const app = require('premierepro');
const { Constants, EncoderManager} = require('premierepro');
const { storage } = require("uxp");
const fs = storage.localFileSystem;

// Global State for the Wizard
let wizardState = {
    ranges: [],
    currentIndex: 0
};

// ========================================================================
//  FEATURE 1: TRIM SILENCE (Logic & Wizard)
// ========================================================================

/**
 * Gathers audio context for analysis.
 * Exports the sequence audio to a temporary WAV file.
 * @returns {Promise<string>} The path to the exported audio file.
 */
async function gatherAudioContext() {
    console.log("Starting Audio Export...");
    const audioFilePath = await exportAudioForAnalysis();
    console.log("Audio Exported to:", audioFilePath);
    return audioFilePath;
}

/**
 * Processes the trim silence payload from AI.
 * @param {Object} payload - The payload containing segments.
 * @param {string} aiMessage - The message from AI.
 * @param {HTMLElement} display - The main display element to update UI.
 */
async function processTrimSilence(payload, aiMessage, display) {
    console.log("Processing Trim Silence Payload:", payload);

    if (display) {
        const chatHistory = display.querySelector('#chatHistory');
        if (chatHistory) {
            const lastAiRow = chatHistory.querySelector('.message-row.ai:last-child');
            if (lastAiRow) {
                const bubble = lastAiRow.querySelector('.chat-bubble');
                if (bubble) {
                    bubble.innerText = aiMessage;
                }
            }
        }
    }
    // --- HARDCODED TEST DATA INJECTION (END) ---

    let ranges = [];

    // Check for segments in payload
    if (payload && payload.segments) {
        ranges = payload.segments;
    } else {
        console.warn("No segments found in payload.");
    }

    console.log("Parsed Ranges:", ranges);

    // Convert [start, end] arrays into objects { start, end }
    const ranges_parsed = ranges.map(segment => ({
        start: segment[0],
        end: segment[1]
    }));

    // // --- LOGIC CHANGE START ---
    // // Update the global state with the PARSED objects so highlightCurrentRange() can read them.
    // if (typeof wizardState !== 'undefined') {
    //     wizardState.ranges = ranges_parsed; 
    //     wizardState.currentIndex = 0; // Reset index to start
    // }
    // // --- LOGIC CHANGE END ---

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

        // CRITICAL: Do NOT overwrite display.innerHTML.
        // The UI is handled by the chat bubble above.

    } else {
        console.log("No silent segments found.");
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

    // Put timeline based on FPS
    const timebaseString = await seq.getTimebase();
    const frameDurationTicks = BigInt(timebaseString);

    const getSnappedTickTime = (seconds) => {
        const exactTicks = BigInt(Math.round(seconds * 254016000000));
        const frameIndex = (exactTicks + (frameDurationTicks / 2n)) / frameDurationTicks;
        const alignedTicks = frameIndex * frameDurationTicks;
        return TickTime.createWithTicks(alignedTicks.toString());
    };

    const startTick = getSnappedTickTime(range.start);
    const endTick = getSnappedTickTime(range.end);

    await project.lockedAccess(async () => {
        await project.executeTransaction((compoundAction) => {
            if (seq.createSetInPointAction)
                compoundAction.addAction(seq.createSetInPointAction(startTick));
        });
        await project.executeTransaction((compoundAction) => {
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

module.exports = {
    gatherAudioContext,
    processTrimSilence
};
