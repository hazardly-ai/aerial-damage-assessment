import psycopg


def fetch_buildings_by_image_pair(
    conn: psycopg.Connection, disaster_id: int, xbd_id: int,
    limit: int | None = None,
) -> list[dict]:
    sql = """
    SELECT
      ST_AsGeoJSON(b.geom)::json AS geometry,
      json_build_object(
        'id',               b.id,
        'uid',              b.uid::text,
        'image_pair_id',    b.image_pair_id,
        'actual_damage',    b.actual_damage::text,
        'predicted_damage', b.predicted_damage::text,
        'is_correct',       b.is_correct,
        'created_at',       b.created_at,
        'geom_bbox',        ST_AsGeoJSON(ST_Envelope(b.geom))::json
      ) AS properties
    FROM buildings b
    WHERE b.image_pair_id = (
      SELECT id FROM image_pairs
      WHERE disaster_id = %s AND xbd_id = %s
    )
    ORDER BY b.id
    """
    if limit is not None:
        sql += " LIMIT %s"
    params: tuple = (disaster_id, xbd_id) if limit is None else (disaster_id, xbd_id, limit)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_building_by_uid(conn: psycopg.Connection, uid: str) -> dict | None:
    sql = """
    SELECT
      ST_AsGeoJSON(b.geom)::json AS geometry,
      json_build_object(
        'id',               b.id,
        'uid',              b.uid::text,
        'image_pair_id',    b.image_pair_id,
        'actual_damage',    b.actual_damage::text,
        'predicted_damage', b.predicted_damage::text,
        'is_correct',       b.is_correct,
        'created_at',       b.created_at,
        'geom_bbox',        ST_AsGeoJSON(ST_Envelope(b.geom))::json
      ) AS properties
    FROM buildings b
    WHERE b.uid = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (uid,))
        return cur.fetchone()


def fetch_buildings_by_disaster(
    conn: psycopg.Connection, disaster_id: int
) -> list[dict]:
    sql = """
    SELECT
      ST_AsGeoJSON(b.geom)::json AS geometry,
      json_build_object(
        'id',               b.id,
        'uid',              b.uid::text,
        'image_pair_id',    b.image_pair_id,
        'actual_damage',    b.actual_damage::text,
        'predicted_damage', b.predicted_damage::text,
        'is_correct',       b.is_correct,
        'created_at',       b.created_at
      ) AS properties
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE ip.disaster_id = %s
    ORDER BY b.id
    """
    with conn.cursor() as cur:
        cur.execute(sql, (disaster_id,))
        return cur.fetchall()


def fetch_building_bboxes_by_disaster(
    conn: psycopg.Connection, disaster_id: int
) -> list[dict]:
    sql = """
    SELECT
      ST_AsGeoJSON(ST_Envelope(b.geom))::json AS geometry,
      json_build_object(
        'id',               b.id,
        'uid',              b.uid::text,
        'image_pair_id',    b.image_pair_id,
        'actual_damage',    b.actual_damage::text,
        'predicted_damage', b.predicted_damage::text,
        'is_correct',       b.is_correct,
        'created_at',       b.created_at
      ) AS properties
    FROM buildings b
    JOIN image_pairs ip ON b.image_pair_id = ip.id
    WHERE ip.disaster_id = %s
    ORDER BY b.id
    """
    with conn.cursor() as cur:
        cur.execute(sql, (disaster_id,))
        return cur.fetchall()
