import modal

app = modal.App("damage-prediction")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "torch",
        "open-clip-torch",
        "pillow",
        "huggingface_hub",
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
def predict_buildings(folder):

    import os
    import glob
    import torch
    import open_clip
    from PIL import Image
    from huggingface_hub import hf_hub_download
    from supabase import create_client

    # ---------- Supabase Setup ----------
    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model_name = "ViT-L-14"

    labels = ["no-damage","minor-damage","major-damage","destroyed"]

    class_prompt_dict = {
        0: [
            "A satellite image of an intact residential building with no visible damage.",
            "Aerial image of a house with a complete roof and no debris or flooding.",
            "Undamaged building after a disaster with no structural failure."
        ],
        1: [
            "Satellite image of a building with minor roof damage.",
            "House with small cracks or slight structural damage but still standing.",
            "Building with light damage and limited visible impact."
        ],
        2: [
            "Satellite image of a building with major structural damage.",
            "House with partial roof collapse or wall damage.",
            "Structure heavily damaged with missing sections or large debris."
        ],
        3: [
            "Satellite image of a completely destroyed building.",
            "House fully collapsed or burned with severe structural failure.",
            "Building reduced to rubble or no longer recognizable."
        ]
    }

    # ---------------- LOAD MODEL ----------------
    checkpoint = hf_hub_download(
        repo_id="chendelong/RemoteCLIP",
        filename=f"RemoteCLIP-{model_name}.pt"
    )

    model, _, preprocess = open_clip.create_model_and_transforms(model_name)
    tokenizer = open_clip.get_tokenizer(model_name)

    ckpt = torch.load(checkpoint, map_location="cpu")
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
    pre_images = glob.glob(f"{folder}/*_pre.png")
    print("Buildings:", len(pre_images))

    for pre_path in pre_images:
        # Extract base filename
        filename = os.path.basename(pre_path).replace("_pre.png","")
        # Extract UUID (the last part after underscores)
        uid = filename.split("_")[-1]

        post_candidates = glob.glob(f"{folder}/{filename}_post*.png")
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

            change_features = post_features - pre_features
            change_features /= change_features.norm(dim=-1, keepdim=True)

            probs = (100.0 * change_features @ text_features.T).softmax(dim=-1)
            probs = probs.cpu().numpy()[0]

        pred_class = probs.argmax()
        pred_label = labels[pred_class]

        print(uid, pred_label)

        # ---------- UPDATE SUPABASE ----------
        supabase.table("buildings").update(
            {"predicted_damage": pred_label}
        ).eq("uid", uid).execute()

    print("Finished")