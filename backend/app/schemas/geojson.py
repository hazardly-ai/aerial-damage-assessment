from pydantic import BaseModel


class GeojsonGeometry(BaseModel):
    type: str
    coordinates: list


class FeatureProperties(BaseModel):
    uid: str
    original_label: str
    vlm_label: str


class GeojsonFeature(BaseModel):
    type: str = "Feature"
    geometry: GeojsonGeometry
    properties: FeatureProperties


class AnalysisResponse(BaseModel):
    type: str = "FeatureCollection"
    image_pair_id: int
    disaster: str
    features: list[GeojsonFeature]
