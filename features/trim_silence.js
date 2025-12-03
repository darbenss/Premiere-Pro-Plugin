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
    handleTrimSilence
};
