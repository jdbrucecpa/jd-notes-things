# v1.4.0 Release Notes

## Highlights

This release replaces the file-based routing system with database-driven company management, adds a backup & restore service with incremental support, introduces an MCP server for Claude Desktop integration, adds calendar coverage reporting with placeholder creation, enables transcription re-runs from the meeting detail view, and delivers a comprehensive mock SDK testing infrastructure for the recording pipeline. The routing.yaml editor is replaced by a full company management UI with CRUD operations, contact syncing, and per-company vault folder configuration.

---

## Company Management (Replaces Routing Editor)

- **Database-driven routing**: The `RoutingEngine` no longer reads `routing.yaml`. Routing decisions are made by matching participant organization fields against the `clients` database table, with fallback to `client_contacts` email matching.
- **New `clientService`**: CRUD operations for companies — create, update, delete, and sync contacts from Google Contacts by organization name.
- **Settings UI**: The "Routing" tab is replaced with a "Clients" tab showing a searchable company list with add/edit/delete controls. Each company has a name, category (Client/Other), status, and configurable vault folder path.
- **Company detail view**: Clicking a company in the Contacts view opens a detail panel showing company info, associated contacts, and recent meeting history.
- **Database schema v3**: New `clients`, `client_contacts`, and `backup_log` tables. Migration from v2 adds a `category` column to `clients`.

## Backup & Restore

- **Full and incremental backups**: `backupService` creates ZIP archives containing the SQLite database, config files, and optionally audio recordings. Incremental backups include only files changed since the last backup.
- **Backup manifest**: The Settings → Backup tab shows database size, audio file count, and last backup date before creating a backup.
- **Restore with validation**: Restore flow validates the archive contents before applying, with toggleable options for database, config, and audio file restoration.
- **Backup logging**: All backup operations are logged in the `backup_log` database table with file counts and sizes.

## MCP Server for Claude Desktop

- **Standalone MCP server**: `src/mcp-server.js` runs as a separate Node.js process, exposing meeting data to Claude Desktop via the Model Context Protocol over stdio.
- **9 tools**: `search_meetings`, `get_meeting`, `get_transcript`, `list_companies`, `get_company`, `list_contacts`, `analyze_transcription`, `search_transcript`, and `get_meeting_stats`.
- **Read-only database access**: Opens the SQLite database in read-only mode with WAL journaling for safe concurrent access alongside the running Electron app.
- **Config generation**: The Settings → Security panel includes a "Claude Desktop (MCP)" section that generates the `claude_desktop_config.json` snippet with the correct paths.

## Calendar Coverage Reporting

- **Coverage report**: New IPC handler fetches Google Calendar events in a date range and cross-references them against the meetings database, returning coverage percentage, covered meetings, and uncovered events.
- **Reports UI**: The Reports view gains a Coverage tab with a progress bar and two lists — uncovered meetings (with "Create Placeholder" buttons) and covered meetings (with "Open" buttons).
- **Placeholder creation**: Uncovered calendar events can be turned into skeleton meeting records in the database, pre-populated with title, date, and attendee list from the calendar event.

## Transcription Re-run

- **Re-run button**: Meeting detail view adds a "Re-run Transcription" button that allows re-transcribing an existing recording with a different provider or settings.
- **Live UI refresh**: After re-transcription completes, the meeting detail view refreshes automatically via the `onMeetingUpdated` IPC event.

## Recording Pipeline Test Infrastructure

- **Mock Recall.ai SDK**: `tests/mocks/MockRecallSdk.js` provides a full mock of the Recall.ai Desktop SDK with configurable scenarios, event simulation with realistic timing, state inspection API, and error injection support.
- **Test scenarios**: JSON-defined scenarios in `tests/fixtures/scenarios/` (quick-solo-test, two-person-client-call) control participant counts, event sequences, and timing.
- **28 E2E tests**: `recording-pipeline.spec.js` covers widget lifecycle, mock SDK state verification, recording start/stop/pause, participant data integrity, transcript generation, audio file association, and error resilience.
- **Webpack integration**: `MOCK_SDK=1` environment variable triggers webpack aliasing of `@recallai/desktop-sdk` to the mock, with `npm run start:mock` and `npm run test:e2e:recording` scripts.

## Bug Fixes (Pre-launch Review)

- **MCP server imports**: Fixed `McpServer` and `StdioServerTransport` import paths — the SDK's `./server` export only provides `{ Server }`, not the high-level classes. Corrected to `./server/mcp.js` and `./server/stdio.js`.
- **routing:testEmails crash**: The handler referenced the removed `emailMatcher` property. Now uses `databaseService.matchEmailToClient()`.
- **routing:getAllDestinations empty**: The handler called `getConfig()` which returns a stub with empty `clients: {}`. Now uses the new `routingEngine.getDestinations()` method.
- **Company name missing from frontmatter**: `generateMeetingMarkdown` looked up company names via `getConfig()` stub. Now uses `route.organizationName` directly.
- **Auto-company page creation broken**: `autoCreateContactAndCompanyPages` had the same `getConfig()` stub issue. Now uses `route.organizationName` and looks up domains from the database.
- **originalName set to email**: Placeholder meeting creation set `originalName` to the participant's email when name was absent, violating the data model. Now uses `p.name || 'Unknown'`.
- **Migration error string mismatch**: The v1→v2 migration catch block checked for `'duplicate column'` but SQLite's error message is `'already has a column'`. Fixed to match the actual error text.
- **v2→v3 migration category overwrite**: The migration set `category = 'Client'` for all rows where `category = 'Other'`, overwriting deliberate choices. Now only sets category where `NULL`.
- **XSS in contacts error display**: Error messages in `contacts.js` were interpolated into `innerHTML` without `escapeHtml()`. Fixed.
- **Path traversal for absolute vault paths**: Absolute paths from company routing bypassed `VaultStructure` validation. Added check that resolved path is under the user's home directory.
- **MCP list_companies legacy field**: The tool displayed `c.type` (v1.3 legacy) instead of `c.category` (v1.4). Fixed to prefer `category`.
- **Orphaned JSDoc on getConfig()**: Two contradictory JSDoc blocks before the stub method. Consolidated with `@deprecated` tag.

---

## New Tests

### Unit Tests (Vitest)
| Suite | Tests | Coverage |
|-------|-------|----------|
| `mcp-server.test.js` | 3 | MCP server import validation, usage error, bad DB path |

### E2E Tests (Playwright)
| Suite | Tests | Coverage |
|-------|-------|----------|
| `app.spec.js` | 37 (+10) | Added: routing destinations, re-run button, originalName integrity, company picker, backup manifest, coverage IPC, MCP config, company detail, companies API, console errors |
| `recording-pipeline.spec.js` | 28 (new) | Widget lifecycle, mock SDK state, recording start/stop, participant tracking, data integrity, error resilience |

**Total test count**: 44 unit + 37 E2E (app) + 28 E2E (recording) = 109 tests

---

## Dependency Updates

### New Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `archiver` | ^7.0.1 | Streaming ZIP archive creation for backups |
| `@modelcontextprotocol/sdk` | ^1.x | MCP server SDK for Claude Desktop integration |

### New Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| (recording pipeline tests use existing Playwright + Vitest) | | |

---

## Files Changed

27 files changed, ~5,997 additions, ~1,148 deletions (net +4,849 lines)

### New Files
| File | Purpose |
|------|---------|
| `src/mcp-server.js` | Standalone MCP server for Claude Desktop |
| `src/main/services/backupService.js` | Full and incremental backup/restore |
| `src/main/services/clientService.js` | Company CRUD operations |
| `src/renderer/companyDetail.js` | Company detail view UI |
| `src/renderer/meetingDetail.js` | Meeting detail enhancements (re-run transcription) |
| `tests/mocks/MockRecallSdk.js` | Mock Recall.ai SDK for testing |
| `tests/e2e/recording-pipeline.spec.js` | Recording pipeline E2E tests |
| `tests/unit/mcp-server.test.js` | MCP server import/startup tests |
| `tests/fixtures/scenarios/*.json` | Test scenario definitions |
| `test_pragma.js` | Pragma comment auto-numbering utility |

### Deleted Files
| File | Reason |
|------|--------|
| `src/renderer/routing.js` | Replaced by company management UI in settings.js |
