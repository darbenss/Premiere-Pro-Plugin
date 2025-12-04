const app = require('premierepro');
const { Constants, EncoderManager, TickTime } = require('premierepro');
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

    let ranges = [];

    // Check for segments in payload
    if (payload && payload.segments) {
        ranges = payload.segments;
    } else {
        console.warn("No segments found in payload.");
    }

    console.log("Parsed Ranges:", ranges);

    // Convert [start, end] arrays into objects { start, end }
    // Constraint: The AI returns segments as nested arrays: [[0.0, 1.4], [2.1, 3.1]]
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
        if (display) {
            display.innerHTML = `
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
        }
    } else {
        if (display) {
            display.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--spectrum-global-color-gray-50); padding: 20px; text-align: center;">
                    <div style="background-color: var(--spectrum-global-color-gray-200); color: var(--spectrum-global-color-gray-900); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
                        "${aiMessage}"
                    </div>
                    <p>No silent segments were found to cut.</p>
                </div>
            `;
        }
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
