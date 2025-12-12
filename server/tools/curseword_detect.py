import json
import os
from faster_whisper import WhisperModel
from better_profanity import profanity

from langchain_core.tools import tool

# Setup Models (Load once on server start)
PAD_SEC = 0.15
model = WhisperModel("base", device="cpu", compute_type="int8")
profanity.load_censor_words() 

def add_bad_words(words: list[str]):
    profanity.add_censor_words(words)

def detect_cursed_words(audio_path):
    print(f"Analyzing: {audio_path}")

    # 2. Transcribe with Word Timestamps
    # 'word_timestamps=True' is the magic key here
    segments, info = model.transcribe(
        audio_path, 
        word_timestamps=True, 
        language="en", 
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=50)
    )

    markers = []

    # 3. Iterate linearly through the timeline
    for segment in segments:
        for word in segment.words:
            # Clean the word for checking (remove punctuation)
            clean_word = word.word.strip(".,!?\"' ")
            print(clean_word)
            
            # 4. Check Profanity
            if profanity.contains_profanity(clean_word):
                
                # Calculate duration
                duration = word.end - word.start
                
                # Create the Marker Object
                markers.append({
                    "start_seconds": round(word.start, 3),
                    "duration_seconds": round(duration, 3) + PAD_SEC,
                    "name": "PROFANITY",
                    "comment": f"Detected word: '{clean_word}' (Confidence: {int(word.probability * 100)}%)",
                    "color_index": 0 
                })

    # 5. Return JSON to UXP
    return {"markers": markers}


@tool
def curseword_detect_tool(audio_path: str, additional_bad_words: list[str] = []):
    """
    Scans the audio to identify profanity or unwanted words.
    
    Args:
        audio_path (str): The absolute file path to the audio file.
        additional_bad_words (list[str], optional): Extra words to flag for this run.
        
    Returns:
        str: A JSON string for UXP processing. Key fields for the Agent:
             - count (int): The total number of bad words found.
             - markers (list): The technical data for Premiere Pro (includes word name/timestamp).
    """
    print(f"[TOOL] Running Curseword Detect on: {audio_path}")
    
    if not os.path.exists(audio_path):
        return json.dumps({"error": "File not found at path."})
    
    try:
        add_bad_words(additional_bad_words)
        markers = detect_cursed_words(audio_path)
        return json.dumps({
            "status": "success",
            "action_type": "curseword_detect",
            "markers": markers["markers"],
            "count": len(markers["markers"])
        })
    except Exception as e:
        return json.dumps({"error": str(e)})

# SEVERITY_MAP = {
#     "damn": "Mild",
#     "hell": "Mild",
#     # ... others
# }

# # Inside the loop:
# severity = SEVERITY_MAP.get(clean_word.lower(), "Critical")
# color_index = 0 if severity == "Mild" else 1 # Different colors for severity