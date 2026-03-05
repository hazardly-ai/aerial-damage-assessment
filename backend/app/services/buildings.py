import psycopg


def fetch_buildings_by_image_pair(
    conn: psycopg.Connection, disaster_id: int, xbd_id: int
) -> list[dict]:
    # TODO (Shiv): return dicts with "geometry" (ST_AsGeoJSON(geom)) and
    # "properties" (id, uid, image_pair_id, actual_damage, predicted_damage,
    # is_correct, created_at, pixel_coords, geom_bbox via ST_Envelope)
    pass


def fetch_building_by_uid(conn: psycopg.Connection, uid: str) -> dict | None:
    # TODO (Shiv): return single building dict or None
    pass


def fetch_buildings_by_disaster(
    conn: psycopg.Connection, disaster_id: int
) -> list[dict]:
    # TODO (Shiv): join through image_pairs, return geom only, NO geom_bbox
    pass


def fetch_building_bboxes_by_disaster(
    conn: psycopg.Connection, disaster_id: int
) -> list[dict]:
    # TODO (Shiv): return ST_Envelope(geom) as geometry, no pixel_coords
    pass
