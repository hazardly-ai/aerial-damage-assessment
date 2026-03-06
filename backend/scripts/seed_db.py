#!/usr/bin/env python3
"""Seed Supabase with xBD label data.

Usage:
    1. Set DB_HOST, DB_PASSWORD (and optionally DB_PORT, DB_USER, DB_NAME)
       in backend/.env. See .env for details.

    2. Run:
       cd backend
       python scripts/seed_db.py
"""

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from shapely import wkt
from shapely.geometry import mapping

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
BACKEND_DIR = SCRIPT_DIR.parent

env = dotenv_values(BACKEND_DIR / ".env")

DB_HOST = env.get("DB_HOST")
DB_PASSWORD = env.get("DB_PASSWORD")
if not DB_HOST or not DB_PASSWORD:
    sys.exit("DB_HOST and DB_PASSWORD must be set in backend/.env")

DB_PORT = int(env.get("DB_PORT", "5432"))
DB_USER = env.get("DB_USER", "postgres.zbnrjjmqbnqunkjbmsdk")
DB_NAME = env.get("DB_NAME", "postgres")

LABELS_DIR = Path(env.get("LABELS_DIR", str(PROJECT_ROOT / "data" / "test" / "labels")))
BATCH_SIZE = 500


def parse_file(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def extract_xbd_id(filename: str) -> int:
    stem = filename.replace("_post_disaster", "")
    return int(stem.rsplit("_", 1)[1])


def pixel_wkt_to_coords(wkt_string: str) -> list:
    geom = wkt.loads(wkt_string)
    return mapping(geom)["coordinates"]


def main(disaster_filter: str = None):
    t0 = time.perf_counter()

    label_files = sorted(LABELS_DIR.glob("*_post_disaster.json"))
    if disaster_filter:
        label_files = [f for f in label_files if disaster_filter in f.name]
    
    if not label_files:
        sys.exit(f"No label files in {LABELS_DIR}" + (f" for disaster '{disaster_filter}'" if disaster_filter else ""))

    print(f"Parsing {len(label_files)} files...")
    with ThreadPoolExecutor() as pool:
        parsed = list(pool.map(parse_file, label_files))

    disasters: dict[str, str] = {}
    for data in parsed:
        m = data["metadata"]
        if not disaster_filter or m["disaster"] == disaster_filter:
            disasters.setdefault(m["disaster"], m["disaster_type"])

    print(f"Connecting to {DB_HOST}:{DB_PORT}...")
    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=15,
    ) as conn:
        with conn.cursor() as cur:
            if disaster_filter:
                # Delete only the specific disaster data
                cur.execute("DELETE FROM buildings WHERE image_pair_id IN "
                           "(SELECT id FROM image_pairs WHERE disaster_id IN "
                           "(SELECT id FROM disasters WHERE name = %s))", (disaster_filter,))
                cur.execute("DELETE FROM image_pairs WHERE disaster_id IN "
                           "(SELECT id FROM disasters WHERE name = %s)", (disaster_filter,))
                cur.execute("DELETE FROM disasters WHERE name = %s", (disaster_filter,))
            else:
                # Full reset when no filter provided
                cur.execute("TRUNCATE buildings, image_pairs, disasters RESTART IDENTITY CASCADE")

            disaster_ids = {}
            for name, dtype in sorted(disasters.items()):
                cur.execute(
                    "INSERT INTO disasters (name, type) VALUES (%s, %s) RETURNING id",
                    (name, dtype),
                )
                disaster_ids[name] = cur.fetchone()[0]
            print(f"  disasters: {len(disaster_ids)}")

            all_buildings = []
            for data, fpath in zip(parsed, label_files):
                m = data["metadata"]
                if disaster_filter and m["disaster"] != disaster_filter:
                    continue
                    
                xbd_id = extract_xbd_id(fpath.stem)

                cur.execute(
                    """INSERT INTO image_pairs
                       (disaster_id, xbd_id, sensor, gsd, capture_date,
                        off_nadir_angle, pan_resolution, sun_azimuth,
                        sun_elevation, target_azimuth, width, height, catalog_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       RETURNING id""",
                    (
                        disaster_ids[m["disaster"]],
                        xbd_id,
                        m.get("sensor"),
                        m.get("gsd"),
                        m.get("capture_date"),
                        m.get("off_nadir_angle"),
                        m.get("pan_resolution"),
                        m.get("sun_azimuth"),
                        m.get("sun_elevation"),
                        m.get("target_azimuth"),
                        m.get("width", 1024),
                        m.get("height", 1024),
                        m.get("catalog_id"),
                    ),
                )
                pair_id = cur.fetchone()[0]

                lng_lat = data["features"]["lng_lat"]
                xy = data["features"]["xy"]

                for i, entry in enumerate(lng_lat):
                    props = entry["properties"]
                    pixel_coords = None
                    if i < len(xy):
                        pixel_coords = json.dumps(pixel_wkt_to_coords(xy[i]["wkt"]))

                    all_buildings.append((
                        props["uid"],
                        pair_id,
                        props.get("subtype", "un-classified"),
                        entry["wkt"],
                        pixel_coords,
                    ))

            print(f"  image_pairs: {len(parsed)}")

            total = len(all_buildings)
            print(f"  buildings: {total} (inserting...)")
            for i in range(0, total, BATCH_SIZE):
                batch = all_buildings[i : i + BATCH_SIZE]
                cur.executemany(
                    """INSERT INTO buildings (uid, image_pair_id, actual_damage, geom, pixel_coords)
                       VALUES (%s, %s, %s::damage_level, ST_GeomFromText(%s, 4326), %s::jsonb)""",
                    batch,
                )
                done = min(i + BATCH_SIZE, total)
                print(f"    {done}/{total}", end="\r")

            conn.commit()

    elapsed = time.perf_counter() - t0
    print(f"\nDone in {elapsed:.1f}s")


if __name__ == "__main__":
    disaster_filter = sys.argv[1] if len(sys.argv) > 1 else None
    main(disaster_filter)
