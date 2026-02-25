# v1.2.4 Release Notes

## Highlights

Major feature release adding OCRM integration with dual-path file storage and a CRM request queue, a background task management system with real-time UI panel, a custom in-app auto-updater banner, and 6 bug fixes. The `CrmRequestQueue` enables reliable meeting data delivery to the obsidian-crm plugin, while `BackgroundTaskManager` provides progress tracking for all long-running operations.

---

## OCRM Integration

- **Dual-path file storage**: `VaultStructure` and `RoutingEngine` now support writing meeting notes to both the Obsidian vault path and a CRM-specific path simultaneously via `appSettings.crmIntegration.pathStructure`. Configurable via `crmIntegration` settings block with `enabled`, `pathStructure`, `useRequestQueue`, `waitForAck`, and `ackTimeoutMs` options.
- **`CrmRequestQueue`** (`src/main/export/CrmRequestQueue.js`): New 319-line service that writes structured JSON request files to `.crm/requests/` for the obsidian-crm plugin to process. Supports request types: `meeting`, `create-contact`, `create-company`, `update-contact`, `update-company`. Includes `generateRequestId()`, `writeRequest()`, `checkAcknowledgment()` with configurable timeout, and `getPendingRequests()` for queue inspection.
- **Export integration**: `exportMeetingToObsidian()` now writes CRM meeting requests after Obsidian export when `crmIntegration.enabled` and `crmIntegration.useRequestQueue` are true. CRM errors are non-blocking — they log warnings but don't fail the export.
- **Settings provider pattern**: Both `VaultStructure` and `RoutingEngine` now accept a `setSettingsProvider()` callback for accessing `appSettings.crmIntegration` without circular dependencies.

## Background Task Management

- **`BackgroundTaskManager`** (`src/main/services/backgroundTaskManager.js`): New 252-line singleton service for tracking long-running operations with `addTask()`, `updateTask()`, `completeTask()`, `failTask()`, and `cancelTask()`. Tasks auto-cleanup after 30 seconds (completed) or 60 seconds (failed). Emits real-time IPC events (`background:task-started`, `background:task-updated`, `background:task-completed`) to the renderer.
- **`BackgroundTasksPanel`** (`src/renderer/components/BackgroundTasksPanel.js`): New 339-line renderer component displaying active and completed tasks with progress bars, status badges, elapsed time, and cancel buttons. Includes notification badge on the sidebar toggle.
- **Summary generation refactor**: `generateMeetingSummary` IPC handler refactored from blocking to non-blocking — now creates a background task, returns immediately with `taskId`, and streams progress updates to the UI.
- **IPC handlers**: Added `background:getTasks` and `background:cancelTask` IPC endpoints with preload bridge.

## Custom Update Banner

- **In-app update notifications**: Replaced Electron's default `notifyUser: true` popup dialog with `notifyUser: false` and custom `autoUpdater` event handlers (`checking-for-update`, `update-available`, `update-downloaded`, `error`). State changes are sent to the renderer via `update-state-changed` IPC.
- **`fetchLatestReleaseInfo()`**: New function that fetches release notes from the GitHub Releases API (`api.github.com/repos/jdbrucecpa/jd-notes-things/releases/latest`) for display in the update banner.
- **`settings:installUpdate` handler**: New IPC handler that sets `app.isQuitting = true` before calling `autoUpdater.quitAndInstall()`, preventing the `close` handler from intercepting and hiding to tray.

## Bug Fixes

- **Regenerate Summary button**: Moved from all tabs to Executive Summary tab only via `meetingDetail.js` restructure.
- **Google Calendar Zoom detection**: `GoogleCalendar.js` now detects Zoom meetings created via the Google Calendar dropdown menu (previously only detected direct Zoom links).
- **Organization creation validation**: Fixed type validation error in the Generate window when creating organizations.
- **Recording button tooltip**: Now correctly shows "Stop Recording" while recording is active.
- **Pulse animation**: Removed unnecessary pulse animation from the Google connection indicator.
- **`.env` migration UI**: Removed the now-obsolete `.env` migration interface from `securitySettings.js` (~55 lines removed).

---

## Files Changed

16 files changed, +2,464 insertions, -280 deletions
