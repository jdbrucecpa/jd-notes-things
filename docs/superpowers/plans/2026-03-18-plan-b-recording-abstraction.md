# Plan B: Recording Layer Abstraction — Decision Document

> **Status:** Not yet implemented. Detailed task plan to be written when Plan A is complete.
> **Depends on:** Plan A (JD Audio Service) being built and runnable.
> **Spec:** `docs/superpowers/specs/2026-03-18-v2-local-first-design.md` — Component 2

**Goal:** Extract the recording system from main.js into a clean provider abstraction, enabling local recording alongside the existing Recall.ai SDK.

---

## Scope

This is the riskiest refactor — it touches the 12K-line `main.js` file where ~800 lines of Recall.ai SDK event handlers, state tracking, and recording lifecycle are deeply entangled with the rest of the app.

## Key Decisions Made During Design

### 1. Two-class split: RecordingManager + RecordingProvider

- **RecordingManager** (new, extracted from main.js) — owns: active recording tracking, meeting-to-note association, widget/tray UI updates, calendar integration, auto-start logic. Shared between both providers.
- **RecordingProvider** (interface) — owns: meeting detection, audio capture, recording lifecycle, provider-specific state. Two implementations: RecallProvider and LocalProvider.
- The orchestrator (RecordingManager) listens to provider events and coordinates the rest of the app.

### 2. RecallProvider preserves all existing behavior

- All existing Recall.ai SDK code moves into RecallProvider class — same behavior, just behind the interface.
- Recall-specific concerns (upload tokens, SDK restart workaround, `prepareDesktopAudioRecording()`) stay inside the class.
- No functional changes to Recall mode — this is a pure refactor.

### 3. LocalProvider: Window monitoring + FFmpeg

- **Meeting detection:** PowerShell polling every 2s for Zoom/Teams window titles.
  - Zoom: substring match on `"Zoom Meeting"` / `"Zoom Webinar"` in title.
  - Teams: `" | Microsoft Teams"` suffix match + `ms-teams.exe` process name.
  - Google Meet: NOT supported in local mode (browser tab detection unreliable, <10% usage).
- **Audio capture:** FFmpeg with WASAPI loopback (`dshow` device). Enumerate loopback device at startup via `ffmpeg -list_devices`. Stop by sending `q` to FFmpeg stdin.
- **Recording lifecycle:** FFmpeg exits and flushes → Electron verifies file → transcription begins.
- **No real-time participant events.** Participants resolved post-meeting from calendar + voice profiles.

### 4. server.js split

- `server.js` currently hosts both webhook routes AND Stream Deck WebSocket support.
- **Webhook routes, localtunnel, Svix** — removed (dead code, only consumer was broken Recall.ai transcription).
- **Stream Deck WebSocket** — moved to new `src/main/services/streamDeckService.js`.

### 5. Provider selection requires app restart

- Recording provider initializes OS-level resources at startup.
- Transcription and LLM providers continue to hot-swap without restart.

## Tasks (to be detailed in full plan)

1. Create RecordingProvider interface (EventEmitter base class)
2. Extract RecallProvider from main.js (pure refactor, no behavior changes)
3. Create RecordingManager orchestrator (extract shared logic from main.js)
4. Wire RecallProvider through RecordingManager (verify existing behavior preserved)
5. Split server.js — move Stream Deck to streamDeckService.js, remove webhook code
6. Implement LocalProvider: window monitoring service
7. Implement LocalProvider: FFmpeg audio capture
8. Implement LocalProvider: recording lifecycle (detect → record → stop → verify)
9. Add provider selection to settings (UI + localStorage + app startup logic)
10. Test: verify Recall mode still works identically after refactor
11. Test: verify Local mode detects Zoom/Teams and produces valid MP3

## Risk Mitigation

- **main.js is 12K lines.** The refactor must be incremental — extract one piece at a time, test after each extraction, never leave main.js in a broken state.
- **Recall mode must keep working.** Every commit should pass the existing E2E test suite. No "break to rebuild" allowed.
- **FFmpeg WASAPI loopback may need fallback.** If loopback device isn't available, document virtual audio cable as alternative in setup guide.
