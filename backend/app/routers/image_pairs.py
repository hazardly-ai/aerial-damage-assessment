from fastapi import APIRouter, HTTPException

from ..schemas.geojson import AnalysisResponse, GeojsonFeature, GeojsonGeometry, FeatureProperties
from ..services.xbd import load_post_disaster_labels, wkt_to_geojson_geometry

router = APIRouter(prefix="/image-pair", tags=["image-pairs"])


@router.get("/{disaster}/{image_pair_id}/analysis", response_model=AnalysisResponse)
def get_analysis(disaster: str, image_pair_id: int):
    data = load_post_disaster_labels(disaster, image_pair_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Label file not found")

    features = []
    for entry in data["features"]["lng_lat"]:
        props = entry["properties"]
        uid = props["uid"]
        original_label = props.get("subtype", "un-classified")
        vlm_label = original_label

        geometry_dict = wkt_to_geojson_geometry(entry["wkt"])

        features.append(
            GeojsonFeature(
                geometry=GeojsonGeometry(**geometry_dict),
                properties=FeatureProperties(
                    uid=uid,
                    original_label=original_label,
                    vlm_label=vlm_label,
                ),
            )
        )

    return AnalysisResponse(
        image_pair_id=image_pair_id,
        disaster=disaster,
        features=features,
    )
