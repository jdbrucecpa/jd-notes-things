# JD Notes Things

**AI Meeting Notetaker for Zoom, Microsoft Teams, and Google Meet**

> Personal productivity tool by JD Knows Things

---

## Overview

JD Notes Things is a Windows desktop application that automatically records, transcribes, and summarizes your meetings. It integrates with Google Calendar to detect upcoming meetings, captures high-quality audio, generates AI-powered summaries, and saves structured notes to your Obsidian vault.

### Key Features

- 🎙️ **Automatic Meeting Recording** - Detects Zoom, Teams, and Google Meet sessions
- 📝 **Multi-Provider Transcription** - Choose from AssemblyAI, Deepgram, or Recall.ai
- 🤖 **AI-Powered Summaries** - Generate structured notes with OpenAI, Claude, or Azure OpenAI
- 📅 **Google Calendar Integration** - Auto-detect and record scheduled meetings
- 👥 **Speaker Identification** - Match voices to contacts via Google Contacts
- 📂 **Smart Organization** - Automatic routing to client/project folders in Obsidian
- 🔒 **Secure & Private** - Local-first with Windows Credential Manager for API keys
- 💰 **Cost-Optimized** - Prompt caching reduces LLM costs by 85-90%

---

## Quick Start

### Prerequisites

- **Windows** 10/11 (required for Recall.ai Desktop SDK)
- **Node.js** v18+ and npm v10+
- **Obsidian** (optional but recommended)
- API keys for:
  - [Recall.ai](https://recall.ai) - For audio recording
  - [AssemblyAI](https://assemblyai.com) or [Deepgram](https://deepgram.com) - For transcription
  - [OpenAI](https://openai.com) - For AI summaries
  - [ngrok](https://ngrok.com) - For webhook tunneling (free tier works)
  - Google OAuth credentials - For Calendar/Contacts integration

### Installation

```bash
# Clone the repository
git clone https://github.com/jdknowsthings/jd-notes-things.git
cd jd-notes-things

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env with your API keys
notepad .env
```

### Running the App

```bash
# Development mode
npm start

# Build for production
npm run package

# Create installer
npm run make
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Recall.ai Configuration
RECALLAI_API_URL=https://us-west-2.recall.ai
RECALLAI_API_KEY=your_api_key
RECALL_WEBHOOK_SECRET=your_webhook_secret

# Transcription Provider (choose one or more)
ASSEMBLYAI_API_KEY=your_key       # $0.37/hr - Recommended
DEEPGRAM_API_KEY=your_key          # $0.43/hr - Alternative

# LLM Provider (choose one)
OPENAI_API_KEY=your_key            # For OpenAI GPT models
ANTHROPIC_API_KEY=your_key         # For Claude models
AZURE_OPENAI_API_KEY=your_key      # For Azure OpenAI

# ngrok (for webhook tunnel)
NGROK_AUTHTOKEN=your_token
NGROK_DOMAIN=your-domain.ngrok-free.dev  # Optional

# Google OAuth
GOOGLE_CALENDAR_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=your_secret
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/oauth2callback

# Obsidian Vault
VAULT_PATH=C:\Users\YourName\Documents\ObsidianVault
```

### Obsidian Vault Structure

The app automatically creates this structure in your vault:

```
vault/
├── clients/{client-name}/meetings/
├── industry/{contact-name}/meetings/
├── internal/meetings/
├── _unfiled/{YYYY-MM}/meetings/
└── config/
    ├── routing.yaml        # Email routing configuration
    └── templates/          # Custom summary templates
```

Each meeting generates two files:
- **Summary** (`YYYY-MM-DD-meeting-title.md`) - Metadata + AI summary
- **Transcript** (`YYYY-MM-DD-meeting-title-transcript.md`) - Full conversation

### Routing Configuration

Edit `vault/config/routing.yaml` to control where meetings are saved:

```yaml
clients:
  acme-corp:
    vault_path: 'clients/acme-corp'
    emails:
      - 'acme.com'
    contacts:
      - 'john@acme.com'

industry:
  consultant-jane:
    vault_path: 'industry/jane-smith'
    emails:
      - 'consulting.com'

internal:
  vault_path: 'internal/meetings'

settings:
  unfiled_path: '_unfiled'
  duplicate_multi_org: 'all'  # 'all', 'primary', or 'unfiled'
```

See [`docs/routing-example.yaml`](./docs/routing-example.yaml) for complete examples.

---

## Features

### Current Capabilities

#### ✅ Core Recording & Transcription
- Manual and automatic meeting recording
- System audio capture via Recall.ai SDK
- Multi-provider transcription with runtime switching
- Speaker diarization (Speaker 1, Speaker 2, etc.)
- Upload progress tracking

#### ✅ Smart Organization
- Email domain-based routing to client/project folders
- Multi-organization meeting handling
- Custom email overrides for personal addresses
- Automatic unfiled folder for unknown participants

#### ✅ Google Calendar Integration
- OAuth 2.0 authentication (unified with Contacts)
- Automatic meeting detection (Zoom, Teams, Meet)
- Upcoming meetings display
- Platform-specific metadata

#### ✅ AI-Powered Summaries
- Multi-provider LLM support (OpenAI, Claude, Azure)
- Template-based summary generation
- Prompt caching for 85-90% cost reduction
- Parallel processing for 10x speedup
- Custom editable templates (Markdown, YAML, JSON, or plain text)

#### ✅ Speaker Recognition
- Google Contacts integration with LRU caching
- Heuristic speaker matching algorithms
- Automatic speaker label replacement in transcripts

#### ✅ Bulk Import
- Import existing transcripts (.txt, .md, VTT, SRT)
- Background processing with progress notifications
- LLM-based title suggestions for generic filenames
- Folder scanning with recursive search

#### ✅ Security & Privacy
- XSS protection with DOMPurify
- Path traversal prevention
- OAuth CSRF protection
- Windows Credential Manager for API keys
- Local-first data storage
- Optional DPAPI encryption

### Roadmap

See [`SPECIFICATION.md`](./SPECIFICATION.md) for the complete development roadmap and current phase status.

**Upcoming features:**
- Real-time transcription during meetings
- HubSpot CRM integration
- Advanced routing configuration UI
- Custom keyboard shortcuts
- System tray controls

---

## Project Structure

```
jd-notes-things/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── recording/         # Audio recording with Recall.ai
│   │   ├── services/          # Transcription, LLM, encryption
│   │   ├── routing/           # Meeting organization logic
│   │   ├── templates/         # Template parsing and management
│   │   ├── integrations/      # Google Calendar/Contacts
│   │   └── storage/           # Vault structure and file operations
│   ├── renderer/              # React UI components
│   ├── shared/                # Validation schemas and constants
│   └── preload.js             # IPC bridge
├── config/
│   └── templates/             # User-editable summary templates
├── docs/                      # Documentation and examples
├── tests/                     # Security tests
├── SPECIFICATION.md           # Complete project specification
└── README.md                  # This file
```

---

## Development

### Available Commands

```bash
npm start              # Start development server with hot reload
npm run package        # Build for current platform
npm run make           # Create distributable installer
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix linting issues
npm run format         # Format code with Prettier
npm run format:check   # Check code formatting
```

### Building for Distribution

```bash
# Windows installer (.exe)
npm run make

# Output location
out/make/squirrel.windows/x64/
```

---

## Documentation

- **[SPECIFICATION.md](./SPECIFICATION.md)** - Complete technical specification and development roadmap
- **[CLAUDE.md](./CLAUDE.md)** - Development guide for Claude Code
- **[docs/security-audit-2025-01-13.md](./docs/security-audit-2025-01-13.md)** - Security audit report
- **[docs/routing-example.yaml](./docs/routing-example.yaml)** - Routing configuration examples
- **[Recall.ai Docs](https://docs.recall.ai)** - Recording SDK documentation

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Desktop Framework | Electron | 39.x |
| UI Framework | React | 19.x |
| Build System | Webpack + Electron Forge | Latest |
| Recording | Recall.ai Desktop SDK | 1.3.x |
| Transcription | AssemblyAI / Deepgram | Latest |
| LLM | OpenAI / Claude / Azure | Latest |
| OAuth | Google OAuth 2.0 | Latest |
| Security | Windows DPAPI + Credential Manager | Native |

---

## Security

This application implements industry-standard security practices:

- ✅ **15/15 automated security tests passing**
- ✅ **0 critical or high-severity vulnerabilities**
- ✅ **XSS protection** with DOMPurify sanitization
- ✅ **Path traversal prevention** with enhanced validation
- ✅ **OAuth CSRF protection** with state parameter validation
- ✅ **Secure API key storage** in Windows Credential Manager
- ✅ **Token file permission validation** with Windows icacls

See [`docs/security-audit-2025-01-13.md`](./docs/security-audit-2025-01-13.md) for the comprehensive security audit report.

---

## Cost Optimization

The application is designed to minimize API costs:

- **Transcription:** $0.37-$0.43/hour (AssemblyAI/Deepgram vs $0.85/hr Recall.ai)
- **LLM Summaries:** ~$0.30/meeting with prompt caching (85-90% savings)
- **Total Cost:** ~$0.70 per 2-hour meeting (well under $1 target)

Prompt caching works by:
1. First template section creates cache (~$0.009)
2. Subsequent sections reuse cache (~$0.001 each)
3. 99%+ cache hit rate on repeated sections

---

## Contributing

This is a personal project by JD Bruce for JD Knows Things. While not open for external contributions, the codebase is shared for reference and personal use.

---

## License

MIT License - Personal use only, not for resale

---

## Support

For detailed development documentation and phase-by-phase implementation details, see:
- **[SPECIFICATION.md](./SPECIFICATION.md)** - Authoritative source for project planning and status
- **[CLAUDE.md](./CLAUDE.md)** - Technical architecture and development guide

---

**Built with ❤️ by JD Knows Things**
