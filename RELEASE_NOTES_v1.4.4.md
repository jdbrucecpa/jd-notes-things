# v1.4.4 Release Notes

## Highlights
Fixes a bug where clicking Record during the SDK startup restart cycle would silently fail to start recording.

---

## SDK Readiness Guard

- **Added SDK readiness check to `startManualRecording`**: The Recall SDK restarts on app launch to detect already-open meetings (~1s window). If the user clicked Record during this window, the `prepareDesktopAudioRecording()` call would hang because the SDK was mid-restart. The handler now polls for SDK readiness (every 250ms, up to 10s) before attempting SDK calls, with a clear error message if the timeout is exceeded.

---

## Files Changed
3 files changed, ~19 additions, ~2 deletions (net +17 lines)
