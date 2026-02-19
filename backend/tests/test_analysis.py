VALID_LABELS = {
    "no-damage",
    "minor-damage",
    "major-damage",
    "destroyed",
    "un-classified",
}


def test_analysis_returns_geojson(client):
    resp = client.get("/image-pair/hurricane-harvey/510/analysis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    assert body["disaster"] == "hurricane-harvey"
    assert body["image_pair_id"] == 510
    assert len(body["features"]) == 75
    feat = body["features"][0]
    assert feat["type"] == "Feature"
    assert "coordinates" in feat["geometry"]
    assert feat["geometry"]["type"] == "Polygon"
    assert "uid" in feat["properties"]
    assert "original_label" in feat["properties"]
    assert "vlm_label" in feat["properties"]


def test_analysis_404_bad_disaster(client):
    resp = client.get("/image-pair/nonexistent-disaster/1/analysis")
    assert resp.status_code == 404


def test_analysis_404_bad_id(client):
    resp = client.get("/image-pair/hurricane-harvey/999999/analysis")
    assert resp.status_code == 404


def test_analysis_invalid_id_type(client):
    resp = client.get("/image-pair/hurricane-harvey/abc/analysis")
    assert resp.status_code == 422


def test_analysis_empty_features(client):
    resp = client.get("/image-pair/hurricane-florence/56/analysis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"] == []


def test_analysis_feature_labels(client):
    resp = client.get("/image-pair/hurricane-harvey/510/analysis")
    body = resp.json()
    for feat in body["features"]:
        assert feat["properties"]["original_label"] in VALID_LABELS
        assert feat["properties"]["vlm_label"] in VALID_LABELS


def test_health_still_works(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
