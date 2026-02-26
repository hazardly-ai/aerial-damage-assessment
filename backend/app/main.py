from fastapi import FastAPI
from pydantic import BaseModel

# Creating the FastAPI app
#This backend will later handle the chatbot logic and the ML  integration
app = FastAPI(title="Aerial Damage Assessment API")

# Health check to make sure backend is working successfully
@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}

# This class defines what we expect from the frontend that will send a 
#JSON body. For example, "Question:" "How damaged is this building?""
class ChatRequest(BaseModel):
    query: str


#Chat endpoint (just a scaffolding version)
# for now it just returns a placeholder, later this will connect to the AI model
@app.post("/chat")
def chat_endpoint(request: ChatRequest) -> dict:
    return {
             "response": "This is a placeholder answer for questions related to the disaster damae."
        }