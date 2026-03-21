from fastapi import APIRouter, Depends, HTTPException
import psycopg

from app.db.supabase import get_conn
from app.schemas.buildings import (
    BuildingFeature,
    BuildingFeatureBboxOnly,
    BuildingFeatureCollection,
    BuildingFeatureCollectionBboxOnly,
    BuildingFeatureCollectionNoBox,
    BuildingFeatureNoBox,
    BuildingProperties,
    BuildingPropertiesNoBox,
)
from app.schemas.geojson import GeoJSONGeometry
from app.services.buildings import (
    fetch_building_bboxes_by_disaster,
    fetch_building_by_uid,
    fetch_buildings_by_disaster,
    fetch_buildings_by_image_pair,
)

router = APIRouter(tags=["buildings"])


@router.get(
    "/disasters/{disaster_id}/image-pairs/{xbd_id}/buildings",
    response_model=BuildingFeatureCollection,
)
def get_buildings_for_image_pair(
    disaster_id: int,
    xbd_id: int,
    limit: int | None = None,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns FeatureCollection with geom_bbox
    rows = fetch_buildings_by_image_pair(conn, disaster_id, xbd_id, limit=limit)
    features = [
        BuildingFeature(
            geometry=GeoJSONGeometry(**row["geometry"]),
            properties=BuildingProperties(**row["properties"]),
        )
        for row in rows
    ]
    return BuildingFeatureCollection(features=features)


@router.get(
    "/buildings/{uid}",
    response_model=BuildingFeature,
)
def get_building(
    uid: str,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns single building Feature
    row = fetch_building_by_uid(conn, uid)
    if not row:
        raise HTTPException(status_code=404, detail="Building not found")
    return BuildingFeature(
        geometry=GeoJSONGeometry(**row["geometry"]),
        properties=BuildingProperties(**row["properties"]),
    )


@router.get(
    "/disasters/{disaster_id}/buildings",
    response_model=BuildingFeatureCollectionNoBox,
)
def get_buildings_for_disaster(
    disaster_id: int,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns FeatureCollection, geom only, no geom_bbox
    rows = fetch_buildings_by_disaster(conn, disaster_id)
    features = [
        BuildingFeatureNoBox(
            geometry=GeoJSONGeometry(**row["geometry"]),
            properties=BuildingPropertiesNoBox(**row["properties"]),
        )
        for row in rows
    ]
    return BuildingFeatureCollectionNoBox(features=features)


@router.get(
    "/disasters/{disaster_id}/buildings/bbox",
    response_model=BuildingFeatureCollectionBboxOnly,
)
def get_building_bboxes_for_disaster(
    disaster_id: int,
    conn: psycopg.Connection = Depends(get_conn),
):
    # Returns FeatureCollection with geom_bbox as geometry
    rows = fetch_building_bboxes_by_disaster(conn, disaster_id)
    features = [
        BuildingFeatureBboxOnly(
            geometry=GeoJSONGeometry(**row["geometry"]),
            properties=BuildingPropertiesNoBox(**row["properties"]),
        )
        for row in rows
    ]
    return BuildingFeatureCollectionBboxOnly(features=features)
