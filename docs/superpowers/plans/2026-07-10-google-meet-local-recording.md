# Google Meet Local Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LocalProvider detect, widget-surface, and locally record Google Meet calls that run in a normal Chrome/Edge browser tab, with a lifecycle that never auto-stops on tab switches and only auto-stops when the browser process fully exits.

**Architecture:** Add a third branch to LocalProvider's pure title parser (`_parseMeetingFromTitle`) that recognizes a browser process hosting a `Meet - …` tab title and returns `platform: 'google-meet'`. Detection, widget, and the audio pipeline reuse the existing Zoom/Teams path unchanged. Meet's lifecycle differs on two axes — the tab title vanishes on tab switch (so window absence must NOT stop recording) and the browser outlives every tab (so Zoom's PID-liveness grace does not apply) — handled by (a) teaching the pure `resolveMeetingClosedTarget` resolver about `platform` + a `browser-exit` `reason`, and (b) a LocalProvider browser-exit backstop that watches the recording's captured browser PID each poll. App-audio isolation viability against Chrome's process tree is verified empirically by a standalone script; if it fails, the existing system-submix fallback already covers it.

**Tech Stack:** Electron main (`src/main.js`, `src/main/recording/LocalProvider.js`, `src/main/services/recordingAutoStopResolver.js`), PowerShell `EnumWindows` polling (unchanged), `application-loopback` native module (verification only), Vitest unit tests.

---

## File Structure

- `src/main/recording/LocalProvider.js` — add browser detection constants + Meet branch in `_parseMeetingFromTitle`; add `_recordingBrowserPid` state; add browser-exit backstop in `_pollForMeetings`. (Modify)
- `src/main/services/recordingAutoStopResolver.js` — extend the pure resolver with `platform` + `reason` so Meet's window-absence and browser-exit cases are decided in one testable place. (Modify)
- `src/main.js` — pass `platform` + `reason` into the resolver from the `meeting-closed` handler. (Modify)
- `tests/unit/LocalProvider.test.js` — Meet detection matrix + browser-exit backstop tests. (Modify)
- `tests/unit/recordingAutoStopResolver.test.js` — Meet lifecycle resolver tests. (Modify)
- `scripts/verify-meet-app-capture.js` — standalone empirical app-capture probe for Chrome tree capture. (Create)
- `CLAUDE.md` — update the stale "not Google Meet" note; conditionally add an app-track limitation note. (Modify)

## Baseline (verify before starting)

- `npx vitest run` → **318 passing**. (One `wasapiCapture` test can `EADDRINUSE` if the dev app is running — environmental, not a regression.)
- `npx eslint src/ tests/` → **zero warnings**. Must stay zero.
- **NEVER** kill running electron/ffmpeg processes.
- Repo quirk: `docs/` is gitignored, so committing this plan (or any doc under `docs/`) requires `git add -f`.

---

## Task 1: Google Meet detection branch

Add browser + Meet-title recognition to the pure `_parseMeetingFromTitle`. The function is already directly unit-testable (existing tests call `provider._parseMeetingFromTitle(...)`), so no extraction is needed.

**Files:**
- Modify: `src/main/recording/LocalProvider.js:23-25` (constants) and `src/main/recording/LocalProvider.js:550-563` (parser, insert Meet branch before the final `return null;`)
- Modify: `CLAUDE.md:215` (stale "not Google Meet" note)
- Test: `tests/unit/LocalProvider.test.js` (new `describe('Google Meet detection', …)`)

- [ ] **Step 1: Write the failing tests**

Add this block inside the top-level `describe('LocalProvider', …)` in `tests/unit/LocalProvider.test.js`, immediately after the existing `it('detectMeeting returns null for null title', …)` test (currently ending at line 61):

```javascript
  describe('Google Meet detection', () => {
    it('detects an in-call Chrome Meet tab (hyphen)', () => {
      const r = provider._parseMeetingFromTitle('Meet - abc-defg-hij - Google Chrome', 'chrome');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
      expect(r.title).toBe('Meet - abc-defg-hij - Google Chrome');
      expect(r.processName).toBe('chrome');
    });

    it('detects a named Chrome Meet tab with an en-dash', () => {
      const r = provider._parseMeetingFromTitle('Meet – Weekly Sync - Google Chrome', 'chrome');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
    });

    it('detects a Meet tab in Edge (msedge)', () => {
      const r = provider._parseMeetingFromTitle('Meet - xyz-abcd-efg - Work - Microsoft​ Edge', 'msedge');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
    });

    it('returns null for the bare Google Meet landing page', () => {
      const r = provider._parseMeetingFromTitle('Google Meet - Google Chrome', 'chrome');
      expect(r).toBeNull();
    });

    it('returns null for an unrelated "Meet notes" document tab', () => {
      const r = provider._parseMeetingFromTitle('Meet notes - Google Docs - Google Chrome', 'chrome');
      expect(r).toBeNull();
    });

    it('returns null for a Meet title in a non-Chrome/Edge browser (firefox)', () => {
      const r = provider._parseMeetingFromTitle('Meet - abc-defg-hij — Mozilla Firefox', 'firefox');
      expect(r).toBeNull();
    });

    it('does not regress Zoom/Teams parsing', () => {
      expect(provider._parseMeetingFromTitle('Zoom Meeting', 'zoom.exe').platform).toBe('zoom');
      expect(
        provider._parseMeetingFromTitle('Standup | Microsoft Teams', 'ms-teams.exe').platform
      ).toBe('teams');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/LocalProvider.test.js -t "Google Meet detection"`
Expected: FAIL — the Meet cases return `null` (no branch yet). The Zoom/Teams regression case passes.

- [ ] **Step 3: Add the detection constants**

In `src/main/recording/LocalProvider.js`, the current constants block reads:

```javascript
const ZOOM_TITLES = ['Zoom Meeting', 'Zoom Webinar'];
const TEAMS_TITLE_SUFFIX = '| Microsoft Teams';
const TEAMS_PROCESS_NAMES = ['ms-teams', 'teams'];
```

Replace it with:

```javascript
const ZOOM_TITLES = ['Zoom Meeting', 'Zoom Webinar'];
const TEAMS_TITLE_SUFFIX = '| Microsoft Teams';
const TEAMS_PROCESS_NAMES = ['ms-teams', 'teams'];

// Google Meet runs in a browser tab, so detection keys on the browser process
// plus the active tab title. Meet's in-call AND pre-join tab title is
// "Meet - <code or meeting name>" (hyphen or en-dash), to which the browser
// appends its own suffix (" - Google Chrome" / " - … Edge"). The anchored
// pattern deliberately excludes the bare landing page titled "Google Meet"
// (starts with "Google", not "Meet ") and unrelated tabs like a doc named
// "Meet notes" (no dash immediately after "Meet ").
const BROWSER_PROCESS_NAMES = ['chrome', 'msedge'];
const MEET_TITLE_PATTERN = /^Meet [-–] /;
```

- [ ] **Step 4: Add the Meet branch to `_parseMeetingFromTitle`**

The current tail of `_parseMeetingFromTitle` reads:

```javascript
    if (isTeamsProcess || hasTeamsSuffix) {
      // Exclude non-meeting windows (e.g. the main Teams shell with just "Microsoft Teams")
      if (hasTeamsSuffix && title.trim().toLowerCase() !== 'microsoft teams') {
        return { platform: 'teams', title, processName };
      }
    }

    return null;
  }
```

Replace it with:

```javascript
    if (isTeamsProcess || hasTeamsSuffix) {
      // Exclude non-meeting windows (e.g. the main Teams shell with just "Microsoft Teams")
      if (hasTeamsSuffix && title.trim().toLowerCase() !== 'microsoft teams') {
        return { platform: 'teams', title, processName };
      }
    }

    // --- Google Meet (Chrome / Edge tab) ---
    // Process: chrome / msedge (matched as a substring so a ".exe" suffix, if
    // any, still matches). Title: the active tab is a "Meet - …" call. The
    // anchored MEET_TITLE_PATTERN rejects the "Google Meet" landing page and
    // "Meet notes …" documents. Pre-join lobby shares the in-call title, which
    // is fine — recording only starts when the user clicks the widget button.
    const isBrowserProcess = BROWSER_PROCESS_NAMES.some(name => lowerProcess.includes(name));
    if (isBrowserProcess && MEET_TITLE_PATTERN.test(title)) {
      return { platform: 'google-meet', title, processName };
    }

    return null;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/LocalProvider.test.js`
Expected: PASS — all Meet cases and the Zoom/Teams regression pass; no existing test breaks.

- [ ] **Step 6: Correct the stale CLAUDE.md note**

`CLAUDE.md:215` currently reads:

```markdown
- **Local Recording:** FFmpeg WASAPI audio capture + window monitoring (Zoom/Teams only, not Google Meet)
```

Replace that line with:

```markdown
- **Local Recording:** FFmpeg WASAPI audio capture + window monitoring (Zoom, Teams, and Google Meet in a Chrome/Edge tab)
```

- [ ] **Step 7: Lint**

Run: `npx eslint src/ tests/`
Expected: zero warnings.

- [ ] **Step 8: Commit**

```bash
git add src/main/recording/LocalProvider.js tests/unit/LocalProvider.test.js CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(recording): detect Google Meet in Chrome/Edge tabs

Add a browser + "Meet - …" tab-title branch to LocalProvider's pure
title parser so Meet calls surface the widget and record via the
existing Zoom/Teams pipeline. Excludes the Google Meet landing page and
"Meet notes" docs.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Google Meet lifecycle (no tab-switch stop, browser-exit backstop)

Two coordinated changes: (a) the pure resolver learns Meet's rules so window-absence never stops a Meet recording while a full browser exit does, and (b) LocalProvider watches the recording's browser PID and emits a `browser-exit` `meeting-closed` when it dies.

### Task 2a: Teach the resolver about `platform` + `reason`

**Files:**
- Modify: `src/main/services/recordingAutoStopResolver.js:55` (signature) and insert two branches at the top of the body (before the existing "1. Direct match" comment)
- Modify: `src/main.js:2523-2530` (pass `platform` + `reason`)
- Test: `tests/unit/recordingAutoStopResolver.test.js`

- [ ] **Step 1: Write the failing resolver tests**

Append this block inside the top-level `describe('resolveMeetingClosedTarget', …)` in `tests/unit/recordingAutoStopResolver.test.js`, before its closing `});`:

```javascript
  describe('Google Meet lifecycle', () => {
    it('never stops a Meet recording on window absence (tab switch), but clears detection', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'chrome-1234',
        detectedWindowId: 'chrome-1234',
        activeRecordingKeys: ['C:\\rec\\recording-x.mp3'],
        platform: 'google-meet',
        reason: undefined,
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('google-meet-window-absent');
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
      expect(result.reason).toBe('direct-match');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/recordingAutoStopResolver.test.js -t "Google Meet lifecycle"`
Expected: FAIL — `google-meet-window-absent` / `browser-exit` reasons don't exist yet; the window-absence case currently resolves via `closed-was-detected` and returns `recordingToStop = 'C:\\rec\\recording-x.mp3'`.

- [ ] **Step 3: Extend the resolver**

The current signature and first comment in `src/main/services/recordingAutoStopResolver.js` read:

```javascript
function resolveMeetingClosedTarget({ sdkWindowId, detectedWindowId, activeRecordingKeys }) {
  // 1. Direct match: the SDK windowId is itself a tracked recording key.
  //    Auto-detect / createMeetingNoteAndRecord path.
```

Replace that with:

```javascript
function resolveMeetingClosedTarget({
  sdkWindowId,
  detectedWindowId,
  activeRecordingKeys,
  platform,
  reason,
}) {
  // 0a. Google Meet browser-exit backstop (LocalProvider). Meet runs in a
  //     browser tab whose title vanishes on a tab switch, so window absence can
  //     never mean "meeting ended". The sole automatic end signal is the host
  //     browser process fully exiting, which LocalProvider reports as
  //     reason === 'browser-exit'. Stop the sole active recording even if
  //     detection state was already cleared by an earlier window-absence close
  //     (a tab switch before the browser closed) — which would otherwise leave
  //     detectedWindowId null and fall through to 'unrelated-window-closed'.
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

  // 1. Direct match: the SDK windowId is itself a tracked recording key.
  //    Auto-detect / createMeetingNoteAndRecord path.
```

The rest of the function (branches 1, 2, 3 and the final unrelated-window return) is unchanged.

Also update the JSDoc `@param` block above the function to document the two new params. The current block ends with:

```javascript
 * @param {string[]} args.activeRecordingKeys
 *   `Object.keys(activeRecordings.getAll())` — recording keys currently
 *   tracked by the recording registry.
 *
 * @returns {{
```

Replace with:

```javascript
 * @param {string[]} args.activeRecordingKeys
 *   `Object.keys(activeRecordings.getAll())` — recording keys currently
 *   tracked by the recording registry.
 * @param {string|undefined} [args.platform]
 *   `detectedMeeting?.window?.platform`. When `'google-meet'`, window absence
 *   is a tab switch, not a meeting end, so no recording is auto-stopped.
 * @param {string|undefined} [args.reason]
 *   Provider-supplied close reason. LocalProvider sets `'browser-exit'` when the
 *   browser process hosting a Meet recording fully exits (the one automatic end
 *   signal for Meet). Absent for ordinary window-absence closes.
 *
 * @returns {{
```

- [ ] **Step 4: Pass `platform` + `reason` from the main.js handler**

The current code in `src/main.js` (inside the `recordingManager.on('meeting-closed', …)` handler) reads:

```javascript
    const sdkWindowId = data.windowId;
    const detectedWindowId = detectedMeeting?.window?.id;

    const decision = resolveMeetingClosedTarget({
      sdkWindowId,
      detectedWindowId,
      activeRecordingKeys: Object.keys(recordingManager.getActiveRecordings()),
    });
```

Replace it with:

```javascript
    const sdkWindowId = data.windowId;
    const detectedWindowId = detectedMeeting?.window?.id;
    // Google Meet lifecycle: LocalProvider tags a browser-exit backstop close
    // with reason 'browser-exit'; a plain window-absence close (tab switch) has
    // no reason. The resolver uses platform + reason to keep a Meet recording
    // running across tab switches and stop it only on a full browser exit.
    const detectedPlatform = detectedMeeting?.window?.platform;

    const decision = resolveMeetingClosedTarget({
      sdkWindowId,
      detectedWindowId,
      activeRecordingKeys: Object.keys(recordingManager.getActiveRecordings()),
      platform: detectedPlatform,
      reason: data.reason,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/recordingAutoStopResolver.test.js`
Expected: PASS — the new Meet lifecycle block passes and every pre-existing resolver test still passes (existing tests omit `platform`/`reason`, which are `undefined`, so branches 0a/0b are skipped).

- [ ] **Step 6: Lint**

Run: `npx eslint src/ tests/`
Expected: zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/recordingAutoStopResolver.js tests/unit/recordingAutoStopResolver.test.js src/main.js
git commit -m "$(cat <<'EOF'
feat(recording): resolver rules for Google Meet lifecycle

Teach resolveMeetingClosedTarget about platform + reason: a google-meet
window-absence (tab switch) never auto-stops the recording (detection
still clears), while a 'browser-exit' reason stops the sole active
recording even if detection was already cleared by an earlier tab switch.
main.js passes both fields from the meeting-closed handler.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

### Task 2b: LocalProvider browser-exit backstop + PID capture

**Files:**
- Modify: `src/main/recording/LocalProvider.js` — constructor (`~117`, add `_recordingBrowserPid`), `startRecording` (`~182`, capture PID), `_handleFfmpegClose` (`~335`, clear PID), `_pollForMeetings` (`~410`, backstop at top)
- Test: `tests/unit/LocalProvider.test.js`

- [ ] **Step 1: Write the failing backstop tests**

Add this block inside the top-level `describe('LocalProvider', …)` in `tests/unit/LocalProvider.test.js`, after the existing `describe('meeting detection close-debounce', …)` block:

```javascript
  describe('Google Meet browser-exit backstop', () => {
    it('emits meeting-closed with reason "browser-exit" when the recording browser PID dies', async () => {
      // Avoid a real PowerShell spawn if the poll continues past the backstop.
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(false);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = { windowId: 'chrome-4321', platform: 'google-meet' };

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith({ windowId: 'chrome-4321', reason: 'browser-exit' });
      expect(provider._recordingBrowserPid).toBeNull();
    });

    it('does not fire the backstop while the browser PID is still alive', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(true);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = { windowId: 'chrome-4321', platform: 'google-meet' };

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(provider._recordingBrowserPid).toBe(4321);
    });

    it('falls back to a synthetic browser-<pid> windowId when _activeMeeting was already cleared', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(false);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = null; // an earlier window-absence close cleared it

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).toHaveBeenCalledWith({ windowId: 'browser-4321', reason: 'browser-exit' });
    });

    it('does not run the backstop when not recording', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      const alive = vi.spyOn(provider, '_isProcessAlive');
      provider._recording = false;
      provider._recordingBrowserPid = 4321;

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(alive).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/LocalProvider.test.js -t "browser-exit backstop"`
Expected: FAIL — `_recordingBrowserPid` is `undefined` and no backstop exists, so `meeting-closed` never fires with `reason: 'browser-exit'`.

- [ ] **Step 3: Initialize `_recordingBrowserPid` in the constructor**

The current constructor tail (just before `this._recordingPath = …`) reads:

```javascript
    // Stop-sequence timings. FFmpeg's interactive 'q' quit is unreliable over a
    // piped stdin with live dshow + WASAPI named-pipe inputs, so stopRecording
    // force-kills if 'q' doesn't terminate FFmpeg within the grace window.
    this._gracefulQuitMs = 2500;
    this._forceKillMs = 1500;
    this._recordingPath = path.join(
```

Replace with:

```javascript
    // Stop-sequence timings. FFmpeg's interactive 'q' quit is unreliable over a
    // piped stdin with live dshow + WASAPI named-pipe inputs, so stopRecording
    // force-kills if 'q' doesn't terminate FFmpeg within the grace window.
    this._gracefulQuitMs = 2500;
    this._forceKillMs = 1500;
    // Browser PID for the active Google Meet recording, captured at start. Meet
    // has no window-based end signal (tabs switch, the browser outlives tabs),
    // so _pollForMeetings watches this PID and auto-stops only when the browser
    // process fully exits. Null for non-Meet recordings and when not recording.
    this._recordingBrowserPid = null;
    this._recordingPath = path.join(
```

- [ ] **Step 4: Capture the browser PID in `startRecording`**

The current code in `startRecording` reads:

```javascript
      let appTrackActive = false;
      const meetingPid = this._activeMeetingPid();
      if (meetingPid && AppLoopbackCapture.isAvailable()) {
```

Replace with:

```javascript
      let appTrackActive = false;
      const meetingPid = this._activeMeetingPid();
      // Google Meet browser-exit backstop: remember the browser PID for this
      // recording so _pollForMeetings can auto-stop when the browser process
      // exits. Only Meet needs this — Zoom/Teams end via their own window/PID
      // signals. Cleared in _handleFfmpegClose when the recording ends.
      this._recordingBrowserPid =
        this._activeMeeting?.platform === 'google-meet' ? meetingPid : null;
      if (meetingPid && AppLoopbackCapture.isAvailable()) {
```

- [ ] **Step 5: Clear the browser PID in `_handleFfmpegClose`**

The current head of `_handleFfmpegClose` reads:

```javascript
  async _handleFfmpegClose(recordingId, audioFilePath, code) {
    this._recording = false;
    this._ffmpegProcess = null;
    this._stopWasapiCaptures();
```

Replace with:

```javascript
  async _handleFfmpegClose(recordingId, audioFilePath, code) {
    this._recording = false;
    this._recordingBrowserPid = null;
    this._ffmpegProcess = null;
    this._stopWasapiCaptures();
```

- [ ] **Step 6: Add the backstop at the top of `_pollForMeetings`**

The current head of `_pollForMeetings` reads:

```javascript
  async _pollForMeetings() {
    let windows;
    try {
      windows = await this._getWindowList();
```

Replace with:

```javascript
  async _pollForMeetings() {
    // Google Meet browser-exit backstop. A Meet recording is never auto-stopped
    // by window/title absence (switching tabs hides the "Meet - …" title while
    // the call continues), so the only automatic end signal is the host browser
    // process fully exiting. Closing a single tab does NOT exit the process, so
    // this fires only on a full browser close/crash. Runs before the window scan
    // because _activeMeeting may already be null (an earlier tab-switch close
    // cleared it) while the recording — and its captured browser PID — live on.
    if (
      this._recording &&
      this._recordingBrowserPid &&
      !this._isProcessAlive(this._recordingBrowserPid)
    ) {
      const windowId = this._activeMeeting?.windowId || `browser-${this._recordingBrowserPid}`;
      log.info(
        `[LocalProvider] Browser process exited (pid=${this._recordingBrowserPid}) during Google Meet recording — auto-stopping`
      );
      this._recordingBrowserPid = null;
      this.emit('meeting-closed', { windowId, reason: 'browser-exit' });
      return;
    }

    let windows;
    try {
      windows = await this._getWindowList();
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/unit/LocalProvider.test.js`
Expected: PASS — the backstop block passes and every pre-existing LocalProvider test still passes.

- [ ] **Step 8: Verify re-detection during recording does not duplicate the widget (documentation + reasoning, no code change)**

No code change is needed for Task 2c. Confirm the existing behavior by reading, not editing:

Read `src/main.js` `meeting-detected` handler (~2478-2505). The auto-show widget guard is:

```javascript
    if (showWidgetOnDetection && !recordingManager?.isRecording) {
```

Because `recordingManager.isRecording` is `true` throughout a Meet recording, re-detection after a tab switches back (LocalProvider re-emits `meeting-detected` once `_meetingDetected` was reset by the earlier window-absence close) does NOT re-pop the widget. The recording continues; the widget stays hidden until manual stop or browser-exit. Add a one-line confirmation to the PR/commit body — no test, since the guard lives in the Electron closure and is exercised by the Task 4 manual E2E ("switch tabs → return → recording continues").

- [ ] **Step 9: Lint**

Run: `npx eslint src/ tests/`
Expected: zero warnings.

- [ ] **Step 10: Commit**

```bash
git add src/main/recording/LocalProvider.js tests/unit/LocalProvider.test.js
git commit -m "$(cat <<'EOF'
feat(recording): browser-exit backstop for Google Meet recordings

Capture the Meet recording's browser PID at start and watch it each poll;
when the browser process fully exits, emit meeting-closed with
reason 'browser-exit' so the resolver auto-stops the recording. Tab
switches (window/title absence) never stop a Meet recording. Existing
!isRecording widget guard already prevents duplicate widgets on
re-detection.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Empirical app-capture verification (Chrome process-tree)

Resolve the spec's open question: does the precompiled `application-loopback` module capture Chrome's whole process TREE when bound to Chrome's MAIN PID (audio actually renders in a child utility process), or only the single PID? This task's deliverable is a complete, runnable probe script; JD runs it and records the outcome.

**Files:**
- Create: `scripts/verify-meet-app-capture.js`
- Conditionally modify: `CLAUDE.md` (add a limitation note only if capture is silent)

- [ ] **Step 1: Create the probe script**

Create `scripts/verify-meet-app-capture.js` with exactly this content:

```javascript
'use strict';

// scripts/verify-meet-app-capture.js
// Usage: node scripts/verify-meet-app-capture.js <chrome-main-pid> [seconds]
//
// Empirically answers the open question in the Google Meet local-recording spec:
// does the precompiled application-loopback native module capture Chrome's whole
// PROCESS TREE (audio actually renders in a child utility/renderer process) when
// bound to Chrome's MAIN process PID, or only the single PID?
//
// HOW TO RUN
//   1. Open Chrome and play continuous audible audio in a tab (e.g. an unmuted
//      YouTube video, volume up). A live Meet call also works.
//   2. Find Chrome's MAIN process PID (the parent browser process, not a
//      renderer). In PowerShell the earliest-started chrome.exe is the parent:
//        Get-Process chrome | Sort-Object StartTime | Select-Object -First 1 Id, StartTime
//   3. node scripts/verify-meet-app-capture.js <that-pid> 8
//
// INTERPRETING RESULTS
//   NON-SILENT  -> tree capture WORKS. Meet gets the full app-isolation track
//                  against the main Chrome PID. No code change needed.
//   SILENT      -> single-PID capture only. The main Chrome PID renders no audio,
//                  so LocalProvider's existing system-submix fallback covers the
//                  app track. Add the CLAUDE.md limitation note (Task 3 Step 3).

const { startAudioCapture, stopAudioCapture } = require('application-loopback');

const pid = process.argv[2];
const seconds = Number(process.argv[3] || 8);
if (!pid) {
  console.error('Usage: node scripts/verify-meet-app-capture.js <chrome-main-pid> [seconds]');
  process.exit(1);
}

// application-loopback emits 48 kHz / 2ch / 16-bit signed PCM (format confirmed
// from upstream C++ in src/main/recording/AppLoopbackCapture.js) and emits
// NOTHING during silence (buffers below -70 dB are skipped by the native binary).
// So a total absence of bytes is itself the "silent" signal; when bytes DO
// arrive we compute RMS to confirm they carry real signal, not a faint tick.
let totalBytes = 0;
let sumSquares = 0;
let sampleCount = 0;
let peak = 0;

startAudioCapture(String(pid), {
  onData: (chunk) => {
    totalBytes += chunk.length;
    const buf = Buffer.from(chunk);
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const s = buf.readInt16LE(i);
      sumSquares += s * s;
      sampleCount += 1;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
  },
});

console.log(`Capturing pid=${pid} for ${seconds}s — make sure audio is PLAYING in a Chrome tab...`);

setTimeout(() => {
  try {
    stopAudioCapture(String(pid));
  } catch {
    /* already stopped */
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const rmsDbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak / 32768) : -Infinity;
  console.log('--- result ---');
  console.log(`bytes captured : ${totalBytes}`);
  console.log(`samples        : ${sampleCount}`);
  console.log(`RMS            : ${rms.toFixed(1)} (${rmsDbfs.toFixed(1)} dBFS)`);
  console.log(`peak           : ${peak} (${peakDbfs.toFixed(1)} dBFS)`);
  // -50 dBFS RMS is a generous noise floor: real playback sits well above it,
  // true silence (no bytes) sits at -Infinity.
  const NONSILENT_RMS_DBFS = -50;
  if (totalBytes > 0 && rmsDbfs > NONSILENT_RMS_DBFS) {
    console.log('\nVERDICT: NON-SILENT audio captured from the main Chrome PID.');
    console.log('=> Tree capture WORKS. Meet app-isolation track is viable. No code change needed.');
  } else {
    console.log('\nVERDICT: SILENT (no meaningful audio from the main Chrome PID).');
    console.log('=> Single-PID capture only. Meet app track falls back to the system submix');
    console.log('   (already handled in LocalProvider). Add the CLAUDE.md v2.0 limitation note.');
  }
  process.exit(0);
}, seconds * 1000);
```

- [ ] **Step 2: Lint the script, then run it manually (JD)**

Run: `npx eslint scripts/verify-meet-app-capture.js`
Expected: zero warnings.

Then, with audio playing in a Chrome tab and Chrome's main PID in hand:
Run: `node scripts/verify-meet-app-capture.js <chrome-main-pid> 8`
Record the printed VERDICT. Do not kill any running Chrome/Electron/ffmpeg processes.

- [ ] **Step 3: Conditional CLAUDE.md limitation note (only if VERDICT is SILENT)**

If — and only if — the script reports SILENT, add a limitation note to the `## v2.0 Local Recording (verified working …)` section of `CLAUDE.md`. Append this bullet at the end of that section:

```markdown
- **Google Meet app-isolation track:** empirically (`scripts/verify-meet-app-capture.js`), `application-loopback` bound to Chrome's MAIN PID captures SILENCE — Chrome renders Meet audio in a child utility process and the precompiled binary does not capture the process tree. Meet recordings therefore use the WASAPI system-submix as the "app" track (existing LocalProvider fallback). Speaker ID is unaffected: the Stage 1 track anchor derives from the MIC solo track (mic = JD).
```

If the VERDICT is NON-SILENT, make no CLAUDE.md change — the app track works as-is.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-meet-app-capture.js
# If the SILENT branch fired and CLAUDE.md was edited, also:  git add CLAUDE.md
git commit -m "$(cat <<'EOF'
chore(recording): app-capture verification probe for Chrome tree capture

Standalone script that binds application-loopback to a Chrome main PID
while audio plays and reports RMS/non-silence, resolving the spec's open
question about process-tree vs single-PID capture. CLAUDE.md limitation
note added only if capture is silent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual E2E + full-suite/lint verification

Final gate: the automated suite is green, lint is clean, and JD walks the real Meet flow from the spec's Testing section.

**Files:** none (verification only; the plan file itself is committed here with `git add -f`).

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all prior tests plus the new Meet detection, resolver-lifecycle, and backstop tests pass. Baseline was 318 passing; this plan adds Task 1 (7 detection tests), Task 2a (5 resolver tests), Task 2b (4 backstop tests) → expect **~334 passing**. (A single `wasapiCapture` `EADDRINUSE` failure is environmental — only if the dev app is running — not a regression.)

- [ ] **Step 2: Run lint**

Run: `npx eslint src/ tests/ scripts/`
Expected: zero warnings.

- [ ] **Step 3: Manual E2E checklist (JD, dev build only)**

Per the CLAUDE.md dev/packaged confound: quit the installed app first, then `npm start` and run only the red-tray dev build. Walk each step and check it off:

  - [ ] Join a real Google Meet in a normal Chrome tab → within ~2-4s the app shows a "Google Meet meeting detected" toast and the recording widget appears.
  - [ ] Click record on the widget → recording starts (widget shows recording state; `[LocalProvider] Spawning FFmpeg` appears in `%APPDATA%/jd-notes-things/logs/main.log`).
  - [ ] Switch to another Chrome tab (or another app) for >10s so the "Meet - …" title is gone → recording CONTINUES (FFmpeg still running; no `recording-ended`). The widget may hide.
  - [ ] Switch back to the Meet tab → no duplicate widget pops; recording still running.
  - [ ] Hang up the Meet call but keep the tab/Chrome open → recording still running (manual-stop lifecycle; Meet does not auto-stop on hang-up).
  - [ ] Click stop (widget or main app UI) → recording finalizes; transcript, speaker ID, and routing are all correct on the produced note.
  - [ ] Separately: start a new Meet recording, then CLOSE Chrome entirely mid-recording → within ~2s the recording auto-stops and finalizes (browser-exit backstop; log shows `Browser process exited (pid=…) during Google Meet recording — auto-stopping`).
  - [ ] Regression: a Zoom and a Teams meeting each still detect, record, and auto-stop on meeting end exactly as before.

- [ ] **Step 4: Commit the plan (docs/ is gitignored → force-add)**

```bash
git add -f docs/superpowers/plans/2026-07-10-google-meet-local-recording.md
git commit -m "$(cat <<'EOF'
docs(recording): Google Meet local recording implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Detection branch (spec §1) → Task 1: `BROWSER_PROCESS_NAMES`, `MEET_TITLE_PATTERN`, third branch → `platform: 'google-meet'`, full test matrix (hyphen, en-dash, landing page null, "Meet notes" null, msedge match, firefox null, Zoom/Teams regression).
- Lifecycle: no tab-switch auto-stop (spec §2 bullet 1) → Task 2a resolver `google-meet-window-absent` + main.js wiring.
- Browser-exit backstop (spec §2 bullet 3) → Task 2b `_recordingBrowserPid` + `_pollForMeetings` backstop → `reason: 'browser-exit'`, resolved by Task 2a `browser-exit` branch.
- No widget duplication on re-detection (spec §2 bullet 2) → Task 2b Step 8 documents the existing `!isRecording` guard; exercised by Task 4 manual E2E.
- Audio pipeline unchanged + empirical app-capture question (spec §3) → Task 3 probe script + conditional CLAUDE.md note; fallback already in LocalProvider.
- Downstream no changes (spec §4) → nothing to do; `platform: 'google-meet'` flows through existing fields (main.js `platformNames` already maps it).
- Testing (spec Testing) → Task 1/2 unit matrices; Task 4 manual E2E mirrors the spec's E2E script incl. "close Chrome entirely mid-recording".

**Placeholder scan:** No TBD/TODO/"similar to Task N"; every code step shows complete before/after code; every command has expected output.

**Type consistency:** `_recordingBrowserPid` (constructor/startRecording/_handleFfmpegClose/_pollForMeetings), `reason: 'browser-exit'` and `platform: 'google-meet'` strings, resolver param names `platform`/`reason`, and reason tags (`google-meet-window-absent`, `browser-exit`, `browser-exit-no-active-recordings`, `browser-exit-multiple-active-recordings`) are used identically across LocalProvider, the resolver, and both test files.
