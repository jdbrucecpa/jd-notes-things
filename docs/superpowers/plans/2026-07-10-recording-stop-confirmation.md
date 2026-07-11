# Recording Stop-Confirmation Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a window-absent close would auto-stop an active local recording (Zoom, Teams, or Google Meet), show a small always-on-top "End the recording?" dialog with a 10-second main-process countdown and End Recording / Keep Recording buttons — instead of stopping silently. Manual stops and the browser-exit/process-death backstop still stop immediately with no dialog. Also add an immediate re-probe in LocalProvider so a single title flicker never fires `meeting-closed`.

**Architecture:** The pure resolver (`recordingAutoStopResolver.js`) gains a `requiresConfirmation` flag and drops its google-meet "never stop" branch, so Meet window-absence resolves a `recordingToStop` exactly like Zoom/Teams. The `meeting-closed` handler in `main.js` branches on that flag: `requiresConfirmation` → open a countdown dialog whose 10-second timer lives in the MAIN process (the renderer only displays the number); timeout or End → the existing stop path, Keep → cancel and keep recording. The dialog is a dedicated frameless always-on-top `BrowserWindow` with its own webpack entry (`stop_confirm`), decoupled from the detection-tied recording widget. LocalProvider runs one extra synchronous `_getWindowList()` after the close-debounce misses and holds the meeting open if the title reappeared.

**Tech Stack:** Electron 43 (main + renderer processes), Electron Forge Webpack plugin (entry points), Vitest (unit tests), ESLint flat config. No new npm dependencies.

---

## Dialog-Surface Decision (read before Task 3)

**Decision: a NEW dedicated frameless always-on-top `BrowserWindow` with its own webpack entry (`stop_confirm`), NOT a reuse of the recording widget.**

Evidence gathered from the code:

1. **The recording widget's lifecycle is bound to meeting *detection*, not to an active recording, and it is destroyed (not hidden) whenever detection is lost.** `hideRecordingWidget()` calls `recordingWidget.close(); recordingWidget = null;` (`src/main.js:1359-1364`) — the note above it says it destroys "to avoid Windows transparency flash on re-show." The widget is auto-shown on `meeting-detected` only when `!recordingManager?.isRecording` (`src/main.js:2485`).
2. **The confirmation must appear at the exact moment detection is being cleared.** A window-absent `meeting-closed` sets `shouldClearDetectedMeeting: true`, and the handler then sends `meeting-detection-status {detected:false}` (`src/main.js:2587-2596`). Reusing the widget for the dialog would mean rendering a countdown on a surface that is being torn down / hidden in the same event — racy.
3. **The widget is `transparent: true` (`src/main.js:1278`) and already runs a multi-mode state machine** (`show-standalone`, `show`, `recording-started`, `recording-stopped` via `widget:update`, see `src/widgetPreload.js:23` and `src/main.js:1323-1388`). Overloading it with a countdown mode couples new state into an already-complex, transparency-sensitive surface.
4. **A dedicated window is fully decoupled and testable in isolation**, is opaque/solid (a proper modal), and can use `setAlwaysOnTop(true, 'screen-saver')` to sit above a full-screen meeting.

**Cost accounted for:** a new webpack entry requires (a) an `entryPoints[]` entry in `forge.config.js`, and (b) two new ESLint globals (`STOP_CONFIRM_WEBPACK_ENTRY`, `STOP_CONFIRM_PRELOAD_WEBPACK_ENTRY`) in the main-process block of `eslint.config.cjs`. Both are one-line additions handled in Task 3. Production CSP (`script-src 'self'`, `src/main.js:1797-1799`) is applied globally to all local content via `session.defaultSession`, so the new window inherits it automatically — which is another reason the script must be a webpack-bundled `<script src>` (html-webpack-plugin injects it as `'self'`), never inline.

---

## File Structure

- `src/main/services/recordingAutoStopResolver.js` — MODIFY. Add `requiresConfirmation` to every return; delete the google-meet window-absent branch (0b).
- `tests/unit/recordingAutoStopResolver.test.js` — MODIFY. Assert `requiresConfirmation` everywhere; rewrite the Meet window-absent test.
- `src/main/recording/LocalProvider.js` — MODIFY. Immediate re-probe in `_pollForMeetings` before emitting `meeting-closed`.
- `tests/unit/LocalProvider.test.js` — MODIFY. Add a re-probe "held open" test.
- `src/stopConfirm.html` — CREATE. Static dialog markup (structure only, no data-driven DOM).
- `src/stopConfirm.js` — CREATE. Renderer: updates countdown via `textContent`, wires two buttons. No HTML strings from data.
- `src/stopConfirmPreload.js` — CREATE. `contextBridge` `confirmAPI` (`end`, `keep`, `onTick`).
- `forge.config.js` — MODIFY. Add the `stop_confirm` webpack entry point.
- `eslint.config.cjs` — MODIFY. Add the two `STOP_CONFIRM_*` globals to the main-process block.
- `src/main.js` — MODIFY. Extract `executeAutoStop()`; add `showStopConfirmWindow()`, `beginStopConfirmation()`, `finishStopConfirmation()`; add `confirm:end` / `confirm:keep` IPC handlers; branch the `meeting-closed` handler on `decision.requiresConfirmation`.

---

## Baseline (verify before starting)

- [ ] **Confirm the baseline.** Run:

```bash
npx vitest run
```

Expected: **340 passing.** One suite, `wasapiCapture`, may fail ONLY with an `EADDRINUSE` / port-bind error — that is environmental (a stray FFmpeg/pipe from a previous run) and does NOT count as a real failure. Any other failure means the tree is dirty — stop and investigate.

```bash
npx eslint src/ tests/
```

Expected: **zero errors, zero warnings.**

> **NEVER kill running electron/ffmpeg processes** to clear an EADDRINUSE — leave them; the port conflict is cosmetic for this plan's tasks (none of Tasks 1–4 touch `wasapiCapture`).

---

## Task 1: Resolver — `requiresConfirmation` flag + drop the google-meet never-stop branch

**Files:**
- Modify: `src/main/services/recordingAutoStopResolver.js:44-160`
- Test: `tests/unit/recordingAutoStopResolver.test.js` (full rewrite of assertions)

- [ ] **Step 1: Update the failing test file first**

Replace the ENTIRE contents of `tests/unit/recordingAutoStopResolver.test.js` with the following. The changes: every stop/no-stop return now asserts `requiresConfirmation`; the "Google Meet lifecycle" block's first test is rewritten because Meet window-absence now resolves a `recordingToStop` (with confirmation) instead of returning `null`.

```javascript
import { describe, it, expect } from 'vitest';
import { resolveMeetingClosedTarget } from '../../src/main/services/recordingAutoStopResolver.js';

describe('resolveMeetingClosedTarget', () => {
  describe('direct match (auto-detect / createMeetingNoteAndRecord path)', () => {
    it('stops the recording when SDK windowId is itself a recording key', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-1',
        activeRecordingKeys: ['win-1'],
      });
      expect(result.recordingToStop).toBe('win-1');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('direct-match');
    });

    it('does not clear detectedMeeting if it points at a different window', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-2',
        activeRecordingKeys: ['win-1'],
      });
      expect(result.recordingToStop).toBe('win-1');
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('still matches even if other recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-1',
        activeRecordingKeys: ['win-1', 'win-2'],
      });
      expect(result.recordingToStop).toBe('win-1');
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('Quirk A: SDK fires meeting-closed with no window.id', () => {
    it('stops the sole active recording (legitimate v1.4.6 case)', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('sdk-no-window-id');
    });

    it('clears detection but stops nothing when no recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: undefined,
        activeRecordingKeys: [],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('sdk-no-window-id-no-active-recordings');
    });

    it('refuses to guess when multiple recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['rec-1', 'rec-2'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('sdk-no-window-id-multiple-active-recordings');
    });

    it('treats null sdkWindowId the same as undefined', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: null,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('sdk-no-window-id');
    });
  });

  describe('Calendar / quick-record path: closed window IS the detected meeting', () => {
    it('stops the sole desk-key recording when the detected meeting closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('closed-was-detected');
    });

    it('clears detection but stops nothing when 0 recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: [],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('closed-was-detected-no-active-recordings');
    });

    it('refuses to guess when multiple recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: ['rec-a', 'rec-b'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('closed-was-detected-multiple-active-recordings');
    });
  });

  describe('Quirk B / v1.4.6 regression: unrelated window closes', () => {
    it('does not stop the SDK-keyed recording when an unrelated Teams lobby closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-lobby-XYZ',
        detectedWindowId: 'teams-meeting-ABC',
        activeRecordingKeys: ['teams-meeting-ABC'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });

    it('does not stop a desk-key recording when an unrelated window closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-lobby-XYZ',
        detectedWindowId: 'teams-meeting-ABC',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });

    it('does not stop anything when no detected meeting is set and the window is unknown', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'unknown-window',
        detectedWindowId: undefined,
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });
  });

  describe('Google Meet lifecycle', () => {
    it('resolves a Meet recording to stop on window absence WITH confirmation required', () => {
      // REVISED 2026-07-10: Meet window-absence no longer means "never stop".
      // It now resolves a recordingToStop exactly like Zoom/Teams, but the
      // main-process handler must gate the stop behind the countdown dialog.
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'chrome-1234',
        detectedWindowId: 'chrome-1234',
        activeRecordingKeys: ['C:\\rec\\recording-x.mp3'],
        platform: 'google-meet',
        reason: undefined,
      });
      expect(result.recordingToStop).toBe('C:\\rec\\recording-x.mp3');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('closed-was-detected');
    });

    it('stops the sole recording on a browser-exit backstop even if detection was already cleared', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'browser-1234',
        detectedWindowId: undefined, // an earlier tab-switch close already cleared detection
        activeRecordingKeys: ['C:\\rec\\recording-x.mp3'],
        platform: undefined,
        reason: 'browser-exit',
      });
      expect(result.recordingToStop).toBe('C:\\rec\\recording-x.mp3');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false); // browser-exit = immediate, no dialog
      expect(result.reason).toBe('browser-exit');
    });

    it('browser-exit with no active recordings clears detection but stops nothing', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'browser-1234',
        detectedWindowId: undefined,
        activeRecordingKeys: [],
        platform: undefined,
        reason: 'browser-exit',
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('browser-exit-no-active-recordings');
    });

    it('browser-exit with multiple active recordings does not risk stopping the wrong one', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'browser-1234',
        detectedWindowId: undefined,
        activeRecordingKeys: ['a.mp3', 'b.mp3'],
        platform: undefined,
        reason: 'browser-exit',
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toBe('browser-exit-multiple-active-recordings');
    });

    it('does not affect Zoom/Teams: a direct match still stops with platform passed through', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'zoom-99',
        detectedWindowId: 'zoom-99',
        activeRecordingKeys: ['zoom-99'],
        platform: 'zoom',
        reason: undefined,
      });
      expect(result.recordingToStop).toBe('zoom-99');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.reason).toBe('direct-match');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/recordingAutoStopResolver.test.js`
Expected: FAIL — several assertions on `result.requiresConfirmation` fail with `expected undefined to be true/false`, and the rewritten Meet test fails because the current code returns `recordingToStop: null` (branch 0b).

- [ ] **Step 3: Update the resolver**

In `src/main/services/recordingAutoStopResolver.js`, make the following edits.

**Edit 3a — the docblock `@returns` (lines 52-60).** Replace:

```javascript
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
```

with:

```javascript
 * @returns {{
 *   recordingToStop: string|null,
 *   shouldClearDetectedMeeting: boolean,
 *   requiresConfirmation: boolean,
 *   reason: string,
 * }}
 *   - `recordingToStop`: key to stop, or null if nothing should stop
 *   - `shouldClearDetectedMeeting`: true when the user's known active
 *     meeting actually closed (so detection state should reset)
 *   - `requiresConfirmation`: true when the stop was triggered by window
 *     absence (Zoom/Teams/Meet) and the caller must gate it behind the
 *     "End the recording?" countdown dialog. false for the browser-exit /
 *     process-death backstop (nothing left to record — stop immediately) and
 *     for every no-op (recordingToStop === null). The user's manual stop never
 *     reaches this resolver, so it is never gated.
 *   - `reason`: short tag for diagnostic logging
 */
```

**Edit 3b — the browser-exit branch (0a), lines 77-93.** Replace:

```javascript
  if (reason === 'browser-exit') {
    if (activeRecordingKeys.length === 1) {
      return {
        recordingToStop: activeRecordingKeys[0],
        shouldClearDetectedMeeting: true,
        reason: 'browser-exit',
      };
    }
    return {
      recordingToStop: null,
      shouldClearDetectedMeeting: true,
      reason:
        activeRecordingKeys.length === 0
          ? 'browser-exit-no-active-recordings'
          : 'browser-exit-multiple-active-recordings',
    };
  }
```

with:

```javascript
  if (reason === 'browser-exit') {
    if (activeRecordingKeys.length === 1) {
      return {
        recordingToStop: activeRecordingKeys[0],
        shouldClearDetectedMeeting: true,
        requiresConfirmation: false,
        reason: 'browser-exit',
      };
    }
    return {
      recordingToStop: null,
      shouldClearDetectedMeeting: true,
      requiresConfirmation: false,
      reason:
        activeRecordingKeys.length === 0
          ? 'browser-exit-no-active-recordings'
          : 'browser-exit-multiple-active-recordings',
    };
  }
```

**Edit 3c — DELETE the google-meet window-absent branch (0b), lines 95-106.** Remove this entire block:

```javascript
  // 0b. Google Meet window-absence (LocalProvider). The user switched tabs — the
  //     "Meet - …" title dropped out of the window list but the call continues.
  //     Never auto-stop a Meet recording on window absence; only a browser exit
  //     (0a) or a manual stop ends it. Detection state still clears so the widget
  //     hides when the Meet tab goes away.
  if (platform === 'google-meet') {
    return {
      recordingToStop: null,
      shouldClearDetectedMeeting: true,
      reason: 'google-meet-window-absent',
    };
  }

```

> After this deletion, `platform` is no longer read by the resolver. Leave `platform` in the destructured params and the `@param` docblock — the caller still passes it, and dropping it from the signature is an unnecessary churn. To avoid a `no-unused-vars` lint error on the parameter, see Edit 3f.

**Edit 3d — the direct-match branch (lines 110-116).** Replace:

```javascript
  if (sdkWindowId && activeRecordingKeys.includes(sdkWindowId)) {
    return {
      recordingToStop: sdkWindowId,
      shouldClearDetectedMeeting: detectedWindowId === sdkWindowId,
      reason: 'direct-match',
    };
  }
```

with:

```javascript
  if (sdkWindowId && activeRecordingKeys.includes(sdkWindowId)) {
    return {
      recordingToStop: sdkWindowId,
      shouldClearDetectedMeeting: detectedWindowId === sdkWindowId,
      requiresConfirmation: true,
      reason: 'direct-match',
    };
  }
```

**Edit 3e — the strong-signal fallback block (lines 129-150).** Replace:

```javascript
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
```

with:

```javascript
  if (sdkProvidedNoWindowId || closedWindowIsDetectedMeeting) {
    const baseReason = sdkProvidedNoWindowId ? 'sdk-no-window-id' : 'closed-was-detected';

    if (activeRecordingKeys.length === 1) {
      return {
        recordingToStop: activeRecordingKeys[0],
        shouldClearDetectedMeeting: true,
        requiresConfirmation: true,
        reason: baseReason,
      };
    }

    // 0 or >1 active recordings — we still consider the user's meeting closed
    // (so clear detection state), but we don't risk stopping the wrong one.
    return {
      recordingToStop: null,
      shouldClearDetectedMeeting: true,
      requiresConfirmation: false,
      reason:
        activeRecordingKeys.length === 0
          ? `${baseReason}-no-active-recordings`
          : `${baseReason}-multiple-active-recordings`,
    };
  }
```

**Edit 3f — the final unrelated-window return (lines 155-159).** Replace:

```javascript
  return {
    recordingToStop: null,
    shouldClearDetectedMeeting: false,
    reason: 'unrelated-window-closed',
  };
```

with:

```javascript
  // `platform` is intentionally accepted but no longer consulted (the google-meet
  // window-absent special case was removed — Meet now stops-with-confirmation like
  // Zoom/Teams). Reference it in a no-op so the destructured param does not trip
  // no-unused-vars, and keep it in the signature for call-site stability.
  void platform;

  return {
    recordingToStop: null,
    shouldClearDetectedMeeting: false,
    requiresConfirmation: false,
    reason: 'unrelated-window-closed',
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/recordingAutoStopResolver.test.js`
Expected: PASS (all resolver tests green).

- [ ] **Step 5: Lint**

Run: `npx eslint src/main/services/recordingAutoStopResolver.js tests/unit/recordingAutoStopResolver.test.js`
Expected: zero errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/recordingAutoStopResolver.js tests/unit/recordingAutoStopResolver.test.js
git commit -m "feat(recording): resolver requiresConfirmation flag; Meet stops like Zoom/Teams

Add requiresConfirmation to resolveMeetingClosedTarget: true for window-absent
auto-stops (Zoom/Teams/Meet), false for the browser-exit backstop and all no-ops.
Remove the google-meet never-stop branch so Meet window-absence resolves a
recordingToStop and is gated behind the countdown dialog by the caller.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: LocalProvider — immediate re-probe before emitting `meeting-closed`

**Files:**
- Modify: `src/main/recording/LocalProvider.js:497-520` (inside `_pollForMeetings`)
- Test: `tests/unit/LocalProvider.test.js` (add one test to the `meeting detection close-debounce` describe block)

- [ ] **Step 1: Write the failing test**

In `tests/unit/LocalProvider.test.js`, inside the `describe('meeting detection close-debounce', ...)` block, add this test immediately after the existing `'closes a Teams meeting on window absence even while ms-teams.exe is alive'` test (i.e. just before the closing `});` of that describe at what is currently line 296). Teams is used deliberately so the Zoom process-liveness hold branch is not taken and the re-probe path is exercised directly:

```javascript
    // Immediate re-probe: after the close-debounce misses, LocalProvider does one
    // extra synchronous enumeration. If the tracked meeting window reappeared (a
    // flicker that outlasted the debounce, or a Meet tab-switch that came back),
    // hold the meeting open and do NOT emit meeting-closed.
    it('holds the meeting open when the window reappears on the immediate re-probe', async () => {
      const TEAMS = [{ processName: 'ms-teams', title: 'Standup | Microsoft Teams', pid: 55 }];
      const list = vi.spyOn(provider, '_getWindowList');
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(TEAMS); // poll 1: detected
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(NONE); // poll 2: miss 1
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(NONE); // poll 3 main scan: miss 2 (reaches threshold)
      list.mockResolvedValueOnce(TEAMS); // poll 3 re-probe: window reappeared
      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(provider._meetingDetected).toBe(true);
      expect(provider._missCount).toBe(0);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/LocalProvider.test.js -t "reappears on the immediate re-probe"`
Expected: FAIL — current code emits `meeting-closed` on the second miss (no re-probe), so `closed` is called once and `_meetingDetected` is `false`.

- [ ] **Step 3: Implement the re-probe**

In `src/main/recording/LocalProvider.js`, inside `_pollForMeetings`, replace the close-emission block (currently lines 497-520):

```javascript
      if (this._missCount >= CLOSE_CONFIRM_POLLS) {
        // Zoom HIDES its meeting window entirely during screen share, so window
        // absence alone is not proof the meeting ended. Zoom runs each meeting
        // in a dedicated child process that exits when the meeting ends, so
        // hold the meeting open while that process is alive. Zoom-only: Teams
        // meetings live inside the long-lived ms-teams.exe process, where
        // process liveness would hold a closed meeting open indefinitely.
        if (this._activeMeeting?.platform === 'zoom') {
          const pid = this._activeMeetingPid();
          if (pid && this._isProcessAlive(pid)) {
            if (this._missCount === CLOSE_CONFIRM_POLLS) {
              log.info(
                `[LocalProvider] Meeting window hidden but Zoom process alive (pid=${pid}) — holding meeting open (screen share?)`
              );
            }
            return;
          }
        }
        const prev = this._activeMeeting;
        this._meetingDetected = false;
        this._activeMeeting = null;
        this._missCount = 0;
        this.emit('meeting-closed', { windowId: prev?.windowId });
      }
```

with:

```javascript
      if (this._missCount >= CLOSE_CONFIRM_POLLS) {
        // Zoom HIDES its meeting window entirely during screen share, so window
        // absence alone is not proof the meeting ended. Zoom runs each meeting
        // in a dedicated child process that exits when the meeting ends, so
        // hold the meeting open while that process is alive. Zoom-only: Teams
        // meetings live inside the long-lived ms-teams.exe process, where
        // process liveness would hold a closed meeting open indefinitely.
        if (this._activeMeeting?.platform === 'zoom') {
          const pid = this._activeMeetingPid();
          if (pid && this._isProcessAlive(pid)) {
            if (this._missCount === CLOSE_CONFIRM_POLLS) {
              log.info(
                `[LocalProvider] Meeting window hidden but Zoom process alive (pid=${pid}) — holding meeting open (screen share?)`
              );
            }
            return;
          }
        }

        const prev = this._activeMeeting;

        // Immediate re-probe (all platforms). The debounce above can still be
        // fooled: a Meet tab-switch or a Zoom window reshuffle can drop the title
        // for exactly CLOSE_CONFIRM_POLLS polls and then bring it back. Enumerate
        // ONE more time synchronously before declaring the meeting closed; if the
        // tracked meeting window reappeared, reset the debounce and hold it open
        // rather than firing a spurious meeting-closed (which would prompt the
        // stop-confirmation dialog for a meeting that never ended).
        let reprobe = null;
        try {
          reprobe = await this._getWindowList();
        } catch (_err) {
          reprobe = null; // a failed re-probe is not evidence the meeting returned
        }
        if (reprobe) {
          const stillPresent = reprobe.some(win => {
            const match = this._parseMeetingFromTitle(win.title, win.processName);
            return match && `${win.processName}-${win.pid}` === prev?.windowId;
          });
          if (stillPresent) {
            this._missCount = 0;
            log.info(
              `[LocalProvider] Meeting window reappeared on immediate re-probe (${prev?.windowId}) — holding meeting open`
            );
            return;
          }
        }

        this._meetingDetected = false;
        this._activeMeeting = null;
        this._missCount = 0;
        this.emit('meeting-closed', { windowId: prev?.windowId });
      }
```

> Note: existing close-debounce tests use a persistent `list.mockResolvedValue(NONE)`, so their re-probe also returns `NONE` and they still emit `meeting-closed` unchanged. The Zoom process-alive tests return before reaching the re-probe. No existing test asserts the `_getWindowList` call count, so the extra call is safe.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/LocalProvider.test.js`
Expected: PASS — the new re-probe test passes and all existing LocalProvider tests remain green.

- [ ] **Step 5: Lint**

Run: `npx eslint src/main/recording/LocalProvider.js tests/unit/LocalProvider.test.js`
Expected: zero errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/main/recording/LocalProvider.js tests/unit/LocalProvider.test.js
git commit -m "feat(recording): immediate re-probe before emitting meeting-closed

After the close-debounce misses, LocalProvider enumerates once more synchronously
and holds the meeting open if the tracked window title reappeared. Prevents a
spurious meeting-closed (and, downstream, a spurious stop-confirmation dialog)
from a title flicker that outlasts CLOSE_CONFIRM_POLLS.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Stop-confirmation dialog surface (webpack entry, window HTML/JS/preload, ESLint globals)

This task creates the dedicated dialog window's assets and registers the webpack entry. No unit test — it is Electron UI verified by a build and by the manual E2E task. Verification here is: webpack compiles the new entry, and lint passes.

**Files:**
- Create: `src/stopConfirm.html`
- Create: `src/stopConfirm.js`
- Create: `src/stopConfirmPreload.js`
- Modify: `forge.config.js:67-84` (entryPoints array)
- Modify: `eslint.config.cjs:52-57` (main-process globals)

- [ ] **Step 1: Create the dialog HTML (static structure only)**

Create `src/stopConfirm.html`. All dynamic text is set later via `textContent` in `stopConfirm.js`; the markup itself is fully static (allowed). The `<script>` is the webpack-injected bundle (html-webpack-plugin adds it), satisfying `script-src 'self'`.

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <!-- CSP is applied globally to local content via session.defaultSession in main.js -->
    <title>End the recording?</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #1f2430;
        color: #f5f7fa;
        user-select: none;
      }
      .card {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        padding: 16px 18px;
      }
      .headline {
        font-size: 15px;
        font-weight: 600;
      }
      .sub {
        margin-top: 6px;
        font-size: 12.5px;
        line-height: 1.4;
        color: #b7c0cf;
      }
      .countdown {
        font-variant-numeric: tabular-nums;
        font-weight: 700;
      }
      .buttons {
        display: flex;
        gap: 10px;
        margin-top: 14px;
      }
      button {
        flex: 1;
        padding: 9px 10px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      #end-btn {
        background: #e5484d;
        color: #fff;
      }
      #keep-btn {
        background: #3a4152;
        color: #f5f7fa;
      }
      button:focus-visible {
        outline: 2px solid #7aa2ff;
        outline-offset: 2px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div>
        <div class="headline">End the recording?</div>
        <div class="sub">
          The meeting window closed. Ending automatically in
          <span id="countdown" class="countdown">10</span>s.
        </div>
      </div>
      <div class="buttons">
        <button id="end-btn" type="button">End Recording</button>
        <button id="keep-btn" type="button">Keep Recording</button>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Create the preload bridge**

Create `src/stopConfirmPreload.js`:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confirmAPI', {
  // User pressed "End Recording" — stop now.
  end: () => ipcRenderer.send('confirm:end'),
  // User pressed "Keep Recording" — cancel the auto-stop, keep recording.
  keep: () => ipcRenderer.send('confirm:keep'),
  // Main process is authoritative for the countdown; it pushes the remaining
  // whole seconds each tick. Renderer only displays.
  onTick: callback =>
    ipcRenderer.on('confirm:tick', (_event, data) => callback(data)),
});
```

- [ ] **Step 3: Create the renderer script (DOM via textContent only)**

Create `src/stopConfirm.js`. It reads no data-derived HTML — it only sets `textContent` and attaches click handlers:

```javascript
// Renderer for the "End the recording?" countdown dialog.
// SECURITY: all dynamic content is written via textContent — never innerHTML.
const countdownEl = document.getElementById('countdown');
const endBtn = document.getElementById('end-btn');
const keepBtn = document.getElementById('keep-btn');

if (window.confirmAPI) {
  window.confirmAPI.onTick(data => {
    const remaining = data && typeof data.remaining === 'number' ? data.remaining : 0;
    countdownEl.textContent = String(remaining);
  });
}

endBtn.addEventListener('click', () => {
  if (window.confirmAPI) window.confirmAPI.end();
});

keepBtn.addEventListener('click', () => {
  if (window.confirmAPI) window.confirmAPI.keep();
});
```

- [ ] **Step 4: Register the webpack entry in `forge.config.js`**

In `forge.config.js`, replace the `entryPoints` array (lines 67-84):

```javascript
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
            {
              html: './src/widget.html',
              js: './src/widget.js',
              name: 'recording_widget',
              preload: {
                js: './src/widgetPreload.js',
              },
            },
          ],
```

with:

```javascript
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
            {
              html: './src/widget.html',
              js: './src/widget.js',
              name: 'recording_widget',
              preload: {
                js: './src/widgetPreload.js',
              },
            },
            {
              html: './src/stopConfirm.html',
              js: './src/stopConfirm.js',
              name: 'stop_confirm',
              preload: {
                js: './src/stopConfirmPreload.js',
              },
            },
          ],
```

- [ ] **Step 5: Add the webpack-entry globals to ESLint**

In `eslint.config.cjs`, replace the main-process globals block (lines 52-57):

```javascript
        // Webpack DefinePlugin globals injected by Electron Forge
        MAIN_WINDOW_WEBPACK_ENTRY: 'readonly',
        MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'readonly',
        // v1.2: Recording widget entry points
        RECORDING_WIDGET_WEBPACK_ENTRY: 'readonly',
        RECORDING_WIDGET_PRELOAD_WEBPACK_ENTRY: 'readonly',
```

with:

```javascript
        // Webpack DefinePlugin globals injected by Electron Forge
        MAIN_WINDOW_WEBPACK_ENTRY: 'readonly',
        MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: 'readonly',
        // v1.2: Recording widget entry points
        RECORDING_WIDGET_WEBPACK_ENTRY: 'readonly',
        RECORDING_WIDGET_PRELOAD_WEBPACK_ENTRY: 'readonly',
        // Stop-confirmation countdown dialog entry points
        STOP_CONFIRM_WEBPACK_ENTRY: 'readonly',
        STOP_CONFIRM_PRELOAD_WEBPACK_ENTRY: 'readonly',
```

- [ ] **Step 6: Lint the new/changed files**

Run: `npx eslint src/stopConfirm.js src/stopConfirmPreload.js forge.config.js eslint.config.cjs`
Expected: zero errors, zero warnings. (The `.html` file is not linted by ESLint — that is expected.)

- [ ] **Step 7: Verify webpack accepts the new entry (compile check)**

Run: `npx electron-forge start --help >/dev/null 2>&1; echo "forge CLI reachable"`
Then confirm the entry is wired by asserting the new files exist and the config references them:

```bash
node -e "const c=require('./forge.config.js'); const eps=c.plugins.find(p=>p&&p.name==='@electron-forge/plugin-webpack').config.renderer.entryPoints; const e=eps.find(x=>x.name==='stop_confirm'); if(!e) throw new Error('stop_confirm entry missing'); console.log('stop_confirm entry OK:', e.html, e.js, e.preload.js);"
```

Expected: prints `stop_confirm entry OK: ./src/stopConfirm.html ./src/stopConfirm.js ./src/stopConfirmPreload.js`.

> Do NOT run a full `npm start` here just to verify compilation — it launches Electron and may collide with a running instance. The config assertion above plus lint is sufficient for this task; the window is exercised live in Task 5.

- [ ] **Step 8: Commit**

```bash
git add src/stopConfirm.html src/stopConfirm.js src/stopConfirmPreload.js forge.config.js eslint.config.cjs
git commit -m "feat(recording): add stop-confirmation countdown dialog window assets

New dedicated frameless webpack entry (stop_confirm) for the End-the-recording?
countdown dialog: static HTML shell, textContent-only renderer, contextBridge
preload. Registered in forge.config.js; ESLint globals added for the new
webpack entry magic constants.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Main-process wiring — countdown timer, dialog window, IPC, and handler branch

This task connects everything: extract the stop action, add the countdown/dialog lifecycle owned by the main process, add IPC handlers, and branch the `meeting-closed` handler on `decision.requiresConfirmation`. No unit test (all Electron-coupled main-process glue); verified by lint and by the Task 5 manual E2E.

**Files:**
- Modify: `src/main.js` — module-state vars near line 416; new functions near the widget helpers (~line 1389); IPC handlers near the other `ipcMain` handlers (~line 9826); `meeting-closed` handler branch (lines 2546-2575).

- [ ] **Step 1: Add module-scope state and a constant**

In `src/main.js`, find the recording-widget state declaration (line 416):

```javascript
let recordingWidget = null; // Floating recording widget window (v1.2)
```

Replace it with:

```javascript
let recordingWidget = null; // Floating recording widget window (v1.2)
let stopConfirmWindow = null; // "End the recording?" countdown dialog window
// Exactly one auto-stop confirmation may be pending at a time. Shape when active:
//   { recordingId: string, timer: NodeJS.Timeout }
// The 10s countdown timer is authoritative in the MAIN process; the renderer only
// displays the remaining seconds it is told.
let pendingStopConfirmation = null;
const STOP_CONFIRM_SECONDS = 10;
```

- [ ] **Step 2: Extract `executeAutoStop` and add the confirmation lifecycle functions**

In `src/main.js`, immediately AFTER the `updateWidgetRecordingState` function (it ends at line 1389 with a `}`) and BEFORE the `initializeDefaultConfigFiles` docblock (line 1391), insert:

```javascript
/**
 * Stop a recording via the active provider and notify the renderer. This is the
 * single stop path shared by the immediate auto-stop (browser-exit/no-window-id)
 * and the confirmed/timed-out countdown stop. Errors from the provider are
 * expected when the meeting already closed and are downgraded to a warning.
 * @param {string} recordingToStop - active recording key to stop
 */
function executeAutoStop(recordingToStop) {
  console.log(`Stopping recording for window: ${recordingToStop}`);
  try {
    recordingProvider.stopRecording(recordingToStop);
    recordingManager.updateState(recordingToStop, 'stopping');
    console.log(`✓ Stop recording command sent successfully`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-state-change', {
        windowId: recordingToStop,
        state: 'stopping',
      });
    }
  } catch (error) {
    // The provider may throw if the meeting already closed; the recording still
    // stops. Expected, not critical.
    console.warn(
      `Warning: provider reported error when stopping recording (recording may have already stopped):`,
      error.message
    );
    recordingManager.updateState(recordingToStop, 'stopping');
  }
}

/**
 * Create and show the always-on-top "End the recording?" countdown dialog.
 * @param {number} seconds - initial remaining seconds to display
 */
function showStopConfirmWindow(seconds) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const w = 340;
  const h = 176;

  stopConfirmWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((screenWidth - w) / 2),
    y: Math.round(screenHeight * 0.22),
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: STOP_CONFIRM_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' level keeps the dialog above a full-screen meeting window.
  stopConfirmWindow.setAlwaysOnTop(true, 'screen-saver');
  stopConfirmWindow.loadURL(STOP_CONFIRM_WEBPACK_ENTRY);

  stopConfirmWindow.once('ready-to-show', () => {
    if (stopConfirmWindow && !stopConfirmWindow.isDestroyed()) {
      stopConfirmWindow.show();
      stopConfirmWindow.webContents.send('confirm:tick', { remaining: seconds });
    }
  });

  stopConfirmWindow.on('closed', () => {
    stopConfirmWindow = null;
  });
}

/**
 * Begin a stop-confirmation countdown for an auto-stop that requires user
 * confirmation (window-absent close for Zoom/Teams/Meet). The 10s timer lives
 * here in the main process; on timeout the recording is stopped exactly like an
 * immediate auto-stop. Only one confirmation may be pending at a time — a second
 * close signal while one is pending is ignored (guards against double dialogs).
 * @param {string} recordingId - active recording key that would be stopped
 */
function beginStopConfirmation(recordingId) {
  if (pendingStopConfirmation) {
    console.log(
      `[stop-confirm] A confirmation is already pending (${pendingStopConfirmation.recordingId}); ignoring new close signal for ${recordingId}`
    );
    return;
  }

  let remaining = STOP_CONFIRM_SECONDS;
  console.log(`[stop-confirm] Prompting End-the-recording? for ${recordingId} (${remaining}s)`);
  showStopConfirmWindow(remaining);

  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      console.log('[stop-confirm] Countdown expired — stopping recording');
      finishStopConfirmation(true);
      return;
    }
    if (stopConfirmWindow && !stopConfirmWindow.isDestroyed()) {
      stopConfirmWindow.webContents.send('confirm:tick', { remaining });
    }
  }, 1000);

  pendingStopConfirmation = { recordingId, timer };
}

/**
 * Resolve the pending stop-confirmation: clear the timer, close the dialog, and
 * either stop the recording (timeout or "End Recording") or leave it running
 * ("Keep Recording"). A later meeting-closed for the same/new window can re-open
 * the dialog — there is no permanent suppression.
 * @param {boolean} shouldStop - true to stop now, false to keep recording
 */
function finishStopConfirmation(shouldStop) {
  if (!pendingStopConfirmation) return;

  const { recordingId, timer } = pendingStopConfirmation;
  clearInterval(timer);
  pendingStopConfirmation = null;

  if (stopConfirmWindow && !stopConfirmWindow.isDestroyed()) {
    stopConfirmWindow.close();
  }

  if (shouldStop) {
    executeAutoStop(recordingId);
  } else {
    console.log(`[stop-confirm] User chose Keep Recording — ${recordingId} continues`);
  }
}
```

- [ ] **Step 3: Add the IPC handlers for the dialog buttons**

In `src/main.js`, find the widget hide handler (line 9826):

```javascript
ipcMain.on('widget:hide', () => {
```

Insert BEFORE it:

```javascript
// Stop-confirmation dialog buttons. The main process owns the countdown; these
// only tell it which way the user resolved it.
ipcMain.on('confirm:end', () => {
  console.log('[stop-confirm] User clicked End Recording');
  finishStopConfirmation(true);
});

ipcMain.on('confirm:keep', () => {
  console.log('[stop-confirm] User clicked Keep Recording');
  finishStopConfirmation(false);
});

```

- [ ] **Step 4: Branch the `meeting-closed` handler on `requiresConfirmation`**

In `src/main.js`, replace the immediate-stop block inside the `meeting-closed` handler (lines 2546-2575):

```javascript
    const recordingToStop = decision.recordingToStop;

    if (recordingToStop) {
      console.log(`Stopping recording for window: ${recordingToStop}`);

      try {
        // Stop the recording via active provider
        recordingProvider.stopRecording(recordingToStop);
        recordingManager.updateState(recordingToStop, 'stopping');
        console.log(`✓ Stop recording command sent successfully`);

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recording-state-change', {
            windowId: recordingToStop,
            state: 'stopping',
          });
        }
      } catch (error) {
        // SDK may throw errors if the meeting is already closed, but recording will still stop
        // This is expected behavior, not a critical error
        console.warn(
          `Warning: SDK reported error when stopping recording (recording may have already stopped):`,
          error.message
        );

        // Still update our internal state
        recordingManager.updateState(recordingToStop, 'stopping');
      }
    }
```

with:

```javascript
    const recordingToStop = decision.recordingToStop;

    if (recordingToStop) {
      if (decision.requiresConfirmation) {
        // Window-absent auto-stop (Zoom/Teams/Meet): the title can lie both ways
        // (a Meet PiP close or a "You left" screen), so ask before stopping.
        // The main process owns the 10s countdown; timeout or "End" stops,
        // "Keep" cancels. Manual stop and the browser-exit backstop set
        // requiresConfirmation=false and never reach this branch.
        beginStopConfirmation(recordingToStop);
      } else {
        // Immediate auto-stop: browser-exit / process-death backstop — the
        // meeting app is gone, nothing left to record.
        executeAutoStop(recordingToStop);
      }
    }
```

- [ ] **Step 5: Lint**

Run: `npx eslint src/main.js`
Expected: zero errors, zero warnings.

- [ ] **Step 6: Full unit-test sweep (nothing regressed)**

Run: `npx vitest run`
Expected: **341 passing** (the prior 340 baseline + the one new re-probe test from Task 2). The `wasapiCapture` EADDRINUSE, if present, remains environmental — no other failures.

- [ ] **Step 7: Commit**

```bash
git add src/main.js
git commit -m "feat(recording): gate window-absent auto-stop behind countdown dialog

Wire the stop-confirmation flow into the meeting-closed handler: requiresConfirmation
opens the always-on-top End-the-recording? dialog with a main-process-owned 10s
countdown; timeout or End Recording stops via the shared executeAutoStop path, Keep
Recording cancels and keeps recording. Only one confirmation pending at a time.
Browser-exit and manual stops are unaffected (immediate, no dialog).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Manual E2E checklist (JD)

No code — JD validates the end-to-end behavior in the real app. Run the DEV build only, after quitting the installed `JDNotesThings.exe` (per MEMORY.md: both write the same log; the installed app confounds testing). Recording provider must be **Local**.

- [ ] **Step 1: Launch the dev app**

Run: `npm start` (red tray icon). Confirm no installed instance is running.

- [ ] **Step 2: Google Meet — Keep Recording survives a mid-call PiP close**

  1. Join a real Google Meet call in a normal Chrome tab. Confirm the widget appears and start recording.
  2. Trigger a window-absent close: close the Document Picture-in-Picture window (or switch away from the Meet tab so the "Meet - …" title drops for >2 polls).
  3. **Expected:** the "End the recording?" dialog appears, always-on-top, counting down from 10.
  4. Click **Keep Recording** before it expires.
  5. **Expected:** the dialog closes, the recording continues (widget/tray still shows recording), and no file is finalized.
  6. Return to the Meet tab / re-open PiP, keep talking a bit, confirm recording is intact.

- [ ] **Step 3: Google Meet — countdown expiry stops and processes**

  1. Still in the same call (recording active), hang up the call AND close the Meet tab.
  2. **Expected:** the "End the recording?" dialog appears; let the countdown reach 0 without clicking.
  3. **Expected:** the recording stops on expiry and processes normally — transcript + summary + speaker ID + routing all produced (verify the two markdown files land in the vault).

- [ ] **Step 4: Zoom regression — dialog instead of silent stop**

  1. Join/start a Zoom meeting, start recording.
  2. Close the Zoom meeting window (end the meeting).
  3. **Expected:** the "End the recording?" dialog appears (previously Zoom auto-stopped silently). Click **End Recording** → recording stops and processes. (Optionally repeat and let it time out.)

- [ ] **Step 5: Teams regression — dialog instead of silent stop**

  1. Join/start a Teams meeting, start recording.
  2. Close the Teams meeting window.
  3. **Expected:** the "End the recording?" dialog appears; End Recording (or timeout) stops and processes.

- [ ] **Step 6: Browser-exit backstop — still immediate, no dialog**

  1. Join a Meet call in Chrome, start recording.
  2. Fully quit Chrome (close the whole browser / kill from taskbar — NOT just the tab).
  3. **Expected:** the recording stops IMMEDIATELY with NO dialog, and processes normally.

- [ ] **Step 7: Manual stop — still immediate, no dialog**

  1. Start any recording.
  2. Click Stop in the widget / app UI.
  3. **Expected:** stops immediately, NO dialog.

- [ ] **Step 8: Re-fire after Keep (no permanent suppression)**

  1. In a Meet call, start recording, trigger the dialog, click **Keep Recording**.
  2. Trigger another window-absent close later in the same call (close PiP / switch tabs again after the meeting was re-detected).
  3. **Expected:** the dialog appears AGAIN (Keep did not permanently suppress it).

- [ ] **Step 9: No sound**

  Throughout Steps 2-8, confirm the dialog plays no sound.

---

## Self-Review (completed by plan author)

**Spec coverage** (against the "REVISED 2026-07-10 evening" decision block):
1. Immediate re-probe before `meeting-closed`, all platforms → **Task 2.**
2. 10s "End the recording?" countdown dialog with End/Keep for ALL window-absent auto-stops (Zoom, Teams, Meet), replacing Meet's never-stop branch → **Task 1** (resolver flag + branch removal) + **Task 3** (dialog surface) + **Task 4** (wiring, timer, IPC).
3. No dialog for manual stop or browser-exit/process-death backstop → **Task 1** (`requiresConfirmation:false` for browser-exit; manual stop bypasses the resolver entirely) + **Task 4** (immediate `executeAutoStop`).
4. Zoom screen-share PID grace unchanged → **Task 2** preserves the Zoom process-liveness hold ahead of the re-probe verbatim.
5. No sound → dialog has no audio; **Task 5 Step 9** verifies.
6. Countdown authoritative in main, renderer only displays; Keep may re-fire; guard double-dialogs → **Task 4** (`beginStopConfirmation`/`finishStopConfirmation`, `pendingStopConfirmation` single-slot guard).
7. Renderer builds DOM via `textContent`, static HTML only → **Task 3** (`stopConfirm.js` uses `textContent`; `stopConfirm.html` static).

**Placeholder scan:** none — every code step contains full before/after code and exact commands.

**Type/name consistency:** `requiresConfirmation` used identically in resolver returns, tests, and the `main.js` branch. Function names consistent: `executeAutoStop`, `showStopConfirmWindow`, `beginStopConfirmation`, `finishStopConfirmation`. IPC channels consistent across preload/renderer/main: `confirm:end`, `confirm:keep`, `confirm:tick`. Webpack globals consistent: `STOP_CONFIRM_WEBPACK_ENTRY`, `STOP_CONFIRM_PRELOAD_WEBPACK_ENTRY` (forge entry name `stop_confirm`, ESLint globals, `main.js` usage all match).

**Ambiguity resolved:** the resolver cannot distinguish a Recall-SDK `meeting-closed` from a LocalProvider window-absence close, so the rule is uniform — `requiresConfirmation = (recordingToStop !== null && reason !== 'browser-exit')`. Manual stops never traverse this resolver, so they are never gated; this satisfies "dialog for all window-absent auto-stops; no dialog for manual/browser-exit."

---

## Note on the plan file

`docs/` is gitignored. If this plan should be committed, force-add it:

```bash
git add -f docs/superpowers/plans/2026-07-10-recording-stop-confirmation.md
git commit -m "docs: plan for recording stop-confirmation countdown

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
