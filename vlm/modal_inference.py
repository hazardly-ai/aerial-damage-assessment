import modal

app = modal.App("damage-prediction")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "torch",
        "open-clip-torch",
        "pillow",
        "supabase",
        "psycopg2-binary"
    )
)

volume = modal.Volume.from_name("disaster-images", create_if_missing=False)

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/images": volume},
    timeout=60 * 60
)
def predict_buildings(folder, batch_size: int = 100, checkpoint_path: str = ""):
    import os
    import glob
    import torch
    import open_clip
    from PIL import Image
    from supabase import create_client
    try:
        from vlm.models.damage_head import DamageHead
    except ModuleNotFoundError:
        from models.damage_head import DamageHead

    # ---------- Supabase Setup ----------
    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if not checkpoint_path:
        raise ValueError("checkpoint_path is required.")
    checkpoint = torch.load(checkpoint_path, map_location=device)
    model_name = checkpoint["encoder_model_name"]
    model, _, preprocess = open_clip.create_model_and_transforms(model_name)
    model.load_state_dict(checkpoint["encoder_state_dict"])
    model = model.to(device).eval()

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

    # ---------- PROCESS IMAGES ----------
    pre_images = sorted(glob.glob(os.path.join(folder, "*_pre.png")))
    print("Total buildings:", len(pre_images))

    batch_updates = []
    for pre_path in pre_images:
        filename = os.path.basename(pre_path).replace("_pre.png", "")
        uid = filename.split("_")[-1]

        post_candidates = sorted(glob.glob(os.path.join(folder, f"{filename}_post*.png")))
        if not post_candidates:
            continue

        post_path = post_candidates[0]

        pre_image = preprocess(Image.open(pre_path)).unsqueeze(0).to(device)
        post_image = preprocess(Image.open(post_path)).unsqueeze(0).to(device)

        with torch.no_grad():
            pre_features = model.encode_image(pre_image)
            post_features = model.encode_image(post_image)
            pre_features /= pre_features.norm(dim=-1, keepdim=True)
            post_features /= post_features.norm(dim=-1, keepdim=True)

            logits = head(pre_features, post_features)
            probs = logits.softmax(dim=-1)
            probs = probs.cpu().numpy()[0]

        pred_class = probs.argmax()
        pred_label = labels[pred_class]

        batch_updates.append({"uid": uid, "predicted_damage": pred_label})
        print(f"{uid}: {pred_label}")

        # ---------- BATCH UPSERT ----------
        if len(batch_updates) >= batch_size:
            supabase.table("buildings").upsert(batch_updates).execute()
            batch_updates = []

    # Insert any remaining updates
    if batch_updates:
        supabase.table("buildings").upsert(batch_updates).execute()

    print("Finished")