from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: list[Any]


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry
    properties: dict[str, Any]


class GeoJSONFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoJSONFeature]
