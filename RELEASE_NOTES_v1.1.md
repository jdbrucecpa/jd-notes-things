# JD Notes Things v1.1 Release Notes

**Release Date:** December 2025

This release brings significant improvements to speaker identification, a new contacts management system, audio file imports, custom vocabulary support, and numerous quality-of-life enhancements.

---

## Highlights

- **Smart Speaker Matching** - Recorded meetings now automatically match speakers to participant names using Recall.ai SDK speech timeline correlation
- **Contacts Page** - New full-page contacts view with search, detail panels, and meeting history
- **Audio File Import** - Import audio files directly and transcribe them with your preferred provider
- **Custom Vocabulary** - Add company names, industry jargon, and custom spellings to improve transcription accuracy
- **Settings Backup** - Export and import all your settings, templates, and configurations

---

## New Features

### Speaker Matching & Diarization

#### Automatic Speaker Identification for Recorded Meetings

Recorded transcripts now show actual participant names instead of "Speaker A/B". The app captures speech timing events from the Recall.ai SDK during recording and correlates them with transcription timestamps to match speakers to participants with high confidence.

#### Global Speaker Replacement for Imports

When importing transcripts with cryptic speaker IDs (like `SPK-72zlg25bsiw`), the new "Fix Speakers" modal allows you to:

- Map speaker IDs to contacts with search
- Auto-suggest known mappings from previous imports
- Preview changes before applying
- Persist mappings for future auto-suggestion

#### Speaker Mapping Enhancements

- View and map ALL speakers in a transcript, not just cryptic IDs
- Automatic duplicate speaker detection with one-click merge
- Similarity suggestions for potential duplicates (using Levenshtein distance)
- Multi-select merge mode for manual speaker consolidation
- Header content filtering (removes "summary", "introduction" from speaker list)

#### User Profile & Auto-Labeling

New "My Profile" tab in Settings allows you to configure:

- Your name, email, title, and organization
- Custom context for AI summaries

Benefits:

- Single-speaker transcripts automatically labeled as you (no modal needed)
- AI summaries include personalized context ("The person reading this summary is...")
- Auto-apply your identity during imports and live recordings

### Contact System

#### Contacts Page

A new full-page contacts view accessible from the header:

- **Left Panel:** Searchable, filterable contact list with avatars
- **Right Panel:** Contact details including emails, phones, organization, and Google Contacts link
- **Meeting History:** See all meetings a contact has attended, clickable to open details

#### Quick Contact Search (Ctrl+K / Cmd+K)

Instant global contact search overlay:

- Fuzzy search over names, emails, and organizations
- Keyboard navigation with arrow keys
- Match highlighting
- Score-based ranking for best matches

#### Contact & Company Pages in Obsidian

Automatically create and maintain CRM-like pages in your vault:

- **Contact Pages:** Saved to `/People/{name}.md` with YAML frontmatter, aliases, and meeting backlinks
- **Company Pages:** Saved to `/Companies/{name}.md` with domain and industry info
- Auto-created when contacts are first linked in transcripts
- Wiki-links (`[[Name]]`) in transcripts enable Obsidian's backlink feature

### Import System

#### Audio File Import

Import audio files directly for transcription:

- Supported formats: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm`, `.flac`, `.aac`
- Select transcription provider (AssemblyAI or Deepgram) at import time
- Batch import multiple audio files
- UUID-like filenames auto-converted to friendly titles

#### Improved Import Metadata

- Enhanced filename pattern parsing for date/title extraction
- File modification time fallback when no date in filename
- "Needs verification" status tracking for imported meetings

#### Import UX Improvements

Changed default checkbox states for better workflow:

- "Generate auto-summary" - checked by default
- Template checkboxes - unchecked by default
- "Auto-export to Obsidian vault" - unchecked by default

### Vocabulary System

#### Custom Vocabulary Management

New Vocabulary tab in Settings with:

- **Global Vocabulary:** Applied to all transcriptions
- **Client-Specific Vocabulary:** Applied only for matching client meetings
- **Spelling Corrections:** Map variants to correct spellings (e.g., "John Doe, JD" → "Jonathan Doe")
- **Keyword Boosts:** Increase recognition probability for important terms
- Import/export vocabulary as JSON
- Reload from disk after manual edits

#### Transcription Integration

Custom vocabulary automatically applied:

- **AssemblyAI:** Uses `custom_spelling` for find/replace corrections
- **Deepgram:** Uses `keywords` with intensifiers for probability boosting
- Client determined from meeting participants via routing rules
- Global + client vocabulary merged automatically

### Settings Management

#### Settings Export

Export all your configurations to a single ZIP file:

- Routing rules (`routing.yaml`)
- Custom templates
- Vocabulary lists (global and client-specific)
- Speaker ID mappings
- App preferences
- Timestamped filename for versioning

#### Settings Import

Restore configurations from a backup:

- Validate archive structure before import
- Preview what will be imported
- Merge mode (default) or overwrite
- Automatic configuration reload after import

### Routing Preview

#### Preview Routing in Templates Modal

Before processing a meeting, see exactly where it will be saved:

- Destination path in Obsidian
- Color-coded icons by type (client=blue, industry=purple, internal=green, unfiled=yellow)
- Human-readable explanation of why this route was selected
- Type badge showing category

#### Manual Override & Rule Creation

- "Change" button to manually select a different destination
- All configured destinations grouped by type
- After override, option to create a permanent routing rule
- Domain chips with checkboxes to select which email domains to add to the rule

### Review & Sync Management

#### "Not Synced to Obsidian" View

New filter toggle in the header to show only unsynced meetings:

- Individual "Sync" button on each meeting card
- Bulk "Sync All" button when filter is active
- Loading states and toast notifications for sync operations

#### Stale Link Detection & Refresh

When you move notes in Obsidian, the app can find them again:

- Meeting notes now include `meeting_id` in YAML frontmatter
- "Refresh Links" button in Settings > General > Data Maintenance
- Scans entire vault for meeting notes
- Updates stored paths for moved files
- Reports: updated, missing, unchanged

### UI Enhancements

#### Meeting Type Icons

Visual platform indicators on meeting cards:

- Brand logo icons for Zoom, Microsoft Teams, Google Meet
- Icons for Webex, Whereby, In-Person, and Unknown
- Displayed in both meeting list and meeting detail view
- Manual selection for imported meetings

#### Sticky Transcript Toolbar

The transcript search bar now stays visible when scrolling through long transcripts.

---

## Bug Fixes

### Google Auth State on Install

**Fixed:** Fresh installs no longer incorrectly show Google as "connected". The app now validates tokens on startup and clears invalid credentials, ensuring users start in a clean "not connected" state.

### Single Instance Enforcement

**Fixed:** Multiple app instances can no longer be opened. When the app is already running:

- If visible: brings window to front
- If minimized to taskbar: restores and focuses
- If minimized to tray: shows window and focuses

### Additional Fixes

- Fixed Google contact link URL format (was returning 404)
- Fixed meetings section not populating in contacts view
- Fixed quick search keyboard navigation highlight contrast
- Fixed meeting click navigation going to home instead of detail
- Fixed routing preview showing "undefined" for organization names
- Fixed routing editor reading from wrong config file in dev mode
- Fixed internal routing logic (now only triggers when 100% internal attendees)
- Fixed `exportToObsidian()` checking wrong field for vault path
- Fixed metadata tab not showing vault path after export
- Fixed UI not updating after Obsidian export

---

## Configuration Changes

### Config Path Consolidation

All config files are now stored in `userData/config/`:

- `routing.yaml` - Routing rules
- `vocabulary.yaml` - Custom vocabulary
- `transcript-patterns.yaml` - Import patterns
- `app-settings.json` - App preferences
- `speaker-mappings.json` - Speaker ID mappings
- `templates/` - Summary templates

On first launch, missing defaults are copied from bundled config (existing files are never overwritten).

---

## Upgrade Notes

- Existing data and settings are preserved when upgrading from v1.0
- Google authentication may require re-connection due to token validation improvements
- Config files are automatically migrated to the new `config/` directory structure
