# v1.2.6 Release Notes

## Highlights

This release fixes false-positive speaker matching, adds AssemblyAI speaker identification short-circuiting, and includes a comprehensive code review that eliminated 17 lint warnings, fixed 5 critical bugs, patched 5 security issues, plugged 4 memory leaks, and removed ~600 lines of dead code. All 24 updatable dependencies have been brought to their latest versions.

---

## Speaker Identification Improvements

- **AssemblyAI short-circuit**: When AssemblyAI's `speech_understanding` returns real speaker names (not generic "Speaker A" labels), the speaker matcher now uses them directly — skipping heuristic matching entirely. This produces faster, more accurate transcripts.
- **Strict name matching**: Eliminated false-positive name matches (e.g., "Ed" no longer matches to "Fred"). The matcher now requires exact name matches instead of fuzzy/substring matching.
- **SDK timestamp drift fix**: Speech timeline segments now use `Math.max()` guards to prevent negative timestamp offsets when SDK timestamps drift.
- **Email source tracking**: Speaker mapping now tracks where each email came from (`participant-data`, `contact-lookup`, `contact-name-search`) and downgrades confidence to `medium` when emails are inferred from contacts rather than provided directly.
- **Broader contact fallback**: Restored `findContactByName` as a fallback for speakers not found in participant emails, improving match rates for meetings where participant emails aren't available.
- **Host fallback**: Heuristics 2 and 3 now fall back to `participants[0]`/`participants[1]` when no participant has `isHost` set.

## Bug Fixes

- **`pollRecallAITranscript` argument ordering**: Fixed `meetingId` being passed as `windowId` (3rd arg) instead of the correct 4th arg, which caused meeting ID to be undefined during Recall.ai transcript polling.
- **`navigate` IPC handler re-registration**: Moved the handler from inside `createWindow()` to module level, preventing duplicate listener registration on window recreation.
- **Widget IPC timeout leaks**: All three widget recording handlers (start, resume, stop) now properly clean up `ipcMain.once` listeners when the 30-second timeout fires, preventing listener accumulation.
- **`pollRecallAITranscript` infinite loop**: Added `MAX_POLL_ATTEMPTS = 120` to replace the unbounded `while(true)` polling loop, ensuring transcription polling times out after 10 minutes.
- **`contacts:getMeetingsForContact` race condition**: Replaced raw `fs.readFileSync` with `fileOperationManager.scheduleOperation` to prevent stale reads when concurrent writes are queued.
- **`contacts:rematchParticipants` validation**: Wrapped handler with `withValidation(stringIdSchema)` to reject malformed IPC data.
- **Deduplication fallback**: Changed participant deduplication to use `originalName` (immutable) instead of `name` (which may be corrupted by contact matching).

## Security Hardening

- **Content Security Policy**: Added CSP `<meta>` headers to both `index.html` and `note-editor/index.html`. The main window restricts scripts to `'self'`, styles to `'self' 'unsafe-inline'` (required by webpack's `style-loader`), and connections to `'self' https:`.
- **External URL whitelist**: Added `ALLOWED_EXTERNAL_PROTOCOLS` (`https:`, `http:`, `zoommtg:`, `msteams:`, `tel:`, `mailto:`) with `new URL()` parsing to block arbitrary protocol handler exploitation via `shell.openExternal`.
- **XSS fixes**: Added `escapeHtml` sanitization to dynamic content in `routing.js`, `templates.js`, and `settings.js` to prevent XSS via user-supplied vocabulary terms, template names, and error messages.
- **Inline event handler removal**: Replaced all `onclick="..."` attributes in `securitySettings.js` with delegated event listeners via `data-action` attributes, eliminating inline script execution vectors.
- **Dead CDN dependency removed**: Removed unused SimpleMDE `<script>` and `<link>` tags from the note-editor page that were loading from `cdn.jsdelivr.net` despite the editor integration being commented out.

## Memory Leak Fixes

- **`mainWindow` null on close**: Added `mainWindow.on('closed')` handler to null out references, preventing stale `BrowserWindow` access.
- **`speechTimelines` cleanup**: Added `cleanupSpeechTimeline(windowId)` to the speaker matching error path, preventing timeline data from accumulating when matching fails.
- **Tunnel reconnect timer**: `tunnelManager.stop()` now clears the stored reconnect timer, preventing orphaned `setTimeout` callbacks after tunnel shutdown.
- **Background task cleanup timers**: `backgroundTaskManager` now stores timer IDs on task objects (`task._cleanupTimer`) and clears them in `removeTask()`, preventing timer leaks when tasks are removed early.

## Code Quality

- **Named constants**: Extracted 26 magic numbers into named constants in `shared/constants.js` — timeouts (`IPC_RESPONSE_TIMEOUT_MS`, `RECALL_API_TIMEOUT_MS`, etc.), delays (`SDK_INIT_DELAY_MS`, `FILE_WRITE_GRACE_MS`, etc.), and limits (`LLM_SECTION_MAX_TOKENS`, `LOG_ENTRIES_DEFAULT_LIMIT`, etc.).
- **Recall credential deduplication**: Extracted `getRecallCredentials()` helper, replacing 8 duplicate credential lookup blocks in `main.js`.
- **Tray menu consolidation**: Created `buildTrayMenu(isRecording)` function, eliminating ~150 lines of duplication between `createSystemTray()` and `updateSystemTrayMenu()`.
- **Streaming audio uploads**: Switched `transcriptionService.js` from `fs.readFileSync` to `fs.createReadStream` for both AssemblyAI and Deepgram uploads, reducing peak memory usage for large audio files.
- **Dead code removal**: Removed ~600 lines of unused functions and variables: `getCurrentUserIdentity`, `fuzzyNameMatch`, `updateTrayMenu`, `matchSpeakersToParticipants`, `pollForUploadCompletion`, `processTranscriptData`, `_isTranscriptFile`, `windowSpeakerLabels`, `_actualConcurrency`, `extractMeetingPurpose`, `slugifyForFilename`, and the `update-electron-app` dependency.
- **Zero lint warnings**: Fixed all 17 ESLint warnings across the codebase (unused variables, catch bindings, dead imports). Added `caughtErrorsIgnorePattern: '^_'` to ESLint config for proper catch clause handling.

## Dependency Updates

### Core SDKs
| Package | From | To |
|---------|------|----|
| `@recallai/desktop-sdk` | 2.0.4 | 2.0.6 |
| `@anthropic-ai/sdk` | 0.71.2 | 0.78.0 |
| `openai` | 6.8.1 | 6.25.0 |
| `googleapis` | 167.0.0 | 171.4.0 |

### Runtime Dependencies
| Package | From | To |
|---------|------|----|
| `axios` | 1.9.0 | 1.13.5 |
| `dotenv` | 17.2.3 | 17.3.1 |
| `lru-cache` | 11.2.2 | 11.2.6 |
| `marked` | 17.0.1 | 17.0.3 |
| `react` | 19.1.0 | 19.2.4 |
| `react-dom` | 19.1.0 | 19.2.4 |
| `svix` | 1.41.0 | 1.86.0 |
| `zod` | 4.1.12 | 4.3.6 |

### Dev Dependencies
| Package | From | To |
|---------|------|----|
| `electron` | 39.1.1 | 39.6.1 |
| `@electron-forge/*` (8 packages) | 7.10.2 | 7.11.1 |
| `eslint` | 9.39.1 | 9.39.3 |
| `@eslint/js` | 9.39.1 | 9.39.3 |
| `prettier` | 3.6.2 | 3.8.1 |
| `css-loader` | 7.1.2 | 7.1.4 |
| `eslint-plugin-no-unsanitized` | 4.1.4 | 4.1.5 |

### Removed
- `update-electron-app` (unused)

### Notable SDK Changes
- **Recall SDK 2.0.6**: Fixes `recording-ended` event not firing on Windows; adds Chrome 145+ compatibility, auto mic detection, reduced CPU usage.
- **Anthropic SDK 0.78.0**: Memory leak fixes for streaming, top-level automatic caching support, Claude Opus 4.6 / Sonnet 4.6 model support.
- **OpenAI SDK 6.25.0**: New features for function call outputs and responses API.
- **googleapis 171.4.0**: Updated API surface area; no breaking changes for Calendar v3 or People v1.

---

## Files Changed

21 files changed, ~1,167 additions, ~1,572 deletions (net -405 lines)

## Known Intentionally Held-Back Dependencies

| Package | Current | Available | Reason |
|---------|---------|-----------|--------|
| `electron` | 39.6.1 | 40.6.1 | Node 24 jump requires keytar rebuild; planned for v1.2.7 |
| `eslint` | 9.39.3 | 10.0.2 | `eslint-plugin-react` has no ESLint 10-compatible release yet |
| `eslint-plugin-security` | 3.0.1 | 4.0.0 | Requires ESLint 10 |
| `globals` | 16.5.0 | 17.3.0 | Tied to ESLint 10 ecosystem |
