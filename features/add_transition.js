const app = require('premierepro');
const { Constants, TickTime, Exporter, TransitionFactory, AddTransitionOptions } = require('premierepro');
const { storage } = require("uxp");
const fs = storage.localFileSystem;

// ========================================================================
// FEATURE 2: TRANSITION RECOMMENDATION
// ========================================================================

/**
 * Gathers clip context for transition recommendation.
 * Extracts frames from clips in the active sequence.
 * @returns {Promise<Object>} Object containing framePaths and clips.
 */
async function gatherClipContext() {
    console.log("[DEBUG] --- Starting Gather Clip Context ---");

    try {
        const project = await app.Project.getActiveProject();
        if (!project) { console.error("[DEBUG] No Project"); return null; }

        const sequence = await project.getActiveSequence();
        if (!sequence) { console.error("[DEBUG] No Sequence"); return null; }

        // 1. ENCODER: Extract Frames and Prepare Data
        const { framePaths, clips } = await transitionEncoder(sequence);

        if (!framePaths || framePaths.length === 0) {
            console.warn("[DEBUG] No frames extracted or not enough clips.");
            return null;
        }

        console.log("[DEBUG] Encoder Output (Frame Paths):", JSON.stringify(framePaths, null, 2));

        // Return data needed for AI
        return framePaths;

    } catch (err) {
        console.error("[DEBUG] CRITICAL ERROR in gatherClipContext:", err);
        return null;
    }
}

/**
 * Processes the transition payload from AI.
 * @param {Object} payload - The payload containing transitions.
 */
async function processTransitions(payload) {
    console.log("[DEBUG] --- Starting Process Transitions ---");

    // We need clips to apply transitions. 
    // Since we can't easily pass the clip objects through the JSON payload roundtrip if we were stateless,
    // we might need to re-fetch them or assume the state is consistent.
    // However, for this refactor, let's re-fetch the clips to be safe and robust, 
    // OR we can rely on the fact that the sequence hasn't changed much.
    // But `gatherClipContext` returned clips, and `processTransitions` receives payload.
    // The payload doesn't have the clip objects.
    // We need to get the clips again to apply transitions to them.

    const project = await app.Project.getActiveProject();
    const sequence = await project.getActiveSequence();
    const videoTrack = await sequence.getVideoTrack(0);
    let clipType = Constants && Constants.TrackItemType ? Constants.TrackItemType.CLIP : 1;
    let rawClips = await videoTrack.getTrackItems(clipType, 0);

    // Sort clips to match the index used in gather
    const clips = rawClips.sort((a, b) => {
        const startA = a.getStartTime().seconds || 0;
        const startB = b.getStartTime().seconds || 0;
        return startA - startB;
    });

    if (payload && payload.transitions) {
        for (let transition of payload.transitions) {
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
    } else {
        console.warn("[DEBUG] No transitions found in payload.");
    }

    console.log("[DEBUG] --- Process Transitions Complete ---");
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
    gatherClipContext,
    processTransitions
};
