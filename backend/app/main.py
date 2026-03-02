from fastapi import FastAPI

app = FastAPI(title="Aerial Damage Assessment API")


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
