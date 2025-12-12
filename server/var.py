import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI


if os.path.exists(".env"):
    load_dotenv(override=True)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = "google/gemini-2.5-flash-lite"

MAX_TOKENS = 40000          # Change accordingly

llm = ChatOpenAI(
    model=OPENROUTER_MODEL,
    api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
    temperature=0,
    max_tokens=MAX_TOKENS,        
)


PORT = int(os.getenv("PORT")) if os.getenv else 8000
HOST = str(os.getenv("HOST")) if os.getenv else "localhost"