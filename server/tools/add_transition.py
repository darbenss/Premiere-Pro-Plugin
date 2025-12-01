import chromadb.utils.embedding_functions as embedding_functions
import chromadb
import time
from langchain_core.tools import tool
from var import OPENROUTER_API_KEY

chroma_client = chromadb.PersistentClient(path="transition_db")

openai_ef = embedding_functions.OpenAIEmbeddingFunction(
                api_key=OPENROUTER_API_KEY,
                model_name="text-embedding-3-small"
            )

# Get collection with the embedding function
transition_db = chroma_client.get_collection(
    name="transition_db",
    embedding_function=openai_ef
)

# --- IN-MEMORY DATABASE (The "Server Side" Loophole Fix) ---
# Format: { "hash_string": { "key": "description_embedding" } }
# In production, use Redis or a Vector DB (Chroma/Pinecone)
VECTOR_CACHE = {} 

class RecommendationRequest(BaseModel):
    hash_id: str
    image_a: str  # Base64 string or file path
    image_b: str


# --- DUMMY AI LOGIC ---
def dummy_ai_analysis(img_a, img_b):
    """Simulates the VLM analyzing images."""
    print(f"🤖 AI: Analyzing frames...")
    time.sleep(1) # Simulate processing time
    return "fast_wipe_left" # The AI decides it wants this "vibe"

def dummy_vector_search(query_vibe):
    """
    Simulates finding the closest transition in the user's specific list.
    Note: We only search inside the specific list associated with the Hash.
    """
    transition_result = transition_db.query(
        query_texts=query_vibe, 
        n_results=1)

    return transition_result['results'][0]['key']

# --- ENDPOINTS ---

@tool
def get_recommendation(payload: RecommendationRequest):
    """
    The Main Endpoint. 
    It intentionally FAILS if the hash is not found.
    """
    print(f"📥 Received Request for Hash: {payload.hash_id}")

    # 1. CHECK IF WE HAVE THE DATA
    if payload.hash_id not in VECTOR_CACHE:
        print(f"❌ Hash {payload.hash_id} not found. Asking client to Sync.")
        # 428 Precondition Required indicates the server needs the 'sync' first
        raise HTTPException(status_code=428, detail="MISSING_TRANSITION_DATA")

    # 2. EXECUTE AI (Only if we have data)
    user_transitions = VECTOR_CACHE[payload.hash_id]
    
    needed_vibe = dummy_ai_analysis(payload.image_a, payload.image_b)
    best_match_key = dummy_vector_search(needed_vibe)
    
    print(f"✅ returning recommendation: {best_match_key}")
    return {"transition_key": best_match_key}
