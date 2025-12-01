import os
import json
import sqlite3
from var import OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL
import uuid
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from tools.trim_silence import trim_silence_tool

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

def get_intent(human_messages: str, config):
    messages = [
        intent_system_prompt,
        HumanMessage(content=human_messages)
    ]
    chain = (
        messages
        | llm
        | {"result": lambda x: x.content}
    )
    result = chain.invoke()
    print(result)
    try:
        result = json.loads(result)
        return result
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
        system_prompt = (
            "You are an AI Assistant for Adobe Premiere Pro. "
            "You can chat normally or use tools to edit video. "
            "Use 'trim_silence_tool' for silence removal. "
            "Use 'add_transition_tool' for adding transitions between clips. "
            "Use 'sync_lips_tool' for synchronizing audio/video. "
            "Always confirm when you have completed an action."
        )
        input_messages.append(SystemMessage(content=system_prompt))
    
    # 3. Add Context dynamically based on what the Frontend sent
    user_msg_content = request.message
    
    context_parts = []
    if request.audio_file_path:
        context_parts.append(f"Audio Path: {request.audio_file_path}")
    
    if request.image_transition_path:
        # Flattening logic might be needed depending on how your agent reads it, 
        # but here we pass the raw structure clearly.
        context_parts.append(f"Transition Clips: {request.image_transition_path}")

    if request.sync_lips:
        context_parts.append("Requesting Lip Sync: True")

    if context_parts:
        user_msg_content += "\n\n[System Context Data]:\n" + "\n".join(context_parts)
    
    print(f"DEBUG INPUT: {user_msg_content}") # Helpful for debugging
    input_messages.append(HumanMessage(content=user_msg_content))

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