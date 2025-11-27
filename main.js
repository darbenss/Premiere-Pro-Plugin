const app = require('premierepro');
const { Constants, EncoderManager, TickTime, Marker, Markers, CompoundAction } = require('premierepro');

// ------------- REAL FUNCTION FOR HANDLING PYTHON --------------
// 1. Handle Context Chips
// chips.forEach(chip => {
//     // Change 'e' to 'event' for clarity
//     chip.addEventListener('click', async (event) => { 

//         // --- FIX 1: Use currentTarget, not target ---
//         // e.target might be the icon or text. currentTarget is ALWAYS the button.
//         const action = event.currentTarget.getAttribute('label');

//         console.log("Button Clicked:", action); // Check your console for this!

//         if (action === "Trim Silence") {
//             handleTrimSilence(); 
//         } 
//         // --- TEST SECTION ---
//         else if (action === "Audio Sync") {
//             console.log("Attempting Audio Export Test...");

//             // --- FIX 2: Wrap in a BIG Try/Catch to see errors ---
//             try {
//                 // Visual feedback so you know it started
//                 mainDisplay.innerHTML = `<h3 style="color:white">Exporting... Check Console.</h3>`;

//                 const path = await exportAudioForAnalysis();

//                 alert(`SUCCESS!\nFile saved at:\n${path}`);
//                 mainDisplay.innerHTML = `<h3 style="color:#2d9d78">Export Success!</h3>`;

//             } catch (err) {
//                 // This will tell us WHY it failed
//                 alert(`ERROR:\n${err.message}`);
//                 console.error("Export Failed:", err);
//                 mainDisplay.innerHTML = `<h3 style="color:#d7373f">Error: ${err.message}</h3>`;
//             }
//         } 
//         // --- END TEST SECTION ---
//         else {
//             inputField.value = `Perform ${action}`;
//         }
//     });
// });

// Wait for the DOM to be fully loaded before running script
document.addEventListener("DOMContentLoaded", () => {

    // --- UI ELEMENTS ---
    const inputField = document.getElementById('aiInput');
    const sendBtn = document.getElementById('sendBtn');
    const chips = document.querySelectorAll('.chip-btn');
    const mainDisplay = document.getElementById('mainDisplay');

    // --- EVENT LISTENERS ---

    // 1. Handle Context Chips
    chips.forEach(chip => {
        chip.addEventListener('click', async (event) => {
            // FIX: Use currentTarget to get the button element, not the clicked icon/text
            const action = event.currentTarget.getAttribute('label');
            console.log("Button clicked:", action);

            // 1. TRIM SILENCE (Real Feature)
            if (action === "Trim Silence") {
                handleTrimSilence();
            }

            // 2. AUDIO SYNC (Placeholder)
            else if (action === "Audio Sync") {
                console.log("Audio Sync logic not connected yet.");
                // FIX: Changed alert to console.log to prevent crashes
                console.log("Audio Sync is waiting for Python!");
            }

            // 3. AUTO CUT BEAT (DEBUG / TEST BUTTON)
            else if (action === "Auto Cut Beat") {
                console.log("--- STARTING MOCK CUT TEST ---");

                // MOCK DATA: Simulating Python response with array of arrays
                const rawPythonResponse = {
                    "segments": [
                        [0.0, 0.5],
                        [3.0, 5.0],
                        [8.0, 10.0]
                    ]
                };

                // Convert [start, end] arrays into objects { start, end }
                const mockData = rawPythonResponse.segments.map(segment => ({
                    start: segment[0],
                    end: segment[1]
                }));

                try {
                    // Call the surgery function directly
                    await performTrimSilence(mockData);
                    // FIX: Removed alert() call
                    console.log("Success! Test Complete.");
                } catch (e) {
                    console.error("Test Failed:", e);
                    // FIX: Removed alert() call, show error in UI if needed
                    console.error("Test Failed Message: " + e.message);
                }
            }
        });
    });

    // 2. Handle Text Input (The "Send" button)
    sendBtn.addEventListener('click', () => {
        const text = inputField.value.trim();
        if (text) console.log("User typed:", text);
    });

    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendBtn.click();
        }
    });


    // --- MAIN FEATURE: TRIM SILENCE ---
    async function handleTrimSilence() {
        let currentMessage = inputField.value.trim();
        // 1. UI FEEDBACK: LOCK INPUT & SHOW PROGRESS
        inputField.disabled = true;
        mainDisplay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                <sp-progress-bar label="Step 1: Exporting Audio..." indeterminate style="width: 200px; margin-bottom: 20px;"></sp-progress-bar>
                <p style="font-size: 14px;">Preparing audio for AI analysis...</p>
                <p style="font-size: 12px; color: var(--spectrum-global-color-gray-400);">Please wait, this can take a few seconds.</p>
            </div>
        `;

        try {
            // --- STEP A: EXPORT AUDIO (The "Blood Draw") ---
            console.log("Starting Audio Export...");
            const audioFilePath = await exportAudioForAnalysis();
            console.log("Audio Exported to:", audioFilePath);

            // Update UI
            mainDisplay.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                    <sp-progress-bar label="Step 2: AI Analysis..." indeterminate style="width: 200px; margin-bottom: 20px;"></sp-progress-bar>
                    <p style="font-size: 14px;">Sending to Python VAD...</p>
                </div>
            `;

            // --- STEP B: SEND PATH TO PYTHON ---
            const response = await fetch("http://localhost:8000/trim-silence", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: "1234567890",
                    message: currentMessage,
                    audio_file_path: audioFilePath
                })
            });

            if (!response.ok) throw new Error(`Python Server Error: ${response.statusText}`);

            const result = await response.json();

            // Parsing logic
            let ranges = [];

            // A. Check for the complex structure from your partner
            if (result.command &&
                result.command.payload &&
                result.command.payload.segments) {
                ranges = result.command.payload.segments;
            }
            // B. Check for simple structures (Backup/Testing)
            else if (result.silent_timestamps) {
                ranges = result.silent_timestamps;
            }
            else if (result.data) {
                ranges = result.data;
            }

            console.log("Final Parsed Ranges:", ranges);

            // --- STEP C: CUT THE VIDEO (The "Surgery") ---
            if (ranges && ranges.length > 0) {

                // Perform the actual timeline edits
                await performTrimSilence(ranges); // Added await here for safety

                // SUCCESS UI
                mainDisplay.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                        <svg style="width: 48px; height: 48px; fill: #2D9D78; margin-bottom: 16px;" viewBox="0 0 24 24">
                            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                        </svg>
                        <h2 style="margin: 0 0 8px 0;">Success!</h2>
                        <p style="margin: 0; color: var(--spectrum-global-color-gray-300);">Removed ${ranges.length} silent segments.</p>
                    </div>
                `;
            } else {
                throw new Error("No silence detected in the audio.");
            }

        } catch (error) {
            console.error(error);
            // ERROR UI
            mainDisplay.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                    <h3 style="color: #D7373F; margin-bottom: 8px;">Error</h3>
                    <p style="text-align: center; margin-bottom: 16px;">${error.message}</p>
                    <p style="font-size: 11px; color: var(--spectrum-global-color-gray-400);">Ensure Python server is running at localhost:8000</p>
                </div>
            `;
        } finally {
            inputField.disabled = false;
        }
    }


    // --- CORE HELPER FUNCTIONS ---

    // --- HELPER 1: EXPORT AUDIO (FIXED) ---
    async function exportAudioForAnalysis() {
        console.log("--- 1. Function Started (Using EncoderManager) ---");

        // 1. GET PROJECT & SEQUENCE
        const project = await app.Project.getActiveProject();
        if (!project) throw new Error("No open project.");

        const seq = await project.getActiveSequence();
        if (!seq) throw new Error("No active sequence. Click the timeline!");
        console.log("--- 2. Found Sequence: " + seq.name + " ---");

        // 2. SETUP PATHS
        const fs = require('uxp').storage.localFileSystem;
        const tempFolder = await fs.getTemporaryFolder();
        const tempFile = await tempFolder.createFile("ai_analysis_audio.wav", { overwrite: true });

        let tempPath = tempFile.nativePath;
        // Windows Fix: Swap / for \
        const isWindows = navigator.platform.indexOf('Win') > -1;
        if (isWindows) tempPath = tempPath.replace(/\//g, '\\');
        console.log("--- 3. Target Path: " + tempPath);

        // 3. GET PRESET
        const pluginFolder = await fs.getPluginFolder();
        let presetPath;
        try {
            const presetEntry = await pluginFolder.getEntry("WAV.epr");
            presetPath = presetEntry.nativePath;
            if (isWindows) presetPath = presetPath.replace(/\//g, '\\');
            console.log("--- 4. Preset Path: " + presetPath);
        } catch (e) {
            throw new Error("WAV.epr not found in plugin folder.");
        }

        // 4. GET MANAGER & EXPORT
        console.log("--- 5. Getting Encoder Manager... ---");
        const encoderMgr = await EncoderManager.getManager();

        console.log("--- 6. Starting Export... ---");

        // Documentation: exportSequence(sequence, exportType, outputFile, presetFile, exportFull)
        const jobID = await encoderMgr.exportSequence(
            seq,
            Constants.ExportType.IMMEDIATELY, // Export now (don't queue)
            tempPath,
            presetPath,
            1 // 1 = Export Full Sequence (0 would be Work Area)
        );

        console.log("--- 7. Export Started! Job ID: " + jobID);

        // Wait for file to appear (since export is async)
        await new Promise(r => setTimeout(r, 2000));

        return tempPath;
    }

    // --- STATE MANAGEMENT ---
    let wizardState = {
        ranges: [],
        currentIndex: 0
    };

    // --- HELPER 2: START REVIEW WIZARD ---
    async function performTrimSilence(silentRanges) {
        console.log("--- Starting Review Wizard ---");

        // 1. Save Data & Reset State
        // We reverse them so the user cuts from the end (safer for ripple edits)
        wizardState.ranges = [...silentRanges].reverse();
        wizardState.currentIndex = 0;

        // 2. Show the UI
        const reviewSection = document.getElementById('reviewSection');
        const inputWrapper = document.querySelector('.input-wrapper');
        const chips = document.querySelector('.context-chips');

        if (reviewSection) {
            reviewSection.style.display = 'flex';
            // Hide other controls to focus the user
            if (inputWrapper) inputWrapper.style.display = 'none';
            if (chips) chips.style.display = 'none';

            // Setup Buttons (Remove old listeners to prevent duplicates)
            const btnNext = document.getElementById('btnNext');
            const btnSkip = document.getElementById('btnSkip');

            // Clone and replace to clear old listeners (simple trick)
            const newNext = btnNext.cloneNode(true);
            const newSkip = btnSkip.cloneNode(true);
            btnNext.parentNode.replaceChild(newNext, btnNext);
            btnSkip.parentNode.replaceChild(newSkip, btnSkip);

            // Add Logic
            newNext.addEventListener('click', () => nextStep(true));
            newSkip.addEventListener('click', () => nextStep(false));
        }

        // 3. Highlight the First One
        await highlightCurrentRange();
    }


    // --- WIZARD STEP LOGIC ---
    async function nextStep(wasActionTaken) {
        // Move to next item
        wizardState.currentIndex++;

        // Check if finished
        if (wizardState.currentIndex >= wizardState.ranges.length) {
            finishWizard();
            return;
        }

        // Highlight the next one
        await highlightCurrentRange();
    }

    async function highlightCurrentRange() {
        const range = wizardState.ranges[wizardState.currentIndex];
        const index = wizardState.currentIndex + 1;
        const total = wizardState.ranges.length;

        // 1. Update UI Text
        document.getElementById('reviewStatus').textContent = `Silence ${index} of ${total}`;
        document.getElementById('reviewTime').textContent = `${range.start.toFixed(1)}s - ${range.end.toFixed(1)}s`;

        // 2. Set In/Out Points (The Visual Proof)
        const { TickTime } = require('premierepro');
        const project = await app.Project.getActiveProject();
        const seq = await project.getActiveSequence();

        const startTick = TickTime.createWithSeconds(range.start);
        const endTick = TickTime.createWithSeconds(range.end);

        await project.lockedAccess(async () => {
            await project.executeTransaction((compoundAction) => {
                if (seq.createSetInPointAction)
                    compoundAction.addAction(seq.createSetInPointAction(startTick));
                if (seq.createSetOutPointAction)
                    compoundAction.addAction(seq.createSetOutPointAction(endTick));
            });
        });

        // 3. Move Playhead
        seq.setPlayerPosition(startTick);
    }

    function finishWizard() {
        // Reset UI
        document.getElementById('reviewSection').style.display = 'none';
        document.querySelector('.input-wrapper').style.display = 'flex';
        document.querySelector('.context-chips').style.display = 'flex';

        // Clear In/Out
        alert("Review Complete! All segments processed.");
    }

}); // --- END OF DOMContentLoaded ---


// --- HELPER FUNCTIONS (MUST BE OUTSIDE DOM LISTENER) ---

/**
 * Helper: Wait until the file actually appears on disk
 */
async function waitForFileCreation(fs, folder, filename) { // <--- Make sure 'async' is here!
    let attempts = 0;
    while (attempts < 20) {
        try {
            await folder.getEntry(filename);
            return;
        } catch (e) {
            // Not found yet
        }
        await new Promise(r => setTimeout(r, 500));
        attempts++;
    }
    throw new Error("Export timed out. File was not created.");
}

/**
 * Snaps a time in seconds to the nearest video frame.
 * This prevents 0.01s gaps caused by sub-frame audio edits.
 * @param {number} seconds - The raw time from Python
 * @param {number} fps - The sequence frame rate (default 23.976)
 * @returns {number} - The snapped time in seconds
 */
function snapToFrame(seconds, fps) {
    const frameDuration = 1.0 / fps;
    const frameCount = Math.round(seconds * fps);
    return frameCount * frameDuration;
}