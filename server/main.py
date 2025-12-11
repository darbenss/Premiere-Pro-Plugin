import os
import re
import time
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
from langchain_core.messages import SystemMessage, ToolMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
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
    api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
    temperature=0,
    max_tokens=40000,
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
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str

class ToolsRequest(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    message: str
    audio_file_path: Optional[str] = None                       # Trim Silence
    image_transition_path: Optional[List[List[str]]] = None     # Add Transition
    sync_lips: Optional[bool] = False                           # Sync Lips (TBC)

class ToolCommand(BaseModel):
    action: str
    payload: Dict[str, Any]

class ChatResponse(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4())) # Return ID so client can store it
    response_text: str
    commands: Optional[List[ToolCommand]] = None

class IntentResponse(BaseModel):
    required_tools: List[str]
    immediate_reply: Optional[str] = None
    
# --- SYSTEM PROMPT ---
system_prompt = (
    """You are a friendly and helpful AI Assistant for Adobe Premiere Pro. 
    You are here to chat, collaborate, and edit videos.
    
    ### YOUR CAPABILITIES (The only things you can do):
    1. 'trim_silence': Removes silence from audio.
    2. 'add_transition': Adds transitions between clips.
    3. 'sync_lips': Synchronizes audio and video.

    ### COMMUNICATION STYLE:
    - *Length Constraint: All replies must be concise and contain a **maximum of 150 words*.
    - **Be Friendly**: Chat naturally. If the user says "Hi", say "Hi" back!
    - **Summarize Actions**: When you run a tool, explain what you did clearly but briefly. Mention the specific details (duration, style, timestamps) so the user knows exactly what changed.
      - *Good Example*: "I added a 0.5s Glitch transition to the first cut and a smooth 1.0s Dissolve to the second. I also trimmed the silence from 0s to 1.2s."
      - *Bad Example*: "Action completed. JSON payload sent."
    - **No Tech Jargon**: Do not bore the user with "JSON arrays" or "float values" unless they ask.
    - **Stay Grounded**: Only recommend next steps if they involve the 3 tools above. Do not offer to color grade, generate subtitles, or fetch coffee.

    RULES for 'add_transition_tool':
    1. **Count Check**: Look for "Target Cut Count" in the system note. Your output lists MUST have exactly that many items.
    2. **Visual Analysis (CRITICAL)**: Act like a Film Director. Look at the [System Context Data].
       - Compare the Color/Lighting between the two shots.
       - Compare the Movement (Static vs. Action).
       - **Do NOT default to generic 'glitch' or 'dissolve'**. 
       - If shots are similar (same scene) -> Suggest "Morph Cut" or "Invisible Cut".
       - If shots are different (scene change) -> Suggest "Dip to Black", "Light Leak", or "Whip Pan".
       - Be specific: e.g., "Warm Light Leak", "Cyberpunk Glitch", "Soft Blur".
    3. **Duration Logic**: Generate 'durations_json' based on the vibe (Max 2.0s):
         - Fast/Glitchy/Action -> 0.2 - 0.5s
         - Standard -> 0.5 - 1.0s
         - Smooth/Dreamy -> 1.0 - 2.0s
    4. **Data Handling**: Simply COPY 'img_paths_json' from the context. Retain the double backslashes.
    5. **Execution**: Apply automatically. Do not ask for user confirmation on durations."""
)

intent_system_prompt = SystemMessage(content="""
    You are the "Intent Classifier" for an Adobe Premiere Pro AI Agent.
    Your job is to analyze the user's latest message and determine if they require specific video editing tools or if they are just chatting.

    ### AVAILABLE TOOLS:
    1. "trim_silence": Use this if the user wants to remove silence, pauses, gaps, or shorten the video based on audio levels.
    2. "add_transition": Use this if the user wants to add transitions, connect clips, OR IF THEY ASK FOR A RECOMMENDATION or suggestion for a transition.
    3. "lips_sync": Use this if the user mentions synchronizing audio, dubbing, or matching lip movements.

    ### RULES:
    1. Analyze the user's Input.
    2. Return a JSON object with two keys: "tools" and "reply".
    3. "tools": A list of strings. 
    - If the user asks for multiple actions (e.g., "Trim silence and add a transition"), include ALL relevant tool names.
    - If the user asks for advice/recommendations regarding a specific tool feature, INCLUDE that tool in the list.
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
    Output: {{"tools": ["lips_sync", "add_transition"], "reply": null}}

    User: "Make the video look like a movie."
    Output: {{"tools": [], "reply": "I currently don't have a specific color grading tool, but I can help you trim silence, add transitions, or sync lips. Would you like to try one of those?"}}
    
    User: "Trim the silence and suggest a transition for me."
    Output: {{"tools": ["trim_silence", "add_transition"], "reply": null}}

    ### RESPONSE FORMAT:
    Provide ONLY the raw JSON object. Do not use Markdown formatting (```json).
    """)
    
# --- HELPER FUNCTIONS ---
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def get_intent(human_messages: str):
    # 1. Construct the message list (This part was fine)
    messages = [
        intent_system_prompt,
        HumanMessage(content=human_messages)
    ]

    # 2. Define the chain (Runnables only)
    # We pipe the LLM into a parser to get the string content automatically
    chain = llm | StrOutputParser()

    # 3. Invoke the chain WITH the messages list as input
    result = chain.invoke(messages)
    
    print(f"DEBUG Intent: {result}")
    
    try:
        json_match = re.search(r"(\{.*\}|\[.*\])", result, re.DOTALL)
        
        if json_match:
            clean_json = json_match.group(0)
            return json.loads(clean_json)
        else:
            # Fallback: Try standard cleanup if regex fails
            cleaned_result = result.strip().replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned_result)

    except (json.JSONDecodeError, AttributeError):
        print(f"❌ JSON Parse Error. Raw content: {result}")
        # Fallback intent if parsing fails entirely
        return {"tools": [], "reply": "I'm sorry, I couldn't process that request."}
    

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

    intent = get_intent(user_msg_content)

    return IntentResponse(
        required_tools=intent["tools"],
        immediate_reply=intent["reply"] if intent["reply"] else None        # Immediate reply if no tools are required
    )


@traceable
@app.post("/process_request", response_model=ChatResponse)
async def process_request_endpoint(request: ToolsRequest):
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
    if request.image_transition_path:
        clips = request.image_transition_path
        
        # Safety check: Need at least 2 clips to have a transition
        if len(clips) >= 2:
            try:
                for i in range(len(clips) - 1):
                    current_clip = clips[i]
                    next_clip = clips[i+1]

                    if not current_clip or not next_clip:
                        print(f"Skipping empty clip data at index {i}")
                        continue

                    outgoing_clip_tail = current_clip[-1]
                    incoming_clip_head = next_clip[0]
                    
                    # Iterate through both paths
                    for img_path in [outgoing_clip_tail, incoming_clip_head]:
                        # 1. Sanitize path (handle mixed slashes if necessary)
                        clean_path = os.path.normpath(img_path) + ".png"

                        # 2. Check if file exists explicitly
                        if not os.path.exists(clean_path):
                            print(f"⚠️ MISSING FILE: {clean_path}")
                            # Optional: Add a small retry if it's a race condition
                            while not os.path.exists(clean_path):
                                print("Waiting for file to be created...")
                                time.sleep(1) 
                            
                            if not os.path.exists(clean_path):
                                continue 
                        
                        # 3. Proceed to encode
                        try:
                            base64_image = encode_image(clean_path)
                            message_content.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}",
                                    "detail": "high"
                                }
                            })
                        except Exception as encode_err:
                            print(f"Error encoding {clean_path}: {encode_err}")

                message_content.append({
                    "type": "text", 
                    "text": f"**[System Note]: Target Cut Count: {len(clips) - 1}**\n"
                })

            except Exception as e:
                print(f"Critical Loop Error: {e}")
        
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
    collected_actions = {}
    
    # We loop REVERSED to get the *latest* execution of a tool first.
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage):
            try:
                data = json.loads(msg.content)
                action_type = data.get("action_type")
                
                # Check if it's a valid known tool
                if action_type in ["trim_silence", "add_transition", "sync_lips"]:
                    
                    # ONLY add if we haven't seen this action_type yet
                    if action_type not in collected_actions:
                        collected_actions[action_type] = ToolCommand(
                            action=action_type, 
                            payload=data
                        )
                        
            except json.JSONDecodeError:
                continue

    # Convert the dictionary values to a list
    final_commands = list(collected_actions.values())

    return ChatResponse(
        session_id=request.session_id,
        response_text=str(bot_text),
        commands=final_commands # Returns list like: [TrimCommand, TransitionCommand]
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=8000)