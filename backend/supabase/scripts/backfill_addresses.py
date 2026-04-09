#!/usr/bin/env python3

import sys
import time
from pathlib import Path

import httpx
import psycopg
from psycopg.rows import dict_row
from dotenv import dotenv_values

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
env = dotenv_values(BACKEND_DIR / ".env")

DB_HOST = env.get("DB_HOST")
DB_PASSWORD = env.get("DB_PASSWORD")
if not DB_HOST or not DB_PASSWORD:
    sys.exit("DB_HOST and DB_PASSWORD must be set in backend/.env")

DB_PORT = int(env.get("DB_PORT", "5432"))
DB_USER = env.get("DB_USER", "postgres.zbnrjjmqbnqunkjbmsdk")
DB_NAME = env.get("DB_NAME", "postgres")

MAPBOX_TOKEN = env.get("MAPBOX_ACCESS_TOKEN", "")
if not MAPBOX_TOKEN:
    sys.exit("MAPBOX_ACCESS_TOKEN must be set in backend/.env")

MAPBOX_GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/reverse"

REQUESTS_PER_MINUTE = 550
MIN_REQUEST_INTERVAL = 60.0 / REQUESTS_PER_MINUTE
BATCH_SIZE = 500


def reverse_geocode(client: httpx.Client, lon: float, lat: float) -> str | None:
    try:
        resp = client.get(
            MAPBOX_GEOCODE_URL,
            params={
                "longitude": lon,
                "latitude": lat,
                "access_token": MAPBOX_TOKEN,
                "limit": 1,
            },
            timeout=10,
        )
        if resp.status_code == 429:
            print("  [rate-limited] backing off 10s...")
            time.sleep(10)
            resp = client.get(
                MAPBOX_GEOCODE_URL,
                params={
                    "longitude": lon,
                    "latitude": lat,
                    "access_token": MAPBOX_TOKEN,
                    "limit": 1,
                },
                timeout=10,
            )
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])
        if features:
            return features[0].get("properties", {}).get("full_address")
        return None
    except Exception as e:
        print(f"  [error] geocode ({lon}, {lat}): {e}")
        return None


def count_buildings_without_address(
    conn: psycopg.Connection, disaster_filter: str | None
) -> int:
    sql = "SELECT COUNT(*) AS n FROM buildings b"
    params: tuple = ()
    if disaster_filter:
        sql += """
        JOIN image_pairs ip ON b.image_pair_id = ip.id
        JOIN disasters d ON ip.disaster_id = d.id
        WHERE b.address IS NULL AND d.name = %s
        """
        params = (disaster_filter,)
    else:
        sql += " WHERE b.address IS NULL"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return row["n"] if row else 0


def fetch_buildings_without_address(
    conn: psycopg.Connection, disaster_filter: str | None
):
    last_seen_id = 0

    while True:
        sql = """
        SELECT b.id,
               ST_X(ST_Centroid(b.geom)) AS lon,
               ST_Y(ST_Centroid(b.geom)) AS lat
        FROM buildings b
        """
        params: tuple
        if disaster_filter:
            sql += """
            JOIN image_pairs ip ON b.image_pair_id = ip.id
            JOIN disasters d ON ip.disaster_id = d.id
            WHERE b.address IS NULL AND d.name = %s AND b.id > %s
            """
            params = (disaster_filter, last_seen_id, BATCH_SIZE)
        else:
            sql += " WHERE b.address IS NULL AND b.id > %s"
            params = (last_seen_id, BATCH_SIZE)
        sql += " ORDER BY b.id LIMIT %s"

        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        if not rows:
            break

        yield from rows

        last_seen_id = rows[-1]["id"]


def update_address(conn: psycopg.Connection, building_id: int, address: str):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE buildings SET address = %s WHERE id = %s",
            (address, building_id),
        )


def connect_db():
    return psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=15,
        autocommit=True,
        row_factory=dict_row,
    )


def main(disaster_filter: str | None = None):
    t0 = time.perf_counter()

    print(f"Connecting to {DB_HOST}:{DB_PORT}...")
    conn = connect_db()

    total = count_buildings_without_address(conn, disaster_filter)
    if total == 0:
        print("All buildings already have addresses. Nothing to do.")
        conn.close()
        return

    print(f"Geocoding {total} buildings" + (f" for {disaster_filter}" if disaster_filter else "") + "...")

    success = 0
    failed = 0
    done = 0
    client = httpx.Client()

    for row in fetch_buildings_without_address(conn, disaster_filter):
        bid, lon, lat = row["id"], row["lon"], row["lat"]
        address = reverse_geocode(client, lon, lat)

        if address:
            try:
                update_address(conn, bid, address)
            except psycopg.OperationalError:
                print("  [reconnecting]...")
                try:
                    conn.close()
                except Exception:
                    pass
                conn = connect_db()
                update_address(conn, bid, address)
            success += 1
        else:
            failed += 1

        done += 1
        if done % 50 == 0 or done == total:
            elapsed = time.perf_counter() - t0
            rate = done / elapsed * 60 if elapsed > 0 else 0
            print(f"  {done}/{total} ({success} ok, {failed} failed, {rate:.0f} req/min)")

        time.sleep(MIN_REQUEST_INTERVAL)

    client.close()
    conn.close()

    elapsed = time.perf_counter() - t0
    print(f"\nDone in {elapsed:.1f}s — {success} geocoded, {failed} failed out of {total}")


if __name__ == "__main__":
    disaster_filter = sys.argv[1] if len(sys.argv) > 1 else None
    main(disaster_filter)
