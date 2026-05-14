import io
import os

from fastapi import File
import modal


app = modal.App("damage-single-inference")

image = (
    modal.Image.debian_slim()
    .pip_install(
        "torch",
        "open-clip-torch",
        "pillow",
        "fastapi[standard]",
        "python-multipart",
    )
    .add_local_python_source("vlm")
    .add_local_file(
        "vlm/checkpoints/best_damage_classifier.pt",
        "/models/best_damage_classifier.pt",
    )
)


@app.cls(
    image=image,
    gpu="T4",
    scaledown_window=60 * 5,
    timeout=60 * 5,
)
class DamageClassifier:
    @modal.enter()
    def load(self) -> None:
        import open_clip
        import torch

        from vlm.models.damage_head import DamageHead

        checkpoint_path = os.environ.get(
            "CHECKPOINT_PATH",
            "/models/best_damage_classifier.pt",
        )
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        checkpoint = torch.load(checkpoint_path, map_location=self.device)
        encoder_model_name = checkpoint["encoder_model_name"]

        self.encoder, _, self.preprocess = open_clip.create_model_and_transforms(
            encoder_model_name
        )
        self.encoder.load_state_dict(checkpoint["encoder_state_dict"])
        self.encoder = self.encoder.to(self.device).eval()

        self.head = DamageHead(
            embed_dim=int(checkpoint["embed_dim"]),
            hidden_dim=int(checkpoint["head_hidden_dim"]),
            num_classes=len(checkpoint["label_map"]),
        ).to(self.device)
        self.head.load_state_dict(checkpoint["head_state_dict"])
        self.head.eval()

        self.labels = [None] * len(checkpoint["label_map"])
        for label_name, idx in checkpoint["label_map"].items():
            self.labels[idx] = label_name

    @modal.web_endpoint(method="POST", docs=True)
    def classify(
        self,
        pre_image: bytes = File(...),
        post_image: bytes = File(...),
    ) -> dict:
        from contextlib import nullcontext

        import torch
        from PIL import Image

        pre_pil = Image.open(io.BytesIO(pre_image)).convert("RGB")
        post_pil = Image.open(io.BytesIO(post_image)).convert("RGB")

        pre_tensor = self.preprocess(pre_pil).unsqueeze(0).to(self.device)
        post_tensor = self.preprocess(post_pil).unsqueeze(0).to(self.device)

        amp_ctx = (
            torch.amp.autocast("cuda", dtype=torch.float16)
            if self.device == "cuda"
            else nullcontext()
        )

        with torch.no_grad():
            with amp_ctx:
                pre_features = self.encoder.encode_image(pre_tensor)
                post_features = self.encoder.encode_image(post_tensor)
                pre_features /= pre_features.norm(dim=-1, keepdim=True)
                post_features /= post_features.norm(dim=-1, keepdim=True)
                logits = self.head(pre_features, post_features)
                probs = logits.softmax(dim=-1)[0].detach().cpu().tolist()

        best_idx = max(range(len(probs)), key=probs.__getitem__)
        probabilities = {label: float(probs[i]) for i, label in enumerate(self.labels)}

        return {
            "predicted_label": self.labels[best_idx],
            "confidence": float(probs[best_idx]),
            "probabilities": probabilities,
        }
