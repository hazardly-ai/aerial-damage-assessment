import argparse
import json
from collections import defaultdict

import open_clip
import torch
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from torch.utils.data import DataLoader

try:
    from vlm.datasets.paired_disaster_dataset import PairedDisasterDataset, discover_paired_samples
    from vlm.models.damage_head import DamageHead
except ModuleNotFoundError:
    from datasets.paired_disaster_dataset import PairedDisasterDataset, discover_paired_samples
    from models.damage_head import DamageHead


def evaluate_by_loader(encoder, head, loader, device):
    encoder.eval()
    head.eval()
    y_true = []
    y_pred = []
    per_disaster = defaultdict(lambda: {"y_true": [], "y_pred": []})

    with torch.no_grad():
        for batch in loader:
            pre_images = batch["pre_image"].to(device)
            post_images = batch["post_image"].to(device)
            labels = batch["label"].to(device)

            pre_features = encoder.encode_image(pre_images)
            post_features = encoder.encode_image(post_images)
            pre_features = pre_features / pre_features.norm(dim=-1, keepdim=True)
            post_features = post_features / post_features.norm(dim=-1, keepdim=True)

            logits = head(pre_features, post_features)
            preds = logits.argmax(dim=-1).cpu().tolist()
            targets = labels.cpu().tolist()

            y_true.extend(targets)
            y_pred.extend(preds)

            for disaster, t, p in zip(batch["disaster"], targets, preds):
                per_disaster[disaster]["y_true"].append(t)
                per_disaster[disaster]["y_pred"].append(p)

    return y_true, y_pred, per_disaster


def main():
    parser = argparse.ArgumentParser(description="Evaluate trained damage classifier.")
    parser.add_argument("--checkpoint", required=True, help="Path to model checkpoint.")
    parser.add_argument("--paired-crops-root", required=True, help="Root path to paired disaster crops.")
    parser.add_argument(
        "--disasters",
        nargs="*",
        default=None,
        help="Optional subset of disaster folders to evaluate.",
    )
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument(
        "--max-pairs-per-disaster",
        type=int,
        default=None,
        help="Optional cap on pairs per disaster folder (random subsample, use --subsample-seed for reproducibility).",
    )
    parser.add_argument(
        "--subsample-seed",
        type=int,
        default=42,
        help="RNG seed when --max-pairs-per-disaster is set.",
    )
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(args.checkpoint, map_location=device)
    label_map = checkpoint["label_map"]
    id_to_label = {v: k for k, v in label_map.items()}
    class_names = [id_to_label[i] for i in range(len(id_to_label))]

    model_name = checkpoint["encoder_model_name"]
    encoder, _, preprocess = open_clip.create_model_and_transforms(model_name)
    encoder.load_state_dict(checkpoint["encoder_state_dict"])
    encoder = encoder.to(device).eval()

    head = DamageHead(
        embed_dim=int(checkpoint["embed_dim"]),
        hidden_dim=int(checkpoint["head_hidden_dim"]),
        num_classes=len(label_map),
    ).to(device)
    head.load_state_dict(checkpoint["head_state_dict"])
    head.eval()

    samples = discover_paired_samples(
        paired_crops_root=args.paired_crops_root,
        label_map=label_map,
        include_disasters=args.disasters,
        max_pairs_per_disaster=args.max_pairs_per_disaster,
        subsample_seed=args.subsample_seed,
    )
    dataset = PairedDisasterDataset(samples=samples, transform=preprocess)
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=torch.cuda.is_available(),
    )

    y_true, y_pred, per_disaster = evaluate_by_loader(encoder, head, loader, device)

    report = classification_report(y_true, y_pred, target_names=class_names, digits=4, output_dict=True)
    cm = confusion_matrix(y_true, y_pred).tolist()
    summary = {
        "num_samples": len(y_true),
        "accuracy": accuracy_score(y_true, y_pred),
        "macro_f1": f1_score(y_true, y_pred, average="macro"),
        "confusion_matrix": cm,
        "classification_report": report,
        "per_disaster_macro_f1": {},
    }

    for disaster, values in per_disaster.items():
        if not values["y_true"]:
            continue
        summary["per_disaster_macro_f1"][disaster] = f1_score(
            values["y_true"], values["y_pred"], average="macro"
        )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

