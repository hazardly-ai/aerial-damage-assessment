from pydantic import BaseModel


class DisasterResponse(BaseModel):
    id: int
    name: str
    type: str
