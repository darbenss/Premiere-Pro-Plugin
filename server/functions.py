import base64

# --- HELPER FUNCTIONS ---

def encode_image(image_path):
    try:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    except Exception as e:
        print(f"Error encoding image: {e}")
        return None

# --- TOOLS DEFINITION ---

@tool
def trim_silence_tool(audio_path: str):
    """
    Analyzes the audio file at the given path to detect silence.
    Returns a list of timestamps [start, end] where silence occurs.
    """
    print(f"[TOOL] Trimming silence for: {audio_path}")
    
    # Placeholder logic (Replace with real VAD code like silero-vad)
    silence_timestamps = [[0.0, 1.5], [10.0, 12.0]]
    
    return json.dumps({
        "status": "success",
        "action_type": "trim_silence",
        "segments": silence_timestamps,
        "message": f"Found {len(silence_timestamps)} silent segments."
    })

@tool
def sync_audio_video_tool(video_path: str, audio_path: str):
    """
    Generates a new video file where the video lips are synced to the provided audio.
    """
    print(f"[TOOL] Syncing video {video_path} with audio {audio_path}")
    
    # Placeholder logic (Replace with real Wav2Lip inference)
    output_path = video_path.replace(".mp4", "_synced.mp4")
    
    return json.dumps({
        "status": "success",
        "action_type": "import_clip",
        "file_path": output_path,
        "message": "Lip sync generation complete."
    })

@tool
def suggest_transition_tool(outgoing_img_path: str, incoming_img_path: str):
    """
    Analyzes two images (last frame of clip A, first frame of clip B) 
    and determines the best video transition.
    """
    print(f"[TOOL] Analyzing transition between {outgoing_img_path} and {incoming_img_path}")
    
    img1_b64 = encode_image(outgoing_img_path)
    img2_b64 = encode_image(incoming_img_path)
    
    if not img1_b64 or not img2_b64:
        return json.dumps({"error": "Could not read image files provided."})

    # Initialize Vision LLM via OpenRouter
    vision_llm = ChatOpenAI(
        model="openai/gpt-4o", # Explicit OpenRouter model slug
        openai_api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
        default_headers=OPENROUTER_HEADERS,
        max_tokens=300
    )
    
    msg = HumanMessage(
        content=[
            {"type": "text", "text": "These are two frames from a video edit (outgoing and incoming). Suggest the best transition: 'Cross Dissolve', 'Dip to Black', or 'Cut'. Return ONLY the transition name."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img1_b64}"}},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img2_b64}"}},
        ]
    )
    
    ai_msg = vision_llm.invoke([msg])
    suggestion = ai_msg.content.strip()
    
    match_names = {
        "Cross Dissolve": "AE.ADBE Cross Dissolve",
        "Dip to Black": "AE.ADBE Dip to Black",
        "Cut": "Cut"
    }
    
    effect_id = match_names.get(suggestion, "AE.ADBE Cross Dissolve")
    
    return json.dumps({
        "status": "success",
        "action_type": "apply_transition",
        "effect_id": effect_id,
        "reason": suggestion
    })