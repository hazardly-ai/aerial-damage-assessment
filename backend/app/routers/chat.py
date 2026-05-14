from fastapi import APIRouter
from pydantic import BaseModel

from app.rag_agent import handle_chat_query

router = APIRouter()


class ChatRequest(BaseModel):
    question: str
    session_id: str | None = None


@router.post("/chat")
def chat(request: ChatRequest):
    return handle_chat_query(request.question, request.session_id)