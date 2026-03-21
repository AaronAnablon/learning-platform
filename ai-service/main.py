from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Learning Platform AI Service")


class GenerateRequest(BaseModel):
    prompt: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
def generate_text(payload: GenerateRequest):
    return {
        "message": "Integrate LangChain pipeline here",
        "prompt": payload.prompt,
    }
