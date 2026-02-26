import torch, open_clip
from PIL import Image
from huggingface_hub import hf_hub_download
import glob

# ---------------- CONFIG ----------------
model_name = "ViT-L-14"  # 'RN50' or 'ViT-B-32' or 'ViT-L-14'
device = "cuda" if torch.cuda.is_available() else "cpu"

# Images
pre_image_path = "../imagery/paired_crops/hurricane-harvey/hurricane-harvey_00000510_5b4baf2e_pre.png"
post_image_path = "../imagery/paired_crops/hurricane-harvey/hurricane-harvey_00000510_5b4baf2e_post_minor-damage.png"

# Text queries
class_prompts = [
    "No visible change between before and after disaster. The building is undamaged.",
    "Minor visible damage after the disaster. Small roof damage or cracks.",
    "Major structural damage after the disaster. Partial roof or wall collapse.",
    "The building is completely destroyed after the disaster."
]

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

# ---------------- TOKENIZE TEXT ----------------
text_tokens = tokenizer(class_prompts).to(device)

# ---------------- INFERENCE ----------------
with torch.no_grad(), torch.cuda.amp.autocast(enabled=(device=="cuda")):

    pre_features = model.encode_image(pre_image)
    post_features = model.encode_image(post_image)
    text_features = model.encode_text(text_tokens)

    # Normalize
    pre_features /= pre_features.norm(dim=-1, keepdim=True)
    post_features /= post_features.norm(dim=-1, keepdim=True)
    text_features /= text_features.norm(dim=-1, keepdim=True)

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