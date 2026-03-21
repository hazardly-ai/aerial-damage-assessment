from fastapi import APIRouter, Depends, HTTPException
import psycopg

from backend.app.db.supabase import get_conn
from backend.app.schemas.geojson import GeoJSONGeometry
from backend.app.schemas.image_pairs import (
    ImagePairFeature,
    ImagePairFeatureCollection,
    ImagePairProperties,
)
from backend.app.services.image_pairs import (
    fetch_image_pair,
    fetch_image_pairs_by_disaster,
)

router = APIRouter(prefix="/disasters", tags=["image-pairs"])


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
    features = [
        ImagePairFeature(
            geometry=GeoJSONGeometry(**row["geometry"]),
            properties=ImagePairProperties(**row["properties"]),
        )
        for row in rows
    ]
    return ImagePairFeatureCollection(features=features)


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
    return ImagePairFeature(
        geometry=GeoJSONGeometry(**row["geometry"]),
        properties=ImagePairProperties(**row["properties"]),
    )
