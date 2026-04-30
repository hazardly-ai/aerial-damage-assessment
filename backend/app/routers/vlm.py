from fastapi import APIRouter, HTTPException, UploadFile

from app.schemas.vlm import VlmEvaluationResponse
from app.services.vlm import evaluate_damage

router = APIRouter(prefix="/vlm", tags=["vlm"])

ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _validate_image(file: UploadFile, label: str) -> None:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"{label} must be PNG, JPEG, or WebP (got {file.content_type})",
        )


@router.post("/evaluate", response_model=VlmEvaluationResponse)
async def evaluate(pre_image: UploadFile, post_image: UploadFile):
    _validate_image(pre_image, "pre_image")
    _validate_image(post_image, "post_image")

    pre_bytes = await pre_image.read()
    post_bytes = await post_image.read()

    if len(pre_bytes) > MAX_FILE_SIZE or len(post_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Image file exceeds 10 MB limit")

    return await evaluate_damage(pre_bytes, post_bytes)
