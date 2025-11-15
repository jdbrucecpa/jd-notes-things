# JD Notes Things

**AI Meeting Notetaker for Zoom, Microsoft Teams, and Google Meet**

> Personal tool by JD Knows Things - Not for resale

---

## Quick Start

### Prerequisites

- **Windows** (required for Recall.ai Desktop SDK)
- **Node.js** v18+ (tested with v22.20.0)
- **npm** v10+
- **Recall.ai API Key** ([Get one here](https://recall.ai))
- **ngrok Account** (free tier sufficient) for webhook tunnel ([Get one here](https://ngrok.com))

### Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Add your API keys to .env
# RECALLAI_API_KEY=your_key_here
# NGROK_AUTHTOKEN=your_token_here
# RECALL_WEBHOOK_SECRET=your_secret_here
```

### Development

```bash
# Start the app in development mode
npm start

# Build for production
npm run package

# Create installers
npm run make
```

---

## Project Status

**Current Phase:** Phase 10 (In Progress) - Advanced UI & Settings

**Security Status:** ✅ **Production-Ready** - 15/15 tests passing, 0 critical vulnerabilities

### ✅ Completed Phases

- **Phase 1**: Core Recording & Transcription (Recall.ai SDK + Async Webhook Transcription)
- **Phase 2**: Routing System (Email domain matching, vault structure)
- **Phase 3**: Calendar Integration (Google Calendar OAuth, event fetching)
- **Phase 4**: LLM Integration (Multi-provider with runtime switching + Prompt Caching)
- **Phase 5**: Obsidian Export (Two-file architecture, auto-export, publish buttons)
- **Phase 6**: Speaker Recognition & Contact Matching (Unified Google auth, LRU cache)
- **Phase 7**: Platform-Specific Recording (Zoom/Teams/Meet detection)
- **Pre-Phase 7 Bug Fixes**: All 5 critical bugs resolved
- **Phase 8**: Import Prior Transcripts (bulk import, folder scanning, template selection)
- **Phase 9**: Encryption & Security (Core hardening + Comprehensive security audit)
- **Phase 10** (In Progress): Advanced UI & Settings
  - ✅ **Phase 10.1**: Settings Infrastructure & Theme Foundation
  - ✅ **Phase 10.2**: Security & Credentials (API Key Management)
  - ✅ **Phase 10.3**: Template Editor & LLM Configuration (Monaco Editor, auto-summary template file)

### 🎯 Recent Achievements

**Phase 10.3: Template Editor & LLM Configuration (January 14, 2025):**

- ✅ **Full-page settings UI** - Converted from modal for better UX and workspace
  - Two-view architecture: mainView and settingsView
  - Full-screen template editor with adequate room
- ✅ **Monaco Editor integration** - VS Code-quality template editing
  - Syntax highlighting for YAML, JSON, Markdown, plaintext
  - Theme synchronization with app dark/light mode
  - Live preview panel with format-aware rendering
- ✅ **Plain text template support** - Added .txt file format
  - Auto-generates metadata from filename
  - Perfect for simple single-prompt templates
- ✅ **Auto-summary template file** - config/templates/auto-summary-prompt.txt
  - Editable prompt template (no longer hardcoded)
  - Conditional sections with Handlebars-style syntax
  - Replaces hardcoded 50-line prompt in main.js
- ✅ **Template content IPC handler** - Load raw file content for editing
- ✅ **Webpack native module fix** - Resolved keytar bundling issue

**Phase 10.1: Settings Management (January 13, 2025):**

- ✅ **Settings IPC handlers** - Foundation for comprehensive settings UI
  - App version retrieval from package.json
  - Vault path configuration access

**Post-Phase 9 Refinements (January 13, 2025):**

- ✅ **Improved code maintainability** - Eliminated ~70 lines of duplicate auto-summary code
  - Single shared function for all transcription providers (DRY principle)
  - Bug fixes now only need to be applied once instead of three times
- ✅ **Fixed recording UI** - Recording button now properly clears when meetings end
- ✅ **Fixed meeting title updates** - AI-suggested titles now appear immediately in meeting list
  - Resolved race condition where auto-save was overwriting new titles
- ✅ **Instant UI feedback** - Recording button clears immediately when meeting ends
  - Eliminated 30-45 second delay from user experience
  - Transcription and summary generation continue in background

**Security Audit Complete (January 13, 2025):**

- ✅ **15/15 automated security tests passing** (100% pass rate)
- ✅ **2 critical vulnerabilities found and fixed** during audit
- ✅ **0 critical or high-severity vulnerabilities remaining**
- ✅ **Path traversal protection**: 10/10 attack scenarios blocked
- ✅ **OAuth CSRF protection**: 5/5 attack scenarios blocked
- ✅ **XSS protection**: 6 attack vectors secured with DOMPurify
- ✅ **Security posture: STRONG** - Ready for personal use deployment
- ✅ **Risk rating: LOW**
- ✅ **45-page comprehensive audit report** with test suites
- ✅ **Automated test infrastructure** for ongoing security validation

**Prompt Caching Implementation (November 12, 2025):**

- ✅ 85-90% cost reduction on template generation
- ✅ All three LLM providers support caching (Azure OpenAI, OpenAI, Anthropic Claude)
- ✅ Token budgets optimized: 50,000 for auto-summary, 15,000 for template sections
- ✅ Total cost per meeting: ~$0.70 (well under $1 budget target)
- ✅ Cache verification logging with performance metrics

**Import Transcripts Feature (November 12, 2025):**

- ✅ Background import with progress notifications
- ✅ Folder import with recursive scanning
- ✅ Granular template selection (checkboxes per template)
- ✅ LLM-based title suggestions for generic titles (including numbered variants like "Transcript2")
- ✅ File overwrite protection
- ✅ Enhanced speaker extraction from transcript content

See [SPECIFICATION.md](./SPECIFICATION.md) for complete phase details.

### 📋 See Full Status

- **[PROGRESS.md](./PROGRESS.md)** - Detailed progress and next steps
- **[SPECIFICATION.md](./SPECIFICATION.md)** - Complete product specification
- **[CODE_REVIEW.md](./CODE_REVIEW.md)** - Security and code quality findings

---

## Project Structure

```
jdnotesthings/
├── src/
│   ├── main/               # Electron main process
│   │   ├── recording/      # Audio recording with Recall.ai
│   │   ├── transcription/  # Transcription with AssemblyAI
│   │   ├── storage/        # File management
│   │   └── index.ts        # Main entry point
│   ├── renderer/           # React UI
│   │   ├── App.tsx         # Main app component
│   │   └── index.tsx       # React bootstrap
│   ├── shared/             # Shared types and constants
│   └── preload.ts          # Electron preload script
├── docs/                   # Documentation and examples
├── SPECIFICATION.md        # Product specification
├── PROGRESS.md             # Development progress tracker
└── CLAUDE.md               # Context for Claude Code
```

---

## Technology Stack

- **Desktop Framework:** Electron 39.1.0
- **UI:** React 19.2.0 + TypeScript
- **Build System:** Webpack + Electron Forge
- **Recording:** Recall.ai Desktop SDK 1.3.2
- **Transcription:** Multi-provider (AssemblyAI, Deepgram, Recall.ai) with runtime switching
- **Webhooks:** Express 4.x + ngrok 5.x + Svix

---

## Features

### ✅ Phase 1: Core Recording & Transcription (Complete)

- Manual and automatic meeting recording
- System audio capture via Recall.ai SDK
- **Flexible transcription provider system with runtime switching:**
  - **AssemblyAI** ($0.37/hr) - 3-step API, speaker diarization, 57% cheaper
  - **Deepgram** ($0.43/hr) - Direct upload, speaker diarization, 49% cheaper
  - **Recall.ai** ($0.85/hr) - Async webhook-based (SDK upload currently broken)
  - UI dropdown for provider selection with localStorage persistence
  - Unified `TranscriptionService` module with provider adapters
- Speaker diarization with participant metadata (participantId, isHost)
- Microphone audio capture confirmed working
- Automatic ngrok tunnel establishment for webhooks
- Upload progress tracking with animated UI progress bar
- Svix signature verification for webhook security

### ✅ Phase 2: Routing System (Complete)

- Automatic file organization by client/project/industry
- Email domain-based routing with priority system
- YAML configuration (`config/routing.yaml`)
- Multi-organization meeting handling
- Email override system for personal emails

### ✅ Phase 3: Calendar Integration (Complete)

- Google Calendar OAuth 2.0 integration (unified with Contacts)
- Calendar event fetching (next 24 hours)
- Meeting platform detection (Zoom, Teams, Meet, Webex, Whereby)
- Meeting metadata extraction (title, participants, links)
- Upcoming meetings display in main UI

### ✅ Phase 4: LLM Integration (Complete)

- **Multi-provider LLM support:** OpenAI (gpt-4o-mini), Anthropic (Claude), Azure OpenAI (gpt-5-mini)
- **Runtime provider switching** via UI dropdown (no restart required)
- **Prompt caching implementation** across all providers (85-90% cost savings)
  - Azure OpenAI, OpenAI, Anthropic Claude all support automatic caching
  - First call creates cache, subsequent calls achieve 99%+ hit rate
  - Token budgets: 50,000 for auto-summary, 15,000 per template section
  - Total cost per meeting: ~$0.70 (well under $1 budget)
- Template-based summary generation with parallel processing
- Streaming summary generation with progress updates
- Structured summaries (participants, key points, action items)
- Cache verification logging with performance metrics

### ✅ Phase 5: Obsidian Export (Complete)

- Two-file architecture (summary + transcript)
- Rich YAML frontmatter with meeting metadata
- Bidirectional Obsidian wiki-links
- Automatic export after template generation
- Manual Publish/Republish buttons with confirmation
- Obsidian link tracking in meeting objects
- Multiple template concatenation in single summary file
- UI status badge (green indicator when synced)
- Multi-organization routing support
- **Known limitation**: Manual vault link override backend ready, UI missing

### ✅ Phase 6: Speaker Recognition & Contact Matching (Complete)

- Unified Google authentication (Calendar + Contacts)
- Google Contacts integration with LRU cache (5,000 max entries, 24-hour TTL)
- Heuristic-based speaker matching algorithms
- Contact count tracking and UI display
- Auth expiration notifications to user

### ✅ Phase 7: Platform-Specific Recording (Complete)

- Zoom meeting detection (inherited from Muesli)
- Microsoft Teams meeting detection
- Google Meet meeting detection
- Platform metadata in meeting objects
- Platform-specific UI colors and icons

### ✅ Pre-Phase 7 Bug Fixes (Complete)

- Fixed RoutingEngine method signature bug
- Fixed service initialization race condition
- Added token refresh user notifications
- Fixed file operation read/write race with readWaiters queue
- Implemented LRU cache for contacts (bounded memory)

### ✅ Phase 8: Import Prior Transcripts (Complete)

- **Bulk import** of existing meeting transcripts (.txt, .md, VTT, SRT formats)
- **Folder import** with recursive scanning
- **Background processing** - imports run in background with progress notifications
- **Granular template selection** - checkboxes for each template
- **LLM-based title suggestions** for generic titles (e.g., "Krisp Transcript")
- **File overwrite protection** with confirmation dialogs
- **Metadata extraction** from filenames and content
- **Automatic routing** and summary generation for historical transcripts
- **Prompt caching** optimization for batch imports (85-90% cost savings)

### ✅ Phase 9: Encryption & Security (COMPLETE)

**Core Security Hardening (Nov 13, 2025):**
- ✅ XSS vulnerability mitigation (DOMPurify sanitization)
- ✅ Path traversal protection (VaultStructure validation)
- ✅ OAuth CSRF protection (state parameter validation)
- ✅ IPC input validation infrastructure (Zod schemas)
- ✅ Token file permission validation (Windows icacls)
- ✅ Memory leak prevention (event listener cleanup)

**Comprehensive Security Audit (Jan 13, 2025):**
- ✅ 15/15 automated tests passing (100%)
- ✅ 2 critical vulnerabilities fixed (path traversal, OAuth CSRF)
- ✅ Penetration testing: XSS, Path Traversal, OAuth CSRF
- ✅ Security posture: STRONG (LOW risk rating)
- ✅ 45-page audit report + automated test suites
- ✅ **Production-ready for personal use**

**Deferred to Phase 10:**
- Windows DPAPI file encryption (optional enhancement)
- API key storage in Windows Credential Manager (UI required)
- Complete IPC validation rollout (34/36 handlers remaining)

### 🔧 Phase 10: Advanced UI & Settings (IN PROGRESS)

**Completed Sub-Phases:**

**Phase 10.1: Settings Infrastructure**
- Settings IPC handlers (getAppVersion, getVaultPath)
- Foundation for comprehensive settings UI

**Phase 10.2: Security & Credentials**
- API Key Management UI with Windows Credential Manager
- Migration wizard from .env to secure storage

**Phase 10.3: Template Editor & LLM Configuration**
- Full-page settings with Monaco Editor
- Template editing with syntax highlighting
- Plain text (.txt) template support
- Auto-summary template file (editable)
- Theme synchronization

**Remaining Sub-Phases:**
- **Phase 10.4**: Advanced Configuration Editors (Routing editor, validation, test tool)
- **Phase 10.5**: Meeting Metadata Management (Speaker correction, participant input, vault override)
- **Phase 10.6**: Bulk Meeting Operations (Batch re-export, template generation, routing updates)
- **Phase 10.7**: Desktop App Polish (System tray, keyboard shortcuts, notifications)
- **Phase 10.8**: Code Quality & Validation (IPC validation rollout, refactoring - ongoing)

### 🔜 Future Phases (Phase 11, 12)

**Phase 11: Real-Time Transcription (Optional)**
- Streaming transcription during meetings
- Live transcript display
- Real-time summary updates

**Phase 12: HubSpot CRM Integration**
- Automatic note syncing to HubSpot
- Company and contact matching
- Meeting activity tracking

See [SPECIFICATION.md](./SPECIFICATION.md) for complete feature roadmap.

---

## Development

### Project Commands

```bash
npm start           # Start development server
npm run lint        # Run ESLint
npm run package     # Build for current platform
npm run make        # Create distributable installer
```

### Building for Distribution

```bash
# Windows installer (.exe)
npm run make

# Output will be in: out/make/squirrel.windows/x64/
```

---

## Configuration

### Environment Variables (.env)

```env
# Recall.ai Configuration
RECALLAI_API_URL=https://us-west-2.recall.ai
RECALLAI_API_KEY=your_api_key
RECALL_WEBHOOK_SECRET=your_webhook_secret

# Transcription Providers (Add at least one)
ASSEMBLYAI_API_KEY=your_assemblyai_key    # Recommended - $0.37/hr (57% cheaper)
DEEPGRAM_API_KEY=your_deepgram_key        # Alternative - $0.43/hr (49% cheaper)

# ngrok Configuration (for webhook tunnel)
NGROK_AUTHTOKEN=your_ngrok_token
NGROK_DOMAIN=your-domain.ngrok-free.dev

# OpenAI Configuration (for AI summaries)
OPENAI_API_KEY=your_api_key

# Google Calendar + Contacts OAuth (unified authentication)
GOOGLE_CALENDAR_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/oauth2callback

# Obsidian Vault Path
VAULT_PATH=./vault
```

### API Keys Required

- **Recall.ai**: For desktop audio recording (SDK upload currently broken)
  - API Key: For SDK authentication
  - Webhook Secret: For Svix signature verification (get from Recall.ai dashboard)
  - Note: Currently used only for local recording, transcription via other providers
- **Transcription Providers** (Choose at least one):
  - **AssemblyAI**: $0.37/hour - [Get API key](https://www.assemblyai.com/) (Recommended - 57% cheaper)
  - **Deepgram**: $0.43/hour - [Get API key](https://deepgram.com/) (Alternative - 49% cheaper)
  - **Recall.ai**: $0.85/hour - Included with recording SDK (fallback when upload fixed)
- **ngrok**: For webhook tunnel (free tier sufficient)
  - Authtoken: From ngrok dashboard
  - Domain: Optional static domain (or use auto-generated)
- **OpenAI**: For AI-generated meeting summaries (gpt-4o-mini)
- **Google OAuth**: For Calendar + Contacts access (unified authentication)
  - Set up OAuth 2.0 credentials at [Google Cloud Console](https://console.cloud.google.com/)
  - Required scopes: `calendar.readonly` + `contacts.readonly`
  - Redirect URI: `http://localhost:3000/oauth2callback`

---

## Documentation

- **[SPECIFICATION.md](./SPECIFICATION.md)** - Complete product specification
- **[PROGRESS.md](./PROGRESS.md)** - Current status and next steps
- **[CLAUDE.md](./CLAUDE.md)** - Context for Claude Code assistant
- **[docs/security-audit-2025-01-13.md](./docs/security-audit-2025-01-13.md)** - Comprehensive security audit report
- **[docs/phase9-security-report.md](./docs/phase9-security-report.md)** - Phase 9 security hardening report
- **[docs/](./docs/)** - Additional documentation and examples

---

## License

MIT License - Personal use only, not for resale

---

## Support

This is a personal project by JD Bruce for JD Knows Things.

For development assistance, see [PROGRESS.md](./PROGRESS.md) for the current implementation checklist.
