/**
 * ============================================================================
 * HOW TO ADD A NEW FEATURE
 * ============================================================================
 * 1. Create a new feature file in `features/` (e.g., `features/my_feature.js`).
 * 2. Export two functions: `gatherMyContext()` and `processMyFeature(payload)`.
 * 3. Add the `gather` function to `TOOL_REGISTRY` below.
 * 4. Add the `process` function to `ai_decoder.js` switch statement.
 * ============================================================================
 */

// ============================================================================
//  GLOBAL IMPORTS & CONSTANTS
// ============================================================================
const { executeAICommands } = require('./ai_decoder.js');
const { gatherAudioContext } = require('./features/trim_silence.js');
const { gatherClipContext } = require('./features/add_transition.js');
const { generateSimpleUniqueId } = require('./uniquesession_id.js'); // Import Session Generator

// GLOBAL STATE
let currentSessionId = null;

// TOOL REGISTRY
const TOOL_REGISTRY = {
    "trim_silence": gatherAudioContext,
    "add_transition": gatherClipContext
};

// ============================================================================
//  MAIN ENTRY POINT | INITIALIZATION 
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {

    // --- UI ELEMENTS ---
    const inputField = document.getElementById('aiInput');
    const sendBtn = document.getElementById('sendBtn');
    const chips = document.querySelectorAll('.chip-btn');

    const mainDisplay = document.getElementById('mainDisplay');
    const chatHistory = document.getElementById('chatHistory');
    const emptyState = document.getElementById('emptyStateContainer');

    // --- INITIALIZATION ---
    (async () => {
        currentSessionId = await generateSimpleUniqueId();
        console.log("Session ID Initialized:", currentSessionId);
    })();

    // --- EVENT LISTENERS ---

    // 1. CHIP BUTTONS (Quick Actions)
    chips.forEach(chip => {
        chip.addEventListener('click', async (event) => {
            // This gets "Trim Silence", "Audio Sync", etc.
            const action = event.currentTarget.getAttribute('label');
            // --- ROUTER LOGIC ---
            if (action === "Trim Silence") {
                await processUserMessage(action);
            }
            else if (action === "Audio Sync") {
                showUnderConstructionWithDelay();
            }
            else if (action === "Transition Recommendation") {
                await processUserMessage(action);
            }
        });
    });

    // 2. SEND BUTTON
    sendBtn.addEventListener('click', () => {
        const text = inputField.value.trim();
        if (text) {
            processUserMessage(text);
            inputField.value = ''; // Clear input
        }
    });

    // 3. ENTER KEY
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent newline in sp-textfield
            sendBtn.click();
        }
    });

    // ========================================================================
    //  CORE CHAT LOGIC (DOUBLE HANDSHAKE)
    // ========================================================================

    async function processUserMessage(messageText) {
        // 1. Switch UI from Empty State to Chat Mode
        ensureChatMode();

        // 2. Add User Message Bubble
        addBubble(messageText, 'user');

        // 3. Add Typing Indicator
        const loadingId = addTypingIndicator();

        try {
            // --- STEP 1: INTENT DETECTION ---
            console.log("--- Step 1: Intent Detection ---");
            const intentResponse = await fetch("http://localhost:8000/get_intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    message: messageText
                })
            });

            if (!intentResponse.ok) throw new Error(`Intent Detection Failed: ${intentResponse.statusText}`);
            const intentData = await intentResponse.json();
            console.log("Intent Data:", intentData);

            // Update Session ID if returned
            if (intentData.session_id) {
                currentSessionId = intentData.session_id;
                console.log("Session ID Updated (Intent):", currentSessionId);
            }

            // GATEKEEPER: BLOCK INTENTS
            const BLOCKED_INTENTS = ["lips_sync"];
            if (intentData.required_tools && intentData.required_tools.some(tool => BLOCKED_INTENTS.includes(tool))) {
                console.log(`🚫 Intent '${intentData.required_tools}' is currently disabled.`);
                removeBubble(loadingId);
                showUnderConstructionWithDelay();
                return;
            }

            // Logic: If immediate_reply is not null and required_tools is empty, just display message
            if (intentData.immediate_reply && (!intentData.required_tools || intentData.required_tools.length === 0)) {
                removeBubble(loadingId);
                addBubble(intentData.immediate_reply, 'ai');
                return;
            }

            // --- STEP 2: DATA GATHERING ---
            console.log("--- Step 2: Data Gathering ---");
            const contextData = {};

            if (intentData.required_tools && intentData.required_tools.length > 0) {
                // Update UI to show we are working
                // Optional: addBubble("Analyzing project...", 'ai'); 

                for (const toolName of intentData.required_tools) {
                    const gatherFunc = TOOL_REGISTRY[toolName];
                    if (gatherFunc) {
                        console.log(`Gathering data for: ${toolName}`);
                        try {
                            const data = await gatherFunc();
                            contextData[toolName] = data;
                        } catch (err) {
                            console.error(`Failed to gather data for ${toolName}:`, err);
                            contextData[toolName] = { error: err.message };
                        }
                    } else {
                        console.warn(`Tool not found in registry: ${toolName}`);
                    }
                }
            }

            let body = {
                session_id: currentSessionId,
                message: messageText,
            };

            if (contextData["trim_silence"]) {
                body.audio_file_path = contextData["trim_silence"];
            }
            if (contextData["add_transition"]) {
                console.log("path: ", contextData["add_transition"]);
                body.image_transition_path = contextData["add_transition"];
            }
            // TODO: If want to add more context data, add it here

            console.log("Body:", body);
            // --- STEP 3: PROCESS REQUEST ---
            console.log("--- Step 3: Process Request ---");
            const processResponse = await fetch("http://localhost:8000/process_request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!processResponse.ok) throw new Error(`Process Request Failed: ${processResponse.statusText}`);
            const result = await processResponse.json();
            console.log("Process Result:", result);

            // Update Session ID if returned
            if (result.session_id) {
                currentSessionId = result.session_id;
                console.log("Session ID Updated (Process):", currentSessionId);
            }

            removeBubble(loadingId);

            // --- STEP 4: EXECUTION ---
            console.log("--- Step 4: Execution ---");

            if (result.response_text) {
                addBubble(result.response_text, 'ai');
            }

            if (result.commands && result.commands.length > 0) {
                await executeAICommands(result.commands, result.response_text);
            }

        } catch (error) {
            console.error(error);
            removeBubble(loadingId);
            addBubble("Sorry, I encountered an error processing that request.", 'ai');
        }
    }

    // ========================================================================
    //  UI HELPER FUNCTIONS
    // ========================================================================

    function addBubble(text, sender) {
        const row = document.createElement('div');
        row.classList.add('message-row', sender);

        const bubble = document.createElement('div');
        bubble.classList.add('chat-bubble');
        bubble.innerText = text;

        row.appendChild(bubble);
        chatHistory.appendChild(row);

        // Auto-scroll to bottom
        mainDisplay.scrollTop = mainDisplay.scrollHeight;
    }

    function addTypingIndicator() {
        const id = 'loading-' + Date.now();
        const row = document.createElement('div');
        row.classList.add('message-row', 'ai');
        row.id = id;

        const bubble = document.createElement('div');
        bubble.classList.add('typing-indicator');
        bubble.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        `;

        row.appendChild(bubble);
        chatHistory.appendChild(row);
        mainDisplay.scrollTop = mainDisplay.scrollHeight;
        return id;
    }

    function removeBubble(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function showUnderConstructionWithDelay() {
        ensureChatMode()
        const loadingId = addTypingIndicator();
        setTimeout(() => {
            removeBubble(loadingId);
            addBubble("🚧 Feature under construction.", 'ai');
        }, 1000);
    }

    function ensureChatMode() {
        if (emptyState.style.display !== 'none') {
            emptyState.style.display = 'none';
            chatHistory.style.display = 'flex';

            // Adjust mainDisplay layout for chat
            mainDisplay.style.justifyContent = 'flex-start';
            mainDisplay.style.alignItems = 'stretch';
        }
    }

}); // --- END OF DOMContentLoaded ---
