# Transcript Parsing Enhancement - Session Context

## Project Overview

**JD Notes Things** is a Windows desktop Electron app for recording, transcribing, and summarizing meetings from Zoom, Teams, and Google Meet. It integrates with Google Calendar/Contacts and saves structured notes to an Obsidian vault.

**Current Phase:** Phase 10.7 (Desktop App Polish) - Recently completed
**Import Feature:** Phase 8 - Allows importing existing transcripts from .txt, .md, .vtt, .srt files

## Transcript Parser Current State

**Location:** `src/main/import/TranscriptParser.js`

The parser supports multiple formats:
- **Plain Text (.txt)** - Currently has two pattern detection modes
- **Markdown (.md)** - Supports `## Speaker Name` and `**Speaker**: text` formats
- **WebVTT (.vtt)** - Video subtitle format with timestamps
- **SRT (.srt)** - SubRip subtitle format

## Current Plain Text Parsing Patterns

**File:** `TranscriptParser.js`, `parsePlainText()` method (lines 41-180)

### Pattern 1: Inline Speaker with Text
**Format:** `Name: transcribed speech`
**Regex:** `/^([A-Za-z\s]+):\s+(.+)/`
**Example:**
```
John: Hello, how are you?
Mary: I'm doing well, thanks!
```

### Pattern 2: Speaker Header on Own Line
**Format:**
```
Name:
"transcribed speech"
```
**Regex:** `/^([A-Za-z\s]+):$/`
**Example:**
```
JD:
"Thanks that was a while ago..."

Marshall:
"You did an excellent job."
```

### Additional Pattern Support
- **Timestamps:** `[HH:MM:SS] text` or `HH:MM:SS - text`
- **Quoted text:** Strips regular quotes `"` and curly quotes `″` from text

## Recent Bug Fix (2025-01-16)

**Problem:** Speaker headers on their own line were being parsed as separate entries with "Unknown" speaker.

**Root Cause:** The inline pattern regex used `\s*` (zero or more spaces), making it ambiguous. Pattern checking order wasn't explicit enough.

**Fix:**
- Changed inline pattern to require at least one space: `:\s+` instead of `:\s*`
- Reordered pattern checks for clarity (header → inline → timestamp → plain text)
- Made variable names clearer (`headerMatch`, `inlineMatch`)

## Parser Architecture

```javascript
parsePlainText(content, filePath) {
  // 1. Split content into lines
  // 2. Loop through lines
  // 3. For each line, check patterns in order:
  //    a. Speaker header (Name:) → collect following lines as text
  //    b. Inline speaker (Name: text) → create entry immediately
  //    c. Timestamp → create entry with timestamp
  //    d. Plain text → attribute to current speaker
  // 4. Return array of entries with {speaker, text, timestamp}
}
```

**Key Design Decision:** Parser creates discrete "entries" (individual speaking turns) rather than grouping by speaker. This allows preserving conversation flow.

## Current Limitations

1. **Fixed Regex Patterns:** Hardcoded patterns in the parser - not user-configurable
2. **No Pattern Preview:** Users can't see how their transcript will be parsed before import
3. **No Learning System:** Can't adapt to new transcript formats without code changes
4. **No Validation UI:** Users only discover parsing issues after import completes
5. **Speaker Name Constraints:** Regex requires `[A-Za-z\s]+` - won't match numbers, hyphens, etc. in names

## Parsing Edge Cases Not Currently Handled

**Potential missed patterns:**
- Speaker names with numbers: `Speaker 1:`, `John-2:`
- Speaker names with special chars: `Dr. Smith:`, `O'Brien:`
- Multi-line quotes without speaker re-identification
- Mixed formats in same file
- Different quote styles (», «, ', ', etc.)
- Indented speakers or text
- Speakers with titles: `[Moderator] John:`, `(Host) Mary:`

## Import Flow Context

**User Journey:**
1. User clicks "Import" button → Opens import modal
2. User selects files (.txt, .md, .vtt, .srt)
3. User chooses options:
   - Generate auto-summary (uses AI)
   - Select template-based summaries
   - Auto-export to Obsidian
4. User clicks "Import Files"
5. **Parser runs in background** (no preview or confirmation)
6. ImportManager processes each file:
   - `TranscriptParser.parseFile()` → Detects format, runs appropriate parser
   - `MetadataExtractor.extractMetadata()` → Pulls date, participants, etc.
   - Creates meeting object with transcript entries
   - Optionally generates AI summaries
   - Saves to meetings.json
7. User sees success toast, meetings appear in list

**UI Files:**
- Modal: `src/index.html` (lines 559-644)
- Logic: `src/renderer.js` (lines 3477-3889)
- IPC Handler: `src/main.js` (lines 3618-3700)

## Technical Stack

- **Main Process:** Node.js with async/await
- **Renderer Process:** Vanilla JavaScript (no framework)
- **IPC:** Electron ipcMain/ipcRenderer
- **LLM Integration:** Multi-provider (OpenAI, Azure, Anthropic) with provider switching utility

## Files Involved in Import

```
src/
├── main/
│   └── import/
│       ├── ImportManager.js       # Orchestrates import flow
│       ├── TranscriptParser.js    # Parses different formats (THE FILE IN QUESTION)
│       └── MetadataExtractor.js   # Extracts date, participants, etc.
├── renderer.js                    # Import UI logic (modal, file selection)
├── index.html                     # Import modal markup
└── main.js                        # IPC handlers for import:importBatch
```

## User Questions for New Session

In looking at the whole transcript import process, I see two scenarios we're testing for:
1. **Inline speaker:** `Name: transcribed speech`
2. **Speaker on own line:**
   ```
   Name:
   "transcribed speech"
   ```

**Questions to explore:**

1. **Are there other scenarios that will get picked up?**
   - What edge cases should we consider?
   - What transcript formats are common but not supported?

2. **How do we best set this up to allow for learning new patterns in the future?**
   - Should patterns be user-configurable?
   - Should we use a plugin/extension system?
   - Could patterns be stored in config files (like templates are)?

3. **Should we add an optional test/confirmation/pattern checker step?**
   - Preview parsed transcript before confirming import?
   - Show speaker detection results with option to adjust?
   - Allow pattern testing on sample text?

4. **Is there a way in the UI to "learn" patterns?**
   - User highlights examples of speaker names in the UI?
   - Pattern builder wizard?
   - Save custom patterns for future imports?

5. **Could we call an LLM chatbot to help build patterns?**
   - User provides sample transcript → LLM suggests regex pattern?
   - LLM analyzes failed parses and recommends fixes?
   - Trade-offs: API cost vs. user experience

6. **What's the best way to handle this?**
   - Balance between flexibility and complexity
   - Should this be a power-user feature or mainstream?
   - How does this fit into the "personal use" constraint of the app?

## Relevant Design Constraints

From `CLAUDE.md`:
- **Personal use only** - Not multi-tenant
- **File-based config** - Users edit YAML/template files directly, UI is convenience layer
- **Phase-based delivery** - Each phase fully functional before proceeding
- **User-editable configs** - Prefer file-based over hardcoded where possible

## Related Features That Could Inform Solution

1. **Template System** (Phase 10.3)
   - User-editable template files in `vault/config/templates/`
   - Supports .md, .yaml, .json, .txt
   - UI loads and displays available templates
   - Could pattern definitions follow similar approach?

2. **Routing System** (Phase 7)
   - YAML-based configuration in `vault/config/routing.yaml`
   - Domain matching with regex support
   - UI displays routing rules but editing is file-based
   - Similar precedent for config-file patterns?

3. **LLM Provider Switching** (Phase 10.3, recently refactored)
   - User selects provider in UI dropdown
   - Settings stored in localStorage
   - Utility function handles provider switching (`withProviderSwitch()`)
   - Could similar approach work for parser selection?

## Current Project Status

- **Phase 10.7 Complete:** System tray, keyboard shortcuts, notifications, logs viewer
- **Import working:** Basic parsing works for the two main patterns
- **Recent fixes:** Speaker header parsing bug fixed, dark mode improvements documented
- **Technical debt:** 172 hardcoded colors documented in `Darkmodefixes.md` for future cleanup

## Additional Context

The import feature is working but feels "brittle" - small variations in transcript format can break parsing. The user is thinking ahead about extensibility and user experience for handling diverse transcript formats without requiring code changes for each new pattern.
