// ============================================================================
//  GLOBAL IMPORTS & CONSTANTS
// ============================================================================
const { handleTrimSilence } = require('./trim_silence.js');
const { handleTransitionRecommendation } = require('./add_transition.js');

// ============================================================================
//  MAIN ENTRY POINT | INITIALIZATION 
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {

    // --- UI ELEMENTS ---
    const inputField = document.getElementById('aiInput');
    const sendBtn = document.getElementById('sendBtn');
    const chips = document.querySelectorAll('.chip-btn');
    const mainDisplay = document.getElementById('mainDisplay');

    // --- EVENT LISTENERS ---
    chips.forEach(chip => {
        chip.addEventListener('click', async (event) => {
            const action = event.currentTarget.getAttribute('label');
            console.log("Button clicked:", action);

            // FEATURE 1: TRIM SILENCE
            if (action === "Trim Silence") {
                await handleTrimSilence();
            }

            // FEATURE 2: TRANSITION RECOMMENDATION
            else if (action === "Transition Recommendation") {
                await handleTransitionRecommendation();
            }

            // FEATURE 3: AUDIO SYNC
            else if (action === "Audio Sync") {
                await handleAudioSync();
            }
        });
    });

    // --- TEXT INPUT HANDLERS ---
    sendBtn.addEventListener('click', () => {
        const text = inputField.value.trim();
        if (text) console.log("User typed:", text);
        // Future: You can route text commands to functions here
    });

    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });

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
