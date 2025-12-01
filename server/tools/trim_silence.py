# Audio Processing Imports
import torch
import torchaudio
import soundfile as sf
from silero_vad import load_silero_vad, get_speech_timestamps

from langchain_core.tools import tool

# 2. Setup VAD Model (Silero)
try:
    print("Loading VAD model... (this may take a moment)")
    vad_model = load_silero_vad()
except Exception as e:
    print(f"Error loading VAD model: {e}")
    vad_model = None


# --- HELPER: LOGIC TO DETECT SILENCE ---
# --- 1. NEW HELPER: SAFE AUDIO READER ---
def read_audio_safe(path: str, target_sr: int = 16000):
    data, samplerate = sf.read(path)

    # Convert Numpy Array to Torch Tensor
    audio_tensor = torch.FloatTensor(data)

    # Handle Stereo (Convert to Mono if needed)
    # If shape is [Samples, Channels] (e.g. 1000, 2), average to [1000]
    if len(audio_tensor.shape) > 1:
        audio_tensor = audio_tensor.mean(dim=1) 
    
    # Add dimension to match Silero expectation: [N] -> [1, N]
    if audio_tensor.ndim == 1:
        audio_tensor = audio_tensor.unsqueeze(0)

    # --- RESAMPLING ---
    # Silero VAD works best at 16000Hz. 
    # We use torchaudio.transforms (which is pure math and doesn't rely on FFmpeg/Codecs)
    if samplerate != target_sr:
        resampler = torchaudio.transforms.Resample(orig_freq=samplerate, new_freq=target_sr)
        audio_tensor = resampler(audio_tensor)

    return audio_tensor

# --- 2. NEW HELPER: CALCULATE SILENCE TIMESTAMP ---
def calculate_silence_timestamps(audio_path: str, threshold: float = 0.5):
    if not vad_model:
        raise RuntimeError("VAD model is not loaded. Cannot process audio.")
    
    wav = read_audio_safe(audio_path)
    speech_timestamps = get_speech_timestamps(
        wav, vad_model, threshold=threshold, return_seconds=True
    )
    
    num_samples = wav.shape[1]
    total_duration = num_samples / 16000

    silence_segments = []
    current_time = 0.0

    for speech in speech_timestamps:
        start_speech = speech['start']
        end_speech = speech['end']
        
        if start_speech > current_time:
            silence_segments.append([round(current_time, 2), round(start_speech, 2)])
        
        current_time = end_speech
    
    if current_time < total_duration:
        silence_segments.append([round(current_time, 2), round(total_duration, 2)])

    return silence_segments

# --- TOOLS DEFINITION ---

@tool
def trim_silence_tool(audio_path: str):
    """
    Analyzes an audio file to detect silent sections. 
    Call this when the user asks to remove silence, cut quiet parts, or trim audio.
    Returns a JSON string with the detected timestamps.
    """
    print(f"[TOOL] Running Trim Silence on: {audio_path}")
    
    if not os.path.exists(audio_path):
        return json.dumps({"error": "File not found at path."})
    
    try:
        segments = calculate_silence_timestamps(audio_path)
        return json.dumps({
            "status": "success",
            "action_type": "trim_silence",
            "segments": segments,
            "count": len(segments)
        })
    except Exception as e:
        return json.dumps({"error": str(e)})



