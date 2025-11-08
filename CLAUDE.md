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
- **Transcription Service** - AssemblyAI v3 (streaming with speaker diarization)
- **LLM Integration** - Multi-provider (OpenAI, Claude, Gemini) for summaries
- **Windows DPAPI** - Encryption at rest

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):
- Recording Manager - Handles Recall.ai SDK, audio capture
- Transcription Service - Interfaces with transcription API, speaker diarization
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

**Currently**: Phase 6 Complete - All Core Features Implemented (Ready for production testing or Phase 7+)

The project follows a 12-phase plan (see `SPECIFICATION.md`):
1. Core recording & transcription (MVP)
2. Routing system
3. Calendar integration & auto-recording
4. LLM integration & summaries
5. Meeting index generation
6. Speaker recognition & contact matching
7. Platform-specific recording (Zoom/Teams/Meet)
8. HubSpot integration
9. Import prior transcripts
10. Encryption & security
11. Advanced UI & settings
12. Real-time transcription (optional)

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

## Current Project State (Nov 8, 2025)

### Completed Phases
- ✅ **Phase 1**: Core Recording & Transcription (Recall.ai SDK, AssemblyAI streaming)
- ✅ **Phase 2**: Routing System (Email domain matching, vault structure)
- ✅ **Phase 3**: Calendar Integration (Google Calendar OAuth, event fetching)
- ✅ **Phase 4**: LLM Integration (OpenAI summaries with templates)
- ✅ **Phase 5**: Obsidian Export (Two-file architecture with frontmatter)
- ✅ **Phase 6**: Speaker Recognition & Contact Matching (COMPLETE)

### Recent Additions (Nov 7, 2025)
- ✅ Unified Google authentication (GoogleAuth.js)
- ✅ Single OAuth flow for Calendar + Contacts
- ✅ Google Contacts integration with caching
- ✅ Speaker matching with heuristic algorithms
- ✅ Contact count tracking (unique contacts vs email addresses)
- ✅ UI authentication with single Google button
- ✅ Consolidated IPC handlers (10 → 6 handlers)

### Current Status
**Working Features:**
- Manual and automatic meeting recording
- Real-time transcription with speaker diarization
- Calendar event detection and display
- Contact matching for speaker identification
- AI summary generation with templates
- Obsidian vault export with routing
- Two-file meeting architecture (summary + transcript)

**Security Fixes Applied (Nov 7, 2025):**
- ✅ Fixed race condition in service initialization (centralized `initializeGoogleServices()`)
- ✅ Secured token file permissions (0o600 Unix, icacls Windows)
- ✅ Implemented token refresh failure recovery (clears state, re-authentication flow)
- ✅ Fixed auth window memory leak (proper cleanup with timeout)
- ⏳ Contact cache validation (deferred - low risk from trusted Google API)

**Code Review Completed (Nov 8, 2025):**
- Comprehensive review of 5,500 lines across 17 files
- 42 issues identified and categorized by development phase
- All findings documented in SPECIFICATION.md
- Security items (XSS, path traversal, CSRF, etc.) scheduled for Phase 10
- Code quality improvements (state management, config) scheduled for Phase 11
- Critical bug fixes (routing error, race conditions) documented in Pre-Phase 7

### Next Steps
1. **Pre-Phase 7 Bug Fixes**: Fix 5 critical bugs identified in code review (4-6 hours)
   - RoutingEngine method signature bug
   - Service initialization robustness
   - Token refresh user notification
   - File operation race conditions
   - LRU cache for contacts
2. **Production Testing**: Test complete system end-to-end with real meetings
3. **Phase 7**: Platform-Specific Recording (Zoom/Teams/Meet optimization)
4. **Phase 10**: Security hardening (XSS, CSRF, IPC validation, credential manager)
5. **Phase 11**: Code quality improvements (React migration, state management)

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
