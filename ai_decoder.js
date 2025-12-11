/**
 * ============================================================================
 * HOW TO ADD A NEW FEATURE
 * ============================================================================
 * 1. Create a new feature file in `features/` (e.g., `features/my_feature.js`).
 * 2. Export two functions: `gatherMyContext()` and `processMyFeature(payload)`.
 * 3. Add the `gather` function to `TOOL_REGISTRY` in `main.js`.
 * 4. Import the `process` function here in `ai_decoder.js`.
 * 5. Add a new case to the switch statement below matching the `action` name.
 * ============================================================================
 */

const { processTrimSilence } = require('./features/trim_silence.js');
const { processTransitions } = require('./features/add_transition.js');
const { processCurseWordDetection } = require('./features/curseword_detection.js');

/**
 * Executes the commands returned by the AI.
 * @param {Array} commands - The list of commands to execute.
 * @param {string} aiMessage - The response text from AI.
 */
async function executeAICommands(commands, aiMessage) {
    console.log("--- Executing AI Commands ---");
    console.log("Commands:", commands);

    if (!commands || !Array.isArray(commands)) {
        console.warn("No commands to execute.");
        return;
    }

    const mainDisplay = document.getElementById('mainDisplay');

    for (const command of commands) {
        const action = command.action;
        const payload = command.payload;

        console.log(`Dispatching action: ${action}`);

        switch (action) {
            case 'trim_silence':
                await processTrimSilence(payload, aiMessage, mainDisplay);
                break;
            case 'add_transition':
                await processTransitions(payload);
                break;
            case 'curseword_detect':
                await processCurseWordDetection(payload);
                break;
            default:
                console.warn(`Unknown action: ${action}`);
                break;
        }
    }
}

module.exports = {
    executeAICommands
};