#!/usr/bin/env python3
"""Fit geo_refine_affine per image_pair from building pixel_coords + lon/lat geometry.

Requires numpy. Run after seed_db.py and seed_geotransforms.py so geom + pixels exist.

Usage (from backend/, with .env):
  python supabase/scripts/fit_geo_refine.py
  python supabase/scripts/fit_geo_refine.py houston-harvey   # disaster name filter

Writes image_pairs.geo_refine_affine as JSON:
  lon = a*u + b*v + c
  lat = d*u + e*v + f
where (u,v) are pixel column/row (same convention as GDAL origin at upper-left).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import psycopg
from dotenv import dotenv_values

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent.parent

env = dotenv_values(BACKEND_DIR / ".env")

DB_HOST = env.get("DB_HOST")
DB_USER = env.get("DB_USER")
DB_PASSWORD = env.get("DB_PASSWORD")
if not DB_HOST or not DB_PASSWORD:
    sys.exit("DB_HOST, DB USER, and DB_PASSWORD must be set in backend/.env")

DB_PORT = int(env.get("DB_PORT", "5432"))
DB_NAME = env.get("DB_NAME", "postgres")

MIN_POINTS = 3


def _pixel_outer_ring(pixel_coords) -> list[tuple[float, float]]:
    """GeoJSON polygon coords from label seed: [[ring]] or [[x,y],...]."""
    if not pixel_coords:
        return []
    try:
        first = pixel_coords[0]
        if isinstance(first[0], (int, float)):
            ring = pixel_coords
        else:
            ring = first
        out = [(float(p[0]), float(p[1])) for p in ring]
    except (IndexError, TypeError, ValueError):
        return []
    if len(out) >= 2 and out[0] == out[-1]:
        out = out[:-1]
    return out


def _lonlat_outer_ring(geom: dict) -> list[tuple[float, float]]:
    t = geom.get("type")
    if t == "Polygon":
        ring = geom["coordinates"][0]
    elif t == "MultiPolygon":
        ring = geom["coordinates"][0][0]
    else:
        return []
    out = [(float(p[0]), float(p[1])) for p in ring]
    if len(out) >= 2 and out[0] == out[-1]:
        out = out[:-1]
    return out


def _collect_pairs(rows: list[tuple]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    us: list[float] = []
    vs: list[float] = []
    lons: list[float] = []
    lats: list[float] = []
    for pixel_coords, geom in rows:
        if pixel_coords is None or geom is None:
            continue
        pr = _pixel_outer_ring(pixel_coords)
        gr = _lonlat_outer_ring(geom)
        n = min(len(pr), len(gr))
        if n == 0:
            continue
        for i in range(n):
            us.append(pr[i][0])
            vs.append(pr[i][1])
            lons.append(gr[i][0])
            lats.append(gr[i][1])
    if len(us) < MIN_POINTS:
        return (
            np.array([]),
            np.array([]),
            np.array([]),
            np.array([]),
        )
    return (
        np.array(us, dtype=np.float64),
        np.array(vs, dtype=np.float64),
        np.array(lons, dtype=np.float64),
        np.array(lats, dtype=np.float64),
    )


def _fit_affine(
    us: np.ndarray, vs: np.ndarray, lons: np.ndarray, lats: np.ndarray,
) -> dict[str, float] | None:
    if us.size < 3:
        return None
    A = np.column_stack([us, vs, np.ones(us.shape[0])])
    coef_lon, *_ = np.linalg.lstsq(A, lons, rcond=None)
    coef_lat, *_ = np.linalg.lstsq(A, lats, rcond=None)
    return {
        "a": float(coef_lon[0]),
        "b": float(coef_lon[1]),
        "c": float(coef_lon[2]),
        "d": float(coef_lat[0]),
        "e": float(coef_lat[1]),
        "f": float(coef_lat[2]),
    }


def main(disaster_name: str | None = None) -> None:
    t0 = time.perf_counter()
    if disaster_name:
        sql_pairs = """
          SELECT DISTINCT ip.id, ip.disaster_id, ip.xbd_id
          FROM image_pairs ip
          JOIN buildings b ON b.image_pair_id = ip.id
          WHERE b.pixel_coords IS NOT NULL
            AND ip.disaster_id = (SELECT id FROM disasters WHERE name = %s)
          ORDER BY ip.id
        """
        params: tuple = (disaster_name,)
    else:
        sql_pairs = """
          SELECT DISTINCT ip.id, ip.disaster_id, ip.xbd_id
          FROM image_pairs ip
          JOIN buildings b ON b.image_pair_id = ip.id
          WHERE b.pixel_coords IS NOT NULL
          ORDER BY ip.id
        """
        params = ()

    sql_pts = """
      SELECT b.pixel_coords, ST_AsGeoJSON(b.geom)::json AS geom
      FROM buildings b
      WHERE b.image_pair_id = %s AND b.pixel_coords IS NOT NULL
    """

    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=15,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(sql_pairs, params)
            pair_rows = cur.fetchall()

        updated = 0
        skipped = 0
        total = len(pair_rows)
        for idx, (pair_id, _did, xbd_id) in enumerate(pair_rows, start=1):
            t_pair = time.perf_counter()
            print(
                f"  [{idx}/{total}] pair id={pair_id} xbd={xbd_id} …",
                flush=True,
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(sql_pts, (pair_id,))
                    rows = cur.fetchall()
            except Exception as e:
                print(f"  ERROR loading buildings: {e}", flush=True)
                conn.rollback()
                raise

            us, vs, lons, lats = _collect_pairs(rows)
            aff = _fit_affine(us, vs, lons, lats)
            if aff is None:
                skipped += 1
                print(
                    f"  skip (need ≥{MIN_POINTS} vertices, got {us.size})",
                    flush=True,
                )
                continue

            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """UPDATE image_pairs SET geo_refine_affine = %s::jsonb
                           WHERE id = %s""",
                        (json.dumps(aff), pair_id),
                    )
                conn.commit()
            except Exception as e:
                print(f"  ERROR update: {e}", flush=True)
                conn.rollback()
                raise

            updated += 1
            dt = time.perf_counter() - t_pair
            print(
                f"  ok vertices={us.size} ({dt:.2f}s)",
                flush=True,
            )

    print(
        f"Done: updated {updated}, skipped (too few points) {skipped}, "
        f"pairs scanned {len(pair_rows)} in {time.perf_counter() - t0:.1f}s",
    )


if __name__ == "__main__":
    dn = sys.argv[1] if len(sys.argv) > 1 else None
    main(dn)
