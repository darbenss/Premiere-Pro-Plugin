import json
from faster_whisper import WhisperModel
from better_profanity import profanity

# 1. Setup Models (Load once on server start)
# 'tiny' or 'base' is usually enough for profanity and very fast.
model = WhisperModel("base", device="cpu", compute_type="int8")
profanity.load_censor_words() 

# You can add custom words relevant to your users
custom_bad_words = ["specific_word", "another_bad_word"]
profanity.add_censor_words(custom_bad_words)

def detect_cursed_words(audio_path):
    print(f"Analyzing: {audio_path}")

    # 2. Transcribe with Word Timestamps
    # 'word_timestamps=True' is the magic key here
    segments, info = model.transcribe(audio_path, word_timestamps=True)

    markers = []

    # 3. Iterate linearly through the timeline
    for segment in segments:
        for word in segment.words:
            # Clean the word for checking (remove punctuation)
            clean_word = word.word.strip(".,!?\"'")
            
            # 4. Check Profanity
            if profanity.contains_profanity(clean_word):
                
                # Calculate duration
                duration = word.end - word.start
                
                # Create the Marker Object
                markers.append({
                    "start_seconds": round(word.start, 3),
                    "duration_seconds": round(duration, 3),
                    "name": "PROFANITY",
                    "comment": f"Detected word: '{clean_word}' (Confidence: {int(word.probability * 100)}%)",
                    "color_index": 0 
                })

    # 5. Return JSON to UXP
    return {"markers": markers}

# --- Mock Output ---
# result = detect_cursed_words("C:/path/to/audio.wav")
# print(json.dumps(result, indent=2))


# SEVERITY_MAP = {
#     "damn": "Mild",
#     "hell": "Mild",
#     # ... others
# }

# # Inside the loop:
# severity = SEVERITY_MAP.get(clean_word.lower(), "Critical")
# color_index = 0 if severity == "Mild" else 1 # Different colors for severity