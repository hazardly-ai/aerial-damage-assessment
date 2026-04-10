import torch
import torch.nn as nn


class DamageHead(nn.Module):
    def __init__(self, embed_dim: int, hidden_dim: int = 1024, num_classes: int = 4) -> None:
        super().__init__()
        input_dim = embed_dim * 4
        self.classifier = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(p=0.2),
            nn.Linear(hidden_dim, num_classes),
        )

    def forward(self, pre_features: torch.Tensor, post_features: torch.Tensor) -> torch.Tensor:
        delta = post_features - pre_features
        abs_delta = torch.abs(delta)
        fused = torch.cat([pre_features, post_features, delta, abs_delta], dim=-1)
        return self.classifier(fused)

