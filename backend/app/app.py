from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import buildings, disasters, image_pairs

app = FastAPI(title="Hazardly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(disasters.router)
app.include_router(image_pairs.router)
app.include_router(buildings.router)


@app.get("/")
def home_page() -> dict:
    return {
        "title": "Hazardly AI",
        "description": "AI-Powered Disaster Assessment API Service",
        "version": "1.0.0",
        "health": "/health",
        "documentation": {
            "swagger": "/docs",
            "openapi": "/openapi.json"
        },
    }


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
