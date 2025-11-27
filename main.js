const app = require('premierepro'); 
const { Constants } = require('premierepro');
const { Time } = require('premierepro');

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
        // Change 'e' to 'event' for clarity
        chip.addEventListener('click', async (event) => { 
            
            // --- FIX 1: Use currentTarget, not target ---
            // e.target might be the icon or text. currentTarget is ALWAYS the button.
            const action = event.currentTarget.getAttribute('label');
            
            console.log("Button Clicked:", action); // Check your console for this!

            if (action === "Trim Silence") {
                handleTrimSilence(); 
            } 
            // --- TEST SECTION ---
            else if (action === "Audio Sync") {
                console.log("Attempting Audio Export Test...");
                
                // --- FIX 2: Wrap in a BIG Try/Catch to see errors ---
                try {
                    // Visual feedback so you know it started
                    mainDisplay.innerHTML = `<h3 style="color:white">Exporting... Check Console.</h3>`;
                    
                    const path = await exportAudioForAnalysis();
                    
                    alert(`SUCCESS!\nFile saved at:\n${path}`);
                    mainDisplay.innerHTML = `<h3 style="color:#2d9d78">Export Success!</h3>`;
                    
                } catch (err) {
                    // This will tell us WHY it failed
                    alert(`ERROR:\n${err.message}`);
                    console.error("Export Failed:", err);
                    mainDisplay.innerHTML = `<h3 style="color:#d7373f">Error: ${err.message}</h3>`;
                }
            } 
            // --- END TEST SECTION ---
            else {
                inputField.value = `Perform ${action}`;
            }
        });
    });

    // 2. Handle Text Input (The "Send" button)
    // Note: For now, this just logs text. You can connect the Chat Router here later.
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
            // Note: We send the command to the specific endpoint we created in server.py
            const response = await fetch("http://localhost:8000/trim-silence", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    file_path: audioFilePath 
                })
            });

            if (!response.ok) throw new Error(`Python Server Error: ${response.statusText}`);
            
            const result = await response.json(); 
            // Expecting format: { silent_timestamps: [[1.5, 3.2], [10.1, 12.0]] }
            
            const ranges = result.silent_timestamps || result.data; // Handle both naming conventions

            // --- STEP C: CUT THE VIDEO (The "Surgery") ---
            if (ranges && ranges.length > 0) {
                
                // Perform the actual timeline edits
                performTrimSilence(ranges);
                
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
    
        // --- IMPORT NEW CLASSES ---
        const { EncoderManager, Constants } = require('premierepro');
    
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
    
    // --- HELPER 2: PERFORM CUTS (FIXED) ---
    async function performTrimSilence(silentRanges) {
        // --- FIX: Get Sequence correctly here too ---
        const project = await app.Project.getActiveProject();
        if (!project) return;
        const seq = await project.getActiveSequence();
        if (!seq) return;
    
        const editor = app.premierepro.SequenceEditor.getEditor(seq.sequenceID);
        const compoundAction = app.premierepro.CompoundAction.create("AI Trim Silence");
    
        // Normalize ranges (handle both array formats)
        let normalizedRanges = silentRanges.map(r => {
            if (Array.isArray(r)) return { start: r[0], end: r[1] };
            return r;
        });
    
        // Sort by Start Time, then Reverse (Cut from end to start)
        normalizedRanges.sort((a, b) => a.start - b.start).reverse();
    
        normalizedRanges.forEach(range => {
            if (range.start >= range.end) return;
    
            // Convert Seconds to Ticks
            const startTicks = (range.start * 254016000000).toString();
            const endTicks = (range.end * 254016000000).toString();
    
            const timeIn = new Time();
            timeIn.ticks = startTicks;
            
            const timeOut = new Time();
            timeOut.ticks = endTicks;
    
            compoundAction.addAction(seq.createSetInPointAction(timeIn));
            compoundAction.addAction(seq.createSetOutPointAction(timeOut));
            compoundAction.addAction(editor.createRemoveItemsAction(true, app.premierepro.Constants.MediaType.VIDEO_AND_AUDIO, false));
        });
    
        compoundAction.execute();
    
        // Clean up
        seq.setInPoint(0);
        seq.setOutPoint(0);
    }

    /**
     * Helper: Wait until the file actually appears on disk
     */
    async function waitForFileCreation(fs, folder, filename) {
        let attempts = 0;
        while (attempts < 20) { // Try for ~10 seconds
            try {
                // Try to get the file
                await folder.getEntry(filename);
                return; // Found it!
            } catch (e) {
                // Not found yet
            }
            await new Promise(r => setTimeout(r, 500)); // Wait 0.5s
            attempts++;
        }
        throw new Error("Export timed out. File was not created.");
    }

});