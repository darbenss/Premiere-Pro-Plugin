import chromadb
import json
import ast
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from fastapi import HTTPException
from var import OPENROUTER_API_KEY
from tools.create_transition_db import create_transition_db

# Ensure directory exists or handle error if needed
chroma_client = chromadb.PersistentClient(path="./transition_db")

try:
    transition_db = chroma_client.get_collection(
        name="premiere_transitions"
    )
except:
    print("Transition DB not found. Creating new collection...")
    transition_db = create_transition_db()


def robust_parse(input_str):
        # 1. Try standard JSON
        try:
            return json.loads(input_str)
        except json.JSONDecodeError:
            pass
        
        # 2. Try Python Literal Eval
        try:
            return ast.literal_eval(input_str)
        except (ValueError, SyntaxError):
            pass
            
        # 3. Last Resort: Brute-force fix single backslashes
        try:
            # Replace single \ with \\ 
            fixed_str = input_str.replace('\\', '\\\\').replace('\\\\\\\\', '\\\\')
            return json.loads(fixed_str)
        except Exception:
            print(f"❌ Failed to parse input: {input_str}")
            return []

def vector_search(query_vibe):
    """
    Simulates finding the closest transition in the user's specific list.
    """
    print(f"🤖 AI: Searching vector DB for vibe: {query_vibe}")
    
    transition_result = transition_db.query(
        query_texts=[query_vibe], 
        n_results=1
    )

    if not transition_result['metadatas'] or not transition_result['metadatas'][0]:
        print("⚠️ No matching transition found in DB.")
        raise HTTPException(status_code=500, detail="No matching transition found in DB.")

    match_meta = transition_result['metadatas'][0][0]
    match_key = match_meta.get('transition_name', 'Cross Dissolve')
    
    print(f"🤖 AI: Found transition: {match_key}")

    return match_key

# --- ENDPOINTS ---

@tool
def add_transition_tool(target_vibes_json: str, durations_json: str, img_paths_json: str):
    """
    Generates a SEQUENCE of transitions with specific vibes and durations.
    
    Args:
        target_vibes_json (str): A JSON string list of style descriptions (e.g. '["fast glitch", "smooth cinematic dissolve", "quick whip pan"]'). Length must match the number of cuts.
        durations_json (str): A JSON string list of float durations in seconds (e.g. '[0.3, 1.5, 0.8]'). Length must match target_vibes_json.
        img_paths_json (str): The raw JSON string of clip paths from the context.
    """
    
    clips = robust_parse(img_paths_json)
    vibes = robust_parse(target_vibes_json)
    durations = robust_parse(durations_json)

    if not clips or not vibes:
        return json.dumps({"error": "Failed to parse inputs. Check format."})

    if len(clips) < 2:
        print(f"⚠️ Error: Need at least 2 clips to add a transition. Received {len(clips)} clips.")
        return json.dumps({"error": "Need at least 2 clips to add a transition.", "count": 0})

    num_cuts = len(clips) - 1
    
    # --- SAFETY LOGIC: Handle Mismatches ---
    # 1. Fix Vibes List
    if isinstance(vibes, str):
        vibes = [vibes] * num_cuts
    
    if len(vibes) < num_cuts:
        print(f"⚠️ Warning: Agent provided {len(vibes)} vibes for {num_cuts} cuts. Repeating last vibe.")
        missing_count = num_cuts - len(vibes)
        # Check if list is not empty to avoid crash
        fill_vibe = vibes[-1] if vibes else "cross dissolve"
        vibes.extend([fill_vibe] * missing_count)

    # 2. Fix Durations List
    # Case A: AI sent a single number (e.g. 0.5) instead of a list
    if isinstance(durations, (float, int, str)):
        try:
            val = float(durations)
            durations = [val] * num_cuts
        except ValueError:
            durations = [1.0] * num_cuts

    # Case B: AI sent a list, but it's too short (e.g. 2 durations for 4 cuts)
    if len(durations) < num_cuts:
        print(f"⚠️ Warning: Agent provided {len(durations)} durations for {num_cuts} cuts. Fixing.")
        missing_count = num_cuts - len(durations)
        
        # Logic: Repeat the last valid duration the AI gave. 
        # If list is completely empty, default to 1.0s.
        if len(durations) > 0:
            fill_value = float(durations[-1])
        else:
            fill_value = 1.0
            
        durations.extend([fill_value] * missing_count)

    transitions_sequence = []
    
    print(f"🛠️ Tool: Generating {num_cuts} transitions...")

    for i in range(num_cuts):
        # 1. Get the specific vibe for THIS cut
        current_vibe = vibes[i]

        raw_duration = float(durations[i])
        current_duration = max(0.1, min(raw_duration, 2.0))
        
        # 3. Search Vector DB with the specific vibe
        print(f"   [Cut {i}] Searching for: '{current_vibe}'")
        best_match_key = vector_search(current_vibe) 
        
        # 4. Build Result
        transitions_sequence.append({
            "cut_index": i,
            "transition_name": best_match_key,
            "duration": current_duration,
            "vibe_used": current_vibe
        })

    return json.dumps({
        "action_type": "add_transition",
        "transitions": transitions_sequence
    })