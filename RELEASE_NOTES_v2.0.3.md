# v2.0.3 Release Notes

## Highlights

Fixes the JD Audio Service path setting not surviving app restarts, and removes the hardcoded developer-machine path defaults that broke installs on other computers.

---

## AI Service Path Persistence

- **Path setting now survives restarts**: The `app:updateSettings` IPC handler applied `aiServicePath` and `aiServiceUrl` to the running service manager but never copied them into `appSettings`, so they were silently dropped from `app-settings.json` on save. Both are now persisted.
- **Settings UI keeps the entered value**: The AI Service Path input's change handler now saves to renderer localStorage (matching the URL and Local LLM inputs), so the field no longer reverts to a stale default after reopening the app.

## No More Hardcoded Dev Paths

- **`AIServiceManager` defaults to no path**: The fallback `C:\Users\brigh\...\jd-audio-service` path is gone. With no path configured, auto-launch fails fast with a clear log message pointing at Settings instead of complaining about a folder that only exists on the dev machine. A service already running at the configured URL still works without a path.
- **Renderer defaults cleaned up**: The settings default and input fallback no longer inject the dev path; the input placeholder is now generic (`C:\path\to\jd-audio-service`).

## Tests

- **3 new AIServiceManager tests**: default path is null, `ensureRunning` fails without spawning when unconfigured, and health-check success still short-circuits without a path.

---

## Files Changed

7 files changed, ~40 additions, ~9 deletions (net +31 lines)
