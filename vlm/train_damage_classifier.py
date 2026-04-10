import argparse
import glob
import json
import os
import random
from collections import Counter
from typing import Dict, List, Tuple

import open_clip
import torch
import torch.nn as nn
import yaml
from huggingface_hub import hf_hub_download
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader

try:
    from vlm.datasets.paired_disaster_dataset import (
        DEFAULT_LABEL_MAP,
        PairedDisasterDataset,
        discover_paired_samples,
    )
    from vlm.models.damage_head import DamageHead
except ModuleNotFoundError:
    from datasets.paired_disaster_dataset import (
        DEFAULT_LABEL_MAP,
        PairedDisasterDataset,
        discover_paired_samples,
    )
    from models.damage_head import DamageHead


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def split_disasters(
    disasters: List[str],
    val_count: int,
    test_count: int,
    seed: int,
) -> Tuple[List[str], List[str], List[str]]:
    if val_count + test_count >= len(disasters):
        raise ValueError("val_count + test_count must be less than number of disasters.")

    rng = random.Random(seed)
    shuffled = disasters[:]
    rng.shuffle(shuffled)
    val_disasters = sorted(shuffled[:val_count])
    test_disasters = sorted(shuffled[val_count : val_count + test_count])
    train_disasters = sorted(shuffled[val_count + test_count :])
    return train_disasters, val_disasters, test_disasters


def build_loader(samples, transform, batch_size: int, shuffle: bool, num_workers: int) -> DataLoader:
    dataset = PairedDisasterDataset(samples=samples, transform=transform)
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )


def encode_images(model, pre_images, post_images):
    pre_features = model.encode_image(pre_images)
    post_features = model.encode_image(post_images)
    pre_features = pre_features / pre_features.norm(dim=-1, keepdim=True)
    post_features = post_features / post_features.norm(dim=-1, keepdim=True)
    return pre_features, post_features


def evaluate(encoder, head, loader, device):
    encoder.eval()
    head.eval()
    all_targets = []
    all_preds = []
    loss_fn = nn.CrossEntropyLoss()
    running_loss = 0.0
    total = 0

    with torch.no_grad():
        for batch in loader:
            pre_images = batch["pre_image"].to(device)
            post_images = batch["post_image"].to(device)
            labels = batch["label"].to(device)

            pre_features, post_features = encode_images(encoder, pre_images, post_images)
            logits = head(pre_features, post_features)
            loss = loss_fn(logits, labels)

            preds = torch.argmax(logits, dim=-1)
            all_targets.extend(labels.cpu().tolist())
            all_preds.extend(preds.cpu().tolist())
            running_loss += loss.item() * labels.size(0)
            total += labels.size(0)

    avg_loss = running_loss / max(total, 1)
    macro_f1 = f1_score(all_targets, all_preds, average="macro") if all_targets else 0.0
    accuracy = (sum(int(p == t) for p, t in zip(all_preds, all_targets)) / max(len(all_targets), 1))
    return {"loss": avg_loss, "macro_f1": macro_f1, "accuracy": accuracy}


def main():
    parser = argparse.ArgumentParser(description="Train supervised damage classifier on paired disaster crops.")
    parser.add_argument(
        "--config",
        default="vlm/configs/train_damage.yaml",
        help="Path to YAML training config.",
    )
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    set_seed(int(cfg["seed"]))
    device = "cuda" if torch.cuda.is_available() else "cpu"

    os.makedirs(cfg["output_dir"], exist_ok=True)
    os.makedirs(cfg["checkpoint_dir"], exist_ok=True)

    train_include_disasters = cfg["split"].get("train_include_disasters", [])
    val_disasters_cfg = cfg["split"].get("val_disasters", [])
    test_disasters_cfg = cfg["split"].get("test_disasters", [])

    max_pairs = cfg["split"].get("max_pairs_per_disaster")
    all_samples = discover_paired_samples(
        paired_crops_root=cfg["paired_crops_root"],
        label_map=DEFAULT_LABEL_MAP,
        include_disasters=train_include_disasters if train_include_disasters else None,
        max_pairs_per_disaster=int(max_pairs) if max_pairs is not None else None,
        subsample_seed=int(cfg["seed"]),
    )
    if not all_samples:
        raise ValueError("No paired samples found. Check paired_crops_root and file naming.")

    disasters = sorted({s.disaster for s in all_samples})
    if val_disasters_cfg or test_disasters_cfg:
        val_disasters = sorted(val_disasters_cfg)
        test_disasters = sorted(test_disasters_cfg)
        val_set = set(val_disasters)
        test_set = set(test_disasters)
        overlap = val_set & test_set
        if overlap:
            raise ValueError(f"val_disasters and test_disasters overlap: {sorted(overlap)}")

        known = set(disasters)
        unknown_val = sorted(val_set - known)
        unknown_test = sorted(test_set - known)
        if unknown_val or unknown_test:
            raise ValueError(
                f"Unknown disasters in split config. val unknown={unknown_val}, test unknown={unknown_test}"
            )
        train_disasters = sorted(known - val_set - test_set)
    else:
        train_disasters, val_disasters, test_disasters = split_disasters(
            disasters=disasters,
            val_count=int(cfg["split"]["val_disaster_count"]),
            test_count=int(cfg["split"]["test_disaster_count"]),
            seed=int(cfg["seed"]),
        )

    if not train_disasters:
        raise ValueError("No disasters left for training after applying split settings.")

    train_samples = [s for s in all_samples if s.disaster in train_disasters]
    val_samples = [s for s in all_samples if s.disaster in val_disasters]
    test_samples = [s for s in all_samples if s.disaster in test_disasters]

    split_manifest = {
        "train_disasters": train_disasters,
        "val_disasters": val_disasters,
        "test_disasters": test_disasters,
        "train_count": len(train_samples),
        "val_count": len(val_samples),
        "test_count": len(test_samples),
        "max_pairs_per_disaster": max_pairs,
    }
    with open(os.path.join(cfg["output_dir"], "split_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(split_manifest, f, indent=2)

    model_name = cfg["model"]["name"]
    encoder, _, preprocess = open_clip.create_model_and_transforms(model_name)
    remoteclip_ckpt = cfg["model"].get("remoteclip_checkpoint", "")
    if remoteclip_ckpt:
        ckpt_path = remoteclip_ckpt
    else:
        checkpoint_list = glob.glob(r"checkpoints\**\RemoteCLIP-ViT-L-14.pt", recursive=True)
        if not checkpoint_list:
            hf_hub_download(
                repo_id="chendelong/RemoteCLIP",
                filename=f"RemoteCLIP-{model_name}.pt",
                cache_dir=r"vlm\checkpoints",
            )
            checkpoint_list = glob.glob(r"checkpoints\**\RemoteCLIP-ViT-L-14.pt", recursive=True)
            if not checkpoint_list:
                raise FileNotFoundError("RemoteCLIP checkpoint not found after download.")
        ckpt_path = checkpoint_list[-1]
    remoteclip_state = torch.load(ckpt_path, map_location="cpu")
    encoder.load_state_dict(remoteclip_state)
    encoder = encoder.to(device)
    embed_dim = encoder.text_projection.shape[1]

    if cfg["model"]["freeze_encoder"]:
        for p in encoder.parameters():
            p.requires_grad = False

    head = DamageHead(
        embed_dim=embed_dim,
        hidden_dim=int(cfg["model"]["head_hidden_dim"]),
        num_classes=int(cfg["model"]["num_classes"]),
    ).to(device)

    train_loader = build_loader(
        train_samples,
        preprocess,
        batch_size=int(cfg["training"]["batch_size"]),
        shuffle=True,
        num_workers=int(cfg["training"]["num_workers"]),
    )
    val_loader = build_loader(
        val_samples,
        preprocess,
        batch_size=int(cfg["training"]["batch_size"]),
        shuffle=False,
        num_workers=int(cfg["training"]["num_workers"]),
    )
    test_loader = build_loader(
        test_samples,
        preprocess,
        batch_size=int(cfg["training"]["batch_size"]),
        shuffle=False,
        num_workers=int(cfg["training"]["num_workers"]),
    )

    class_counts = Counter(s.label_id for s in train_samples)
    total_train = len(train_samples)
    num_classes = int(cfg["model"]["num_classes"])
    weights = []
    for class_id in range(num_classes):
        count = class_counts.get(class_id, 1)
        weights.append(total_train / (num_classes * count))
    class_weights = torch.tensor(weights, dtype=torch.float32, device=device)

    loss_fn = nn.CrossEntropyLoss(weight=class_weights)

    params = list(head.parameters())
    if not cfg["model"]["freeze_encoder"]:
        params += [p for p in encoder.parameters() if p.requires_grad]

    optimizer = torch.optim.AdamW(
        params,
        lr=float(cfg["training"]["lr"]),
        weight_decay=float(cfg["training"]["weight_decay"]),
    )

    scaler = torch.amp.GradScaler("cuda", enabled=(device == "cuda"))
    best_val_f1 = -1.0
    history: List[Dict] = []

    for epoch in range(1, int(cfg["training"]["epochs"]) + 1):
        encoder.train(not cfg["model"]["freeze_encoder"])
        head.train()
        running_loss = 0.0
        seen = 0

        for batch in train_loader:
            pre_images = batch["pre_image"].to(device)
            post_images = batch["post_image"].to(device)
            labels = batch["label"].to(device)

            optimizer.zero_grad(set_to_none=True)

            with torch.amp.autocast("cuda", dtype=torch.float16, enabled=(device == "cuda")):
                pre_features, post_features = encode_images(encoder, pre_images, post_images)
                logits = head(pre_features, post_features)
                loss = loss_fn(logits, labels)

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(params, max_norm=float(cfg["training"]["max_grad_norm"]))
            scaler.step(optimizer)
            scaler.update()

            running_loss += loss.item() * labels.size(0)
            seen += labels.size(0)

        train_loss = running_loss / max(seen, 1)
        val_metrics = evaluate(encoder, head, val_loader, device)
        test_metrics = evaluate(encoder, head, test_loader, device)

        row = {
            "epoch": epoch,
            "train_loss": train_loss,
            "val_loss": val_metrics["loss"],
            "val_macro_f1": val_metrics["macro_f1"],
            "val_accuracy": val_metrics["accuracy"],
            "test_macro_f1": test_metrics["macro_f1"],
        }
        history.append(row)
        print(row)

        if val_metrics["macro_f1"] > best_val_f1:
            best_val_f1 = val_metrics["macro_f1"]
            ckpt_path = os.path.join(cfg["checkpoint_dir"], "best_damage_classifier.pt")
            torch.save(
                {
                    "config": cfg,
                    "label_map": DEFAULT_LABEL_MAP,
                    "encoder_model_name": model_name,
                    "encoder_state_dict": encoder.state_dict(),
                    "head_state_dict": head.state_dict(),
                    "embed_dim": embed_dim,
                    "head_hidden_dim": int(cfg["model"]["head_hidden_dim"]),
                    "metrics": row,
                },
                ckpt_path,
            )
            print(f"Saved best checkpoint to: {ckpt_path}")

    with open(os.path.join(cfg["output_dir"], "train_history.json"), "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

    print("Training complete.")


if __name__ == "__main__":
    main()

