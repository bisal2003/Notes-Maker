/**
 * Content script for automatic caption/subtitle extraction.
 * Injected into YouTube and Oracle Learn pages.
 *
 * Strategy:
 * 1. Detect platform (YouTube / Oracle / generic HTML5 video)
 * 2. Watch for caption/subtitle DOM elements using MutationObserver
 * 3. Buffer caption lines and send batches to background script every 30s
 * 4. If no captions are found, does nothing — zero impact on the page
 */

(function () {
    "use strict";

    // ===== Configuration =====
    const BATCH_INTERVAL_MS = 30000;  // Send captions every 30 seconds
    const PLAYER_POLL_MS = 3000;      // Check for video player every 3s
    const PLAYER_POLL_TIMEOUT = 60000; // Stop polling after 60s

    // ===== State =====
    let captionBuffer = [];
    let sentLines = new Set();        // Track already-sent lines to avoid duplicates
    let observer = null;
    let batchTimer = null;
    let isInitialized = false;

    // ===== Entry point =====
    function init() {
        if (isInitialized) return;
        isInitialized = true;

        const hostname = window.location.hostname;

        if (hostname.includes("youtube.com")) {
            startYouTubeWatcher();
        }

        // Always try generic HTML5 video tracks (works for Oracle Learn, Coursera, etc.)
        startHTML5TrackWatcher();

        // Batch send timer
        batchTimer = setInterval(sendBatch, BATCH_INTERVAL_MS);

        // Send remaining captions when navigating away
        window.addEventListener("beforeunload", sendBatch);

        // Handle YouTube SPA navigation (page changes without full reload)
        if (hostname.includes("youtube.com")) {
            watchYouTubeNavigation();
        }

        console.log("[Oracle Tracker] Content script initialized");
    }


    // ================================================================
    //  YOUTUBE CAPTIONS (.ytp-caption-segment)
    // ================================================================

    function startYouTubeWatcher() {
        let elapsed = 0;

        const poll = setInterval(() => {
            elapsed += PLAYER_POLL_MS;

            // Look for the YouTube player
            const player = document.querySelector("#movie_player");
            if (player) {
                clearInterval(poll);
                attachYouTubeObserver(player);
                return;
            }

            // Timeout — player not found (maybe not a video page)
            if (elapsed >= PLAYER_POLL_TIMEOUT) {
                clearInterval(poll);
                console.log("[Oracle Tracker] No YouTube player found, caption extraction skipped");
            }
        }, PLAYER_POLL_MS);
    }

    function attachYouTubeObserver(playerElement) {
        // Disconnect any existing observer
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(() => {
            const segments = document.querySelectorAll(".ytp-caption-segment");
            if (segments.length === 0) return;

            segments.forEach((segment) => {
                const text = segment.textContent.trim();
                if (text && !sentLines.has(text)) {
                    captionBuffer.push(text);
                    sentLines.add(text);
                }
            });
        });

        observer.observe(playerElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        console.log("[Oracle Tracker] YouTube caption observer attached");
    }

    /**
     * YouTube is a SPA — watch for navigation events and re-attach observer.
     */
    function watchYouTubeNavigation() {
        let currentUrl = window.location.href;

        // YouTube fires 'yt-navigate-finish' on SPA navigation
        document.addEventListener("yt-navigate-finish", () => {
            const newUrl = window.location.href;
            if (newUrl !== currentUrl) {
                currentUrl = newUrl;
                console.log("[Oracle Tracker] YouTube navigation detected, re-initializing");

                // Send any pending captions from the previous page
                sendBatch();

                // Clear state for the new page
                sentLines.clear();
                captionBuffer = [];

                // Re-attach observer for the new video
                startYouTubeWatcher();
            }
        });
    }


    // ================================================================
    //  GENERIC HTML5 VIDEO TRACKS (Oracle Learn, Coursera, etc.)
    // ================================================================

    function startHTML5TrackWatcher() {
        let elapsed = 0;

        const poll = setInterval(() => {
            elapsed += PLAYER_POLL_MS;

            const videos = document.querySelectorAll("video");

            videos.forEach((video) => {
                // Skip if we already attached listeners to this video
                if (video.dataset.oracleTrackerAttached) return;

                attachHTML5TrackListeners(video);
                video.dataset.oracleTrackerAttached = "true";
            });

            // Stop polling after timeout
            if (elapsed >= PLAYER_POLL_TIMEOUT) {
                clearInterval(poll);
            }
        }, PLAYER_POLL_MS);
    }

    function attachHTML5TrackListeners(video) {
        if (!video.textTracks || video.textTracks.length === 0) return;

        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];

            // Only watch caption/subtitle tracks
            if (track.kind !== "captions" && track.kind !== "subtitles") continue;

            track.addEventListener("cuechange", () => {
                const cues = track.activeCues;
                if (!cues) return;

                for (let j = 0; j < cues.length; j++) {
                    // Strip HTML tags from cue text
                    const text = cues[j].text.replace(/<[^>]*>/g, "").trim();
                    if (text && !sentLines.has(text)) {
                        captionBuffer.push(text);
                        sentLines.add(text);
                    }
                }
            });
        }

        console.log("[Oracle Tracker] HTML5 text track listeners attached");
    }


    // ================================================================
    //  BATCH SENDING
    // ================================================================

    function sendBatch() {
        if (captionBuffer.length === 0) return;

        // Join all buffered lines into a paragraph
        const batchText = captionBuffer.join(" ");

        // Send to background script
        try {
            chrome.runtime.sendMessage({
                action: "caption",
                text: batchText,
                lineCount: captionBuffer.length,
            });

            console.log(`[Oracle Tracker] Sent ${captionBuffer.length} caption lines`);
        } catch (error) {
            // Extension context may be invalidated (e.g., extension reloaded)
            console.warn("[Oracle Tracker] Failed to send captions:", error.message);
        }

        // Clear buffer (sentLines keeps tracking to avoid re-sending)
        captionBuffer = [];
    }


    // ================================================================
    //  CLEANUP
    // ================================================================

    // Clean up sentLines periodically to avoid unbounded memory growth
    setInterval(() => {
        if (sentLines.size > 5000) {
            sentLines.clear();
        }
    }, 300000); // Every 5 minutes


    // ===== Start =====
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
