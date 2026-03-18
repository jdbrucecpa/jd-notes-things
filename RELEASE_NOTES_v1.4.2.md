# v1.4.2 Release Notes

## Highlights
Bug fix release that eliminates a race condition where clicking Record could immediately stop recording and trigger transcription of an empty meeting.

---

## Recording Stability Fixes

- **Removed dangerous `meeting-closed` fallback**: The SDK's `meeting-closed` event handler previously had a fallback that would stop ANY active recording if the closing window's ID didn't match. This meant an unrelated window closing (browser tab, meeting platform flickering) could kill an in-progress recording. The handler now only stops a recording when the window ID directly matches.

- **Fixed orphaned `activeRecordings` entry on startup failure**: If `RecallAiSdk.startRecording()` threw an error, the `activeRecordings` entry (added before the call) was never cleaned up. This phantom entry could later be stopped by other SDK events, triggering transcription on an empty file. The error handler now properly removes both `activeRecordings` and `activeMeetingIds` entries.

- **Scoped `activeMeetingIds` cleanup to closed window only**: The `meeting-closed` handler previously wiped ALL entries in `global.activeMeetingIds`, not just the one for the closed window. This destroyed tracking context for any concurrently active recording.

---

## Files Changed
3 files changed, ~17 additions, ~22 deletions (net -5 lines)
