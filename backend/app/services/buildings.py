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
        'address',          b.address,
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
        'address',          b.address,
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
        'address',          b.address,
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
        'address',          b.address,
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


def fetch_paginated_buildings_by_disaster(
    conn: psycopg.Connection,
    disaster_id: int,
    page: int,
    page_size: int,
    damage: str | None = None,
) -> tuple[list[dict], int]:
    offset = (page - 1) * page_size
    params: list[object] = [disaster_id]
    damage_sql = ""

    if damage is not None:
        damage_sql = " AND b.actual_damage::text = %s"
        params.append(damage)

    count_sql = f"""
    SELECT COUNT(*) AS total_count
    FROM buildings b
    JOIN image_pairs ip ON ip.id = b.image_pair_id
    WHERE ip.disaster_id = %s{damage_sql}
    """

    data_sql = f"""
    SELECT
      b.id,
      b.uid::text,
      b.image_pair_id,
      ip.xbd_id,
      b.actual_damage::text,
      b.predicted_damage::text,
      b.is_correct,
      b.created_at,
      ip.pre_image_path,
      ip.post_image_path
    FROM buildings b
    JOIN image_pairs ip ON ip.id = b.image_pair_id
    WHERE ip.disaster_id = %s{damage_sql}
    ORDER BY b.id
    LIMIT %s OFFSET %s
    """

    with conn.cursor() as cur:
        cur.execute(count_sql, tuple(params))
        count_row = cur.fetchone()
        if isinstance(count_row, dict):
            total_count = count_row["total_count"]
        else:
            total_count = count_row[0]

        data_params = [*params, page_size, offset]
        cur.execute(data_sql, tuple(data_params))
        rows = cur.fetchall()

    return rows, total_count


def fetch_building_damage_stats_by_disaster(
    conn: psycopg.Connection,
    disaster_id: int,
) -> dict:
    sql = """
    SELECT
      b.actual_damage::text AS actual_damage,
      COUNT(*) AS count
    FROM buildings b
    JOIN image_pairs ip ON ip.id = b.image_pair_id
    WHERE ip.disaster_id = %s
    GROUP BY b.actual_damage
    """

    with conn.cursor() as cur:
        cur.execute(sql, (disaster_id,))
        rows = cur.fetchall()

    by_damage = {
        "no-damage": 0,
        "minor-damage": 0,
        "major-damage": 0,
        "destroyed": 0,
    }
    for row in rows:
        key = row["actual_damage"]
        by_damage[key] = row["count"]

    total = sum(by_damage.values())

    return {
        "total": total,
        "no_damage": by_damage["no-damage"],
        "by_damage": by_damage,
    }
