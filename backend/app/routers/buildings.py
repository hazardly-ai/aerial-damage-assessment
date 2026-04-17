from fastapi import APIRouter, Depends, HTTPException
import psycopg

from app.db.supabase import get_conn
from app.schemas.buildings import (
    BuildingDamageStatsResponse,
    BuildingFeature,
    BuildingFeatureBboxOnly,
    BuildingFeatureCollection,
    BuildingFeatureCollectionBboxOnly,
    BuildingFeatureCollectionNoBox,
    BuildingListItem,
    BuildingFeatureNoBox,
    PaginatedBuildingListResponse,
    BuildingProperties,
    BuildingPropertiesNoBox,
)
from app.schemas.geojson import GeoJSONGeometry
from app.services.buildings import (
    fetch_building_damage_stats_by_disaster,
    fetch_building_bboxes_by_disaster,
    fetch_building_by_uid,
    fetch_buildings_by_disaster,
    fetch_buildings_by_image_pair,
    fetch_paginated_buildings_by_disaster,
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


@router.get(
    "/disasters/{disaster_id}/buildings/paged",
    response_model=PaginatedBuildingListResponse,
)
def get_paginated_buildings_for_disaster(
    disaster_id: int,
    page: int = 1,
    page_size: int = 25,
    damage: str | None = None,
    conn: psycopg.Connection = Depends(get_conn),
):
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=400, detail="page_size must be between 1 and 200")

    rows, total_items = fetch_paginated_buildings_by_disaster(
        conn,
        disaster_id,
        page,
        page_size,
        damage,
    )

    total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 1

    items = [
        BuildingListItem(
            id=row["id"],
            uid=row["uid"],
            address=row["address"],
            image_pair_id=row["image_pair_id"],
            xbd_id=row["xbd_id"],
            actual_damage=row["actual_damage"],
            predicted_damage=row["predicted_damage"],
            is_correct=row["is_correct"],
            created_at=row["created_at"],
            pre_image_path=row["pre_image_path"],
            post_image_path=row["post_image_path"],
        )
        for row in rows
    ]

    return PaginatedBuildingListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
    )


@router.get(
    "/disasters/{disaster_id}/buildings/stats",
    response_model=BuildingDamageStatsResponse,
)
def get_building_damage_stats_for_disaster(
    disaster_id: int,
    conn: psycopg.Connection = Depends(get_conn),
):
    return fetch_building_damage_stats_by_disaster(conn, disaster_id)
