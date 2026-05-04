'use strict';

/**
 * Decide which recording (if any) should be auto-stopped in response to a
 * Recall SDK `meeting-closed` event, and whether to clear the tracked
 * detectedMeeting / user-facing meeting-detected indicator.
 *
 * Pure function: no side effects, no module state, no Electron access.
 * Always pass everything explicitly so the auto-stop decision is unit-testable.
 *
 * Background — the Recall SDK v2 has two distinct quirks that this resolver
 * must distinguish, because v1.4.6 conflated them and caused a regression:
 *
 *   Quirk A: evt.window.id is sometimes `undefined` when a meeting actually
 *     ends cleanly. There is no direct way to identify which recording
 *     corresponds to the closed meeting, so if exactly one recording is
 *     active we stop it. (This is the legitimate v1.4.6 fallback case.)
 *
 *   Quirk B: evt.window.id is sometimes a *valid* windowId for an UNRELATED
 *     window (e.g. a Teams lobby/preview window closing while the actual
 *     meeting window stays open). Stopping the active recording in this case
 *     was the v1.4.6 regression and is what this resolver fixes.
 *
 * Active recording keys can be one of two shapes, depending on which start
 * path was used:
 *
 *   - The SDK windowId itself (auto-detect / `createMeetingNoteAndRecord`
 *     path) — `meeting-closed` for that windowId is a direct match.
 *
 *   - A `prepareDesktopAudioRecording()` key (calendar / quick-record path) —
 *     the closed window's SDK id will never directly match an active key,
 *     even when the user's actual meeting is the one closing. We detect that
 *     case via `detectedWindowId === sdkWindowId`.
 *
 * @param {object} args
 * @param {string|undefined|null} args.sdkWindowId
 *   `evt.window?.id` from the SDK event. May be undefined (Quirk A).
 * @param {string|undefined|null} args.detectedWindowId
 *   `detectedMeeting?.window?.id` — the window the SDK most recently fired
 *   `meeting-detected` for.
 * @param {string[]} args.activeRecordingKeys
 *   `Object.keys(activeRecordings.getAll())` — recording keys currently
 *   tracked by the recording registry.
 *
 * @returns {{
 *   recordingToStop: string|null,
 *   shouldClearDetectedMeeting: boolean,
 *   reason: string,
 * }}
 *   - `recordingToStop`: key to stop, or null if nothing should stop
 *   - `shouldClearDetectedMeeting`: true when the user's known active
 *     meeting actually closed (so detection state should reset)
 *   - `reason`: short tag for diagnostic logging
 */
function resolveMeetingClosedTarget({ sdkWindowId, detectedWindowId, activeRecordingKeys }) {
  // 1. Direct match: the SDK windowId is itself a tracked recording key.
  //    Auto-detect / createMeetingNoteAndRecord path.
  if (sdkWindowId && activeRecordingKeys.includes(sdkWindowId)) {
    return {
      recordingToStop: sdkWindowId,
      shouldClearDetectedMeeting: detectedWindowId === sdkWindowId,
      reason: 'direct-match',
    };
  }

  // 2. Strong-signal fallback cases — only fall back to "stop the sole
  //    active recording" when we have evidence the user's meeting is the
  //    one closing:
  //      (a) Quirk A: SDK gave us no windowId at all
  //      (b) Calendar/quick-record path: the closed window IS our tracked
  //          detected meeting, even though activeRecordings is keyed by a
  //          desktop-audio key
  const sdkProvidedNoWindowId = !sdkWindowId;
  const closedWindowIsDetectedMeeting =
    !!sdkWindowId && !!detectedWindowId && sdkWindowId === detectedWindowId;

  if (sdkProvidedNoWindowId || closedWindowIsDetectedMeeting) {
    const baseReason = sdkProvidedNoWindowId ? 'sdk-no-window-id' : 'closed-was-detected';

    if (activeRecordingKeys.length === 1) {
      return {
        recordingToStop: activeRecordingKeys[0],
        shouldClearDetectedMeeting: true,
        reason: baseReason,
      };
    }

    // 0 or >1 active recordings — we still consider the user's meeting closed
    // (so clear detection state), but we don't risk stopping the wrong one.
    return {
      recordingToStop: null,
      shouldClearDetectedMeeting: true,
      reason:
        activeRecordingKeys.length === 0
          ? `${baseReason}-no-active-recordings`
          : `${baseReason}-multiple-active-recordings`,
    };
  }

  // 3. SDK gave us a windowId, it doesn't match any recording, and it isn't
  //    our detected meeting. It's an unrelated window (Quirk B) — leave
  //    recordings AND detection state alone.
  return {
    recordingToStop: null,
    shouldClearDetectedMeeting: false,
    reason: 'unrelated-window-closed',
  };
}

module.exports = { resolveMeetingClosedTarget };
