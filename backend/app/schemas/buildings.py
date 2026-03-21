from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.geojson import GeoJSONGeometry


# Includes geom_bbox only
class BuildingProperties(BaseModel):
    id: int
    uid: str
    image_pair_id: int
    actual_damage: str
    predicted_damage: str | None = None
    is_correct: bool | None = None
    created_at: datetime | None = None
    geom_bbox: GeoJSONGeometry | None = None


# No geom_bbox
class BuildingPropertiesNoBox(BaseModel):
    id: int
    uid: str
    image_pair_id: int
    actual_damage: str
    predicted_damage: str | None = None
    is_correct: bool | None = None
    created_at: datetime | None = None


# Bbox only
class BuildingPropertiesBboxOnly(BaseModel):
    id: int
    uid: str
    image_pair_id: int
    actual_damage: str
    predicted_damage: str | None = None
    is_correct: bool | None = None
    created_at: datetime | None = None


class BuildingFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry
    properties: BuildingProperties


class BuildingFeatureNoBox(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry
    properties: BuildingPropertiesNoBox


class BuildingFeatureBboxOnly(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry
    properties: BuildingPropertiesBboxOnly


class BuildingFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[BuildingFeature]


class BuildingFeatureCollectionNoBox(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[BuildingFeatureNoBox]


class BuildingFeatureCollectionBboxOnly(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[BuildingFeatureBboxOnly]
