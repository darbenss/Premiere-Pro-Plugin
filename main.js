// ============================================================================
//  GLOBAL IMPORTS & CONSTANTS
// ============================================================================
const app = require('premierepro');
const { Constants, EncoderManager, TickTime, Marker, Markers, CompoundAction, Exporter, TransitionFactory, AddTransitionOptions} = require('premierepro');
const { storage } = require("uxp");
const fs = storage.localFileSystem;

// Mock AI Data (Simulating your partner's JSON structure)
const MOCK_AI_RESPONSE = {
    "session_id": "1234567890",
    "response_text": "All set. I added transitions...",
    "command": {
        "action": "add_transition",
        "payload": {
            "action_type": "add_transition",
            "transitions": [
                {
                    "cut_index": 0, // Note: AI uses 0-based index here based on your example
                    "transition_name": "AE.ADBE Cross Dissolve New",
                    "vibe_used": "cross dissolve",
                    "duration" : 2
                },
                {
                    "cut_index": 1,
                    "transition_name": "AE.ADBE Dip To Black", // Changed to a standard one for testing consistency
                    "vibe_used": "glitch morph",
                    "duration" : 1
                }
            ]
        }
    }
};

// Global State for the Wizard
let wizardState = {
    ranges: [],
    currentIndex: 0
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
    //  FEATURE 1: TRIM SILENCE (Logic & Wizard)
    // ========================================================================
    async function handleTrimSilence() {
        const inputField = document.getElementById('aiInput');
        const mainDisplay = document.getElementById('mainDisplay');
        let currentMessage = inputField.value.trim();

        // UI Loading
        inputField.disabled = true;
        mainDisplay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                <sp-progress-bar label="Step 1: Exporting Audio..." indeterminate style="width: 200px; margin-bottom: 20px;"></sp-progress-bar>
                <p style="font-size: 14px;">Preparing audio for AI analysis...</p>
                <p style="font-size: 12px; color: var(--spectrum-global-color-gray-400);">Please wait, this can take a few seconds.</p>
            </div>
        `;

        try {
            // Export
            console.log("Starting Audio Export...");
            const audioFilePath = await exportAudioForAnalysis();
            console.log("Audio Exported to:", audioFilePath);

            // Send to Python
            mainDisplay.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50);">
                    <sp-progress-bar label="Step 2: AI Analysis..." indeterminate style="width: 200px; margin-bottom: 20px;"></sp-progress-bar>
                    <p style="font-size: 14px;">Sending to Python VAD...</p>
                </div>
            `;

            const response = await fetch("http://localhost:8000/chat", {
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

            // Parse Response
            const aiMessage = result.response_text || "Analysis complete.";
            let ranges = [];

            // Check for the complex structure from python
            if (result.command && result.command.payload && result.command.payload.segments) {
                ranges = result.command.payload.segments;
            }
            // Check for simple structures (Backup/Testing)
            else if (result.silent_timestamps) {
                ranges = result.silent_timestamps;
            }
            else if (result.data) {
                ranges = result.data;
            }

            console.log("Parsed Ranges:", ranges);

            // Convert [start, end] arrays into objects { start, end }
            const ranges_parsed = ranges.map(segment => ({
                start: segment[0],
                end: segment[1]
            }));

            // Recommend to Cut the Video
            if (ranges_parsed && ranges_parsed.length > 0) {

                // Perform the actual timeline edits
                try {
                    await performTrimSilence(ranges_parsed);
                    console.log("Trim Success!");
                } catch (e) {
                    console.error("Trim Failed:", e);
                    console.error("Trim Failed Message: " + e.message);
                }
                // SUCCESS UI
                mainDisplay.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50); padding: 20px; text-align: center;">
                            
                        <div style="background-color: var(--spectrum-global-color-gray-200); color: var(--spectrum-global-color-gray-900); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; max-width: 90%; font-size: 14px; line-height: 1.4; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                            "${aiMessage}"
                        </div>
                
                        <svg style="width: 48px; height: 48px; fill: #2D9D78; margin-bottom: 16px;" viewBox="0 0 24 24">
                            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                        </svg>
                        <h2 style="margin: 0 0 8px 0;">Ready to Review</h2>
                        <p style="margin: 0; color: var(--spectrum-global-color-gray-300);">Found ${ranges_parsed.length} silent segments.</p>
                        <p style="font-size: 12px; margin-top: 8px; opacity: 0.7;">Use the controls below to review.</p>
                    </div>
                `;
            } else {
                mainDisplay.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50); padding: 20px; text-align: center;">
                        <div style="background-color: var(--spectrum-global-color-gray-200); color: var(--spectrum-global-color-gray-900); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
                            "${aiMessage}"
                        </div>
                        <p>No silent segments were found to cut.</p>
                    </div>
                `;
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

    // --- TRIM SILENCE WIZARD HELPERS ---
    async function performTrimSilence(silentRanges) {
        console.log("--- Starting Review Wizard ---");

        // Reverse system for user cut from end 
        wizardState.ranges = [...silentRanges].reverse();
        wizardState.currentIndex = 0;

        // UI Setup 
        const reviewSection = document.getElementById('reviewSection');
        const inputWrapper = document.querySelector('.input-wrapper');
        const chips = document.querySelector('.context-chips');

        if (reviewSection) {
            reviewSection.style.display = 'flex';
            if (inputWrapper) inputWrapper.style.display = 'none';
            if (chips) chips.style.display = 'none';

            // Connect Buttons
            const btnNext = document.getElementById('btnNext');
            const btnSkip = document.getElementById('btnSkip');

            const newNext = btnNext.cloneNode(true);
            const newSkip = btnSkip.cloneNode(true);
            btnNext.parentNode.replaceChild(newNext, btnNext);
            btnSkip.parentNode.replaceChild(newSkip, btnSkip);

            newNext.addEventListener('click', () => nextStep(true));
            newSkip.addEventListener('click', () => nextStep(false));
        }
        await highlightCurrentRange();
    }

    async function nextStep(wasActionTaken) {
        wizardState.currentIndex++;
        if (wizardState.currentIndex >= wizardState.ranges.length) {
            finishWizard();
            return;
        }
        await highlightCurrentRange();
    }

    async function highlightCurrentRange() {
        const range = wizardState.ranges[wizardState.currentIndex];
        const index = wizardState.currentIndex + 1;
        const total = wizardState.ranges.length;

        // Update UI
        document.getElementById('reviewStatus').textContent = `Silence ${index} of ${total}`;
        document.getElementById('reviewTime').textContent = `${range.start.toFixed(1)}s - ${range.end.toFixed(1)}s`;

        // Update Timeline
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
        seq.setPlayerPosition(startTick);
    }

    function finishWizard() {
        document.getElementById('reviewSection').style.display = 'none';
        document.querySelector('.input-wrapper').style.display = 'flex';
        document.querySelector('.context-chips').style.display = 'flex';
        alert("Review Complete! All segments processed.");
    }

    // ========================================================================
    // FEATURE 2: TRANSITION RECOMMENDATION
    // ========================================================================
    
    async function handleTransitionRecommendation() {
       console.log("[DEBUG] --- Started Transition Recommendation Engine ---");
   
       try {
           const project = await app.Project.getActiveProject();
           if (!project) { console.error("[DEBUG] No Project"); return; }
   
           const sequence = await project.getActiveSequence();
           if (!sequence) { console.error("[DEBUG] No Sequence"); return; }
           
           // 1. Get Track
           const videoTrack = await sequence.getVideoTrack(0); 
           if (!videoTrack) { console.error("[DEBUG] No V1 Track"); return; }
   
           // 2. Get Clips (Strict)
           let rawClips;
           let clipType = Constants && Constants.TrackItemType ? Constants.TrackItemType.CLIP : 1;
           
           try {
               rawClips = await videoTrack.getTrackItems(clipType, 0); 
           } catch (e) {
               console.warn(`[DEBUG] API Error: ${e.message}`);
               return;
           }
   
           if (!rawClips || rawClips.length < 2) {
               console.warn("[DEBUG] Not enough clips to analyze.");
               return;
           }
   
           // --- SORT CLIPS BY START TIME ---
           const clips = rawClips.sort((a, b) => {
               const startA = a.getStartTime().seconds || 0;
               const startB = b.getStartTime().seconds || 0;
               return startA - startB;
           });
   
           console.log(`[DEBUG] Analyzing gaps between ${clips.length} sorted clips...`);
   
           // 3. ANALYSIS LOOP
           let detectedCuts = [];
           let cutIndex = 0;
           
           for (let i = 0; i < clips.length - 1; i++) {
               const clipA = clips[i];
               const clipB = clips[i + 1];
   
               // Inspect Time Objects
               let tickEndA = clipA.getEndTime();
               let tickStartB = clipB.getStartTime();
   
               if (tickEndA instanceof Promise) tickEndA = await tickEndA;
               if (tickStartB instanceof Promise) tickStartB = await tickStartB;
   
               if (!tickEndA || !tickStartB) continue;
   
               // Extract Seconds (Handle Ticks vs Seconds)
               let endA = tickEndA.seconds;
               let startB = tickStartB.seconds;
   
               // Fallback for Ticks
               if (typeof endA === 'undefined') endA = tickEndA.value ? tickEndA.value / 254016000000 : 0;
               if (typeof startB === 'undefined') startB = tickStartB.value ? tickStartB.value / 254016000000 : 0;
   
               const gap = Math.abs(endA - startB);
               
               console.log(`[DEBUG] Pair ${i+1}: [${clipA.name}] -> [${clipB.name}] GAP=${Number(gap).toFixed(4)}s`);
   
               if (gap < 0.5) { 
                   detectedCuts.push({
                    index: cutIndex, // 0, 1, 2...
                    clipB: clipB // We apply transitions to the start of the incoming clip
                });

                console.log(`[DEBUG] >>> VALID CUT FOUND (Cut Index: ${cutIndex})`);
   
                   // TIME CALCULATION
                   // Frame A: End of Clip A - 1 frame
                   const oneFrame = 1 / sequence.videoFrameRate;
                   let timeA_Seconds = endA - oneFrame;
                   
                   // SANITY CHECK: Ensure time is valid
                   if (timeA_Seconds < 0) {
                       console.warn(`[DEBUG] Correcting negative timeA: ${timeA_Seconds} -> ${endA}`);
                       timeA_Seconds = endA; // Just use the end point if calc fails
                   }
   
                   const timeB_Seconds = startB;
   
                   // --- PROPER TIME OBJECT CREATION ---
                   let exportTimeA, exportTimeB;
   
                   try {
                       if (TickTime.createWithSeconds) {
                           exportTimeA = await TickTime.createWithSeconds(timeA_Seconds);
                           exportTimeB = await TickTime.createWithSeconds(timeB_Seconds);
                       } else {
                           // Fallback: Fetch FRESH Zero Points
                           const zeroA = await sequence.getZeroPoint();
                           exportTimeA = zeroA; 
                           exportTimeA.seconds = timeA_Seconds;
                           
                           const zeroB = await sequence.getZeroPoint();
                           exportTimeB = zeroB;
                           exportTimeB.seconds = timeB_Seconds;
                       }
                   } catch(err) {
                       console.error("[DEBUG] Time creation failed:", err);
                       continue; 
                   }
   
                   console.log(`[DEBUG] Exporting Cut${cutIndex}A at: ${exportTimeA.seconds}s`);
                   console.log(`[DEBUG] Exporting Cut${cutIndex}B at: ${exportTimeB.seconds}s`);
   
                   // EXPORT
                   await uxpExportFrame(sequence, exportTimeA, `Cut${cutIndex}_FrameA`);
                   await uxpExportFrame(sequence, exportTimeB, `Cut${cutIndex}_FrameB`);
               
                   cutIndex++;
                }
            }

            // 4. DECODER PART (Apply AI Suggestions)
            console.log("[DEBUG] --- Starting Decoder (Transition Application) ---");
        
            // In real app: const aiData = await callPythonBackend(...);
            const aiResponse = MOCK_AI_RESPONSE;

            // Validate structure based on your partner's format
            if (aiResponse && aiResponse.command && aiResponse.command.payload && aiResponse.command.payload.transitions) {
                const transitionsList = aiResponse.command.payload.transitions;
                
                for (let instruction of transitionsList) {
                    const duration = instruction.duration || 1.0;
                    const targetCut = detectedCuts.find(c => c.index === instruction.cut_index);
                    
                    if (targetCut) {
                        console.log(`[DEBUG] Applying '${instruction.transition_name}' to Cut Index ${instruction.cut_index} (Duration: ${duration}s)`);
                        await applyTransition(targetCut.clipB, instruction.transition_name, duration);
                    } else {
                        console.warn(`[DEBUG] AI asked for Cut Index ${instruction.cut_index}, but we didn't find it locally.`);
                    }
                }
            } else {
                console.warn("[DEBUG] Invalid AI Response structure.");
            }

            console.log("[DEBUG] --- Analysis Complete ---");
   
       } catch (err) {
           console.error("[DEBUG] CRITICAL ERROR:", err);
       }
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

// ============================================================================
// CORE HELPERS (Must be outside Event Listener)
// ============================================================================
    async function exportAudioForAnalysis() {
        console.log("--- 1. Function Started (Using EncoderManager) ---");

        // Get project sequence
        const project = await app.Project.getActiveProject();
        if (!project) throw new Error("No open project.");

        const seq = await project.getActiveSequence();
        if (!seq) throw new Error("No active sequence. Click the timeline!");
        console.log("--- 2. Found Sequence: " + seq.name + " ---");

        // Setup path
        const fs = require('uxp').storage.localFileSystem;
        const tempFolder = await fs.getTemporaryFolder();
        const tempFile = await tempFolder.createFile("ai_analysis_audio.wav", { overwrite: true });

        let tempPath = tempFile.nativePath;
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

        console.log("--- 5. Getting Encoder Manager... ---");
        const encoderMgr = await EncoderManager.getManager();

        console.log("--- 6. Starting Export... ---");

        const jobID = await encoderMgr.exportSequence(
            seq,
            Constants.ExportType.IMMEDIATELY, 
            tempPath,
            presetPath,
            1 // 1 = Export Full Sequence (0 would be Work Area)
        );

        console.log("--- 7. Export Started! Job ID: " + jobID);

        await new Promise(r => setTimeout(r, 2000));

        return tempPath;
    }

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
     * HELPER: Exports a single frame using Strict UXP (No QE)
     * @param {Sequence} sequence - The active sequence
     * @param {TickTime} tickTimeObj - The specific time to capture
     * @param {String} fileNameSuffix - Suffix for the filename (e.g., "FrameA")
     */
   /**
    * HELPER: Exports a single frame using Strict UXP (No QE)
    */
    async function uxpExportFrame(sequence, tickTimeObj, fileNameSuffix) {
        try {
            // 1. Get Project Path
            const project = await app.Project.getActiveProject();
            let projectPath = project.path;
    
            if (!projectPath || projectPath.length === 0) {
                console.warn("[DEBUG] Project not saved! Saving to Temp folder instead.");
                return await uxpExportFrameToTemp(sequence, tickTimeObj, fileNameSuffix);
            }
    
            // 2. Clean Path & Directory Parsing
            if (projectPath.startsWith("\\\\?\\")) projectPath = projectPath.substring(4);
    
            const lastBackSlash = projectPath.lastIndexOf("\\");
            const lastForwardSlash = projectPath.lastIndexOf("/");
            const lastSlashIndex = Math.max(lastBackSlash, lastForwardSlash);
            
            let projectDir = "";
            
            if (lastSlashIndex > -1) {
                projectDir = projectPath.substring(0, lastSlashIndex);
            } else {
                console.error(`[DEBUG] Could not parse directory from: ${projectPath}`);
                return;
            }
    
            // 3. Construct NAME Only
            const safeFileName = `Preview_${fileNameSuffix}.png`;
            console.log(`[DEBUG] Exporting: ${safeFileName} into ${projectDir}`);
    
            // 4. GET FRAME SIZE (Dynamic Resolution Fix)
            let width = 1920;
            let height = 1080;
            
            try {
                const frameSize = await sequence.getFrameSize();
                if (frameSize) {
                    width = frameSize.width || (frameSize.right - frameSize.left) || 1920;
                    height = frameSize.height || (frameSize.bottom - frameSize.top) || 1080;
                    // Ensure Integers
                    width = Math.round(width);
                    height = Math.round(height);
                }
            } catch(e) {}
    
            // 5. EXECUTE EXPORT
            // FIX: Passing "safeFileName" (Just Name) + "projectDir" (Directory)
            const result = await Exporter.exportSequenceFrame(
                sequence,
                tickTimeObj,
                safeFileName,   // JUST THE NAME
                projectDir,     // THE DIRECTORY
                width,          
                height          
            );
    
            console.log(`[DEBUG] Export Result: ${result}`);
    
            // 6. VERIFY
            await new Promise(r => setTimeout(r, 1000));
    
            if (result === true || result === "true") {
                 console.log(`[DEBUG] SUCCESS!`);
                 console.log(`[DEBUG] Check your project folder: ${projectDir}`);
            } else {
                 console.error(`[DEBUG] Export returned false.`);
            }
    
        } catch (error) {
            console.error(`[DEBUG] FAILED to export ${fileNameSuffix}`);
            console.error(`[DEBUG] Reason: ${error.message || JSON.stringify(error)}`);
        }
    }
    
    // Fallback function needs update too
    async function uxpExportFrameToTemp(sequence, tickTimeObj, fileNameSuffix) {
        const tempFolder = await fs.getTemporaryFolder();
        const filename = `Preview_${fileNameSuffix}.png`;
        const tempFile = await tempFolder.createFile(filename, { overwrite: true });
        let nativePath = tempFile.nativePath;
        const isWindows = navigator.platform.indexOf('Win') > -1;
        if (isWindows) nativePath = nativePath.replace(/\//g, '\\');
        let parentDir = nativePath.substring(0, nativePath.lastIndexOf(isWindows ? "\\" : "/"));
    
        let width = 1920;
        let height = 1080;
        try {
            const frameSize = await sequence.getFrameSize();
            if (frameSize) {
                width = Math.round(frameSize.width || 1920);
                height = Math.round(frameSize.height || 1080);
            }
        } catch(e) {}
    
        console.log(`[DEBUG] Saving to Temp: ${nativePath}`);
        await Exporter.exportSequenceFrame(sequence, tickTimeObj, filename, parentDir, width, height);
    }

    async function applyTransition(clipObject, matchName, durationInSeconds = 1.0) {
    try {
        const transitionObj = await TransitionFactory.createVideoTransition(matchName);
        const options = new AddTransitionOptions();
        options.setApplyToStart(true); 
        options.setForceSingleSided(false);

        // FIX: Set Custom Duration
        try {
            if (TickTime.createWithSeconds) {
                const durationTime = await TickTime.createWithSeconds(durationInSeconds);
                options.setDuration(durationTime);
                console.log(`[DEBUG] Set transition duration to: ${durationInSeconds}s`);
            }
        } catch (err) {
            console.warn(`[DEBUG] Could not set duration (using default): ${err.message}`);
        }

        // Create Action
        const action = await clipObject.createAddVideoTransitionAction(transitionObj, options);
        
        // FIX: Execute via Project Transaction (Like your reference image)
        const project = await app.Project.getActiveProject();

        // We use executeTransaction to safely perform the action
        await project.executeTransaction((compoundAction) => {
            compoundAction.addAction(action);
        });
        
        console.log(`[DEBUG] Transition applied.`);
    } catch (e) {
        console.error(`[DEBUG] Failed to apply transition: ${e.message}`);
    }
}
