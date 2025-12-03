// ============================================================================
//  GLOBAL IMPORTS & CONSTANTS
// ============================================================================
const { handleTrimSilence } = require('./features/trim_silence.js');
const { handleTransitionRecommendation } = require('./features/add_transition.js');

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

    // --- EVENT LISTENERS ---
    
    // 1. CHIP BUTTONS (Quick Actions)
    chips.forEach(chip => {
        chip.addEventListener('click', async (event) => {
            const action = event.currentTarget.getAttribute('label');
            await processUserMessage(action);
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
    //  CORE CHAT LOGIC
    // ========================================================================

    async function processUserMessage(messageText) {
        // 1. Switch UI from Empty State to Chat Mode
        if (emptyState.style.display !== 'none') {
            emptyState.style.display = 'none';
            chatHistory.style.display = 'flex';
            
            // Adjust mainDisplay layout for chat
            mainDisplay.style.justifyContent = 'flex-start';
            mainDisplay.style.alignItems = 'stretch';
        }

        // 2. Add User Message Bubble
        addBubble(messageText, 'user');

        // 3. Add Typing Indicator
        const loadingId = addTypingIndicator();

        // 4. Determine Intent & Route to Logic
        // We assume the actual API fetching happens inside handleTrimSilence/handleTransitionRecommendation
        try {
            const lowerMsg = messageText.toLowerCase();

            if (lowerMsg.includes('silence') || lowerMsg.includes('trim')) {
                // FEATURE 1: TRIM SILENCE
                await handleTrimSilence(); 
                removeBubble(loadingId);
                addBubble("I've analyzed the audio. Use the controls below to review silences.", 'ai');

            } else if (lowerMsg.includes('transition') || lowerMsg.includes('fade') || lowerMsg.includes('dissolve')) {
                // FEATURE 2: TRANSITIONS
                await handleTransitionRecommendation();
                removeBubble(loadingId);
                addBubble("Transitions have been added to your cut points.", 'ai');

            } else if (lowerMsg.includes('sync') || lowerMsg.includes('audio')) {
                // FEATURE 3: AUDIO SYNC
                await handleAudioSync();
                removeBubble(loadingId);
                addBubble("Audio synchronization complete.", 'ai');

            } else {
                // FALLBACK AI RESPONSE
                // Simulate a slight delay for realism if not using a heavy function
                setTimeout(() => {
                    removeBubble(loadingId);
                    addBubble(`I received: "${messageText}". currently I am optimized for Silence Trimming, Transitions, and Audio Sync.`, 'ai');
                }, 1000);
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

    // ========================================================================
    // FEATURE 3: AUDIO SYNC 
    // ========================================================================

    async function handleAudioSync() {
        console.log("--- Starting Feature 3: Audio Sync ---");
        const mainDisplay = document.getElementById('mainDisplay');

        mainDisplay.innerHTML = `
            <div style="text-align: center; padding: 20px; color: white;">
                <h2>Audio Sync</h2>
                <p>Feature coming soon...</p>
            </div>
        `;

        // [COMMAND]: PUT YOUR AUDIO SYNC LOGIC HERE
        // 1. Export Audio A & B
        // 2. Send to AI
        // 3. Move Clip
    }

}); // --- END OF DOMContentLoaded ---
