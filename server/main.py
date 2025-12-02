import os
import json
import base64
import sqlite3
from var import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL
import uuid
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from tools.trim_silence import trim_silence_tool
from tools.add_transition import add_transition_tool

# LangChain & LangGraph
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, ToolMessage, HumanMessage, 
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.prebuilt import ToolNode, tools_condition
from langsmith import traceable

# --- CONFIGURATION ---
if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY not found in environment.")


# --- LANGGRAPH SETUP ---
# 1. Initialize LLM
llm = ChatOpenAI(
    model=OPENROUTER_MODEL,
    openai_api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
    temperature=0
)

# 2. Bind Tools
tools = [trim_silence_tool, add_transition_tool]
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
conn = sqlite3.connect("checkpoints.sqlite", check_same_thread=False)
memory = SqliteSaver(conn)
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

class IntentRequest(BaseModel):
    session_id: str # = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str

class ToolsRequest(BaseModel):
    session_id: str # = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str
    audio_file_path: Optional[str] = None
    image_transition_path: Optional[List[List[str]]] = None
    sync_lips: Optional[bool] = False                   # To be changed

class ToolCommand(BaseModel):
    action: str
    payload: Dict[str, Any]

class ChatResponse(BaseModel):
    session_id: str # Return ID so client can store it
    response_text: str
    command: Optional[ToolCommand] = None

class IntentResponse(BaseModel):
    trim_silence: bool = False
    add_transition: bool = False
    sync_lips: bool = False
    immediate_reply: Optional[str] = None
    
# --- SYSTEM PROMPT ---
system_prompt = (
    """You are an AI Assistant for Adobe Premiere Pro. 
    You can chat normally or use tools to edit video. 
    RULES for Tools:
    1. 'trim_silence_tool': Use for silence removal.
    2. 'add_transition_tool': Use when user wants to add transitions. 
    3. 'sync_lips_tool': For synchronizing audio/video.
    
    RULES for 'add_transition_tool':
        1. You will receive multiple images representing sequential cuts.
        2. You must generate a LIST of 'target_vibes' strings, one for each cut.
            - Input 'target_vibes_json': A JSON string list. Example: '["slow dissolve", "fast glitch"]'
        3. Input 'img_paths_json': COPY the exact JSON string provided in context.
        4. If the cuts look similar, you can repeat the vibe in the list.
        5. If the cuts are drastically different, use different vibes for each index."""
)

intent_system_prompt = SystemMessage(content="""
    You are the "Intent Classifier" for an Adobe Premiere Pro AI Agent.
    Your job is to analyze the user's latest message and determine if they require specific video editing tools or if they are just chatting.

    ### AVAILABLE TOOLS:
    1. "trim_silence": Use this if the user wants to remove silence, pauses, gaps, or shorten the video based on audio levels.
    2. "add_transition": Use this if the user wants to add transitions (dissolve, wipe, cut) between clips or connect videos.
    3. "lips_sync": Use this if the user mentions synchronizing audio, dubbing, or matching lip movements.

    ### RULES:
    1. Analyze the user's Input.
    2. Return a JSON object with two keys: "tools" and "reply".
    3. "tools": A list of strings. 
    - If the user asks for multiple actions (e.g., "Trim silence and add a transition"), include ALL relevant tool names.
    - If the request does not match any tool, return an empty list [].
    4. "reply": A string.
    - If "tools" is NOT empty (you found an intent): Set "reply" to null (The main agent will handle the conversation later).
    - If "tools" IS empty (just chatting): Write a friendly, helpful response as an AI Assistant.

    ### EXAMPLES:
    User: "Hi, how are you?"
    Output: {{"tools": [], "reply": "I'm doing well! I'm ready to help you edit. What are we working on?"}}

    User: "Please remove the silent parts from this interview."
    Output: {{"tools": ["trim_silence"], "reply": null}}

    User: "I need to sync this audio and add a cross dissolve between these clips."
    Output: {{"tools": ["sync_lips", "add_transition"], "reply": null}}

    User: "Make the video look like a movie."
    Output: {{"tools": [], "reply": "I currently don't have a specific color grading tool, but I can help you trim silence, add transitions, or sync lips. Would you like to try one of those?"}}

    ### RESPONSE FORMAT:
    Provide ONLY the raw JSON object. Do not use Markdown formatting (```json).
    """)

# --- HELPER FUNCTIONS ---
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def get_intent(human_messages: str, config):
    # READ ONLY: Fetch history from the Graph's memory
    current_state = graph.get_state(config)
    history = current_state.values.get("messages", [])
    
    recent_history = history[-5:] 
    
    messages = [
        intent_system_prompt,
        *recent_history, 
        HumanMessage(content=human_messages)
    ]

    chain = (
        messages
        | llm
        | {"result": lambda x: x.content}
    )

    result = chain.invoke(config=config)
    print(f"DEBUG Intent: {result}")
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Not a valid JSON response.")
    

# --- API ENDPOINT ---
@traceable
@app.post("/get_intent", response_model=IntentResponse)
async def get_intent_endpoint(request: IntentRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="Missing API Key configuration.")

    user_msg_content = request.message
    print(user_msg_content)

    if not user_msg_content:
        raise HTTPException(status_code=400, detail="No message provided.")

    config = {"configurable": {"thread_id": request.session_id}}

    intent = get_intent(user_msg_content, config)

    return IntentResponse(
        trim_silence=intent["tools"].count("trim_silence") > 0,
        add_transition=intent["tools"].count("add_transition") > 0,
        sync_lips=intent["tools"].count("sync_lips") > 0,
        immediate_reply=intent["reply"] if intent["reply"] else None
    )


@traceable
@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ToolsRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="Missing API Key configuration.")

    # 1. Setup Config with Thread ID
    config = {"configurable": {"thread_id": request.session_id}}

    # 2. Check Existing State
    current_state = graph.get_state(config)
    existing_messages = current_state.values.get("messages", [])

    input_messages = []

    # Only add System Prompt if this is a NEW conversation
    if not existing_messages:
        input_messages.append(SystemMessage(content=system_prompt))
    
    # 3. Add Context dynamically based on what the Frontend sent
    text_content = f"User Request: {request.message}\n"
    
    context_parts = []
    
    # Context for Trim Silence
    if request.audio_file_path:
        context_parts.append(f"Audio Path: {request.audio_file_path}")
    
    # Context for Add Transition (The Paths)
    if request.image_transition_path:
        paths_str = json.dumps(request.image_transition_path)
        context_parts.append(f"Transition Clips JSON: {paths_str}")
        context_parts.append("(See attached images for visual context of these clips)")

    # Context for Lip Sync
    if request.sync_lips:
        context_parts.append("Requesting Lip Sync: True")

    # Combine text parts
    if context_parts:
        text_content += "\n\n[System Context Data]:\n" + "\n".join(context_parts)

    print(f"DEBUG TEXT INPUT: {text_content}") 

    # --- Part B: Build the Message Payload ---
    
    message_content = []
    
    # 1. Add the Text Block first
    message_content.append({"type": "text", "text": text_content})
    
    # 2. Add Image Blocks
    # This allows the AI to "see" the clips to determine the Vibe
    # Safety check: Need at least 2 clips to have a transition
    if len(clips) >= 2:
        try:
            # Loop through every connection (Cut 1, Cut 2, etc.)
            for i in range(len(clips) - 1):
                outgoing_clip_tail = clips[i][1]      # End of Clip A
                incoming_clip_head = clips[i+1][0]    # Start of Clip B
                
                # We load BOTH images for this specific cut
                for img_path in [outgoing_clip_tail, incoming_clip_head]:
                    base64_image = encode_image(img_path)
                    
                    # We add a small detail note so the AI knows which cut this is
                    message_content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}",
                            "detail": "low" # 'low' is cheaper/faster, 'high' for better analysis
                        }
                    })
            
            # Add a text hint to explain the image order to the LLM
            message_content.append({
                "type": "text", 
                "text": f"[System Note]: The images above represent {len(clips)-1} cut points. They are ordered sequentially: Cut 1 Out, Cut 1 In, Cut 2 Out, Cut 2 In..."
            })

        except Exception as e:
            print(f"Error loading images: {e}")
            # Don't crash, just proceed with text only

    # 3. Create the final HumanMessage
    input_messages.append(HumanMessage(content=message_content))

    # 4. Run Graph
    try:
        final_state = graph.invoke({"messages": input_messages}, config=config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent Error: {str(e)}")

    # 5. Process Response
    messages = final_state["messages"]
    bot_text = messages[-1].content if messages else "No response generated."
    
    # Logic to find the LAST successful tool execution to send back to UXP
    # Note: If multiple tools ran, this logic picks the last one. 
    # If you need to return multiple commands, 'uxp_command' needs to be a list in your Pydantic model.
    uxp_command = None
    
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage):
            try:
                data = json.loads(msg.content)
                action_type = data.get("action_type")
                
                if action_type == "trim_silence":
                    uxp_command = ToolCommand(action="trim_silence", payload=data)
                    break 
                elif action_type == "add_transition":
                    uxp_command = ToolCommand(action="add_transition", payload=data)
                    break
                elif action_type == "sync_lips":
                    uxp_command = ToolCommand(action="sync_lips", payload=data)
                    break
                    
            except json.JSONDecodeError:
                continue

    return ChatResponse(
        session_id=request.session_id,
        response_text=str(bot_text),
        command=uxp_command
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)