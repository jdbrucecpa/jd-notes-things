# v1.4.6 Release Notes

## Highlights
Fixes recording auto-stop when ending a Zoom meeting. The Recall SDK v2 sometimes fires `meeting-closed` and `recording-ended` events with undefined `window.id`, which caused the auto-stop logic to silently fail.

---

## Recording Auto-Stop Fix

- **meeting-closed handler**: Added three layers of fallback for resolving the window ID when the SDK event is missing it: (1) the event's `window.id`, (2) the tracked `detectedMeeting` window ID, (3) the sole active recording key. Previously, an undefined `window.id` caused the handler to skip stopping entirely.

- **recording-ended handler**: Added optional chaining (`evt.window?.id` instead of `evt.window.id`) to prevent a crash when `window` is undefined, plus a fallback to resolve the window ID from the sole active recording.

- **Logging improvements**: Both handlers now log detailed diagnostic information when fallbacks are used, making future SDK event issues easier to diagnose.

---

## Files Changed
3 files changed, ~59 additions, ~22 deletions (net +37 lines)
