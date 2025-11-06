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
- **Transcription Service** - TBD (Deepgram, AssemblyAI, or Whisper API)
- **LLM Integration** - Multi-provider (OpenAI, Claude, Gemini) for summaries
- **Windows DPAPI** - Encryption at rest

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):
- Recording Manager - Handles Recall.ai SDK, audio capture
- Transcription Service - Interfaces with transcription API, speaker diarization
- Routing Engine - Matches participants to organizations, determines save location
- LLM Service - Template processing, summary generation
- Calendar Integration - Google Calendar OAuth, meeting detection
- Contact Integration - Google Contacts matching
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
├── clients/{client-slug}/meetings/{date-meeting-title}/
│   ├── index.md                    # AI-generated navigation index
│   ├── full-notes.md               # Full transcript with timestamps
│   └── {template-name}.md          # LLM summaries (multiple per meeting)
├── industry/{contact-slug}/meetings/
├── internal/meetings/
├── _unfiled/{YYYY-MM}/             # Unknown participants
└── config/
    ├── routing.yaml                # Email domain → organization mapping
    └── templates/                  # User-editable LLM prompt templates
```

### Routing System

`config/routing.yaml` determines where meetings are saved based on participant email domains:

- **Priority**: email_overrides → exact contact → domain match → industry → internal → unfiled
- **Multi-org meetings**: Configurable (duplicate in all folders, primary only, or unfiled)
- **See**: `docs/routing-example.yaml` for full structure

### Meeting Index Format

Each meeting folder gets an `index.md` with:
- Metadata (date, participants, platform, duration)
- Quick navigation table linking topics → sections in other files
- File summaries describing each document in the meeting folder
- Action items summary
- **Purpose**: Optimized for LLM retrieval and Obsidian navigation

**Reference**: `docs/index-example.md`

## Template System

User-editable templates live in `config/templates/`. Supports `.md`, `.yaml`, `.json` formats.

The LLM service scans this folder, presents available templates in UI, and generates summaries matching each template's structure from the full transcript.

**Examples**: Client meeting vs internal team meeting have different summary sections.

## Development Phases

**Currently**: Phase 1 - Core Recording & Transcription (Foundation Complete, Implementation Pending)

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

### Google Calendar
- OAuth 2.0, read-only calendar access
- Detects meetings with Zoom/Teams/Meet links
- Auto-start recording when meeting begins (with notification)
- Manual refresh + on-app-launch sync

### Speaker Identification
1. Transcription service provides speaker diarization (Speaker 1, Speaker 2)
2. Match speakers to calendar participants via Google Contacts lookup
3. Label transcript with actual names instead of "Speaker N"
4. Future: Voice fingerprinting for historical matching

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

## Project File Structure (Planned)

```
src/
├── main/
│   ├── recording/       # RecordingManager, RecallSDK, AudioCapture
│   ├── transcription/   # TranscriptionService, SpeakerDiarization
│   ├── routing/         # RoutingEngine, ConfigLoader, EmailMatcher
│   ├── llm/             # LLMService, TemplateProcessor, SummaryGenerator
│   ├── integrations/    # GoogleCalendar, GoogleContacts, HubSpotAPI
│   ├── storage/         # FileManager, Encryption (DPAPI), VaultStructure
│   └── utils/           # Logger, Config
├── renderer/
│   ├── components/      # MainWindow, RecordingWidget, SettingsPanel, etc.
│   └── hooks/
└── shared/              # TypeScript types, constants
```

## Important Constraints

- **Personal use only** - Not for resale or multi-tenant use
- **Windows-first** - macOS/Linux support is future consideration
- **Phase-based delivery** - No time estimates; each phase must be fully functional before moving to next
- **User can manually summarize** - LLM integration is Phase 4, so early phases save raw transcripts for manual processing
- **File-based config** - Users edit YAML/template files directly, UI is optional convenience layer

## Reference Documentation

- **Product Spec**: `SPECIFICATION.md` (authoritative source)
- **Progress Tracker**: `PROGRESS.md` (current status, what's done, what's next)
- **Routing Example**: `docs/routing-example.yaml`
- **Index Example**: `docs/index-example.md`
- **Initial Requirements**: `docs/startingprompt.md`, `docs/answers1.md`
- **Widget Design**: `docs/widget-example.png` (Krisp.ai-style recording overlay)
- **Recall.ai Docs**: https://docs.recall.ai/docs/getting-started
- **Recall.ai Example**: https://github.com/recallai/muesli-public

## Current Project State (Nov 5, 2025)

### Completed
- ✅ Electron + TypeScript + React project initialized
- ✅ Project structure organized (main, renderer, shared)
- ✅ Dependencies installed (Recall.ai SDK, AssemblyAI, React)
- ✅ Basic recording widget UI built and styled
- ✅ TypeScript types and constants defined
- ✅ Webpack build verified successful

### Next Implementation Tasks
1. `src/main/index.ts` - Main Electron process with BrowserWindow and IPC handlers
2. `src/preload.ts` - IPC API exposure to renderer via contextBridge
3. `src/main/recording/RecordingManager.ts` - Recall.ai SDK integration
4. `src/main/transcription/TranscriptionService.ts` - AssemblyAI integration
5. `src/main/storage/FileManager.ts` - Save transcripts to disk
6. Update `src/renderer/App.tsx` - Connect UI to IPC API

### Running the App
- Development: `npm start` (launches Electron with hot reload)
- Build: `npm run package` (creates distributable)
- **Note**: Requires Windows for Recall.ai Desktop SDK

See `PROGRESS.md` for detailed implementation guide and checklist.

## Development Philosophy

- **Iterative**: Each phase is independently useful
- **Real-world testing**: User tests each phase in actual meetings before proceeding
- **Feedback-driven**: Phase N+1 incorporates learnings from Phase N
- **No premature optimization**: Build for clarity first, optimize when needed
- **User-editable configs**: Prefer YAML/file-based config over hardcoded logic where possible
