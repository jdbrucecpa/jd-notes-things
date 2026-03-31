# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**JD Notes Things** is a Windows desktop application for automatically recording, transcribing, and summarizing meetings from Zoom, Microsoft Teams, and Google Meet. It integrates with Google Calendar, Google Contacts, and saves structured notes to an Obsidian vault.

See [`README.md`](./README.md) for project overview and setup instructions.

## Technology Stack

- **Desktop Framework:** Electron 40.x + Node.js
- **UI:** React 19.x (renderer process)
- **Build System:** Webpack + Electron Forge
- **Recording:** Dual-provider — Recall.ai Desktop SDK 2.x or Local (FFmpeg WASAPI + window monitoring)
- **Transcription:** Multi-provider (AssemblyAI, Deepgram, Local via JD Audio Service) with runtime switching
- **LLM:** Multi-provider (OpenAI, Anthropic Claude, Azure OpenAI, Google Gemini, Local via Ollama/LM Studio) with prompt caching
- **Local AI Service:** JD Audio Service (separate Python FastAPI app) — Parakeet TDT + PyAnnote diarization + speaker embeddings
- **Security:** Windows DPAPI encryption, Windows Credential Manager for API keys
- **OAuth:** Google OAuth 2.0 (unified Calendar + Contacts)

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):

- Recording Manager - Dual-provider: Recall.ai SDK or Local (FFmpeg WASAPI)
- Transcription Service - Multi-provider (AssemblyAI, Deepgram, Local) with runtime switching
- Voice Profile Service - Speaker identification via PyAnnote embeddings stored in SQLite
- Routing Engine - Participant organization matching → company folders (DB-driven)
- LLM Service - Multi-provider template processing, summary generation with caching
- Google Integration - Unified OAuth 2.0 for Calendar + Contacts
- File Manager - Obsidian vault structure, contact/company page creation
- Key Management - Windows Credential Manager integration

**Renderer Process** (`src/renderer/`):

- Main Window - Calendar view, meeting list, recording controls
- Settings Panel - Full-page configuration UI with Monaco Editor
- Import Wizard - Bulk transcript import

**IPC Communication:** Main ↔ Renderer via preload script

### File Organization

```
src/
├── main/
│   ├── recording/              # RecordingManager, RecallProvider, LocalProvider
│   ├── services/
│   │   ├── transcriptionService.js  # Multi-provider transcription (AssemblyAI, Deepgram, Local)
│   │   ├── llmService.js            # Multi-provider LLM with caching + LocalLLMAdapter
│   │   ├── voiceProfileService.js   # Voice profile CRUD, embedding math, speaker ID
│   │   ├── clientService.js         # Company/client CRUD, email-to-client matching
│   │   ├── keyManagementService.js  # Windows Credential Manager
│   │   └── databaseService.js       # SQLite (schema v4: meetings, clients, voice profiles)
│   ├── routing/                # RoutingEngine (DB-driven, matches org → clients table)
│   ├── templates/              # TemplateManager, TemplateParser, contactTemplate, companyTemplate
│   ├── integrations/
│   │   ├── GoogleAuth.js       # Unified OAuth 2.0
│   │   ├── GoogleCalendar.js   # Calendar event fetching
│   │   ├── GoogleContacts.js   # Contact matching with LRU cache
│   │   └── SpeakerMatcher.js   # Multi-stage speaker identification (voice profiles → contacts → heuristics)
│   ├── storage/                # VaultStructure, file operations
│   └── utils/                  # Logger, Config
├── renderer/
│   ├── settings.js             # Settings panel logic
│   ├── contacts.js             # Contacts/Companies view
│   ├── companyDetail.js        # Company detail panel
│   ├── meetingDetail.js        # Meeting detail, participant cards, speaker mapping
│   ├── templates.js            # Template editor with Monaco
│   └── securitySettings.js     # API key management UI
├── shared/                     # Zod validation schemas
└── preload.js                  # IPC bridge
```

## Obsidian Vault Integration

The app writes to a user-configured Obsidian vault:

```
vault/
├── clients/{slug}/meetings/      # Client meeting notes (absolute paths from DB)
├── industry/{slug}/meetings/     # Industry-categorized meetings
├── internal/meetings/            # Internal team meetings
├── _unfiled/{YYYY-MM}/meetings/  # Unrouted meetings
├── People/                       # Contact pages (auto-created from Google Contacts)
├── Companies/                    # Company pages (auto-created from routing)
└── config/
    └── templates/                # User-editable LLM prompt templates (.md, .yaml, .json, .txt)
```

### Two-File Architecture

Each meeting generates **two markdown files**:

1. **Summary File:** `YYYY-MM-DD-meeting-slug.md`
   - YAML frontmatter with complete metadata
   - AI-generated executive summary
   - Link to transcript

2. **Transcript File:** `YYYY-MM-DD-meeting-slug-transcript.md`
   - Full timestamped conversation
   - Speaker labels
   - Link back to summary

**Rationale:** 60% token cost savings (most LLM queries only need summary).

## Key Technical Details

### Routing System

DB-driven routing determines where meetings are saved based on participant organizations:

**Priority:** participant organization → `clients` table match → `client_contacts` email fallback → unfiled

Companies are configured in the Clients settings tab with a vault folder path and category. The old `routing.yaml` file-based system was removed in v1.4.

### Template System

User-editable templates in `config/templates/` (supports `.md`, `.yaml`, `.json`, `.txt`).

LLM service scans folder, presents templates in UI, generates summaries matching structure.

**Special template:** `config/templates/auto-summary-prompt.txt` - Editable auto-summary prompt (replaces hardcoded prompt).

### Multi-Provider Transcription

Unified `TranscriptionService` with provider-specific adapters:

- **AssemblyAI:** $0.37/hr (3-step API: upload → transcribe → poll)
- **Deepgram:** $0.43/hr (direct upload)
- **Local:** Free — JD Audio Service (Parakeet TDT 0.6B + PyAnnote diarization). Requires GPU with ~2.3GB VRAM.

Runtime switching via UI dropdown with localStorage persistence. The `recallai` transcription provider was removed in v2.0.

### LLM Integration with Prompt Caching

Multi-provider support with 85-90% cost reduction:

- **Cloud:** Azure OpenAI, OpenAI, Anthropic Claude, Google Gemini — all support automatic prompt caching
- **Local:** Ollama or LM Studio via LocalLLMAdapter (auto-discovers models from either `/api/tags` or `/v1/models`)
- Separate static content (transcript) from dynamic content (section prompts)
- Token budgets: 50,000 for auto-summary, 15,000 per template section
- Cache verification logging with performance metrics

### Google Integration

**Unified Authentication:**

- Single OAuth 2.0 flow for Calendar + Contacts
- Combined scopes: `calendar.events` + `contacts` + `gmail.readonly` + `userinfo.email`
- Single token file with automatic refresh
- Shared `GoogleAuth.js` module

**Google Contacts:**

- LRU cache (5,000 max entries, 24-hour TTL)
- Batch email lookups for speaker matching

### Speaker Identification

Multi-stage matching pipeline in `SpeakerMatcher.js`:

1. **Stage 0: Voice profiles** — Match speaker embeddings (from JD Audio Service) against stored voice profile embeddings in SQLite. Cosine distance threshold.
2. **Stage 1: Timeline priority** — Map speakers to participants using join times and speaking order
3. **Stage 2: AssemblyAI supplementary** — Use AssemblyAI's speaker labels if available
4. **Stage 3: Heuristics** — Count-based, first speaker, most talkative algorithms
5. Label transcript with actual names via Google Contacts enrichment

Voice profiles are linked to Google Contacts and stored in the `voice_profiles` / `voice_samples` SQLite tables (schema v4). Embeddings are 256-dimensional PyAnnote vectors.

### Participant Data Model (IMPORTANT)

**Data Authority Hierarchy:**
- **`originalName`:** The IMMUTABLE participant name from Zoom SDK. This field is set once when a participant joins and should NEVER be modified. This is the source of truth.
- **`name`:** Display name that may be updated by contact matching. Can become corrupted - always fall back to `originalName`.
- **Emails:** NEVER authoritative. Emails are always inferred from Google Contacts matching and can be wrong. The Zoom SDK and transcription services do not provide participant emails.
- **Organization:** Inferred from contact matching, not authoritative.

**Participant Object Structure:**
```javascript
{
  id: string,           // SDK participant ID
  originalName: string, // IMMUTABLE - original Zoom display name, NEVER modify
  name: string,         // Display name (may be updated by contact matching)
  email: string|null,   // INFERRED from contact matching, may be wrong
  organization: string|null,  // INFERRED from contact matching
  isHost: boolean,
  platform: string,
  joinTime: string,     // ISO timestamp
}
```

**Key Rule:** When refreshing or re-matching participants, always use `originalName` as the source of truth. Only update supplementary fields (email, organization) from contact matching - never the `originalName` field.

**Why this matters:** Contact matching uses fuzzy name matching which can produce false positives (e.g., "Tim Peyser" matching to "Tim Rasmussen" contact). The `originalName` field preserves the true identity even if `name` gets corrupted.

### Security

- **XSS Protection:** DOMPurify sanitization (6 attack vectors secured)
- **Path Traversal:** Enhanced validation in VaultStructure
- **OAuth CSRF:** Mandatory state parameter validation
- **API Keys:** Windows Credential Manager (with .env fallback)
- **File Encryption:** DPAPI (currently unused - Obsidian requires plain text)
- **Token Files:** Windows icacls permission validation
- **IPC Validation:** Zod schemas for validated handlers

## v2.0 Local-First Architecture

v2.0 adds fully local alternatives to every cloud dependency while keeping all cloud providers functional. Any layer (recording, transcription, summarization) can independently use local or cloud providers.

- **Local Recording:** FFmpeg WASAPI audio capture + window monitoring (Zoom/Teams only, not Google Meet)
- **Local Transcription:** JD Audio Service — Parakeet TDT 0.6B + PyAnnote diarization (separate Python app at `C:\Users\brigh\Documents\code\jd-audio-service`)
- **Local LLM:** Ollama or LM Studio via LocalLLMAdapter
- **Voice Profiles:** PyAnnote 256-d speaker embeddings stored in SQLite, linked to Google Contacts
- **"Apply Fully Local" preset:** One button sets all layers to local providers

### Key v2.0 Details

- `transcriptionProvider` stored in `localStorage.getItem('transcriptionProvider')` (NOT in app settings JSON)
- JD Audio Service default endpoint: `http://localhost:8374`
- Local LLM default endpoint: `http://localhost:11434` (Ollama default)
- Models lazy-load on demand, auto-unload after 5min idle
- Voice profile assignment IPC requires non-empty embedding array

## Important Constraints

- **Personal use only** - Not for resale or multi-tenant
- **Windows-first** - macOS/Linux support is future consideration
- **Phase-based delivery** - Each phase must be fully functional before proceeding
- **File-based config** - Users edit YAML/template files directly, UI is convenience layer
- **Obsidian compatibility** - Vault files must be plain text markdown (no encryption)

## Development Commands

```bash
npm start           # Development mode with hot reload
npm run package     # Build for current platform
npm run make        # Create distributable installer
npm run lint        # Run ESLint
npm run format      # Format with Prettier
npm test            # Run unit tests (Vitest)
npm run test:watch  # Unit tests in watch mode
```

### E2E Testing

```bash
E2E_TEST=1 npm start                              # Start app with CDP port 9222
npx playwright test tests/e2e/app.spec.js          # Run main E2E suite (37 tests)
npx playwright test tests/e2e/recording-pipeline.spec.js   # Recording pipeline tests
npx playwright test tests/e2e/recording-providers.spec.js  # Provider abstraction tests
```

## Reference Documentation

- **[README.md](./README.md)** - Project overview and quick start
- **[v2.0 Design Spec](./docs/superpowers/specs/2026-03-18-v2-local-first-design.md)** - Local-first architecture design
- **[Recall.ai SDK Docs](https://docs.recall.ai/docs/getting-started)** - Recording SDK reference

## Development Philosophy

- **Iterative:** Each phase delivers independently useful functionality
- **Real-world testing:** User validates each phase before proceeding
- **Feedback-driven:** Phase N+1 incorporates learnings from Phase N
- **No premature optimization:** Build for clarity first
- **User-editable configs:** Prefer file-based over hardcoded where possible
- **Zero lint warnings:** Always fix ESLint errors and warnings. Do not leave warnings unresolved unless there is a documented reason. Run `npm run lint` after making changes and fix any issues before considering work complete.
