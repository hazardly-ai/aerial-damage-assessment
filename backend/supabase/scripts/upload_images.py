#!/usr/bin/env python3
"""Upload satellite images to Supabase Storage and update image_pairs paths.

Usage:
    cd backend
    python scripts/upload_images.py
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
import psycopg
from dotenv import dotenv_values

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
BACKEND_DIR = SCRIPT_DIR.parent.parent

env = dotenv_values(BACKEND_DIR / ".env")

SUPABASE_URL = env.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = env.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")

IMAGES_DIR = Path(env.get("IMAGES_DIR", str(PROJECT_ROOT / "data" / "test" / "images")))
BUCKET = "satellite-images"
MAX_WORKERS = 10


def upload_image(client: httpx.Client, filepath: Path) -> tuple[str, bool]:
    filename = filepath.name
    parts = filename.replace("_pre_disaster.png", "").replace("_post_disaster.png", "").rsplit("_", 1)
    disaster = parts[0]
    storage_path = f"{disaster}/{filename}"

    with open(filepath, "rb") as f:
        data = f.read()

    resp = client.post(
        f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}",
        content=data,
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
    )
    return storage_path, resp.status_code in (200, 201)


def main(disaster_filter: str = None):
    t0 = time.perf_counter()

    image_files = sorted(IMAGES_DIR.glob("*.png"))
    if disaster_filter:
        image_files = [f for f in image_files if disaster_filter in f.name]
    
    if not image_files:
        sys.exit(f"No images in {IMAGES_DIR}" + (f" for disaster '{disaster_filter}'" if disaster_filter else ""))

    print(f"Uploading {len(image_files)} images to '{BUCKET}' bucket...")

    uploaded = 0
    failed = 0

    client = httpx.Client(timeout=30)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(upload_image, client, f): f for f in image_files}
        for future in as_completed(futures):
            path, ok = future.result()
            if ok:
                uploaded += 1
            else:
                failed += 1
                print(f"  FAILED: {path}")

            total = uploaded + failed
            if total % 100 == 0 or total == len(image_files):
                print(f"  {total}/{len(image_files)}")

    client.close()
    print(f"Uploaded: {uploaded}, Failed: {failed}")

    if failed > 0:
        print("Fix failures before updating DB paths.")
        sys.exit(1)

    print("Updating image_pairs paths...")
    DB_HOST = env.get("DB_HOST")
    DB_PASSWORD = env.get("DB_PASSWORD")
    DB_PORT = int(env.get("DB_PORT", "5432"))
    DB_USER = env.get("DB_USER", "postgres.zbnrjjmqbnqunkjbmsdk")
    DB_NAME = env.get("DB_NAME", "postgres")

    with psycopg.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASSWORD, connect_timeout=15,
    ) as conn:
        with conn.cursor() as cur:
            query = """
                SELECT ip.id, d.name, ip.xbd_id
                FROM image_pairs ip
                JOIN disasters d ON d.id = ip.disaster_id
            """
            if disaster_filter:
                query += " WHERE d.name = %s"
                cur.execute(query, (disaster_filter,))
            else:
                cur.execute(query)
            rows = cur.fetchall()

            for pair_id, disaster, xbd_id in rows:
                pre_path = f"{disaster}/{disaster}_{xbd_id:08d}_pre_disaster.png"
                post_path = f"{disaster}/{disaster}_{xbd_id:08d}_post_disaster.png"
                cur.execute(
                    "UPDATE image_pairs SET pre_image_path = %s, post_image_path = %s WHERE id = %s",
                    (pre_path, post_path, pair_id),
                )

            conn.commit()
            print(f"  Updated {len(rows)} image pairs")

    elapsed = time.perf_counter() - t0
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    disaster_filter = sys.argv[1] if len(sys.argv) > 1 else None
    main(disaster_filter)
