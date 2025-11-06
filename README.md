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
- **AssemblyAI API Key** ([Get one here](https://assemblyai.com))

### Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Add your API keys to .env
# RECALLAI_API_KEY=your_key_here
# ASSEMBLYAI_API_KEY=your_key_here
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

**Current Phase:** Phase 1 - Core Recording & Transcription

### ✅ Completed
- Project initialization with Electron + TypeScript + React
- Basic recording widget UI
- Project structure and type definitions
- Build system configuration

### 🚧 In Progress
- Recall.ai SDK integration for audio recording
- AssemblyAI transcription service
- File management for saving transcripts

### 📋 See Full Status
- **[PROGRESS.md](./PROGRESS.md)** - Detailed progress and next steps
- **[SPECIFICATION.md](./SPECIFICATION.md)** - Complete product specification

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
- **Transcription:** AssemblyAI 4.19.0

---

## Features (Planned)

### Phase 1: Core Recording & Transcription ⏳
- Manual recording with start/stop controls
- System audio capture via Recall.ai SDK
- Transcription with speaker diarization
- Save transcripts as Markdown files

### Phase 2: Routing System
- Automatic file organization by client/project
- Email domain-based routing
- YAML configuration

### Phase 3: Calendar Integration
- Google Calendar integration
- Auto-start recording when meetings begin
- Meeting metadata extraction

### Phase 4: LLM Summaries
- Template-based meeting summaries
- Multi-LLM support (OpenAI, Claude, Gemini)
- Custom summary templates

### Future Phases
- Speaker recognition & contact matching
- Platform-specific recording (Zoom/Teams/Meet)
- HubSpot CRM integration
- Import prior transcripts
- Encryption & security
- Real-time transcription

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
RECALLAI_API_URL=https://us-east-1.recall.ai
RECALLAI_API_KEY=your_api_key

# AssemblyAI Configuration
ASSEMBLYAI_API_KEY=your_api_key

# Obsidian Vault (future)
VAULT_PATH=./vault
```

### API Keys Required
- **Recall.ai**: For desktop audio recording
- **AssemblyAI**: For transcription with speaker diarization

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
