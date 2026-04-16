from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.geojson import GeoJSONFeature, GeoJSONGeometry


class GeoRefineAffine(BaseModel):
    """Maps pixel (u, v) to (lon, lat): lon = a*u + b*v + c, lat = d*u + e*v + f."""

    a: float
    b: float
    c: float
    d: float
    e: float
    f: float


class ImagePairProperties(BaseModel):
    id: int
    disaster_id: int
    xbd_id: int
    sensor: str | None = None
    gsd: float | None = None
    capture_date: datetime | None = None
    off_nadir_angle: float | None = None
    pan_resolution: float | None = None
    sun_azimuth: float | None = None
    sun_elevation: float | None = None
    target_azimuth: float | None = None
    width: int = 1024
    height: int = 1024
    catalog_id: str | None = None
    pre_image_path: str | None = None
    post_image_path: str | None = None
    created_at: datetime | None = None
    geo_origin_lon: float | None = None
    geo_origin_lat: float | None = None
    geo_pixel_width: float | None = None
    geo_pixel_height: float | None = None
    geo_refine_affine: GeoRefineAffine | None = None


class ImagePairFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry
    properties: ImagePairProperties


class ImagePairFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[ImagePairFeature]


class XbdIdsResponse(BaseModel):
    """Sorted XBD identifiers for all image pairs in a disaster (lightweight list)."""

    xbd_ids: list[int]
