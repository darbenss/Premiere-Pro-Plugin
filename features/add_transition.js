const app = require('premierepro');
const { Constants, TickTime, Exporter, TransitionFactory, AddTransitionOptions } = require('premierepro');
const { storage } = require("uxp");
const fs = storage.localFileSystem;

// Mock AI Data (Simulating your partner's JSON structure)
const MOCK_AI_RESPONSE = {
    "session_id": "16213822",
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
                    "duration": 2
                },
                {
                    "cut_index": 1,
                    "transition_name": "AE.ADBE Dip To Black", // Changed to a standard one for testing consistency
                    "vibe_used": "glitch morph",
                    "duration": 1
                }
            ]
        }
    }
};

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

        // 1. ENCODER: Extract Frames and Prepare Data
        const { framePaths, clips } = await transitionEncoder(sequence);

        if (!framePaths || framePaths.length === 0) {
            console.warn("[DEBUG] No frames extracted or not enough clips.");
            return;
        }

        console.log("[DEBUG] Encoder Output (Frame Paths):", JSON.stringify(framePaths, null, 2));

        // 2. FETCH: Send to AI (Mocked for now)
        // In a real scenario, you would do:
        
        const response = await fetch("http://localhost:8000/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: "Recommend transitions",
                session_id: "16213822",
                image_transition_path: framePaths
            })
        });
        
        const aiResponse = await response.json();
    
        console.log("[DEBUG] AI Response:", JSON.stringify(aiResponse, null, 2));

        // Simulating network delay
        await new Promise(r => setTimeout(r, 500));

        // Mock AI Response
        // const aiResponse = MOCK_AI_RESPONSE;

        // 3. DECODER: Apply Transitions
        await transitionDecoder(aiResponse, clips);

        console.log("[DEBUG] --- Analysis Complete ---");

    } catch (err) {
        console.error("[DEBUG] CRITICAL ERROR:", err);
    }
}

// ========================================================================
// ENCODER
// ========================================================================

async function transitionEncoder(sequence) {
    console.log("[DEBUG] --- Starting Encoder ---");

    // 1. Get Track
    const videoTrack = await sequence.getVideoTrack(0);
    if (!videoTrack) { console.error("[DEBUG] No V1 Track"); return { framePaths: [], clips: [] }; }

    // 2. Get Clips (Strict)
    let rawClips;
    let clipType = Constants && Constants.TrackItemType ? Constants.TrackItemType.CLIP : 1;

    try {
        rawClips = await videoTrack.getTrackItems(clipType, 0);
    } catch (e) {
        console.warn(`[DEBUG] API Error: ${e.message}`);
        return { framePaths: [], clips: [] };
    }

    if (!rawClips || rawClips.length < 2) {
        console.warn("[DEBUG] Not enough clips to analyze.");
        return { framePaths: [], clips: [] };
    }

    // --- SORT CLIPS BY START TIME ---
    const clips = rawClips.sort((a, b) => {
        const startA = a.getStartTime().seconds || 0;
        const startB = b.getStartTime().seconds || 0;
        return startA - startB;
    });

    console.log(`[DEBUG] Processing ${clips.length} clips...`);

    let framePaths = [];

    // 3. EXTRACTION LOOP
    for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        let clipPaths = [];

        // Logic:
        // First Clip: Last Frame only
        // Middle Clips: First Frame, then Last Frame
        // Last Clip: First Frame only

        const isFirstClip = (i === 0);
        const isLastClip = (i === clips.length - 1);

        // --- EXTRACT FIRST FRAME (if not first clip) ---
        if (!isFirstClip) {
            let tickStart = clip.getStartTime();
            if (tickStart instanceof Promise) tickStart = await tickStart;

            let startSeconds = tickStart.seconds;
            // Fallback for Ticks
            if (typeof startSeconds === 'undefined') startSeconds = tickStart.value ? tickStart.value / 254016000000 : 0;

            const exportTime = await createTickTime(sequence, startSeconds);
            const fileName = `Clip${i}_First`;

            const path = await uxpExportFrame(sequence, exportTime, fileName);
            if (path) clipPaths.push(path);
        }

        // --- EXTRACT LAST FRAME (if not last clip) ---
        if (!isLastClip) {
            let tickEnd = clip.getEndTime();
            if (tickEnd instanceof Promise) tickEnd = await tickEnd;

            let endSeconds = tickEnd.seconds;
            // Fallback for Ticks
            if (typeof endSeconds === 'undefined') endSeconds = tickEnd.value ? tickEnd.value / 254016000000 : 0;

            // Subtract 1 frame to get the actual last visible frame
            const oneFrame = 1 / 30; // 30 FPS (maybe can change using framerate property at adobe uxp documentation)
            let lastFrameSeconds = endSeconds - oneFrame;
            if (lastFrameSeconds < 0) lastFrameSeconds = 0;

            const exportTime = await createTickTime(sequence, lastFrameSeconds);
            const fileName = `Clip${i}_Last`;

            const path = await uxpExportFrame(sequence, exportTime, fileName);
            if (path) clipPaths.push(path);
        }

        framePaths.push(clipPaths);
    }

    return { framePaths, clips };
}

// ========================================================================
// DECODER
// ========================================================================

async function transitionDecoder(aiResponse, clips) {
    console.log("[DEBUG] --- Starting Decoder ---");

    // Validate structure based on your partner's format
    if (aiResponse && aiResponse.commands) {
        
        const commandList = aiResponse.commands;

        for (let command of commandList) {
            if (command.payload.action_type === "add_transition") {
                for (let transition of command.payload.transitions) {
                    const duration = transition.duration || 1.0;
                    const transitionName = transition.transition_name;
                    const cutIndex = transition.cut_index;

                    const targetClipIndex = cutIndex + 1;

                    if (targetClipIndex < clips.length) {
                        const targetClip = clips[targetClipIndex];
                        console.log(`[DEBUG] Applying '${transitionName}' to Clip Index ${targetClipIndex} (Duration: ${duration}s)`);
                        await applyTransition(targetClip, transitionName, duration);
                    } else {
                        console.warn(`[DEBUG] AI asked for Cut Index ${cutIndex} (Target Clip ${targetClipIndex}), but it's out of bounds.`);
                    }
                }
            } else if (command.payload.action_type === "trim_silence") {
                let ranges = [];
                ranges = command.payload.segments;
                // TODO: Implement trim silence
            }
        }
    } else {
        console.warn("[DEBUG] Invalid AI Response structure.");
    }
}

// ========================================================================
// HELPERS
// ========================================================================

async function createTickTime(sequence, seconds) {
    try {
        if (TickTime.createWithSeconds) {
            return await TickTime.createWithSeconds(seconds);
        } else {
            // Fallback: Fetch FRESH Zero Points
            const zero = await sequence.getZeroPoint();
            zero.seconds = seconds;
            return zero;
        }
    } catch (err) {
        console.error("[DEBUG] Time creation failed:", err);
        throw err;
    }
}

/**
 * HELPER: Exports a single frame using Strict UXP (No QE)
 * Returns the absolute path of the exported file.
 */
async function uxpExportFrame(sequence, tickTimeObj, fileNameSuffix) {
    try {
        // 1. Get Project Path
        const project = await app.Project.getActiveProject();
        let projectPath = project.path;
        let useTemp = false;

        if (!projectPath || projectPath.length === 0) {
            console.warn("[DEBUG] Project not saved! Saving to Temp folder instead.");
            useTemp = true;
        }

        let exportDir = "";

        if (!useTemp) {
            // 2. Clean Path & Directory Parsing
            if (projectPath.startsWith("\\\\?\\")) projectPath = projectPath.substring(4);

            const lastBackSlash = projectPath.lastIndexOf("\\");
            const lastForwardSlash = projectPath.lastIndexOf("/");
            const lastSlashIndex = Math.max(lastBackSlash, lastForwardSlash);

            if (lastSlashIndex > -1) {
                exportDir = projectPath.substring(0, lastSlashIndex);
            } else {
                useTemp = true;
            }
        }

        if (useTemp) {
            const tempFolder = await fs.getTemporaryFolder();
            exportDir = tempFolder.nativePath;
            const isWindows = navigator.platform.indexOf('Win') > -1;
            if (isWindows) exportDir = exportDir.replace(/\//g, '\\');
        }

        // 3. Construct NAME Only
        const safeFileName = `Preview_${fileNameSuffix}.png`;

        // 4. GET FRAME SIZE
        let width = 1920;
        let height = 1080;

        try {
            const frameSize = await sequence.getFrameSize();
            if (frameSize) {
                width = Math.round(frameSize.width || (frameSize.right - frameSize.left) || 1920);
                height = Math.round(frameSize.height || (frameSize.bottom - frameSize.top) || 1080);
            }
        } catch (e) { }

        // 5. EXECUTE EXPORT
        const result = await Exporter.exportSequenceFrame(
            sequence,
            tickTimeObj,
            safeFileName,   // JUST THE NAME
            exportDir,     // THE DIRECTORY
            width,
            height
        );

        // 6. Return Path
        if (result === true || result === "true") {
            const fullPath = exportDir + (exportDir.endsWith("\\") || exportDir.endsWith("/") ? "" : "\\") + safeFileName;
            return fullPath;
        } else {
            console.error(`[DEBUG] Export returned false for ${safeFileName}`);
            return null;
        }

    } catch (error) {
        console.error(`[DEBUG] FAILED to export ${fileNameSuffix}`);
        console.error(`[DEBUG] Reason: ${error.message || JSON.stringify(error)}`);
        return null;
    }
}

async function uxpExportFrameToTemp(sequence, tickTimeObj, fileNameSuffix) {
    // This function is now largely redundant as uxpExportFrame handles temp fallback, 
    // but keeping it if needed or we can remove it.
    // For now, I'll just alias it to uxpExportFrame logic if called, or ignore it.
    return await uxpExportFrame(sequence, tickTimeObj, fileNameSuffix);
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
            }
        } catch (err) {
            console.warn(`[DEBUG] Could not set duration (using default): ${err.message}`);
        }

        // Create Action
        const action = await clipObject.createAddVideoTransitionAction(transitionObj, options);

        // FIX: Execute via Project Transaction
        const project = await app.Project.getActiveProject();

        await project.executeTransaction((compoundAction) => {
            compoundAction.addAction(action);
        });

        console.log(`[DEBUG] Transition applied.`);
    } catch (e) {
        console.error(`[DEBUG] Failed to apply transition: ${e.message}`);
    }
}

module.exports = {
    handleTransitionRecommendation
};
