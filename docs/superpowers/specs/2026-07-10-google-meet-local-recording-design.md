# Google Meet Local Recording — Design

**Date:** 2026-07-10
**Status:** Approved by JD (chat), pending spec review
**Branch:** v2.0

## Problem

Local recording (LocalProvider) detects meetings by enumerating windows and
matching Zoom/Teams title+process patterns. Google Meet runs in a Chrome tab,
so it is never detected: no widget, no auto-record, no local recording. JD
joins Meet in a normal Chrome tab and wants to keep doing so (no PWA).

Two structural differences from Zoom/Teams drive the design:
- The window title is the ACTIVE tab's title. Switching tabs mid-meeting makes
  the "Meet" title vanish even though the call continues — so title absence
  cannot mean "meeting ended".
- The browser process outlives every tab, so Zoom's PID-liveness grace check
  cannot detect the end either.

## Decisions (JD)

- Chrome tab workflow stays; no Meet PWA.
- Lifecycle: **auto-detect, manual stop.** Detection shows the widget and
  recording starts the same way as Zoom/Teams; the app never auto-stops a Meet
  recording based on the window, except the browser-exit backstop below.

## Design

### 1. Detection branch (`LocalProvider._parseMeetingFromTitle`)

Add a third branch after Zoom and Teams:
- Process name includes `chrome` or `msedge` (constant
  `BROWSER_PROCESS_NAMES = ['chrome', 'msedge']`).
- Window title matches `/^Meet [-–] /` — Meet's in-call and pre-join tab title
  is "Meet - <code or meeting name>" (hyphen or en-dash; the browser appends
  its own " - Google Chrome" suffix after). The bare landing page titled
  "Google Meet" must NOT match, nor must arbitrary tabs like a Doc named
  "Meet notes" (no dash after "Meet").
- Result: `platform: 'google-meet'` (display-name map in main.js already
  renders "Google Meet"), `windowId = "<processName>-<pid>"` as usual.

Polling, `meeting-detected` emission, and the widget flow are unchanged.
Pre-join lobby has the same title as in-call; that is acceptable because
recording starts only when JD clicks the widget button.

### 2. Lifecycle rules for `google-meet`

- `meeting-closed` (2 consecutive missed polls) still fires and still clears
  detection state / hides the widget — but the main.js handler must NOT
  auto-stop an active recording when the meeting's platform is `google-meet`.
  Tab-switching makes title absence meaningless for Meet.
- While a recording is active, re-detection of the same `windowId` must not
  spam the widget (existing `_meetingDetected` flag semantics; verify the
  hide/re-show path keeps the recording UI state coherent when the title
  reappears).
- **Browser-exit backstop:** while a `google-meet` recording is active,
  LocalProvider polls `_isProcessAlive(pid)` (existing helper) for the bound
  browser PID each detection cycle; if the browser process exits, emit the
  normal recording auto-stop path. Closing one tab does not exit the process —
  this backstop only covers "browser fully closed / crashed".
- Manual stop (widget / app UI) is the primary end signal, per JD.

### 3. Audio capture — unchanged pipeline, best-effort app track

Recording for Meet uses the exact Zoom/Teams path: mic solo track + WASAPI
system-loopback submix (Meet audio is present in the system mix regardless of
process topology) + best-effort `AppLoopbackCapture` bound to the detected
window's PID (Chrome's main process).

Open question resolved empirically during implementation (one task):
Chrome renders audio in a child utility process; whether the native
`application-loopback` module captures the process TREE (Windows
`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`) or the single PID is
undocumented and the binary is precompiled. The implementation task plays
audio in a Chrome tab, captures against the main PID, and checks for
non-silent PCM.
- If tree capture works: Meet gets the full isolation-track treatment.
- If not: the existing graceful fallback (system submix as the "app" track)
  applies, and the spec's limitation note lands in CLAUDE.md. Speaker ID is
  minimally affected either way — the Stage 1 track anchor derives primarily
  from the MIC solo track (mic = JD), which works for every platform.

### 4. Downstream — no changes required

Speaker waterfall (track anchor, voice profiles, Stage 3 content pass),
auto-summary, renaming, routing via speaker-mapping emails, and vault export
are all platform-agnostic. `platform: 'google-meet'` flows through existing
fields. Calendar correlation remains out of scope (unchanged from Zoom/Teams).

## Non-Goals

- No Chrome extension, no DevTools protocol, no calendar-driven detection.
- No audio-silence-based or grace-period auto-stop for Meet (JD chose manual).
- No PWA-specific handling.
- Other browsers (Firefox, Brave) — YAGNI; JD uses Chrome. Edge is included
  only because it costs one constant entry.

## Testing

- Unit (`tests/unit/` — LocalProvider parse logic is already pure enough or
  extract `_parseMeetingFromTitle` cases):
  - `chrome` + "Meet - abc-defg-hij - Google Chrome" → google-meet.
  - `chrome` + "Meet – Weekly Sync - Google Chrome" (en-dash) → google-meet.
  - `chrome` + "Google Meet - Google Chrome" (landing page) → null.
  - `chrome` + "Meet notes - Google Docs - Google Chrome" → null.
  - `msedge` variant → google-meet; `firefox` + Meet title → null.
  - Zoom/Teams cases unchanged (regression).
- Lifecycle unit test: `meeting-closed` for platform google-meet does not
  invoke the auto-stop path; browser-exit backstop does.
- Manual E2E (JD): join a real Meet in a Chrome tab → widget appears → record
  → switch tabs for >10s (recording continues, widget may hide) → return →
  hang up → click stop → transcript + speaker ID + routing all correct.
  Also: close Chrome entirely mid-recording → recording stops and finalizes.
