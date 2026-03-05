import psycopg


def fetch_image_pairs_by_disaster(
    conn: psycopg.Connection, disaster_id: int
) -> list[dict]:
    # TODO (Shiv): return list of dicts, each with "geometry" (GeoJSON polygon
    # from geotransform fields) and "properties" (all image_pair columns)
    pass


def fetch_image_pair(
    conn: psycopg.Connection, disaster_id: int, xbd_id: int
) -> dict | None:
    # TODO (Shiv): return single image pair dict (same shape) or None
    pass
