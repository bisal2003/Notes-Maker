/**
 * Background service worker for the Oracle Screenshot Tracker.
 * 
 * Uses a hybrid approach for reliable interval capture in MV3:
 * - setInterval for precise timing (3-10s intervals)
 * - chrome.alarms as a keepalive to restart the timer if the service worker dies
 */

let captureTimer = null;
let activeFolder = "default";   // Holds the current folder name in memory
const KEEPALIVE_ALARM = "oracle-keepalive";


// ===== Message listener (from popup and content script) =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === "start") {
        // Read folder directly from the message (sent by popup)
        activeFolder = message.folder || "default";
        startCapture();
    }

    if (message.action === "stop") {
        stopCapture();
    }

    if (message.action === "caption") {
        sendCaptionToBackend(message.text, message.lineCount);
    }

});


// ===== Alarm listener (keepalive / recovery) =====
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
        chrome.storage.local.get(["isRunning", "folder"], (data) => {
            if (data.isRunning && !captureTimer) {
                activeFolder = data.folder || "default";
                console.log(`[Oracle] Keepalive: resuming capture into folder '${activeFolder}'`);
                resumeCapture();
            }
        });
    }
});


/**
 * Start the screenshot capture loop.
 * Reads interval from chrome.storage, sets up setInterval + keepalive alarm.
 */
function startCapture() {
    if (captureTimer) {
        clearInterval(captureTimer);
        captureTimer = null;
    }

    chrome.storage.local.get(["interval"], (result) => {
        const intervalSec = result.interval || 10;

        console.log(`[Oracle] Starting capture every ${intervalSec}s → folder: '${activeFolder}'`);

        chrome.storage.local.set({
            isRunning: true,
            savedCount: 0,
            skippedCount: 0,
        });

        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

        captureAndSend();
        captureTimer = setInterval(captureAndSend, intervalSec * 1000);
    });
}


/**
 * Resume capture after service worker revival (called by keepalive alarm).
 * Does NOT reset counters.
 */
function resumeCapture() {
    chrome.storage.local.get(["interval"], (result) => {
        const intervalSec = result.interval || 10;

        console.log(`[Oracle] Resuming capture every ${intervalSec}s → folder: '${activeFolder}'`);

        captureAndSend();
        captureTimer = setInterval(captureAndSend, intervalSec * 1000);
    });
}


/**
 * Stop the screenshot capture loop.
 */
function stopCapture() {
    if (captureTimer) {
        clearInterval(captureTimer);
        captureTimer = null;
    }

    chrome.alarms.clear(KEEPALIVE_ALARM);
    chrome.storage.local.set({ isRunning: false });
    console.log("[Oracle] Capture stopped");
}


/**
 * Capture the visible tab and send it to the backend.
 * Uses `activeFolder` variable directly — no extra storage read needed.
 */
async function captureAndSend() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            console.warn("[Oracle] No active tab found, skipping this cycle");
            return;
        }

        if (tab.url && (
            tab.url.startsWith("chrome://") ||
            tab.url.startsWith("chrome-extension://") ||
            tab.url.startsWith("edge://") ||
            tab.url.startsWith("about:")
        )) {
            console.warn("[Oracle] Skipping restricted page:", tab.url);
            return;
        }

        console.log(`[Oracle] Capturing tab: ${tab.title}`);

        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: "png",
            quality: 100,
        });

        console.log(`[Oracle] Sending to backend → folder: '${activeFolder}'`);

        const response = await fetch("http://127.0.0.1:5000/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image: dataUrl,
                title: tab.title || "Untitled",
                url: tab.url || "",
                folder: activeFolder,
            }),
        });

        if (!response.ok) {
            console.error(`[Oracle] Backend returned HTTP ${response.status}`);
            return;
        }

        const result = await response.json();

        // Update counters
        chrome.storage.local.get(["savedCount", "skippedCount"], (data) => {
            let saved = data.savedCount || 0;
            let skipped = data.skippedCount || 0;

            if (result.action === "saved") {
                saved++;
                console.log(`[Oracle] ✅ SAVED (${result.difference_pct}% diff) — Total: ${saved}`);
            } else if (result.action === "skipped") {
                skipped++;
                console.log(`[Oracle] ⏭️ SKIPPED (${result.difference_pct}% diff) — Total: ${skipped}`);
            }

            chrome.storage.local.set({ savedCount: saved, skippedCount: skipped });
        });

    } catch (error) {
        console.error("[Oracle] Capture/send failed:", error.message);
    }
}


// ===== On service worker startup =====
// Restore folder + resume capture if it was active
chrome.storage.local.get(["isRunning", "folder"], (data) => {
    if (data.isRunning) {
        activeFolder = data.folder || "default";
        console.log(`[Oracle] Service worker started — resuming into folder '${activeFolder}'`);
        resumeCapture();
        chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
    }
});


/**
 * Send auto-captured captions to the backend as a note.
 */
async function sendCaptionToBackend(text, lineCount) {
    // Only send if we are actively capturing
    const data = await chrome.storage.local.get(["isRunning"]);
    if (!data.isRunning) return;

    try {
        console.log(`[Oracle] Sending ${lineCount} auto-captured caption lines to backend...`);
        const response = await fetch("http://127.0.0.1:5000/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                folder: activeFolder,
                text: "[Auto-Caption] " + text,
            }),
        });

        if (!response.ok) {
            console.error(`[Oracle] Failed to send captions. HTTP ${response.status}`);
        } else {
            console.log("[Oracle] Auto-captions saved successfully.");
        }
    } catch (error) {
        console.error("[Oracle] Failed to send captions to backend:", error.message);
    }
}