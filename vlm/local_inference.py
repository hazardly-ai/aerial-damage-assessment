import argparse
import glob
import os
from contextlib import nullcontext
from dotenv import load_dotenv

import open_clip
import torch
from huggingface_hub import hf_hub_download
from PIL import Image
from supabase import create_client


def predict_buildings(
    folder: str,
    batch_size: int = 100,
    infer_batch_size: int = 32,
) -> None:
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
    model_name = "ViT-L-14"

    labels = ["no-damage", "minor-damage", "major-damage", "destroyed"]

    class_prompt_dict = {
        0: [
            "A satellite image of an intact residential building with no visible damage.",
            "Aerial image of a house with a complete roof and no debris or flooding.",
            "Undamaged building after a disaster with no structural failure.",
        ],
        1: [
            "Satellite image of a building with minor roof damage.",
            "House with small cracks or slight structural damage but still standing.",
            "Building with light damage and limited visible impact.",
        ],
        2: [
            "Satellite image of a building with major structural damage.",
            "House with partial roof collapse or wall damage.",
            "Structure heavily damaged with missing sections or large debris.",
        ],
        3: [
            "Satellite image of a completely destroyed building.",
            "House fully collapsed or burned with severe structural failure.",
            "Building reduced to rubble or no longer recognizable.",
        ],
    }

    # ---------------- FIND CHECKPOINT ----------------
    checkpoint_list = glob.glob(r"checkpoints\**\RemoteCLIP-ViT-L-14.pt", recursive=True)
    if not checkpoint_list:
        # If not found, download automatically to checkpoints folder
        print("Checkpoint not found in snapshots. Downloading from Huggingface...")
        hf_hub_download(
            repo_id="chendelong/RemoteCLIP",
            filename=f"RemoteCLIP-{model_name}.pt",
            cache_dir=r"vlm\checkpoints"
        )
        checkpoint_list = glob.glob(r"checkpoints\**\RemoteCLIP-ViT-L-14.pt", recursive=True)
        if not checkpoint_list:
            raise FileNotFoundError("Checkpoint still not found after downloading!")
    checkpoint_path = checkpoint_list[-1]  # pick the last one if multiple
    print(f"Using checkpoint: {checkpoint_path}")

    # ---------------- LOAD MODEL ----------------
    model, _, preprocess = open_clip.create_model_and_transforms(model_name)
    tokenizer = open_clip.get_tokenizer(model_name)

    ckpt = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(ckpt)
    model = model.to(device).eval()

    # ---------------- TEXT EMBEDDINGS ----------------
    with torch.no_grad():
        class_embeddings = []
        for class_id in sorted(class_prompt_dict.keys()):
            prompts = class_prompt_dict[class_id]
            tokens = tokenizer(prompts).to(device)
            text_features = model.encode_text(tokens)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            avg = text_features.mean(dim=0)
            avg /= avg.norm()
            class_embeddings.append(avg)
        text_features = torch.stack(class_embeddings)

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

                change_features = post_features - pre_features
                change_features /= change_features.norm(dim=-1, keepdim=True)

                probs_batch = (100.0 * change_features @ text_features.T).softmax(dim=-1)

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
        description="Run local RemoteCLIP damage inference and update existing Supabase building rows by uid."
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
    args = parser.parse_args()

    predict_buildings(
        args.folder,
        batch_size=args.batch_size,
        infer_batch_size=args.infer_batch_size,
    )


if __name__ == "__main__":
    main()
