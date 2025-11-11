# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**JD Notes Things** is a Windows desktop application for automatically recording, transcribing, and summarizing meetings from Zoom, Microsoft Teams, and Google Meet. It's a personal tool (not for resale) that integrates with Google Calendar, Google Contacts, HubSpot, and saves structured notes to an Obsidian vault.

**Complete specification:** See `SPECIFICATION.md` for full product requirements, architecture, and phase-based development plan.

## Technology Stack

- **Electron + Node.js + TypeScript** - Desktop application framework
- **React** - Renderer process UI
- **Webpack + Electron Forge** - Build system
- **Recall.ai Desktop Recording SDK** - Audio/video capture
- **Transcription Service** - Recall.ai Async API (webhook-based with speaker diarization)
- **LLM Integration** - Multi-provider (OpenAI, Claude, Gemini) for summaries
- **Windows DPAPI** - Encryption at rest
- **ngrok** - Webhook tunnel for Recall.ai async transcription callbacks

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):
- Recording Manager - Handles Recall.ai SDK, audio capture, upload to Recall.ai
- Transcription Service - Webhook-based async transcription via Recall.ai API
- Webhook Server - Express server on port 13373 for Recall.ai callbacks
- ngrok Integration - Automatic tunnel establishment for webhook endpoint
- Routing Engine - Matches participants to organizations, determines save location
- LLM Service - Template processing, summary generation
- Google Integration - Unified OAuth 2.0 authentication for Calendar + Contacts
- Calendar Integration - Google Calendar event fetching, meeting detection
- Contact Integration - Google Contacts matching, speaker identification
- HubSpot Integration - CRM sync
- File Manager - Obsidian vault structure, encryption (DPAPI)

**Renderer Process** (`src/renderer/`):
- Main Window - Calendar view, upcoming meetings
- Recording Widget - Always-on-top overlay during recording
- Settings Panel - Configuration UI
- Import Wizard - Bulk transcript import

**IPC Communication**: Main ↔ Renderer for all state updates and user actions.

## Obsidian Vault Integration

The app writes to a user-configured Obsidian vault with this structure:

```
vault/
├── clients/{client-slug}/meetings/
│   ├── YYYY-MM-DD-meeting-title.md            # Summary with metadata
│   ├── YYYY-MM-DD-meeting-title-transcript.md # Full transcript
│   └── YYYY-MM-DD-another-meeting.md
├── industry/{contact-slug}/meetings/
├── internal/meetings/
├── _unfiled/{YYYY-MM}/meetings/    # Unknown participants
└── config/
    ├── routing.yaml                # Email domain → organization mapping
    └── templates/                  # User-editable LLM prompt templates
```

### Two-File Architecture

Each meeting generates **two markdown files**:

**Primary File (Summary):**
- Filename: `YYYY-MM-DD-meeting-slug.md`
- Complete metadata in YAML frontmatter (participants, tags, topics, platform, duration)
- AI-generated executive summary with decisions and action items
- Link to transcript file
- **Purpose**: Quick reference, LLM queries (cheap), CRM linking, Obsidian search

**Secondary File (Transcript):**
- Filename: `YYYY-MM-DD-meeting-slug-transcript.md`
- Full timestamped conversation with speaker labels
- Link back to summary
- **Purpose**: Deep dives, exact quotes, full context (more expensive for LLM reads)

**Rationale**: Two-file structure provides ~60% token cost savings (most LLM queries only need summary, not full transcript). No `index.md` file - previous multi-file design with navigation index was over-engineered.

### Routing System

`config/routing.yaml` determines where meetings are saved based on participant email domains:

- **Priority**: email_overrides → exact contact → domain match → industry → internal → unfiled
- **Multi-org meetings**: Configurable (duplicate in all folders, primary only, or unfiled)
- **See**: `docs/routing-example.yaml` for full structure

## Template System

User-editable templates live in `config/templates/`. Supports `.md`, `.yaml`, `.json` formats.

The LLM service scans this folder, presents available templates in UI, and generates summaries matching each template's structure from the full transcript.

**Examples**: Client meeting vs internal team meeting have different summary sections.

## Development Phases

**Currently**: Pre-Phase 8 - Essential UI & Code Quality

The project follows a 12-phase plan (see `SPECIFICATION.md`):
1. ✅ Core recording & transcription (MVP)
2. ✅ Routing system
3. ✅ Calendar integration & auto-recording
4. ✅ LLM integration & summaries
5. ✅ Obsidian export & file generation
6. ✅ Speaker recognition & contact matching
7. ✅ Platform-specific recording (Zoom/Teams/Meet)
8. 🚧 Pre-Phase 8: Vault override UI + logging + linting (CURRENT - 5-8 hours)
9. 🔜 Import prior transcripts (NEXT)
10. Encryption & security
11. Advanced UI & settings (speaker correction, participant input, etc.)
12. Real-time transcription (optional)
13. HubSpot CRM integration

Each phase delivers independently useful functionality.

## Key Integration Points

### Recall.ai SDK
- Reference implementation: https://github.com/recallai/muesli-public
- Handles system audio capture and app-specific recording
- Windows compatibility confirmed via muesli example

### Google Integration (Calendar + Contacts)

**Unified Authentication:**
- Single OAuth 2.0 flow for both Calendar and Contacts APIs
- Combined scopes: `calendar.readonly` + `contacts.readonly`
- Single token file (`google-token.json`) with automatic refresh
- Shared authentication module (`GoogleAuth.js`) for centralized token management

**Google Calendar:**
- Read-only calendar access
- Detects meetings with Zoom/Teams/Meet links
- Extracts participant emails and meeting metadata
- Auto-start recording when meeting begins (with notification)
- Manual refresh + on-app-launch sync

**Google Contacts:**
- Contact caching with 24-hour expiry
- Fast email-based lookups for speaker matching
- Batch contact fetching on authentication
- Automatic re-authentication when cache expires

### Speaker Identification
1. Transcription service provides speaker diarization (Speaker 1, Speaker 2)
2. Match speakers to calendar participants via Google Contacts lookup
3. Label transcript with actual names instead of "Speaker N"
4. Heuristic-based matching (word count, timing, first speaker patterns)
5. Future: Voice fingerprinting for historical matching

### HubSpot Sync
- Match email domain → HubSpot Company (prioritize Companies over Contacts)
- Create Note/Activity with meeting summary
- Associate with Company + all matched Contacts
- Include link to Obsidian notes (research `obsidian://` protocol viability)

## Security & Privacy

- **Encryption**: All transcripts and audio files encrypted at rest using Windows DPAPI (user-toggleable)
- **API Keys**: Stored in Windows Credential Manager
- **No recording consent announcements**: User responsibility (not in-app feature)
- **Local-first**: All data stored locally in Obsidian vault, encrypted if enabled

## Project File Structure

```
src/
├── main/
│   ├── recording/       # RecordingManager, RecallSDK, AudioCapture
│   ├── transcription/   # TranscriptionService, SpeakerDiarization
│   ├── routing/         # RoutingEngine, ConfigLoader, EmailMatcher
│   ├── llm/             # LLMService, TemplateProcessor, SummaryGenerator
│   ├── integrations/
│   │   ├── GoogleAuth.js       # Unified OAuth 2.0 for Calendar + Contacts
│   │   ├── GoogleCalendar.js   # Calendar event fetching
│   │   ├── GoogleContacts.js   # Contact matching
│   │   ├── SpeakerMatcher.js   # Speaker identification
│   │   └── HubSpotAPI.js       # CRM sync (future)
│   ├── storage/         # FileManager, Encryption (DPAPI), VaultStructure
│   └── utils/           # Logger, Config
├── renderer/
│   ├── components/      # MainWindow, RecordingWidget, SettingsPanel, etc.
│   └── hooks/
└── shared/              # TypeScript types, constants, validation
```

## Important Constraints

- **Personal use only** - Not for resale or multi-tenant use
- **Windows-first** - macOS/Linux support is future consideration
- **Phase-based delivery** - No time estimates; each phase must be fully functional before moving to next
- **User can manually summarize** - LLM integration is Phase 4, so early phases save raw transcripts for manual processing
- **File-based config** - Users edit YAML/template files directly, UI is optional convenience layer

## Reference Documentation

- **Product Spec**: `SPECIFICATION.md` (authoritative source - includes detailed status)
- **Routing Example**: `docs/routing-example.yaml`
- **Index Example**: `docs/index-example.md`
- **Initial Requirements**: `docs/startingprompt.md`, `docs/answers1.md`
- **Widget Design**: `docs/widget-example.png` (Krisp.ai-style recording overlay)
- **Recall.ai Docs**: https://docs.recall.ai/docs/getting-started
- **Recall.ai Example**: https://github.com/recallai/muesli-public

## Current Project State (Nov 10, 2025)

### Completed Phases
- ✅ **Phase 1**: Core Recording & Transcription (Recall.ai SDK with async webhook-based transcription)
- ✅ **Phase 2**: Routing System (Email domain matching, vault structure)
- ✅ **Phase 3**: Calendar Integration (Google Calendar OAuth, event fetching)
- ✅ **Phase 4**: LLM Integration (Multi-provider with runtime switching)
- ✅ **Phase 5**: Obsidian Export (Auto-export, publish buttons, link tracking - manual override UI deferred)
- ✅ **Phase 6**: Speaker Recognition & Contact Matching (LRU cache, auth notifications)
- ✅ **Phase 7**: Platform-Specific Recording (Zoom/Teams/Meet detection, inherited from Muesli)
- ✅ **Pre-Phase 7 Bug Fixes**: All 5 critical bugs resolved

### Architectural Migration (Nov 10, 2025)
- ✅ Migrated from AssemblyAI real-time streaming to Recall.ai async transcription API
- ✅ Implemented webhook-based workflow with Svix signature verification
- ✅ Integrated ngrok for automatic webhook tunnel establishment
- ✅ Removed polling in favor of 100% webhook-driven transcript delivery
- ✅ Added upload progress tracking UI with animated progress bar
- ✅ Fixed transcript parsing for Recall.ai format (participant objects with words arrays)
- ✅ Added participantId and isHost metadata to transcript entries

### Recent Bug Fixes (Nov 10, 2025)
- ✅ Fixed Zod schema validation (added missing optional fields with `.passthrough()`)
- ✅ Fixed fileOperationManager deadlock (read waiting for write, write calling read)
- ✅ Fixed misleading "Generating summary..." toast (now says "Transcript saved")
- ✅ All button functionality working (Record In-person Meeting, back button navigation)
- ✅ Fixed ngrok 4.x API compatibility (changed from sync `connect()` to async pattern)
- ✅ Fixed webhook IPC mismatch (changed from IPC events to direct function calls via `global.webhookHandlers`)
- ✅ Fixed calendar meeting Zod validation (added `type: 'calendar'`, changed `transcript` to array)
- ✅ Fixed transcript parsing for Recall.ai format (array of participant objects with words arrays)
- ✅ Added audio recording download URL to transcript metadata (for manual review)

### Current Status
**Working Features:**
- Manual and automatic meeting recording
- Async webhook-based transcription with speaker diarization (Recall.ai)
- Upload progress tracking with UI progress bar
- Automatic ngrok tunnel establishment for webhooks
- Calendar event detection and display
- Contact matching for speaker identification
- AI summary generation with templates
- Obsidian vault export with routing
- Two-file meeting architecture (summary + transcript)
- Svix webhook signature verification for security

**Platform Detection (Nov 8, 2025):**
- ✅ Zoom meeting detection working (tested with solo meeting)
- ✅ Platform metadata saved in meeting objects
- ✅ Calendar integration detects platform from meeting links
- ✅ UI displays platform-specific colors and icons

**Phase 5 Status (Nov 10, 2025):**
- ✅ Auto-export after template generation (main.js:1905-1916)
- ✅ Manual Publish/Republish buttons with confirmation (renderer.js:2785-2839)
- ✅ Obsidian link tracking (`meeting.obsidianLink` field - validation.js:45, main.js:1077-1086)
- 🟡 Manual vault link override (backend complete main.js:976-978, UI input field missing - deferred to Phase 11)
- ✅ Multiple templates concatenated in single summary.md file (main.js:1186-1192)
- ✅ UI status indicator - green badge on meeting cards (renderer.js:350-358)

**Feature Requests Added to Phase 11:**
- Separate LLM model configuration for auto-summary vs template-based summaries
- Auto-summary template file (editable like other templates, instead of hardcoded prompt)

### Next Steps

**Pre-Phase 8 (CURRENT - 5-8 hours):**
Essential UI and code quality before HubSpot integration:

**Tasks:**
1. Manual Vault Link Override UI - Edit obsidianLink field in meeting editor (2-3h)
2. Proper Logging Framework - Install electron-log for structured logging (2-3h)
3. ESLint & Prettier - Code linting and formatting (1-2h)

**Then:**
4. **Phase 8**: Import Prior Transcripts (bulk import existing meeting notes)
5. **Phase 9**: Security hardening (XSS, CSRF, IPC validation, credential manager, DPAPI encryption)
6. **Phase 10**: Advanced UI & Settings
   - Manual Speaker ID Correction UI
   - Manual Participant Input During Recording
   - Separate LLM model config for auto-summary vs template summaries
   - Auto-summary template file (editable like other templates)
   - Additional deferred code quality improvements (TypeScript, component extraction, etc.)
7. **Phase 11**: Real-time Transcription (optional - streaming transcript during meetings)
8. **Phase 12**: HubSpot Integration (CRM sync)
9. **Production Testing**: End-to-end system validation with real meetings

### Running the App
- Development: `npm start` (launches Electron with hot reload)
- Build: `npm run package` (creates distributable)
- **Note**: Requires Windows for Recall.ai Desktop SDK

## Development Philosophy

- **Iterative**: Each phase is independently useful
- **Real-world testing**: User tests each phase in actual meetings before proceeding
- **Feedback-driven**: Phase N+1 incorporates learnings from Phase N
- **No premature optimization**: Build for clarity first, optimize when needed
- **User-editable configs**: Prefer YAML/file-based config over hardcoded logic where possible
