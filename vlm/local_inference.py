import argparse
import glob
import os
from contextlib import nullcontext

from dotenv import load_dotenv
import open_clip
import torch
from PIL import Image
from supabase import create_client

try:
    from vlm.models.damage_head import DamageHead
except ModuleNotFoundError:
    from models.damage_head import DamageHead


def _load_trained_model(device: str, checkpoint_path: str):
    checkpoint = torch.load(checkpoint_path, map_location=device)
    model_name = checkpoint["encoder_model_name"]
    encoder, _, preprocess = open_clip.create_model_and_transforms(model_name)
    encoder.load_state_dict(checkpoint["encoder_state_dict"])
    encoder = encoder.to(device).eval()

    head = DamageHead(
        embed_dim=int(checkpoint["embed_dim"]),
        hidden_dim=int(checkpoint["head_hidden_dim"]),
        num_classes=len(checkpoint["label_map"]),
    ).to(device)
    head.load_state_dict(checkpoint["head_state_dict"])
    head.eval()

    labels = [None] * len(checkpoint["label_map"])
    for label_name, idx in checkpoint["label_map"].items():
        labels[idx] = label_name
    return encoder, head, preprocess, labels


def predict_buildings(folder: str, batch_size: int = 100, infer_batch_size: int = 32, checkpoint: str = "") -> None:
    # Load environment variables from .env file
    load_dotenv()
    
    # ---------- Supabase Setup ----------
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
    
    if not supabase_url:
        raise ValueError("SUPABASE_URL environment variable not found. Please set it in your .env file.")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_KEY environment variable not found. Please set it in your .env file.")
    
    supabase = create_client(supabase_url, supabase_key)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if not checkpoint:
        raise ValueError("Requires --checkpoint path/to/best_damage_classifier.pt")
    model, head, preprocess, labels = _load_trained_model(device, checkpoint)

    # ---------- PROCESS IMAGES ----------
    pre_images = sorted(glob.glob(os.path.join(folder, "*_pre.png")))
    print("Total buildings:", len(pre_images))

    # Build valid (uid, pre, post) pairs once to avoid per-image glob overhead.
    pairs = []
    for pre_path in pre_images:
        filename = os.path.basename(pre_path).replace("_pre.png", "")
        uid = filename.split("_")[-1]
        post_candidates = sorted(glob.glob(os.path.join(folder, f"{filename}_post*.png")))
        if not post_candidates:
            continue
        pairs.append((uid, pre_path, post_candidates[0]))

    print(f"Paired buildings found: {len(pairs)}")

    updated_count = 0
    missing_uid_count = 0
    processed_count = 0
    amp_ctx = (
        torch.amp.autocast("cuda", dtype=torch.float16)
        if device == "cuda"
        else nullcontext()
    )

    for start in range(0, len(pairs), infer_batch_size):
        batch = pairs[start:start + infer_batch_size]
        uids = [uid for uid, _, _ in batch]

        pre_tensors = []
        post_tensors = []
        for _, pre_path, post_path in batch:
            pre_tensors.append(preprocess(Image.open(pre_path).convert("RGB")))
            post_tensors.append(preprocess(Image.open(post_path).convert("RGB")))

        pre_images_batch = torch.stack(pre_tensors, dim=0).to(device)
        post_images_batch = torch.stack(post_tensors, dim=0).to(device)

        with torch.no_grad():
            with amp_ctx:
                pre_features = model.encode_image(pre_images_batch)
                post_features = model.encode_image(post_images_batch)
                pre_features /= pre_features.norm(dim=-1, keepdim=True)
                post_features /= post_features.norm(dim=-1, keepdim=True)
                logits = head(pre_features, post_features)
                probs_batch = logits.softmax(dim=-1)

        pred_indices = probs_batch.argmax(dim=-1).cpu().tolist()
        pred_labels = [labels[idx] for idx in pred_indices]

        for uid, pred_label in zip(uids, pred_labels):
            # ---------- UPDATE ONLY (NO INSERTS) ----------
            response = (
                supabase.table("buildings")
                .update({"predicted_damage": pred_label})
                .eq("uid", uid)
                .execute()
            )

            if response.data:
                updated_count += 1
                print(f"{uid}: {pred_label}")
            else:
                missing_uid_count += 1
                print(f"{uid}: skipped (uid not found in buildings table)")

            processed_count += 1
            if processed_count % batch_size == 0:
                print(
                    f"Progress: {processed_count}/{len(pairs)} processed | "
                    f"updated={updated_count} skipped={missing_uid_count}"
                )
                print(
                    f"Database update progress: {updated_count} rows updated, "
                    f"{missing_uid_count} skipped"
                )

    print(
        f"Finished: processed={processed_count}, "
        f"updated={updated_count}, skipped={missing_uid_count}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run trained RemoteCLIP + damage head inference and update existing Supabase building rows by uid."
    )
    parser.add_argument("folder", help="Folder containing *_pre.png and *_post*.png building crops.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Progress logging interval for processed records.",
    )
    parser.add_argument(
        "--infer-batch-size",
        type=int,
        default=32,
        help="How many pre/post crop pairs to run in one model forward pass.",
    )
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="Path to trained model checkpoint (encoder + damage head).",
    )
    args = parser.parse_args()

    predict_buildings(
        args.folder,
        batch_size=args.batch_size,
        infer_batch_size=args.infer_batch_size,
        checkpoint=args.checkpoint,
    )


if __name__ == "__main__":
    main()
