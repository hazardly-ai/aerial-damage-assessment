import psycopg


def _image_pair_query(where: str) -> str:
    """Build the SELECT for image_pairs with a computed GeoJSON polygon
    derived from the geotransform columns (origin + pixel size + dimensions).
    ``where`` must be a hard-coded SQL fragment — never user input."""
    return f"""
    SELECT
      ST_AsGeoJSON(
        ST_MakeEnvelope(
          LEAST(ip.geo_origin_lon,
                ip.geo_origin_lon + ip.width * ip.geo_pixel_width),
          LEAST(ip.geo_origin_lat,
                ip.geo_origin_lat + ip.height * ip.geo_pixel_height),
          GREATEST(ip.geo_origin_lon,
                   ip.geo_origin_lon + ip.width * ip.geo_pixel_width),
          GREATEST(ip.geo_origin_lat,
                   ip.geo_origin_lat + ip.height * ip.geo_pixel_height),
          4326
        )
      )::json AS geometry,
      json_build_object(
        'id',               ip.id,
        'disaster_id',      ip.disaster_id,
        'xbd_id',           ip.xbd_id,
        'sensor',           ip.sensor,
        'gsd',              ip.gsd,
        'capture_date',     ip.capture_date,
        'off_nadir_angle',  ip.off_nadir_angle,
        'pan_resolution',   ip.pan_resolution,
        'sun_azimuth',      ip.sun_azimuth,
        'sun_elevation',    ip.sun_elevation,
        'target_azimuth',   ip.target_azimuth,
        'width',            ip.width,
        'height',           ip.height,
        'catalog_id',       ip.catalog_id,
        'pre_image_path',   ip.pre_image_path,
        'post_image_path',  ip.post_image_path,
        'created_at',       ip.created_at,
        'geo_origin_lon',   ip.geo_origin_lon,
        'geo_origin_lat',   ip.geo_origin_lat,
        'geo_pixel_width',  ip.geo_pixel_width,
        'geo_pixel_height', ip.geo_pixel_height,
        'geo_refine_affine', ip.geo_refine_affine
      ) AS properties
    FROM image_pairs ip
    {where}
    """


def fetch_image_pairs_by_disaster(
    conn: psycopg.Connection, disaster_id: int, limit: int | None = None,
) -> list[dict]:
    sql = _image_pair_query("WHERE ip.disaster_id = %s ORDER BY ip.xbd_id")
    if limit is not None:
        sql += " LIMIT %s"
    params: tuple = (disaster_id,) if limit is None else (disaster_id, limit)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_image_pair(
    conn: psycopg.Connection, disaster_id: int, xbd_id: int
) -> dict | None:
    sql = _image_pair_query("WHERE ip.disaster_id = %s AND ip.xbd_id = %s")
    with conn.cursor() as cur:
        cur.execute(sql, (disaster_id, xbd_id))
        return cur.fetchone()
