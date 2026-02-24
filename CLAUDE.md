# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**JD Notes Things** is a Windows desktop application for automatically recording, transcribing, and summarizing meetings from Zoom, Microsoft Teams, and Google Meet. It integrates with Google Calendar, Google Contacts, and saves structured notes to an Obsidian vault.

See [`README.md`](./README.md) for project overview and setup instructions.

## Technology Stack

- **Desktop Framework:** Electron 39.x + Node.js
- **UI:** React 19.x (renderer process)
- **Build System:** Webpack + Electron Forge
- **Recording:** Recall.ai Desktop SDK 2.x (local audio capture)
- **Transcription:** Multi-provider system (AssemblyAI, Deepgram, Recall.ai) with runtime switching
- **LLM:** Multi-provider (OpenAI, Anthropic Claude, Azure OpenAI) with prompt caching
- **Webhooks:** Express + localtunnel + Svix signature verification
- **Security:** Windows DPAPI encryption, Windows Credential Manager for API keys
- **OAuth:** Google OAuth 2.0 (unified Calendar + Contacts)

## Architecture

### Electron Process Model

**Main Process** (`src/main/`):

- Recording Manager - Recall.ai SDK, local audio capture
- Transcription Service - Multi-provider with runtime UI switching
- Webhook Server - Express on port 13373 for async transcription callbacks
- Localtunnel Integration - Automatic tunnel for webhook endpoints
- Routing Engine - Participant matching → organization folders
- LLM Service - Template processing, summary generation with caching
- Google Integration - Unified OAuth 2.0 for Calendar + Contacts
- File Manager - Obsidian vault structure, DPAPI encryption
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
│   ├── recording/              # RecordingManager, Recall SDK
│   ├── services/
│   │   ├── transcriptionService.js  # Unified multi-provider transcription
│   │   ├── llmService.js            # Multi-provider LLM with caching
│   │   ├── keyManagementService.js  # Windows Credential Manager
│   │   └── encryptionService.js     # DPAPI encryption
│   ├── routing/                # RoutingEngine, ConfigLoader, EmailMatcher
│   ├── templates/              # TemplateManager, TemplateParser
│   ├── integrations/
│   │   ├── GoogleAuth.js       # Unified OAuth 2.0
│   │   ├── GoogleCalendar.js   # Calendar event fetching
│   │   ├── GoogleContacts.js   # Contact matching with LRU cache
│   │   └── SpeakerMatcher.js   # Heuristic speaker identification
│   ├── storage/                # VaultStructure, file operations
│   └── utils/                  # Logger, Config
├── renderer/
│   ├── settings.js             # Settings panel logic
│   ├── templates.js            # Template editor with Monaco
│   └── securitySettings.js     # API key management UI
├── shared/                     # Zod validation schemas
└── preload.js                  # IPC bridge
```

## Obsidian Vault Integration

The app writes to a user-configured Obsidian vault:

```
vault/
├── clients/{slug}/meetings/
├── industry/{slug}/meetings/
├── internal/meetings/
├── _unfiled/{YYYY-MM}/meetings/
└── config/
    ├── routing.yaml            # Email domain → organization mapping
    └── templates/              # User-editable LLM prompt templates (.md, .yaml, .json, .txt)
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

`config/routing.yaml` determines where meetings are saved based on participant emails:

**Priority:** email_overrides → exact contact → domain match → industry → internal → unfiled

See `config/routing.yaml` for structure and examples.

### Template System

User-editable templates in `config/templates/` (supports `.md`, `.yaml`, `.json`, `.txt`).

LLM service scans folder, presents templates in UI, generates summaries matching structure.

**Special template:** `config/templates/auto-summary-prompt.txt` - Editable auto-summary prompt (replaces hardcoded prompt).

### Multi-Provider Transcription

Unified `TranscriptionService` with provider-specific adapters:

- **AssemblyAI:** $0.37/hr (3-step API: upload → transcribe → poll)
- **Deepgram:** $0.43/hr (direct upload)
- **Recall.ai:** $0.85/hr (async webhook-based, SDK upload currently broken)

Runtime switching via UI dropdown with localStorage persistence.

### LLM Integration with Prompt Caching

Multi-provider support with 85-90% cost reduction:

- **Azure OpenAI, OpenAI, Anthropic Claude** - All support automatic prompt caching
- Separate static content (transcript) from dynamic content (section prompts)
- Token budgets: 50,000 for auto-summary, 15,000 per template section
- Cache verification logging with performance metrics

### Google Integration

**Unified Authentication:**

- Single OAuth 2.0 flow for Calendar + Contacts
- Combined scopes: `calendar.readonly` + `contacts.readonly`
- Single token file with automatic refresh
- Shared `GoogleAuth.js` module

**Google Contacts:**

- LRU cache (5,000 max entries, 24-hour TTL)
- Batch email lookups for speaker matching

### Speaker Identification

1. Transcription service provides diarization (Speaker 1, Speaker 2)
2. Match speakers to calendar participants via Google Contacts
3. Heuristic algorithms: count-based, first speaker, most talkative
4. Label transcript with actual names

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
- **IPC Validation:** Zod schemas (2/36 handlers, infrastructure complete)

## Pending Features (v1.2.6+)

Features that are implemented in backend but lack UI:

- **Verbatim Mode:** Transcription service supports `options.verbatim = true` to preserve filler words (um, uh, etc.) but no Settings toggle exists. To enable programmatically, pass `{ verbatim: true }` to `transcriptionService.transcribe()`.

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
```

## Updating the Recall.ai Desktop SDK

To update the Recall.ai Desktop SDK to the latest version:

```bash
npm install @recallai/desktop-sdk
```

Check the [SDK Changelog](https://docs.recall.ai/docs/dsdk-changelog) for release notes.

## Reference Documentation

- **[README.md](./README.md)** - Project overview and quick start
- **[config/routing.yaml](./config/routing.yaml)** - Routing configuration example
- **[Recall.ai SDK Docs](https://docs.recall.ai/docs/getting-started)** - Recording SDK reference
- **[Muesli Example](https://github.com/recallai/muesli-public)** - Recall.ai reference implementation

## Development Philosophy

- **Iterative:** Each phase delivers independently useful functionality
- **Real-world testing:** User validates each phase before proceeding
- **Feedback-driven:** Phase N+1 incorporates learnings from Phase N
- **No premature optimization:** Build for clarity first
- **User-editable configs:** Prefer file-based over hardcoded where possible
