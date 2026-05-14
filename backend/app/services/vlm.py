import random
from typing import Any

import httpx
from fastapi import HTTPException

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


def _parse_probabilities(raw: Any) -> DamageProbabilities:
    if not isinstance(raw, dict):
        raise ValueError("probabilities must be a JSON object")

    def pick(label: str, *keys: str) -> float:
        for k in keys:
            if k in raw and raw[k] is not None:
                return float(raw[k])
        available_keys = sorted(raw.keys())
        raise ValueError(
            f"probabilities missing {label}; tried {keys!s}, have keys {available_keys}"
        )

    return DamageProbabilities(
        no_damage=pick("no_damage", "no_damage", "no-damage"),
        minor_damage=pick("minor_damage", "minor_damage", "minor-damage"),
        major_damage=pick("major_damage", "major_damage", "major-damage"),
        destroyed=pick("destroyed", "destroyed"),
    )


def _label_keys_present(d: dict[str, Any]) -> bool:
    return "damage_class" in d or "predicted_label" in d


def _extract_prediction_dict(data: dict[str, Any]) -> dict[str, Any]:
    """Modal apps may return our nested shape, a flat object, or a wrapped payload."""
    pred = data.get("prediction")
    if isinstance(pred, dict) and "probabilities" in pred and _label_keys_present(pred):
        return pred

    for wrap in ("result", "data", "output", "response"):
        inner = data.get(wrap)
        if not isinstance(inner, dict):
            continue
        ip = inner.get("prediction")
        if isinstance(ip, dict) and "probabilities" in ip and _label_keys_present(ip):
            return ip
        if "probabilities" in inner and _label_keys_present(inner):
            return inner

    if "probabilities" in data and _label_keys_present(data):
        return data

    raise KeyError("prediction")


def _modal_json_to_response(data: Any) -> VlmEvaluationResponse:
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=502,
            detail=f"Modal VLM response must be a JSON object, got {type(data).__name__}",
        )

    try:
        pred = dict(_extract_prediction_dict(data))
        if "damage_class" not in pred and "predicted_label" in pred:
            pred["damage_class"] = pred["predicted_label"]
        damage_class = str(pred["damage_class"])
        probs = _parse_probabilities(pred["probabilities"])
        desc = str(pred.get("description") or "").strip()
        if not desc:
            desc = MOCK_DESCRIPTIONS.get(
                damage_class,
                f"Damage classified as {damage_class}.",
            )
        return VlmEvaluationResponse(
            prediction=VlmPrediction(
                damage_class=damage_class,
                confidence=float(pred["confidence"]),
                probabilities=probs,
                description=desc,
            ),
            model_version=str(
                data.get("model_version") or pred.get("model_version") or "remoteclip-v1"
            ),
            is_mock=False,
            raw_response=data,
        )
    except (KeyError, TypeError, ValueError) as e:
        top_keys = sorted(data.keys())
        raise HTTPException(
            status_code=502,
            detail=(
                "Modal VLM JSON did not match any supported shape "
                f"({type(e).__name__}: {e}). Top-level keys: {top_keys}"
            ),
        ) from e


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

    return _modal_json_to_response(data)


async def evaluate_damage(pre_image_bytes: bytes, post_image_bytes: bytes) -> VlmEvaluationResponse:
    if not MODAL_VLM_URL:
        return _mock_evaluate()
    return await _modal_evaluate(pre_image_bytes, post_image_bytes)
