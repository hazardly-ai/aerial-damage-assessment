from pydantic import BaseModel


class DamageProbabilities(BaseModel):
    no_damage: float
    minor_damage: float
    major_damage: float
    destroyed: float


class VlmPrediction(BaseModel):
    damage_class: str
    confidence: float
    probabilities: DamageProbabilities
    description: str


class VlmEvaluationResponse(BaseModel):
    prediction: VlmPrediction
    model_version: str
    is_mock: bool
