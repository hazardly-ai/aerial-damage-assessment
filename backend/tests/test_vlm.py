import io
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

from app.app import app


@pytest.fixture
def client():
    return TestClient(app)


def _make_png_bytes() -> bytes:
    try:
        from PIL import Image
        img = Image.new("RGB", (64, 64), color="red")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except ImportError:
        def _chunk(chunk_type, data):
            c = chunk_type + data
            return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        sig = b"\x89PNG\r\n\x1a\n"
        ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        raw = zlib.compress(b"\x00\xff\x00\x00")
        idat = _chunk(b"IDAT", raw)
        iend = _chunk(b"IEND", b"")
        return sig + ihdr + idat + iend


def test_evaluate_returns_prediction(client):
    png = _make_png_bytes()
    r = client.post(
        "/vlm/evaluate",
        files={
            "pre_image": ("pre.png", png, "image/png"),
            "post_image": ("post.png", png, "image/png"),
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["is_mock"], bool)
    assert data["prediction"]["damage_class"] in [
        "no-damage", "minor-damage", "major-damage", "destroyed"
    ]
    probs = data["prediction"]["probabilities"]
    assert abs(sum(probs.values()) - 1.0) < 0.01
    assert 0.0 < data["prediction"]["confidence"] <= 1.0
    assert len(data["prediction"]["description"]) > 0


def test_evaluate_rejects_missing_file(client):
    png = _make_png_bytes()
    r = client.post(
        "/vlm/evaluate",
        files={"pre_image": ("pre.png", png, "image/png")},
    )
    assert r.status_code == 422


def test_evaluate_rejects_non_image(client):
    r = client.post(
        "/vlm/evaluate",
        files={
            "pre_image": ("pre.txt", b"not an image", "text/plain"),
            "post_image": ("post.txt", b"not an image", "text/plain"),
        },
    )
    assert r.status_code == 422


def test_evaluate_response_shape(client):
    png = _make_png_bytes()
    r = client.post(
        "/vlm/evaluate",
        files={
            "pre_image": ("pre.png", png, "image/png"),
            "post_image": ("post.png", png, "image/png"),
        },
    )
    data = r.json()
    assert "prediction" in data
    assert "model_version" in data
    assert "is_mock" in data
    pred = data["prediction"]
    assert "damage_class" in pred
    assert "confidence" in pred
    assert "probabilities" in pred
    assert "description" in pred
    probs = pred["probabilities"]
    assert set(probs.keys()) == {"no_damage", "minor_damage", "major_damage", "destroyed"}
