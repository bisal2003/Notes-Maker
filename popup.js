/**
 * Popup script for the Oracle Screenshot Tracker.
 * Manages UI state, sends start/stop commands to the background worker,
 * handles note saving and Word document export.
 */

// DOM elements
const folderInput = document.getElementById("folder");
const intervalInput = document.getElementById("interval");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const savedCountEl = document.getElementById("savedCount");
const skippedCountEl = document.getElementById("skippedCount");
const noteInput = document.getElementById("noteInput");
const saveNoteBtn = document.getElementById("saveNote");
const exportBtn = document.getElementById("exportDoc");


/**
 * Load current state from chrome.storage and render the UI.
 * Called once when the popup opens.
 */
function loadState() {
    chrome.storage.local.get(
        ["isRunning", "interval", "folder", "savedCount", "skippedCount"],
        (data) => {
            const running = data.isRunning || false;

            // Restore saved values
            if (data.interval) {
                intervalInput.value = data.interval;
            }
            if (data.folder) {
                folderInput.value = data.folder;
            }

            // Update UI to match current state
            updateUI(running, data.savedCount || 0, data.skippedCount || 0);
        }
    );
}


/**
 * Update all UI elements to reflect current state.
 */
function updateUI(isRunning, saved, skipped) {
    // Status indicator
    if (isRunning) {
        statusDot.classList.add("running");
        statusText.textContent = "Running";
    } else {
        statusDot.classList.remove("running");
        statusText.textContent = "Stopped";
    }

    // Button states
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;

    // Lock folder/interval inputs while running
    intervalInput.disabled = isRunning;
    folderInput.disabled = isRunning;

    // Export only available when a folder name exists
    exportBtn.disabled = !folderInput.value.trim();

    // Stat counters
    savedCountEl.textContent = saved;
    skippedCountEl.textContent = skipped;
}


// ===== Start button =====
startBtn.addEventListener("click", async () => {
    const interval = Number(intervalInput.value);
    const folder = folderInput.value.trim();

    // Validate interval (minimum 3 seconds)
    if (!interval || interval < 3) {
        intervalInput.value = 3;
        return;
    }

    // Validate folder name
    if (!folder) {
        folderInput.focus();
        folderInput.style.borderColor = "#e74c5a";
        setTimeout(() => { folderInput.style.borderColor = ""; }, 1500);
        return;
    }

    // Save settings to storage and send start command
    await chrome.storage.local.set({ interval: interval, folder: folder });

    chrome.runtime.sendMessage({ action: "start", folder: folder });

    // Immediately update UI
    updateUI(true, 0, 0);
});


// ===== Stop button =====
stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "stop" });
});


// ===== Save Note button =====
saveNoteBtn.addEventListener("click", async () => {
    const text = noteInput.value.trim();
    const folder = folderInput.value.trim();

    if (!text) {
        noteInput.focus();
        noteInput.style.borderColor = "#e74c5a";
        setTimeout(() => { noteInput.style.borderColor = ""; }, 1500);
        return;
    }

    if (!folder) {
        folderInput.focus();
        folderInput.style.borderColor = "#e74c5a";
        setTimeout(() => { folderInput.style.borderColor = ""; }, 1500);
        return;
    }

    // Disable button while saving
    saveNoteBtn.disabled = true;
    saveNoteBtn.textContent = "Saving...";

    try {
        const response = await fetch(`${API_URL}/note`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: folder, text: text }),
        });

        const result = await response.json();

        if (result.status === "success") {
            // Clear the textarea and show confirmation
            noteInput.value = "";
            saveNoteBtn.textContent = "✓ Saved!";
            saveNoteBtn.classList.add("saved");
            setTimeout(() => {
                saveNoteBtn.textContent = "Save Note";
                saveNoteBtn.classList.remove("saved");
                saveNoteBtn.disabled = false;
            }, 1500);
        } else {
            saveNoteBtn.textContent = "Error!";
            setTimeout(() => {
                saveNoteBtn.textContent = "Save Note";
                saveNoteBtn.disabled = false;
            }, 1500);
        }
    } catch (error) {
        console.error("Failed to save note:", error);
        saveNoteBtn.textContent = "Server offline";
        setTimeout(() => {
            saveNoteBtn.textContent = "Save Note";
            saveNoteBtn.disabled = false;
        }, 2000);
    }
});


// ===== Export to Word button =====
exportBtn.addEventListener("click", async () => {
    const folder = folderInput.value.trim();

    if (!folder) {
        folderInput.focus();
        folderInput.style.borderColor = "#e74c5a";
        setTimeout(() => { folderInput.style.borderColor = ""; }, 1500);
        return;
    }

    exportBtn.disabled = true;
    exportBtn.textContent = "⏳ Generating...";

    try {
        // Open the export URL in a new tab — triggers the browser download
        const exportUrl = `${API_URL}/export/${encodeURIComponent(folder)}`;
        chrome.tabs.create({ url: exportUrl });

        exportBtn.textContent = "✓ Downloading!";
        setTimeout(() => {
            exportBtn.textContent = "📄 Export to Word";
            exportBtn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error("Export failed:", error);
        exportBtn.textContent = "Export Failed";
        setTimeout(() => {
            exportBtn.textContent = "📄 Export to Word";
            exportBtn.disabled = false;
        }, 2000);
    }
});


// ===== Listen for real-time storage changes =====
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.isRunning || changes.savedCount || changes.skippedCount) {
        loadState();
    }
});


// ===== Initialize on popup open =====
loadState();