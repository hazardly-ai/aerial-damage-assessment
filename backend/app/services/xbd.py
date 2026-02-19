import json

from shapely import wkt
from shapely.geometry import mapping

from app.config import LABELS_DIR


def load_post_disaster_labels(disaster: str, image_pair_id: int) -> dict | None:
    filename = f"{disaster}_{image_pair_id:08d}_post_disaster.json"
    filepath = LABELS_DIR / filename
    if not filepath.is_file():
        return None
    with open(filepath) as f:
        return json.load(f)


def wkt_to_geojson_geometry(wkt_string: str) -> dict:
    geom = wkt.loads(wkt_string)
    return mapping(geom)
