import chromadb
import json
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from fastapi import HTTPException
from var import OPENROUTER_API_KEY

# Ensure directory exists or handle error if needed
chroma_client = chromadb.PersistentClient(path="./transition_db")

transition_db = chroma_client.get_collection(
    name="premiere_transitions"
)

vibe_transition_system_prompt = SystemMessage(
    content="""You are a video editor assistant. You are given a list of image frame descriptions and a human message. 
    You need to analyze the context of the frames and the user's intent to determine the 'vibe' or style of the video transition needed. 
    Return a JSON object with a key called 'vibe' and the value being a descriptive string of the visual style (e.g., 'fast paced action', 'slow dreamlike dissolve', 'glitchy tech').
    Example: {{"vibe": "a glitchy computer error or broken screen"}}"""
)

def img_path_parser(img_path: list[list[str]]):
    """
    Parses list of clips to get the relevant frames for transition context.
    Structure: [[start_frame, end_frame], [start_frame, end_frame]]
    """
    image = {}
    
    for i, img in enumerate(img_path):
        # Safety check for empty lists
        if not img: 
            continue

        if i == 0:
            image[f"video{i+1}"] = {"last_frame": img[-1]} 
        elif i == len(img_path) - 1:
            image[f"video{i+1}"] = {"first_frame": img[0]}
        else:
            image[f"video{i+1}"] = {"first_frame": img[0], "last_frame": img[-1]}

    print(f"🤖 AI: Analyzed frames: {image}")
    return image


# --- DUMMY AI LOGIC ---
def ai_vibe_transition(session_id: str, img_path: list[list[str]], human_messages: str):
    """Simulates the VLM analyzing images."""
    from main import graph, llm             # To resolve circular import
    print(f"🤖 AI: Analyzing frames...")

    img_parsed = img_path_parser(img_path)

    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="Missing API Key configuration.")

    # Context injection
    context_msg = human_messages if human_messages else "I want to add a transition between these clips."
    context_msg += f"\n\n[System Context Data - Frame Analysis]:\n {json.dumps(img_parsed)}\n\n" 

    config = {"configurable": {"thread_id": session_id}}

    # Fetch History
    current_state = graph.get_state(config)
    history = current_state.values.get("messages", [])
    
    # Filter history to avoid token overflow, but ensure valid message objects
    recent_history = history[-5:] 
    
    messages = [
        vibe_transition_system_prompt,
        *recent_history, 
        HumanMessage(content=context_msg)
    ]

    try:
        response = llm.invoke(messages)
        result_content = response.content
        
        print(f"DEBUG Intent: {result_content}")
        
        if "```json" in result_content:
            result_content = result_content.split("```json")[1].split("```")[0].strip()
        elif "```" in result_content:
             result_content = result_content.split("```")[1].strip()

        return json.loads(result_content)

    except json.JSONDecodeError:
        print("Error decoding JSON, returning fallback.")
        raise HTTPException(status_code=500, detail="Error decoding JSON, returning fallback.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Processing Error: {str(e)}")


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
        target_vibes_json (str): JSON string list of vibe strings (e.g. '["glitch", "dissolve"]').
        durations_json (str): JSON string list of float seconds (e.g. '[0.5, 1.5]').
        img_paths_json (str): The JSON string of the list of clips.
    """
    try:
        clips = json.loads(img_paths_json)
        vibes = json.loads(target_vibes_json)
        durations = json.loads(durations_json)
    except Exception as e:
        return json.dumps({"error": f"Invalid JSON format: {str(e)}"})

    if len(clips) < 2:
        return json.dumps({"error": "Need at least 2 clips to add a transition.", "count": 0})

    num_cuts = len(clips) - 1
    
    # --- SAFETY LOGIC: Handle Mismatches ---
    # If Agent sent a single string instead of a list, fix it
    if isinstance(vibes, str):
        vibes = [vibes] * num_cuts
    
    # If Agent sent fewer vibes than cuts (e.g. 3 cuts, but only provided ["glitch"]), 
    # we extend the list using the last vibe.
    if len(vibes) < num_cuts:
        print(f"⚠️ Warning: Agent provided {len(vibes)} vibes for {num_cuts} cuts. Repeating last vibe.")
        missing_count = num_cuts - len(vibes)
        vibes.extend([vibes[-1]] * missing_count)

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