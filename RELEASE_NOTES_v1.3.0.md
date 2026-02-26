# v1.3.0 Release Notes

## Highlights

This release replaces the JSON file-based meeting store with a SQLite database, adds Gmail integration for viewing recent email threads per contact, introduces a transcript export system (single and batch), upgrades Google OAuth scopes from read-only to read/write for Calendar and Contacts, adds a Reports view for finding gaps between calendar events and recordings, and migrates API key storage from the deprecated `keytar` library to Electron's built-in `safeStorage`. A new testing infrastructure (Vitest + Playwright) covers 52+ test cases across unit and E2E suites.

---

## SQLite Database Migration

- **`meetings.json` → SQLite**: All meeting data is now stored in a local SQLite database (`better-sqlite3` with WAL mode) instead of a flat JSON file. This eliminates race conditions on concurrent reads/writes and enables SQL-based queries for reports, contact history, and date-range filtering.
- **Automatic migration**: On first v1.3 launch, existing `meetings.json` is imported into SQLite in a single atomic transaction. The original file is renamed to `.bak` as a safety backup.
- **Schema**: Five normalized tables — `meetings` (52 columns), `participants`, `transcript_entries`, `speaker_mappings`, and `calendar_attendees` — with indexes on date, status, calendar event ID, and participant email.
- **Transaction support**: All multi-table writes (meeting + participants + transcript) are wrapped in transactions for atomicity.
- **18 new IPC handlers**: Database, calendar, contacts, Gmail, and export operations exposed to the renderer via typed `ipcMain.handle` channels.

## Gmail Integration

- **Email thread viewer**: The expanded participant card in Meeting Detail now lazy-loads recent Gmail threads for that contact, showing subject, date, message count, and a direct link to the Gmail web UI.
- **Read-only scope**: Uses `gmail.readonly` — the app can view threads but cannot send, modify, or delete email.
- **Shared auth**: Piggybacks on the existing `GoogleAuth` OAuth flow — no separate login required.

## Transcript Export

- **Single export**: Export any meeting's transcript to a `.txt` file via the new toolbar button or File → Export Transcript menu item. Format: `Speaker Name: text` with one utterance per line.
- **Batch export**: Select multiple meetings and export all transcripts to a directory. Filenames follow the pattern `YYYY-MM-DD-title-slug-transcript.txt` with collision handling.
- **Speaker name resolution**: Prefers the matched speaker name (`speakerName`), falls back to the raw diarization label, and finally to "Unknown Speaker".

## Google Integration Upgrades

- **Calendar read/write**: OAuth scope upgraded from `calendar.readonly` to `calendar.events`. The app can now write extended properties to calendar events (e.g., marking an event as having a recording, linking to Obsidian notes).
- **Contacts read/write**: OAuth scope upgraded from `contacts.readonly` to `contacts`. New capabilities include creating contacts, updating custom fields (`jdNotes_*` namespace), appending notes, and tracking meeting statistics per contact.
- **Scope upgrade detection**: `GoogleAuth` detects when stored tokens lack the new scopes and displays a banner prompting re-authentication — no silent failures.
- **Token validation**: Stale or broken tokens from previous installs are auto-cleared via a live API test call on startup.
- **`googleContactId` → `googleContactResource`**: Renamed throughout for consistency with the Google People API's `resourceName` convention.

## Reports View

- **New full-page view**: Accessible via View → Reports. Includes date-range picker with preset buttons (7/30/90 days).
- **Meetings without recordings**: Shows calendar events in the selected range that have no associated recording — useful for catching missed meetings.
- **Recordings without calendar events**: Shows recordings that couldn't be matched to any calendar event — useful for finding orphaned transcripts.
- **Filter integration**: New "Recording" and "Calendar" filter dropdowns in the main meeting list let you filter by `has-recording`/`no-recording` and `linked`/`not-linked` status.

## SafeStorage Key Manager

- **`keytar` → `safeStorage`**: API keys are now encrypted using Electron's built-in `safeStorage` (DPAPI on Windows) and stored in `{userData}/secure-keys.json`. This removes the dependency on the deprecated `keytar` native module.
- **One-time migration**: Existing keys in Windows Credential Manager are automatically migrated on first launch.
- **In-memory cache**: Decrypted keys are cached in memory to avoid repeated disk reads.
- **`keytar` kept as webpack external**: The old module is retained as a build external during the migration period to suppress bundling warnings. Full removal planned for v1.4.

## Speaker Matching Refactor

- **Timeline-first priority**: The SDK speech timeline now _always_ runs first (when available), even when AssemblyAI returns identified speaker names. Previously, AssemblyAI names would short-circuit and skip timeline matching entirely.
- **AssemblyAI as supplementary**: After timeline matching, any still-unmatched speakers are filled in using AssemblyAI's identified names. This layered approach combines the high confidence of SDK timestamps with AssemblyAI's name resolution.
- **Heuristic fallback preserved**: Speakers unmatched by both timeline and AssemblyAI still fall through to count-based and first-speaker heuristics.
- **User profile support**: `SpeakerMatcher` now accepts a `userProfile` object (`{ name, email }`) from Settings, used to identify the meeting host in speaker mapping.

## Participant Card Enhancements

- **Expandable cards**: Participant cards in Meeting Detail now expand to show contact details, meeting history, recent emails (via Gmail), and Obsidian links.
- **Mismatch warning banner**: When the number of unique transcript speakers differs from the participant count, a warning banner appears with a prompt to fix speaker assignments.
- **Custom name mapping**: Users can assign custom names to speakers directly from the Fix Speakers modal — via dropdown selection or freeform text entry (Enter key).
- **"Add to Google Contacts" button**: Unmatched participants show a CTA to create a new Google Contact inline, pre-filled with the participant's name and email.

## Testing Infrastructure

- **Vitest unit tests** (`npm test`): 38 tests across two suites.
  - `SpeakerMatcher.test.js` — 24 tests covering timeline priority, AssemblyAI supplementary matching, strict name matching, edge cases, and regression guards for the v1.3 refactor.
  - `transcriptExporter.test.js` — 14 tests covering format output, speaker name fallback chains, newline flattening, filename generation, and special character handling.
- **Playwright E2E tests** (`npm run test:e2e`): 20 tests covering window initialization, menu navigation, search, toolbar, filters, settings tabs, reports view, contacts view, participant cards, scope upgrade banner, mismatch warning, Fix Speakers modal, and custom name entry.
- **Database integration tests** (`npm run test:db`): 5 suites covering schema creation, CRUD, query methods, JSON migration, and transaction atomicity.
- **CI-ready scripts**: `npm test`, `npm run test:watch`, `npm run test:db`, `npm run test:e2e`.

## Code Quality

- **`googleContactId` → `googleContactResource`**: Renamed across the entire codebase for consistency with the Google People API.
- **Logging refactor**: Gmail and GoogleAuth integrations switched to structured logging with consistent prefixes.
- **Webpack externals**: `better-sqlite3` added to externals; `@timfish/forge-externals-plugin` added to Forge config for proper native module handling.
- **ASAR unpack**: Both `@recallai` and `better-sqlite3` are unpacked from the ASAR archive for native module compatibility.

## Dependency Updates

### New Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | ^12.6.2 | Local SQLite database (v12.x required for Electron 40 V8 API) |

### New Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | ^4.0.18 | Unit testing framework |
| `@playwright/test` | ^1.58.2 | E2E testing framework |
| `playwright` | ^1.58.2 | Browser automation (base package) |
| `@rollup/rollup-win32-x64-msvc` | ^4.59.0 | Windows build support for Vitest |

### Core Framework
| Package | From | To |
|---------|------|-----|
| `electron` | 39.6.1 | 40.6.1 |

### Removed
- `keytar` — removed from `dependencies` (kept as webpack external for migration period)

---

## Files Changed

33 files changed, ~7,670 additions, ~796 deletions (net +6,874 lines)

## Known Intentionally Held-Back Dependencies

| Package | Current | Available | Reason |
|---------|---------|-----------|--------|
| `eslint` | 9.39.3 | 10.0.2 | `eslint-plugin-react` has no ESLint 10-compatible release yet |
| `eslint-plugin-security` | 3.0.1 | 4.0.0 | Requires ESLint 10 |
| `globals` | 16.5.0 | 17.3.0 | Tied to ESLint 10 ecosystem |

## Native Module Build Notes

- Electron 40's V8 API changes require `better-sqlite3` v12.6.2 (v11.x is incompatible).
- Windows builds require a patched `find-visualstudio.js` in `@electron/node-gyp` to detect the Windows SDK when it's not registered as a Visual Studio component.
- Rebuild after install: `electron-rebuild --only better-sqlite3 --force`.
