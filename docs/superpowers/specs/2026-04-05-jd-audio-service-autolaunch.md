# JD Audio Service Auto-Launch Design

## Goal

Automatically start the JD Audio Service when the user records with local transcription, so they never need to manually launch a separate app.

## Architecture

The Electron app manages the JD Audio Service as a child process. On recording start (when transcription provider is "local"), the app checks the service health endpoint. If unreachable, it spawns the service in headless mode (`--no-tray`), polls `/health` until ready, then proceeds. The service stays running until the Electron app quits.

## Behavior

### Auto-launch trigger
- User clicks Record AND `transcriptionProvider === 'local'`
- `GET /health` to configured `aiServiceUrl` (default `http://localhost:8374`)
- If healthy: proceed (service already running, e.g., user started it manually)
- If unreachable: spawn child process, poll `/health` every 500ms, timeout after 30 seconds

### Service lifecycle
- Spawned via `run-jd-audio-service.bat --no-tray` from the known path (`C:\Users\brigh\Documents\code\jd-audio-service`)
- The service path should be configurable in app settings (for portability)
- Child process reference stored in main process
- On Electron `app.quit` / `before-quit`: kill the child process (SIGTERM → SIGKILL fallback)
- If the service crashes mid-session, the next health check will detect it and re-launch

### What auto-launch does NOT do
- Does not auto-launch at app startup (only on recording start when local provider selected)
- Does not shut down the service on idle (models already auto-unload after 5min; the process is ~50MB idle)
- Does not manage the venv setup — assumes `run-jd-audio-service.bat` works (setup is a one-time manual step)

## UI Changes

### Settings panel (Service Endpoints section)
- Existing: URL input + health status indicator (Connected/Disconnected)
- Add: "Start" button next to status when disconnected (manual fallback)
- Add: "JD Audio Service Path" input field (default: `C:\Users\brigh\Documents\code\jd-audio-service`)
- Status transitions: "Disconnected" → "Starting..." → "Connected" (or "Failed to start" after timeout)

### Recording flow
- No visible change when service is already running
- When auto-launching: brief "Starting AI service..." message in the background task area (non-blocking — recording starts immediately, service just needs to be ready by the time transcription begins)

## Implementation Scope

### New file
- `src/main/services/aiServiceManager.js` — manages child process lifecycle, health polling, start/stop

### Modified files
- `src/main.js` — import aiServiceManager, call `ensureRunning()` in recording start path, kill on quit
- `src/index.html` — add Start button and service path input
- `src/renderer/settings.js` — wire Start button and path input
- `src/preload.js` — add `aiServiceStart` IPC bridge
- `src/main/validation/ipcSchemas.js` — schema for service path setting if needed

### Not modified
- JD Audio Service itself (no changes needed — `--no-tray` headless mode already exists)

## Error Handling

- Service path doesn't exist: show error in settings, don't attempt launch
- Service fails to start (bad venv, missing deps): timeout after 30s, show error toast, recording continues (transcription will fail later with a clear error)
- Service crashes during recording: transcription fails with "AI service unavailable" — user can restart via Settings button
- Port already in use: health check succeeds (something else is on 8374) — proceed normally

## Config

- `aiServicePath`: stored in `app-settings.json` (main process), default `C:\Users\brigh\Documents\code\jd-audio-service`
- `aiServiceUrl`: already exists, default `http://localhost:8374`
