#!/usr/bin/env python3
"""Populate geo_origin/geo_pixel columns on image_pairs from xview_geotransforms.json."""

import json
import sys
import time
from pathlib import Path

import psycopg
from dotenv import dotenv_values

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

env = dotenv_values(BACKEND_DIR / ".env")

DB_HOST = env.get("DB_HOST")
DB_PASSWORD = env.get("DB_PASSWORD")
if not DB_HOST or not DB_PASSWORD:
    sys.exit("DB_HOST and DB_PASSWORD must be set in backend/.env")

DB_PORT = int(env.get("DB_PORT", "5432"))
DB_USER = env.get("DB_USER", "postgres.zbnrjjmqbnqunkjbmsdk")
DB_NAME = env.get("DB_NAME", "postgres")

PROJECT_ROOT = SCRIPT_DIR.parent.parent
GEOTRANSFORMS_PATH = Path(
    env.get("GEOTRANSFORMS_PATH", str(PROJECT_ROOT / "data" / "xview_geotransforms.json"))
)


def main():
    t0 = time.perf_counter()

    with open(GEOTRANSFORMS_PATH) as f:
        transforms = json.load(f)
    print(f"Loaded {len(transforms)} geotransforms")

    with psycopg.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD, connect_timeout=15,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ip.id, d.name, ip.xbd_id
                FROM image_pairs ip
                JOIN disasters d ON d.id = ip.disaster_id
            """)
            rows = cur.fetchall()

            updated = 0
            for pair_id, disaster, xbd_id in rows:
                key = f"{disaster}_{xbd_id:08d}_post_disaster.png"
                entry = transforms.get(key)
                if not entry:
                    continue

                gt = entry[0]
                cur.execute(
                    """UPDATE image_pairs
                       SET geo_origin_lon = %s, geo_origin_lat = %s,
                           geo_pixel_width = %s, geo_pixel_height = %s
                       WHERE id = %s""",
                    (gt[0], gt[3], gt[1], gt[5], pair_id),
                )
                updated += 1

            conn.commit()
            print(f"Updated {updated}/{len(rows)} image pairs")

    print(f"Done in {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
