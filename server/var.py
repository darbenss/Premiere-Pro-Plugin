from dotenv import load_dotenv
import os


if os.path.exists(".env"):
    load_dotenv(override=True)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = "google/gemini-2.5-flash-lite"


PORT = int(os.getenv("PORT")) if os.getenv else 8000
HOST = str(os.getenv("HOST")) if os.getenv else "localhost"