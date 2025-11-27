import os
import json
from var import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL
import uuid
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from silero_vad import load_silero_vad, read_audio, get_speech_timestamps

# LangChain & LangGraph
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage, HumanMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.checkpoint.memory import MemorySaver
from langsmith import traceable

# Audio Processing Imports
import torch
import torchaudio
import soundfile as sf


# --- CONFIGURATION ---

# 1. Setup OpenRouter Credentials
if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY not found in environment.")

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

# --- LANGGRAPH SETUP ---

# 1. Initialize LLM
llm = ChatOpenAI(
    model=OPENROUTER_MODEL,
    openai_api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
    temperature=0
)

# 2. Bind Tools
tools = [trim_silence_tool]
llm_with_tools = llm.bind_tools(tools)

# 3. Define Nodes
def agent_node(state: MessagesState):
    messages = state["messages"]
    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}

# 4. Build Graph
builder = StateGraph(MessagesState)
builder.add_node("agent", agent_node)
builder.add_node("tools", ToolNode(tools))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)
builder.add_edge("tools", "agent")

# 5. Compile with Memory
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)

# --- FASTAPI SERVER ---

app = FastAPI(title="Premiere Pro Agentic Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API MODELS ---

class ChatRequest(BaseModel):
    # CLIENT MUST SEND THIS ID TO MAINTAIN MEMORY
    session_id: str # = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str
    audio_file_path: Optional[str] = None

class ToolCommand(BaseModel):
    action: str
    payload: Dict[str, Any]

class ChatResponse(BaseModel):
    session_id: str # Return ID so client can store it
    response_text: str
    command: Optional[ToolCommand] = None

# --- API ENDPOINT ---

@traceable
@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="Missing API Key configuration.")

    # 1. Setup Config with Thread ID
    config = {"configurable": {"thread_id": request.session_id}}

    # 2. Check Existing State (Prevent System Prompt Duplication)
    # We fetch the current state of this thread from memory
    current_state = graph.get_state(config)
    existing_messages = current_state.values.get("messages", [])

    input_messages = []

    # Only add System Prompt if this is a NEW conversation (no history)
    if not existing_messages:
        system_prompt = (
            "You are an AI Assistant for Adobe Premiere Pro. "
            "You can chat normally or use tools to edit video. "
            "If the user asks to trim silence, use the 'trim_silence_tool'. "
            "Always confirm when you have completed an action."
        )
        input_messages.append(SystemMessage(content=system_prompt))
    
    # Add Context if provided
    user_msg_content = request.message
    print(user_msg_content)
    if request.audio_file_path:
        user_msg_content += f"\n[Context] Audio Path: {request.audio_file_path}"
    
    input_messages.append(HumanMessage(content=user_msg_content))

    # 3. Run Graph
    try:
        final_state = graph.invoke({"messages": input_messages}, config=config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent Error: {str(e)}")

    # 4. Process Response
    messages = final_state["messages"]
    bot_text = messages[-1].content if messages else "No response generated."
    
    uxp_command = None
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage):
            try:
                data = json.loads(msg.content)
                if data.get("action_type") == "trim_silence":
                    uxp_command = ToolCommand(action="trim_silence", payload=data)
                    break 
            except json.JSONDecodeError:
                continue

    # Return the session_id so the client can reuse it
    return ChatResponse(
        session_id=request.session_id,
        response_text=str(bot_text),
        command=uxp_command
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)