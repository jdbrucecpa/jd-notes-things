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

**Current Phase:** Pre-Phase 8 - Complete Deferred Features from Phases 1-7

### ✅ Completed Phases
- **Phase 1**: Core Recording & Transcription (Recall.ai SDK + Async Webhook Transcription)
- **Phase 2**: Routing System (Email domain matching, vault structure)
- **Phase 3**: Calendar Integration (Google Calendar OAuth, event fetching)
- **Phase 4**: LLM Integration (Multi-provider with runtime switching)
- **Phase 5**: Obsidian Export (Two-file architecture, auto-export, publish buttons)
- **Phase 6**: Speaker Recognition & Contact Matching (Unified Google auth, LRU cache)
- **Phase 7**: Platform-Specific Recording (Zoom/Teams/Meet detection)
- **Pre-Phase 7 Bug Fixes**: All 5 critical bugs resolved

### 🚧 Current Work: Pre-Phase 8 Features

Before moving to Phase 8 (Import Prior Transcripts), completing essential UI features and code quality improvements:

**Tasks:**
1. Manual Vault Link Override UI (edit obsidianLink field in UI)
2. Proper Logging Framework (electron-log for debugging)
3. ESLint & Prettier (code quality and consistency)

**Deferred to Phase 10 (Advanced UI & Settings):**
- Manual Speaker ID Correction UI
- Manual Participant Input During Recording

**Estimated effort:** 5-8 hours

See [SPECIFICATION.md Pre-Phase 8](./SPECIFICATION.md#pre-phase-8-complete-deferred-features-from-phases-1-7) for complete details.

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
- AI-generated meeting summaries with OpenAI (gpt-4o-mini)
- Template-based summary generation
- Streaming summary generation with progress updates
- Structured summaries (participants, key points, action items)

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

### 🔜 Next Phase (Phase 8)
- Import Prior Transcripts
  - Bulk import existing meeting notes
  - Support .txt, .md, VTT, SRT formats
  - Metadata extraction from filenames
  - Apply routing and generate summaries

### Future Phases
- Phase 9: Encryption & Security (Windows DPAPI)
- Phase 10: Advanced UI & Settings (speaker correction, participant input, etc.)
- Phase 11: Real-time Transcription (optional)
- Phase 12: HubSpot CRM Integration

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
- **[docs/](./docs/)** - Additional documentation and examples

---

## License

MIT License - Personal use only, not for resale

---

## Support

This is a personal project by JD Bruce for JD Knows Things.

For development assistance, see [PROGRESS.md](./PROGRESS.md) for the current implementation checklist.
