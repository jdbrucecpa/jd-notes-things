# v1.4.7 Release Notes

## Highlights
Fixes a regression introduced in v1.4.6 where Microsoft Teams meetings would briefly start recording and then immediately stop and begin transcribing on empty audio. The v1.4.6 auto-stop fallback was too aggressive — closing any unrelated window (e.g. a Teams lobby/preview) while a recording was active would trigger a stop. v1.4.7 narrows the fallback to only fire on the genuine SDK quirks it was meant for.

---

## Recording Auto-Stop Regression Fix

- **Narrowed the "sole active recording" fallback in `meeting-closed`**: v1.4.6 stopped the only active recording any time a `meeting-closed` event fired with a windowId that didn't match a tracked recording. v1.4.7 only invokes the fallback when (a) the SDK gave us no windowId at all (the original quirk v1.4.6 was meant to fix), or (b) the closed window is our currently-detected meeting (the calendar/quick-record path where activeRecordings is keyed by a `prepareDesktopAudioRecording()` key). An unrelated window closing now leaves recordings alone.

- **`detectedMeeting` no longer cleared on unrelated window close**: The handler used to set `detectedMeeting = null` on every `meeting-closed` event, which then caused subsequent record-button clicks to fail with "No active meeting detected". It now only clears detection state when the user's actual meeting is the one closing.

- **Renderer detection-status update is now conditional**: The `meeting-detection-status: { detected: false }` IPC is only sent when the detected meeting actually closes, so the widget and main UI stay accurate when Teams transitions between lobby/preview/meeting windows.

---

## Engineering

- **New pure helper `src/main/services/recordingAutoStopResolver.js`**: The decision logic for "what to stop and what to clear when `meeting-closed` fires" was extracted from the inline event handler into a pure function. This made it possible to unit-test the regression scenario directly without spinning up Electron.

- **13 new unit tests in `tests/unit/recordingAutoStopResolver.test.js`**: Cover the direct-match path, both legitimate fallback cases (SDK quirk A: missing windowId; calendar/quick-record path), and a dedicated `REGRESSION` block that pins the v1.4.6 → v1.4.7 fix so the buggy behavior cannot be silently reintroduced.

- **`src/main.js` net −18 lines**: Despite adding a require and richer diagnostic logging, the meeting-closed handler is shorter because the conditional spaghetti moved into the helper.

---

## Files Changed
4 files modified, 2 files added; ~106 additions, ~55 deletions in source (net cleanup of ~18 lines in `src/main.js` plus the new helper + test module).
