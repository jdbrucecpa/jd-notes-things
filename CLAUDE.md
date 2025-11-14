# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**JD Notes Things** is a Windows desktop application for automatically recording, transcribing, and summarizing meetings from Zoom, Microsoft Teams, and Google Meet. It's a personal tool (not for resale) that integrates with Google Calendar, Google Contacts, HubSpot, and saves structured notes to an Obsidian vault.

**Complete specification:** See `SPECIFICATION.md` for full product requirements, architecture, and phase-based development plan.

## Technology Stack

- **Electron + Node.js + TypeScript** - Desktop application framework
- **React** - Renderer process UI
- **Webpack + Electron Forge** - Build system
- **Recall.ai Desktop Recording SDK** - Audio/video capture (local recording only)
- **Transcription Service** - Flexible multi-provider (AssemblyAI, Deepgram, Recall.ai) with runtime switching
- **LLM Integration** - Multi-provider (OpenAI, Claude, Gemini) for summaries
- **Windows DPAPI** - Encryption at rest
- **ngrok** - Webhook tunnel for Recall.ai async transcription callbacks

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):

- Recording Manager - Handles Recall.ai SDK, local audio capture
- Transcription Service - Multi-provider (AssemblyAI, Deepgram, Recall.ai) with runtime switching via UI dropdown
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

**Currently**: Phase 10.1 Complete - Ready for Phase 10.2

The project follows a 12-phase plan (see `SPECIFICATION.md`):

1. ✅ Core recording & transcription (MVP)
2. ✅ Routing system
3. ✅ Calendar integration & auto-recording
4. ✅ LLM integration & summaries + prompt caching (85-90% cost savings)
5. ✅ Obsidian export & file generation
6. ✅ Speaker recognition & contact matching
7. ✅ Platform-specific recording (Zoom/Teams/Meet)
8. ✅ Import prior transcripts (bulk import, folder scanning, background processing)
9. ✅ **Encryption & security** (COMPLETE - Core hardening + Comprehensive audit)
   - ✅ XSS protection (DOMPurify)
   - ✅ Path traversal prevention (enhanced validation)
   - ✅ OAuth CSRF protection (mandatory state parameter)
   - ✅ Token file security (icacls verification)
   - ✅ Memory leak prevention
   - ✅ Security audit: 15/15 tests passing, 0 critical vulnerabilities
   - 📋 File encryption & API key management deferred to Phase 10
10. 🔧 **Advanced UI & settings** (IN PROGRESS)
   - ✅ Phase 10.1: Settings Management (getAppVersion, getVaultPath IPC handlers)
   - 🔜 Phase 10.2: API key management UI, encryption settings, speaker correction
11. Real-time transcription (optional)
12. HubSpot CRM integration

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
│   ├── services/
│   │   └── transcriptionService.js  # Multi-provider transcription (AssemblyAI, Deepgram, Recall.ai)
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

## Current Project State (Jan 13, 2025)

### Completed Phases

- ✅ **Phase 1**: Core Recording & Transcription (Recall.ai SDK with async webhook-based transcription)
- ✅ **Phase 2**: Routing System (Email domain matching, vault structure)
- ✅ **Phase 3**: Calendar Integration (Google Calendar OAuth, event fetching)
- ✅ **Phase 4**: LLM Integration (Multi-provider with runtime switching + Prompt Caching)
- ✅ **Phase 5**: Obsidian Export (Auto-export, publish buttons, link tracking - manual override UI deferred)
- ✅ **Phase 6**: Speaker Recognition & Contact Matching (LRU cache, auth notifications)
- ✅ **Phase 7**: Platform-Specific Recording (Zoom/Teams/Meet detection, inherited from Muesli)
- ✅ **Pre-Phase 7 Bug Fixes**: All 5 critical bugs resolved
- ✅ **Phase 8**: Import Prior Transcripts (bulk import, folder scanning, template selection)
- ✅ **Phase 9**: Encryption & Security (Core hardening + Comprehensive security audit)

### Architectural Migration (Nov 10-12, 2025)

- ✅ Migrated from AssemblyAI real-time streaming to Recall.ai async transcription API (Nov 10)
- ✅ Implemented webhook-based workflow with Svix signature verification (Nov 10)
- ✅ Integrated ngrok for automatic webhook tunnel establishment (Nov 10)
- ✅ Removed polling in favor of 100% webhook-driven transcript delivery (Nov 10)
- ✅ Added upload progress tracking UI with animated progress bar (Nov 10)
- ✅ Fixed transcript parsing for Recall.ai format (participant objects with words arrays) (Nov 10)
- ✅ Added participantId and isHost metadata to transcript entries (Nov 10)
- ✅ **Discovered Recall.ai SDK upload broken** (returns null, no progress events) (Nov 12)
- ✅ **Implemented flexible multi-provider transcription system** (Nov 12)
  - AssemblyAI ($0.37/hr), Deepgram ($0.43/hr), Recall.ai ($0.85/hr fallback)
  - UI dropdown for runtime provider switching with localStorage persistence
  - Unified `TranscriptionService` module (`src/main/services/transcriptionService.js`)
  - Cost savings: 49-57% cheaper than Recall.ai full stack
- ✅ **Implemented prompt caching across all LLM providers** (Nov 12)
  - 85-90% cost reduction on template generation
  - Azure OpenAI, OpenAI, and Anthropic Claude all support caching
  - Token budgets optimized: 50,000 for auto-summary, 15,000 for template sections
  - Cache verification logging with performance metrics
  - Total cost per meeting: ~$0.70 (well under $1 budget target)

### Recent Bug Fixes (Nov 10-12, 2025)

- ✅ Fixed Zod schema validation (added missing optional fields with `.passthrough()`)
- ✅ Fixed fileOperationManager deadlock (read waiting for write, write calling read)
- ✅ Fixed misleading "Generating summary..." toast (now says "Transcript saved")
- ✅ All button functionality working (Record In-person Meeting, back button navigation)
- ✅ Fixed ngrok 4.x API compatibility (changed from sync `connect()` to async pattern)
- ✅ Fixed webhook IPC mismatch (changed from IPC events to direct function calls via `global.webhookHandlers`)
- ✅ Fixed calendar meeting Zod validation (added `type: 'calendar'`, changed `transcript` to array)
- ✅ Fixed transcript parsing for Recall.ai format (array of participant objects with words arrays)
- ✅ Added audio recording download URL to transcript metadata (for manual review)
- ✅ Fixed generic title detection to catch numbered variants (Transcript2, Meeting1, etc.) (Nov 12)
- ✅ Enhanced MetadataExtractor with fallback speaker detection from transcript content (Nov 12)
- ✅ Fixed auto-summary token limit for OpenAI gpt-4o-mini (15,000 tokens, not 50,000) (Nov 12)

### Post-Phase 9 Refinements (Jan 13, 2025)

- ✅ **Code refactoring** - Eliminated ~70 lines of duplicate auto-summary code
  - Created shared `generateAndSaveAutoSummary()` function (main.js:4541-4620)
  - Removed duplication from AssemblyAI/Deepgram/Recall.ai transcription paths
  - Single source of truth for auto-summary workflow (DRY principle)
- ✅ **Recording icon bug fix** - Fixed `updateRecordingButtonState is not defined` error
  - Changed to correct function name: `updateRecordingButtonUI(false, null)`
  - File: src/renderer.js:2019
- ✅ **Title update bug fix** - Meeting title not appearing in UI (auto-save race condition)
  - Root cause: Auto-save reading stale DOM title and overwriting new title from AI
  - Solution: Update `document.getElementById('noteTitle').textContent` in `onSummaryGenerated` event
  - File: src/renderer.js:1982
  - Technical detail: Three-way state synchronization (DOM ↔ in-memory object ↔ file)
- ✅ **Immediate UI feedback** - Recording button now clears instantly when meeting ends
  - Moved cleanup and notification to `recording-ended` event (before 3-second transcription delay)
  - Eliminated 30-45 second perceived delay from user experience
  - Transcription and summary continue in background
  - File: src/main.js:974-980

### Phase 10.1: Settings Management (Jan 13, 2025)

- ✅ **Settings module IPC handlers** implemented
  - `settings:getAppVersion` - Returns application version from package.json
  - `settings:getVaultPath` - Returns configured Obsidian vault path from environment
  - File: src/preload.js:92-94
  - Foundation for comprehensive settings UI in Phase 10.2

### Security Hardening & Audit (Phase 9 - Nov 13, 2025 + Jan 13, 2025)

**Core Hardening (Nov 13, 2025):**
- ✅ XSS vulnerability mitigation (DOMPurify sanitization - 6 attack vectors)
- ✅ Path traversal protection (VaultStructure validation)
- ✅ OAuth CSRF protection (state parameter validation)
- ✅ IPC input validation infrastructure (Zod schemas for 36 handlers)
- ✅ Token file permission validation (Windows icacls verification)
- ✅ Memory leak prevention (auth window event listener cleanup)
- ✅ Security dependencies installed (DOMPurify, Zod, keytar, marked)

**Comprehensive Security Audit (Jan 13, 2025):**
- ✅ **15/15 automated security tests passing** (100% pass rate)
- ✅ **2 critical vulnerabilities found and fixed:**
  - Path traversal attacks completely blocked (enhanced validation, 10/10 tests pass)
  - OAuth CSRF bypass prevented (mandatory state parameter, 5/5 tests pass)
- ✅ **0 critical or high-severity vulnerabilities remaining**
- ✅ **Security posture: STRONG** - Ready for personal use deployment
- ✅ **Risk rating: LOW**
- ✅ **Penetration testing completed**: XSS, Path Traversal, OAuth CSRF
- ✅ **Automated scanning**: npm audit (7 low/moderate dev deps only), ESLint security
- ✅ **Manual code review**: All IPC handlers, file operations, API key storage
- ✅ **Documentation**: 45-page comprehensive audit report
- ✅ **Test suites created**: Automated XSS, Path Traversal, OAuth CSRF tests
- 🟡 **2 medium-severity accepted risks** (deferred to Phase 10):
  - API keys in plain text .env file (acceptable for personal use)
  - Partial IPC validation (34/36 handlers, infrastructure complete)

**Audit Artifacts:**
- `docs/phase9-security-report.md` - Initial security hardening report (400+ lines)
- `docs/security-audit-2025-01-13.md` - Comprehensive audit report (45 pages)
- `tests/security/xss-test-payloads.js` - OWASP XSS test suite
- `tests/security/path-traversal-tests.js` - Path traversal penetration tests
- `tests/security/oauth-csrf-tests.js` - OAuth CSRF attack scenarios
- `.eslintrc.json` - ESLint security plugin configuration

**Ngrok Shutdown Fix (Jan 13, 2025):**
- ✅ Fixed ngrok disconnect error on app close
- ✅ Pass URL to `disconnect()` for reliable cleanup
- ✅ Graceful error handling for shutdown edge cases

### Current Status

**Working Features:**

- Manual and automatic meeting recording (Recall.ai SDK - local recording)
- **Flexible transcription provider system:**
  - **AssemblyAI** - $0.37/hr, 3-step API, 57% cheaper (Working ✅)
  - **Deepgram** - $0.43/hr, direct upload, 49% cheaper (Working ✅)
  - **Recall.ai** - $0.85/hr, async webhook-based (SDK upload broken ⚠️, kept as fallback)
  - UI dropdown for provider selection (persists via localStorage)
  - Supports both manual and auto-detected meetings
  - Unified `TranscriptionService` module with provider adapters
- Upload progress tracking with UI progress bar
- Automatic ngrok tunnel establishment for webhooks
- Calendar event detection and display
- Contact matching for speaker identification
- **AI summary generation with templates + prompt caching:**
  - Multi-provider LLM support (Azure OpenAI, OpenAI, Anthropic Claude)
  - 85-90% cost reduction on template generation
  - 99%+ cache hit rate on 2nd+ sections
  - Token budgets: 50,000 for auto-summary, 15,000 per template section
  - Total cost per meeting: ~$0.70 (including transcription)
- **Import prior transcripts:**
  - Bulk import with folder scanning
  - Background processing with progress notifications
  - Granular template selection
  - LLM-based title suggestions for generic titles
  - File overwrite protection
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

**Phase 9: COMPLETE ✅** (Nov 13, 2025 + Jan 13, 2025 Audit)

Core security hardening and comprehensive audit complete. Application is **production-ready for personal use** with:
- ✅ 0 critical or high-severity vulnerabilities
- ✅ 15/15 automated security tests passing
- ✅ Strong security posture (LOW risk rating)
- ✅ Protection against: XSS, path traversal, OAuth CSRF, token theft

**Phase 10.1: COMPLETE ✅** (Jan 13, 2025)

Settings management foundation implemented:
- ✅ IPC handlers for app version and vault path
- ✅ Foundation for comprehensive settings UI

**Phase 10.2 (NEXT): Advanced UI & Settings**

User experience enhancements and security feature completion:

**High Priority:**
1. **API Key Management UI** (Phase 9 Deferred #14)
   - Settings panel for managing API keys
   - Migration from `.env` to Windows Credential Manager
   - Secure storage using `keytar` package
   - Migration wizard for existing keys

2. **Encryption Settings UI** (Phase 9 Deferred #15)
   - Toggle for Windows DPAPI file encryption
   - "Encrypt existing files" / "Decrypt all files" actions
   - Status indicators for encrypted files
   - Warning dialogs for state changes

3. **Windows DPAPI Integration** (Phase 9 Deferred #16)
   - Use Electron's `safeStorage` API (wraps Windows DPAPI)
   - Transparent encryption/decryption on file I/O
   - `.encrypted` suffix for encrypted files
   - Optional feature (off by default)

**Feature Enhancements:**
- Manual Speaker ID Correction UI
- Manual Participant Input During Recording
- Manual Vault Link Override UI (backend complete)
- Separate LLM model config for auto-summary vs template summaries
- Auto-summary template file (editable like other templates)
- Comprehensive settings panel
- Template editor with syntax highlighting
- Routing configuration editor
- Theme support (light/dark)
- Keyboard shortcuts
- System tray menu

**Code Quality:**
- Complete IPC validation rollout (34/36 remaining handlers)
- Additional deferred improvements (TypeScript, component extraction)

**Then:**

- **Phase 11**: Real-time Transcription (optional - streaming transcript during meetings)
- **Phase 12**: HubSpot Integration (CRM sync)
- **Production Testing**: End-to-end system validation with real meetings

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
