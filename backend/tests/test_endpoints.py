"""Smoke tests – hit every endpoint against the live Supabase DB."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


# ── Health ───────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Disasters ────────────────────────────────────────────────────────

def test_get_disasters(client):
    r = client.get("/disasters")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    if data:
        assert "id" in data[0]
        assert "name" in data[0]
        assert "type" in data[0]


def test_get_disaster_by_id(client):
    # First grab a valid ID from the list
    r = client.get("/disasters")
    disasters = r.json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    r = client.get(f"/disasters/{did}")
    assert r.status_code == 200
    assert r.json()["id"] == did


def test_get_disaster_not_found(client):
    r = client.get("/disasters/999999")
    assert r.status_code == 404


# ── Image Pairs ──────────────────────────────────────────────────────

def test_get_image_pairs(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    r = client.get(f"/disasters/{did}/image-pairs")
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection"
    assert isinstance(fc["features"], list)
    if fc["features"]:
        feat = fc["features"][0]
        assert feat["type"] == "Feature"
        assert "geometry" in feat
        assert "properties" in feat


def test_get_image_pair_by_id(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    pairs = client.get(f"/disasters/{did}/image-pairs", params={"limit": 1}).json()["features"]
    if not pairs:
        pytest.skip("No image pairs for first disaster")

    xbd_id = pairs[0]["properties"]["xbd_id"]
    r = client.get(f"/disasters/{did}/image-pairs/{xbd_id}")
    assert r.status_code == 200
    feat = r.json()
    assert feat["type"] == "Feature"
    assert feat["properties"]["xbd_id"] == xbd_id


def test_get_image_pair_not_found(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    r = client.get(f"/disasters/{did}/image-pairs/999999")
    assert r.status_code == 404


# ── Buildings ────────────────────────────────────────────────────────

def test_get_buildings_for_image_pair(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    pairs = client.get(f"/disasters/{did}/image-pairs", params={"limit": 1}).json()["features"]
    if not pairs:
        pytest.skip("No image pairs for first disaster")

    xbd_id = pairs[0]["properties"]["xbd_id"]
    r = client.get(f"/disasters/{did}/image-pairs/{xbd_id}/buildings", params={"limit": 5})
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection"
    if fc["features"]:
        feat = fc["features"][0]
        assert "geometry" in feat
        props = feat["properties"]
        assert "uid" in props
        assert "geom_bbox" in props


def test_get_building_by_uid(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    pairs = client.get(f"/disasters/{did}/image-pairs", params={"limit": 1}).json()["features"]
    if not pairs:
        pytest.skip("No image pairs for first disaster")

    xbd_id = pairs[0]["properties"]["xbd_id"]
    buildings = client.get(
        f"/disasters/{did}/image-pairs/{xbd_id}/buildings", params={"limit": 1}
    ).json()["features"]
    if not buildings:
        pytest.skip("No buildings for first image pair")

    uid = buildings[0]["properties"]["uid"]
    r = client.get(f"/buildings/{uid}")
    assert r.status_code == 200
    assert r.json()["properties"]["uid"] == uid


def test_get_building_not_found(client):
    r = client.get("/buildings/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_get_buildings_for_disaster(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    r = client.get(f"/disasters/{did}/buildings")
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection"
    if fc["features"]:
        props = fc["features"][0]["properties"]
        assert "uid" in props
        # This endpoint should NOT have geom_bbox
        assert "geom_bbox" not in props


def test_get_building_bboxes_for_disaster(client):
    disasters = client.get("/disasters").json()
    if not disasters:
        pytest.skip("No disasters in DB")

    did = disasters[0]["id"]
    r = client.get(f"/disasters/{did}/buildings/bbox")
    assert r.status_code == 200
    fc = r.json()
    assert fc["type"] == "FeatureCollection"
    if fc["features"]:
        props = fc["features"][0]["properties"]
        assert "uid" in props
        # This endpoint should NOT have pixel_coords
        assert "pixel_coords" not in props
