from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import image_pairs

app = FastAPI(title="Aerial Damage Assessment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(image_pairs.router)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
