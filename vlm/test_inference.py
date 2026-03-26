import torch, open_clip
from PIL import Image
from huggingface_hub import hf_hub_download
import glob

# ---------------- CONFIG ----------------
model_name = "ViT-L-14"  # 'RN50' or 'ViT-B-32' or 'ViT-L-14'
device = "cuda" if torch.cuda.is_available() else "cpu"

# Images
pre_image_path = "../imagery/paired_crops/santa-rosa-wildfire/santa-rosa-wildfire_00000217_c8eab17d_pre.png"
post_image_path = "../imagery/paired_crops/santa-rosa-wildfire/santa-rosa-wildfire_00000217_c8eab17d_post_destroyed.png"

# ---------------- TEXT PROMPTS (MULTIPLE PER CLASS) ----------------
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

labels = ["No Damage (0)", "Minor Damage (1)", "Major Damage (2)", "Destroyed (3)"]

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

# ---------------- LOAD IMAGES ----------------
pre_image = preprocess(Image.open(pre_image_path)).unsqueeze(0).to(device)
post_image = preprocess(Image.open(post_image_path)).unsqueeze(0).to(device)

# ---------------- ENCODE TEXT (AVERAGE PER CLASS) ----------------
with torch.no_grad(), torch.cuda.amp.autocast(enabled=(device=="cuda")):

    class_embeddings = []

    for class_id in sorted(class_prompt_dict.keys()):
        prompts = class_prompt_dict[class_id]

        tokens = tokenizer(prompts).to(device)
        text_features = model.encode_text(tokens)

        # Normalize each prompt embedding
        text_features /= text_features.norm(dim=-1, keepdim=True)

        # Average prompts for this class
        avg_feature = text_features.mean(dim=0)

        # Normalize averaged embedding
        avg_feature /= avg_feature.norm()

        class_embeddings.append(avg_feature)

    text_features = torch.stack(class_embeddings)

# ---------------- INFERENCE ----------------
with torch.no_grad(), torch.cuda.amp.autocast(enabled=(device=="cuda")):

    pre_features = model.encode_image(pre_image)
    post_features = model.encode_image(post_image)

    # Normalize
    pre_features /= pre_features.norm(dim=-1, keepdim=True)
    post_features /= post_features.norm(dim=-1, keepdim=True)

    # Compute change embedding
    change_features = post_features - pre_features
    change_features /= change_features.norm(dim=-1, keepdim=True)

    # Compare change to damage prompts
    probs = (100.0 * change_features @ text_features.T).softmax(dim=-1)
    probs = probs.cpu().numpy()[0]

# ---------------- RESULT ----------------
predicted_class = probs.argmax()

print("\nClass Probabilities:")
for label, p in zip(labels, probs):
    print(f"{label:<20}: {p*100:5.2f}%")

print(f"\nPredicted Damage Class: {labels[predicted_class]}")