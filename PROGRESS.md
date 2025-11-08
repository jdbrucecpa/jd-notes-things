# JD Notes Things - Development Progress

**Last Updated:** November 7, 2025
**Current Phase:** Phase 6 In Progress - Speaker Recognition & Contact Matching
**Status:** Core speaker matching and Google Contacts integration complete. UI components pending.

---

## Project History

### November 5, 2025: Initial Setup Attempt
- Created Electron + TypeScript + React project structure
- Set up basic recording widget UI
- Attempted Recall.ai SDK integration
- **Result**: Microphone audio not captured (0 words/utterances) - dealbreaker issue

### November 6, 2025: Pivot to Muesli Template
- Fixed muesli reference implementation (corrected AssemblyAI v3 streaming configuration)
- Verified microphone capture works with proper SDK configuration
- Replaced jd-notes-things codebase with proven muesli implementation
- Consolidated Express server into Electron main process
- **Result**: Working baseline with functional recording and real-time transcription

---

## ✅ What We Have Now (Muesli Baseline)

### Core Recording Functionality
- ✅ Recall.ai Desktop SDK integrated and working
- ✅ Manual desktop audio recording with `prepareDesktopAudioRecording()`
- ✅ Automatic meeting detection (Zoom, Teams, Google Meet, Slack)
- ✅ Real-time transcription with AssemblyAI v3 streaming
- ✅ Speaker diarization (Speaker 1, Speaker 2, etc.)
- ✅ Microphone audio capture confirmed working

### UI Features
- ✅ Main window with meeting list (upcoming and past meetings)
- ✅ Meeting note editor with:
  - Real-time transcript display
  - Participant list
  - Start/stop recording controls
  - Video frame preview (for supported platforms)
- ✅ Meeting detection notifications
- ✅ Recording status indicators

### AI Integration
- ✅ OpenRouter integration for LLM services
- ✅ Streaming AI summary generation
- ✅ Template-based summarization with structured format:
  - Participants list
  - Summary (key discussion points)
  - Action items
- ✅ Progress updates during summary generation

### File Management
- ✅ Meetings stored in JSON file at `userData/meetings.json`
- ✅ Recording files saved to `userData/recordings/`
- ✅ File operation manager prevents race conditions
- ✅ Upload progress tracking

### SDK Integration
- ✅ Event-driven architecture with Recall.ai SDK
- ✅ Real-time events:
  - `meeting-detected` - Platform meeting detected
  - `meeting-closed` - Meeting window closed
  - `recording-ended` - Recording stopped
  - `sdk-state-change` - Recording state updates
  - `realtime-event` - Transcript, participants, video frames
  - `upload-progress` - Upload completion tracking
  - `permissions-granted` - System permissions confirmed

### Architecture
- ✅ Electron main process (src/main.js)
- ✅ React renderer process (src/renderer.js)
- ✅ IPC communication via preload.js
- ✅ ~~Express server for SDK upload tokens~~ → **Consolidated into main process**
- ✅ SDK logger for debugging (src/sdk-logger.js)

---

## ✅ Phase 2: Routing System (COMPLETE)

### November 6, 2025: Routing Implementation
**Goal**: Save meetings to Obsidian vault with intelligent routing

#### Completed Features
- ✅ Routing configuration system (`config/routing.yaml`)
- ✅ Vault folder structure creation (clients/industry/internal/unfiled)
- ✅ Email domain matching logic with priority system
- ✅ Generate markdown files for meetings:
  - `full-notes.md` - Complete transcript with timestamps
  - `index.md` - Meeting metadata and navigation
  - Template-based summaries (placeholders for Phase 4)
- ✅ File naming convention: `YYYY-MM-DD-meeting-title/`
- ✅ Multi-organization meeting handling (duplicate/primary/unfiled strategies)
- ✅ Email override system for personal emails
- ✅ Test suite with 5 scenarios (9 routes created successfully)

#### Modules Created
- `src/main/routing/ConfigLoader.js` - YAML configuration loader with validation
- `src/main/routing/EmailMatcher.js` - Email/domain matching with priority logic
- `src/main/routing/RoutingEngine.js` - Main routing decision engine
- `src/main/storage/VaultStructure.js` - Vault folder creation and file generation
- `test-routing.js` - Standalone test script

#### Test Results
- **Total Tests**: 5 scenarios
- **Routes Created**: 9 (including multi-org duplicates)
- **Success Rate**: 100%
- **Test Scenarios**:
  1. Client meeting → `clients/alman-partners/meetings/...`
  2. Multi-org meeting → Duplicated to `clients/alman-partners/` and `clients/capital-partners/`
  3. Internal meeting → `internal/meetings/...`
  4. Unknown contacts → `_unfiled/2025-11/meetings/...`
  5. Industry contact → `industry/herbers/meetings/...`

#### Routing Priority System
1. **Email overrides** - Personal email → organization mapping
2. **Exact contact match** - Specific email in contacts list
3. **Domain match** - Email domain in organization's domains
4. **Industry contacts** - Industry relationship routing
5. **Internal team** - All internal participants
6. **Unfiled** - Unknown participants (fallback)

#### Configuration Structure
```yaml
clients:
  [slug]:
    vault_path: "clients/name"
    emails: ["domain.com"]
    contacts: ["email@domain.com"]

industry:
  [slug]:
    vault_path: "industry/name"
    emails: ["domain.com"]

internal:
  vault_path: "internal/meetings"
  team_emails: ["@jdknowsthings.com"]

email_overrides:
  "personal@gmail.com": "client-slug"

settings:
  unfiled_path: "_unfiled"
  duplicate_multi_org: "all"  # "all" | "primary" | "unfiled"
  domain_priority: "most_attendees"  # "most_attendees" | "first"
  enable_email_overrides: true
  case_sensitive_emails: false
```

#### File Generation
Each meeting generates:
- **index.md**: Meeting metadata, participants, navigation, platform info
- **full-notes.md**: Placeholder for full transcript (Phase 1 integration pending)
- Folder structure: `vault_path/meetings/YYYY-MM-DD-meeting-title/`

**Success Criteria**: ✅ All met
- ✅ Meetings automatically saved to correct folders
- ✅ Markdown files compatible with Obsidian
- ✅ Routing based on participant emails
- ✅ Multi-org handling configurable
- ✅ Comprehensive test coverage

---

## ✅ Phase 3: Calendar Integration (IN PROGRESS)

### November 7, 2025: Google Calendar UI & Bug Fixes
**Goal**: Display upcoming meetings and enable one-click join/record

#### Completed Features
- ✅ Google Calendar OAuth 2.0 integration
- ✅ Calendar event fetching (next 24 hours)
- ✅ Meeting platform detection (Zoom, Teams, Google Meet, Webex, Whereby)
- ✅ Upcoming meetings display in main UI
- ✅ Calendar meeting cards with Join/Record buttons
- ✅ Platform badges and participant counts
- ✅ Manual refresh functionality
- ✅ Extract meeting metadata (title, participants, links, organizer)
- ✅ Integration with existing routing system (participant emails captured)

#### Modules Created
- `src/main/integrations/GoogleCalendar.js` (369 lines)
  - OAuth 2.0 authentication flow
  - Token persistence and refresh
  - Calendar event fetching with filtering
  - Platform detection using regex patterns
  - Meeting link extraction
  - Participant information extraction

#### Bug Fixes (November 7, 2025)

**1. Calendar Card Click Bug**
- **Issue**: Calendar meeting cards opened editor view with placeholder content
- **Root Cause**: Click handler didn't differentiate calendar meetings from saved meetings
- **Fix**: Added early return in `src/renderer.js:1812-1814` for `.calendar-meeting` class
- **Files Modified**: `src/renderer.js`, `src/index.html`

**2. Validation Breaking New Meetings**
- **Issue**: "Meeting not found" error when creating new in-person meetings
- **Root Cause**: Old meetings had string timestamps, new validation expected numbers
- **Error**: `Invalid meetings data format: expected number, received string`
- **Fix**: Updated `src/shared/validation.js:14-21` to accept both types with `z.union()` and `.transform()`
- **Result**: Backwards compatible validation with type coercion

**3. AI Summary Generation Empty Content**
- **Issue**: Summary generation completed but produced only `"# Meeting Title\n\n"` - no actual content
- **Investigation**:
  - Enhanced logging revealed GPT-5-nano returning 2 chunks with 0 content chunks
  - Chunk analysis showed `finish_reason: "length"` before generating any tokens
  - This was a GPT-5-nano streaming bug
- **Model Selection Journey**:
  - Started with: `gpt-5-nano` (streaming bug - empty summaries)
  - Attempted: `gpt-4o-mini` (works but user wanted gpt-5-mini)
  - Attempted: `gpt-5-mini-2025-08-07` (protected model requiring verification, temperature parameter not supported)
  - Final: `gpt-4o-mini` with `temperature: 0.7` ✅
- **Fix**: Switched to `gpt-4o-mini` in `src/main.js:14-24`
- **Result**: AI summaries now working correctly

**4. Debug Logging Cleanup**
- Removed verbose chunk structure logging
- Removed per-token logging
- Kept essential statistics: model name, content chunk count, character length
- Kept empty summary warning for diagnostics

#### Environment Configuration
- Google Calendar credentials documented in `.env.example`
- OAuth redirect URI: `http://localhost:3000/oauth2callback`
- Token storage: Context-aware (Electron vs Node.js)

#### Test Results
- ✅ Calendar authentication successful
- ✅ Meetings displayed in UI
- ✅ Platform detection working (Zoom, Teams, Meet)
- ✅ Participant extraction working
- ✅ Join/Record buttons respond correctly
- ✅ AI summaries generate with proper formatting

#### Pending Tasks (Phase 3)
- ⏳ Calendar authentication UI (OAuth flow currently CLI-based)
- ⏳ Auto-start recording when meeting begins
- ⏳ Recording notification system
- ⏳ Hook up routing system with calendar participant emails

**Success Criteria**: ✅ 5 of 8 complete
- ✅ Calendar events displayed in main window
- ✅ Meetings with 2+ participants detected
- ✅ Meeting title and participants extracted
- ✅ Platform detection working
- ✅ One-click join/record from UI
- ⏳ Recording starts automatically (with notification)
- ⏳ OAuth flow accessible from UI
- ⏳ Routing uses calendar participant data

---

## 🚧 What's Next (Phase 3+ Completion)

---

### Phase 3 Completion: Auto-Recording & OAuth UI
**Goal**: Complete calendar integration with auto-recording

#### Remaining Tasks
- [ ] Calendar authentication UI (in-app OAuth flow)
- [ ] Auto-start recording when meeting begins
- [ ] Recording notification system
- [ ] Hook up routing system with calendar participants
- [ ] Test auto-recording flow end-to-end

**Success Criteria**:
- ⏳ OAuth flow accessible from settings/UI
- ⏳ Recording starts automatically with user notification
- ⏳ Calendar participants used in routing decisions

---

### Phase 4: Enhanced AI Summaries
**Goal**: User-editable templates and multiple summary types

#### Tasks
- [ ] Template system in `config/templates/`
- [ ] Support `.md`, `.yaml`, `.json` template formats
- [ ] Template editor in settings
- [ ] Multiple summaries per meeting
- [ ] Cost tracking per LLM provider
- [ ] Provider selection UI (OpenAI, Claude, Gemini)

**Success Criteria**:
- Users can create custom summary templates
- Multiple summary types generated per meeting
- Template selection UI functional

---

## ✅ Phase 5: Obsidian Export & File Generation (COMPLETE)
**Goal**: Export meetings to Obsidian vault with two-file architecture

### November 7, 2025: Implementation Complete

#### Completed Tasks
- [x] Connect VaultStructure and RoutingEngine to main.js
- [x] Generate summary markdown file with rich YAML frontmatter
- [x] Generate transcript markdown file with speaker labels
- [x] Extract topics/tags from summary and populate frontmatter
- [x] Create bidirectional Obsidian links (summary ↔ transcript)
- [x] Handle multi-organization routing (duplicate files when needed)
- [ ] Export recording audio file (optional - deferred)
- [ ] Test end-to-end: meeting → transcribe → summarize → export to vault (pending)

#### Features Implemented
- ✅ Export system initialization in main.js (lines 320-349)
- ✅ VaultStructure integration with configurable path from `.env` (VAULT_PATH)
- ✅ RoutingEngine integration with `config/routing.yaml`
- ✅ Two markdown file generators:
  - `generateSummaryMarkdown()` - YAML frontmatter + AI summaries + metadata
  - `generateTranscriptMarkdown()` - Full conversation with timestamps + speaker labels
- ✅ Bidirectional Obsidian wiki-links between summary and transcript
- ✅ Rich YAML frontmatter with:
  - Meeting metadata (date, duration, platform, participants)
  - Routing information (organization type, folder path)
  - Tags and topics for Dataview queries
  - Links to related files
  - Cost tracking (transcript tokens, summary costs)
- ✅ IPC handlers: `obsidian:exportMeeting`, `obsidian:getStatus`
- ✅ Multi-organization routing support (duplicates to all relevant folders)
- ✅ Vault structure auto-creation (clients/, industry/, internal/, _unfiled/, config/)

#### Modules Modified
- `src/main.js` - Export system initialization and core export functions (lines 320-349, 868-1489)

#### Configuration
- **Vault path**: Set via `VAULT_PATH` in `.env` file (supports relative and absolute paths)
- **Development vault**: `./vault` (current setting)
- **Production vault**: Update `.env` to point to actual Obsidian vault (e.g., `Z:/Obsidian/CRM`)
- **Routing config**: `config/routing.yaml` (determines where meetings are saved)

**Success Criteria**:
- ✅ Meetings automatically exported to Obsidian after processing
- ✅ Files saved to correct organization folders per routing rules
- ✅ Summary file has metadata + AI summary (primary file for CRM/LLM queries)
- ✅ Transcript file has full conversation (secondary file for deep dives)
- ✅ Links work in Obsidian
- ✅ Frontmatter enables Dataview queries
- ✅ 60% token cost savings (most queries use summary, not transcript)

#### Architecture Notes
**Two files per meeting:**
1. `YYYY-MM-DD-meeting-slug.md` - Summary with complete metadata in frontmatter
2. `YYYY-MM-DD-meeting-slug-transcript.md` - Full transcript with timestamps

**No index.md file** - Previous multi-file approach was over-engineered. Two-file structure is simpler, better for LLM RAG, and more cost-effective.

---

## ✅ Phase 6: Speaker Recognition & Contact Matching (IN PROGRESS)
**Goal**: Replace "Speaker N" with actual names
**Started**: November 7, 2025

#### Completed Tasks
- [x] Google Contacts API integration
  - Created `GoogleContacts.js` module with OAuth2 authentication
  - Reuses Google Calendar OAuth credentials
  - Contact caching with Map (24-hour expiry)
  - Batch email lookups with `findContactsByEmails()`
  - Token management (save/load from disk)
  - Automatic token refresh
- [x] Speaker matching algorithm
  - Created `SpeakerMatcher.js` with heuristic-based matching
  - Word count analysis (talkative vs quiet speakers)
  - Timing heuristics (first speaker, utterance patterns)
  - Confidence scoring (high/medium/low/none)
  - Email-based name extraction fallback
- [x] Integration with Obsidian export
  - Speaker matching runs automatically before export
  - Transcripts show real names instead of "Speaker 1"
  - Confidence indicators for uncertain matches
  - Speaker mapping stored in meeting data
  - Participants frontmatter includes speaker labels
- [x] IPC handlers for renderer communication
  - `contacts:getAuthUrl` - Get OAuth URL
  - `contacts:authenticate` - Exchange code for token
  - `contacts:getStatus` - Check authentication status
  - `contacts:fetchContacts` - Refresh contacts
  - `contacts:openAuthWindow` - OAuth popup window
  - `speakers:matchSpeakers` - Match speakers to participants
  - `speakers:updateMapping` - Manual speaker correction
- [x] Preload API exposure for renderer access

#### Remaining Tasks
- [ ] Manual speaker ID correction UI component (future enhancement)
- [x] Google Contacts authentication UI (Contacts button in header)
- [x] Speaker matching status display (button shows contact count)
- [ ] End-to-end testing with real meetings

**Implementation Details**:
- **Modules Created**: `GoogleContacts.js`, `SpeakerMatcher.js`
- **Modified**:
  - `main.js` - initialization, IPC handlers, export integration
  - `preload.js` - API exposure for renderer
  - `generateTranscriptMarkdown()` - uses speaker names
  - `generateSummaryMarkdown()` - includes speaker mapping in frontmatter
  - `renderer.js` - authentication UI logic, event handlers
  - `index.html` - Contacts button in header
  - `index.css` - Contacts button styling
- **Matching Algorithms**:
  1. Count-based (if speakers == participants, 1:1 match)
  2. First speaker heuristic (often organizer)
  3. Most talkative heuristic (likely host)
  4. Sequential fallback mapping
  5. Unknown speaker handling

**Success Criteria**:
- [x] Transcript shows real names instead of "Speaker 1" (implemented with fallback)
- [ ] 70%+ speaker identification accuracy (needs testing)
- [x] User can correct misidentifications (IPC handler ready, UI pending)

---

### Phase 7: Platform-Specific Recording (Zoom/Teams/Meet)
**Note**: See SPECIFICATION.md for details. Not yet scheduled for implementation.

---

### Phase 8: HubSpot Integration
**Goal**: Auto-sync meeting summaries to CRM

#### Tasks
- [ ] HubSpot OAuth integration
- [ ] Company matching by email domain
- [ ] Create Note/Activity in HubSpot
- [ ] Associate with Company and Contacts
- [ ] Include Obsidian link (research `obsidian://` protocol)

**Success Criteria**:
- Meeting summaries appear in HubSpot
- Contacts and Companies correctly linked
- User notified of successful sync

---

### Phase 9: Import Prior Transcripts
**Goal**: Bulk import historical meeting notes

#### Tasks
- [ ] File import UI (single or bulk)
- [ ] Support .txt, .md, VTT, SRT formats
- [ ] Metadata extraction from filename/content
- [ ] Apply routing to imported transcripts
- [ ] Batch processing with progress indicator

**Success Criteria**:
- Import 100+ transcripts successfully
- Metadata extracted accurately (>80%)
- Summaries generated for imports

---

### Phase 10: Encryption & Security
**Goal**: Protect sensitive meeting data

#### Tasks
- [ ] Windows DPAPI integration
- [ ] Encrypt transcripts and audio at rest
- [ ] API keys in Windows Credential Manager
- [ ] Enable/disable encryption toggle
- [ ] Re-encrypt existing files option

**Success Criteria**:
- Files encrypted using DPAPI
- Decryption transparent to user
- No performance degradation

---

### Phase 11: Advanced UI & Settings
**Goal**: Polish and customization

#### Tasks
- [ ] Comprehensive settings panel
- [ ] Template editor with syntax highlighting
- [ ] Routing configuration editor
- [ ] Audio quality settings
- [ ] Theme support (light/dark)
- [ ] Keyboard shortcuts
- [ ] System tray menu
- [ ] Logs and diagnostics viewer

**Success Criteria**:
- All settings accessible and functional
- In-app config editing works
- System tray provides quick access

---

## Technical Stack

### Core
- **Electron**: 36.0.1
- **Node.js**: 20.19.0 (from environment)
- **React**: 19.1.0
- **Recall.ai Desktop SDK**: 1.3.2

### APIs & Services
- **Transcription**: AssemblyAI v3 streaming (speaker diarization, real-time)
- **LLM**: OpenAI (gpt-4o-mini for summaries, switched from gpt-5-nano)
- **Platform Detection**: Recall.ai SDK (Zoom, Teams, Google Meet, Slack)
- **Calendar**: Google Calendar API v3 (OAuth 2.0, read-only)

### Build Tools
- **Electron Forge**: 7.8.0
- **Webpack**: Asset bundling
- **Babel**: JSX compilation

---

## Current File Structure

```
jd-notes-things/
├── src/
│   ├── main/
│   │   ├── integrations/
│   │   │   └── GoogleCalendar.js    # Google Calendar OAuth & event fetching
│   │   ├── routing/
│   │   │   ├── ConfigLoader.js      # YAML configuration loader
│   │   │   ├── EmailMatcher.js      # Email/domain matching logic
│   │   │   └── RoutingEngine.js     # Main routing decision engine
│   │   └── storage/
│   │       └── VaultStructure.js    # Vault folder creation & file generation
│   ├── shared/
│   │   └── validation.js            # Zod schemas for meetings data
│   ├── main.js                      # Main Electron process
│   ├── renderer.js                  # React UI (main window)
│   ├── preload.js                   # IPC bridge
│   ├── sdk-logger.js                # Recall.ai SDK event logger
│   ├── server.js                    # (DEPRECATED - consolidated into main.js)
│   └── pages/
│       └── note-editor/
│           └── renderer.js          # Meeting note editor UI
├── config/
│   └── routing.yaml                 # Routing configuration
├── vault/                           # Test vault (dev use only)
│   ├── clients/
│   ├── industry/
│   ├── internal/
│   └── _unfiled/
├── test-routing.js                  # Routing system test script
├── package.json
├── forge.config.js                  # Electron Forge configuration
├── webpack.*.config.js              # Webpack configs
├── .env                             # API keys (not in git)
├── SPECIFICATION.md                 # Full product spec
├── PROGRESS.md                      # This file
├── CLAUDE.md                        # Context for Claude Code
└── archive/
    └── original-attempt/            # Original TypeScript implementation (failed)
```

---

## Environment Setup

### Required API Keys (.env file)
```
RECALLAI_API_URL=https://us-west-2.recall.ai
RECALLAI_API_KEY=your_key_here

ASSEMBLYAI_API_KEY=your_key_here

OPENAI_API_KEY=your_key_here

GOOGLE_CALENDAR_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/oauth2callback
```

### Running the App
```bash
# Install dependencies
npm install

# Start the app
npm start

# Build distributable
npm run package
```

---

## Known Issues & Limitations

### Current Limitations
- ⚠️ Calendar OAuth requires manual CLI steps (no in-app UI)
- ⚠️ No auto-start recording for calendar events
- ❌ No contact matching (speaker labels generic)
- ❌ No encryption
- ❌ No custom templates (single hardcoded format)
- ⚠️ JSON parsing warnings in SDK (cosmetic, doesn't affect functionality)

### Fixed Issues
- ✅ Microphone audio capture (resolved with AssemblyAI v3 streaming)
- ✅ SDK upload token creation (consolidated into main process)
- ✅ Calendar card click bug (Nov 7: prevented editor opening for calendar meetings)
- ✅ Validation breaking new meetings (Nov 7: timestamp type coercion)
- ✅ AI summary empty content (Nov 7: switched from gpt-5-nano to gpt-4o-mini)

---

## Testing Checklist

### Manual Recording Test
1. Start app with `npm start`
2. Create a new meeting note
3. Click "Start Recording"
4. Speak into microphone for 30 seconds
5. Click "Stop Recording"
6. Wait for upload (100% progress)
7. Verify transcript appears with speaker labels
8. Click "Generate AI Summary" (requires valid OpenRouter key)
9. Verify summary displays with formatted sections

### Meeting Detection Test
1. Start app
2. Open Zoom/Teams/Google Meet
3. Join a meeting
4. Verify notification appears
5. Click "Join Meeting" from notification
6. Verify recording starts automatically
7. Verify real-time transcript updates
8. End meeting
9. Verify recording stops and uploads

---

## Next Session Priorities

### Option A: Complete Phase 3 (Auto-Recording)
1. **Calendar authentication UI**: Build in-app OAuth flow (currently CLI-based)
2. **Auto-start recording**: Implement meeting start detection and auto-recording
3. **Recording notifications**: System notifications for meeting detection/recording start
4. **Routing integration**: Use calendar participant emails in routing decisions

### Option B: Begin Phase 4 (Enhanced AI Summaries)
1. **Template system**: Implement `config/templates/` scanning and loading
2. **Template parser**: Support .md, .yaml, .json template formats
3. **Multi-summary generation**: Apply multiple templates per meeting
4. **Template selection UI**: Allow user to choose which templates to apply
5. **Cost tracking**: Track LLM usage per template/meeting

**Recommendation**: Complete Phase 3 first for cohesive user experience (calendar → auto-record → summary)

---

## Success Metrics

### Phase 1 (Complete)
- ✅ Record 30-minute meeting successfully
- ✅ Transcript accuracy >85%
- ✅ Real-time transcription working
- ✅ AI summary generation functional

### Phase 2 (Complete)
- ✅ 100% of meetings routed to correct folders
- ✅ Markdown files render correctly in Obsidian
- ✅ Zero manual file organization needed

### Phase 3 (In Progress)
- ✅ Calendar events displayed in UI
- ✅ Meeting metadata extracted correctly
- ✅ AI summaries working with gpt-4o-mini
- ⏳ OAuth flow accessible from UI (currently CLI)
- ⏳ Auto-start recording for calendar events

---

**Ready for Phase 2: Obsidian Vault Integration**

Baseline is stable and functional. Next step is to integrate Obsidian file generation and routing system to match the original JD Notes Things specification.
