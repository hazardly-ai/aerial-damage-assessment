from fastapi import APIRouter, Depends, HTTPException
import psycopg

from app.db.supabase import get_conn
from app.schemas.geojson import GeoJSONGeometry
from app.schemas.image_pairs import (
    ImagePairFeature,
    ImagePairFeatureCollection,
    ImagePairProperties,
    XbdIdsResponse,
)
from app.services.image_pairs import (
    fetch_image_pair,
    fetch_image_pairs_by_disaster,
    fetch_xbd_ids_by_disaster,
)

router = APIRouter(prefix="/disasters", tags=["image-pairs"])


def _map_image_pair_feature(row: dict) -> ImagePairFeature:
    geometry = row["geometry"]
    return ImagePairFeature(
        geometry=GeoJSONGeometry(**geometry),
        properties=ImagePairProperties(**row["properties"]),
    )


@router.get(
    "/{disaster_id}/image-pairs",
    response_model=ImagePairFeatureCollection,
)
def get_image_pairs(
    disaster_id: int,
    limit: int | None = None,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns GeoJSON FeatureCollection
    rows = fetch_image_pairs_by_disaster(conn, disaster_id, limit=limit)
    features = [_map_image_pair_feature(row) for row in rows]
    return ImagePairFeatureCollection(features=features)


# Static path `xbd-ids` must be declared before `/{xbd_id}`.
@router.get(
    "/{disaster_id}/image-pairs/xbd-ids",
    response_model=XbdIdsResponse,
)
def get_image_pair_xbd_ids(
    disaster_id: int,
    conn: psycopg.Connection = Depends(get_conn),
):
    xbd_ids = fetch_xbd_ids_by_disaster(conn, disaster_id)
    return XbdIdsResponse(xbd_ids=xbd_ids)


@router.get(
    "/{disaster_id}/image-pairs/{xbd_id}",
    response_model=ImagePairFeature,
)
def get_image_pair(
    disaster_id: int,
    xbd_id: int,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns single GeoJSON Feature
    row = fetch_image_pair(conn, disaster_id, xbd_id)
    if not row:
        raise HTTPException(status_code=404, detail="Image pair not found")
    return _map_image_pair_feature(row)
