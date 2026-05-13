import random

import httpx

from app.config import MODAL_VLM_URL, MODAL_VLM_TOKEN
from app.schemas.vlm import DamageProbabilities, VlmEvaluationResponse, VlmPrediction

DAMAGE_CLASSES = ["no-damage", "minor-damage", "major-damage", "destroyed"]

MOCK_DESCRIPTIONS = {
    "no-damage": "No visible structural damage detected. Building appears intact with roof and walls in pre-disaster condition.",
    "minor-damage": "Minor structural damage observed. Possible roof tile displacement or superficial wall cracks visible in post-disaster imagery.",
    "major-damage": "Significant structural damage detected. Partial roof collapse and wall breach visible. Building is likely uninhabitable.",
    "destroyed": "Building is destroyed. Complete structural failure with debris field visible. No recognizable building structure remains.",
}


def _mock_evaluate() -> VlmEvaluationResponse:
    weights = [0.25, 0.30, 0.25, 0.20]
    damage_class = random.choices(DAMAGE_CLASSES, weights=weights, k=1)[0]

    raw_probs = {c: random.random() * 0.15 for c in DAMAGE_CLASSES}
    raw_probs[damage_class] = random.uniform(0.60, 0.92)
    total = sum(raw_probs.values())
    normalized = {c: round(v / total, 4) for c, v in raw_probs.items()}

    return VlmEvaluationResponse(
        prediction=VlmPrediction(
            damage_class=damage_class,
            confidence=normalized[damage_class],
            probabilities=DamageProbabilities(
                no_damage=normalized["no-damage"],
                minor_damage=normalized["minor-damage"],
                major_damage=normalized["major-damage"],
                destroyed=normalized["destroyed"],
            ),
            description=MOCK_DESCRIPTIONS[damage_class],
        ),
        model_version="mock-v1",
        is_mock=True,
    )


async def _modal_evaluate(pre_image_bytes: bytes, post_image_bytes: bytes) -> VlmEvaluationResponse:
    async with httpx.AsyncClient(timeout=120.0) as client:
        headers = {}
        if MODAL_VLM_TOKEN:
            headers["Authorization"] = f"Bearer {MODAL_VLM_TOKEN}"

        resp = await client.post(
            MODAL_VLM_URL,
            files={
                "pre_image": ("pre.png", pre_image_bytes, "image/png"),
                "post_image": ("post.png", post_image_bytes, "image/png"),
            },
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    predicted_label = data["predicted_label"]
    probs = data["probabilities"]

    return VlmEvaluationResponse(
        prediction=VlmPrediction(
            damage_class=predicted_label,
            confidence=data["confidence"],
            probabilities=DamageProbabilities(
                no_damage=probs["no-damage"],
                minor_damage=probs["minor-damage"],
                major_damage=probs["major-damage"],
                destroyed=probs["destroyed"],
            ),
            description=MOCK_DESCRIPTIONS.get(predicted_label, f"Damage classified as {predicted_label}."),
        ),
        model_version="remoteclip-v1",
        is_mock=False,
        raw_response=data,
    )


async def evaluate_damage(pre_image_bytes: bytes, post_image_bytes: bytes) -> VlmEvaluationResponse:
    if not MODAL_VLM_URL:
        return _mock_evaluate()
    return await _modal_evaluate(pre_image_bytes, post_image_bytes)
