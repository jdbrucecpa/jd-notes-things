<div align="center">

# JD Notes Things

**AI-powered meeting notes that organize themselves**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows)](https://www.microsoft.com/windows)
[![Electron](https://img.shields.io/badge/Electron-39.x-47848F?logo=electron)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org/)

[Features](#features) • [Installation](#installation) • [Configuration](#configuration) • [Usage](#usage) • [Contributing](#contributing)

</div>

---

## What is this?

JD Notes Things is a Windows desktop app that automatically records your Zoom, Teams, and Google Meet calls, transcribes them, generates AI summaries, and saves everything to your Obsidian vault—organized by client, project, or team.

**The problem:** Meeting notes are scattered, incomplete, or never written at all.

**The solution:** Hit record, forget about it, and find perfectly organized notes waiting for you.

---

## Features

### Core Functionality

- **One-click recording** — Capture system audio from any meeting platform
- **Multi-provider transcription** — Choose AssemblyAI ($0.37/hr), Deepgram ($0.43/hr), or Recall.ai
- **AI summaries** — Generate structured notes with OpenAI, Claude, or Azure OpenAI
- **Smart organization** — Auto-route meetings to the right folder based on who's in the call

### Integrations

- **Google Calendar** — See upcoming meetings and auto-detect when they start
- **Google Contacts** — Match speakers to real names in your transcripts
- **Obsidian** — Native markdown output with proper linking between summary and transcript

### Developer-Friendly

- **Template system** — Customize summary output with your own prompts
- **YAML routing config** — Full control over where meetings land
- **Cost optimized** — Prompt caching reduces LLM costs by 85-90%

---

## Installation

### Prerequisites

- Windows 10/11
- Node.js 18+ and npm 10+
- API keys (see [Configuration](#configuration))

### Quick Start

```bash
# Clone the repo
git clone https://github.com/jdbrucecpa/jd-notes-things.git
cd jd-notes-things

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Run the app
npm start
```

### Building for Windows

```bash
# Build without installer (for testing)
npm run package
# Output: out/jd-notes-things-win32-x64/

# Build Windows installer (.exe)
npm run make
# Output: out/make/squirrel.windows/x64/jd-notes-things-1.0.0 Setup.exe
```

The installer uses Squirrel for Windows, which provides automatic updates and clean install/uninstall.

### Other Platforms (Experimental)

This app is built with Electron and _theoretically_ supports macOS and Linux. However, **these platforms have not been tested or attempted.**

If you want to try building for other platforms:

```bash
# macOS (untested)
npm run package -- --platform=darwin

# Linux (untested)
npm run package -- --platform=linux
```

**Known limitations on other platforms:**

- The Recall.ai Desktop SDK may not be available for macOS/Linux
- Windows Credential Manager (keytar) would need platform-specific alternatives
- DPAPI encryption is Windows-only
- Some file path handling assumes Windows conventions

Contributions to add cross-platform support are welcome!

---

## Configuration

### Required API Keys

| Service                  | Purpose             | Get Key                                                                         |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------- |
| Recall.ai                | Audio recording     | [recall.ai](https://recall.ai)                                                  |
| AssemblyAI _or_ Deepgram | Transcription       | [assemblyai.com](https://assemblyai.com) / [deepgram.com](https://deepgram.com) |
| OpenAI _or_ Anthropic    | AI summaries        | [openai.com](https://openai.com) / [anthropic.com](https://anthropic.com)       |
| Google Cloud             | Calendar & Contacts | [console.cloud.google.com](https://console.cloud.google.com)                    |

### Environment Variables

Create a `.env` file (see `.env.example` for all options):

```env
# Recording
RECALLAI_API_KEY=your_key
RECALLAI_API_URL=https://us-west-2.recall.ai

# Transcription (pick one)
ASSEMBLYAI_API_KEY=your_key

# AI Summaries (pick one)
OPENAI_API_KEY=your_key

# Google OAuth
GOOGLE_CALENDAR_CLIENT_ID=your_id.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=your_secret

# Output
VAULT_PATH=C:/Users/You/Documents/ObsidianVault
```

### Meeting Routing

Control where meetings are saved by editing `config/routing.yaml`:

```yaml
clients:
  acme-corp:
    vault_path: clients/acme-corp
    emails:
      - acme.com
    contacts:
      - ceo@acme.com

internal:
  vault_path: internal/meetings
  team_emails:
    - yourcompany.com

settings:
  unfiled_path: _unfiled
```

**Routing priority:** Email overrides → Exact contact match → Domain match → Internal → Unfiled

See [`config/routing.yaml`](config/routing.yaml) for a complete example.

---

## Usage

### Recording a Meeting

1. Open the app and connect to Google Calendar
2. Join your Zoom/Teams/Meet call
3. Click **Start Recording** (or let it auto-detect from calendar)
4. When done, click **Stop Recording**
5. Wait for transcription and summary generation
6. Find your notes in Obsidian, organized automatically

### Output Structure

Each meeting creates two files:

```
vault/
├── clients/acme-corp/meetings/
│   ├── 2024-01-15-quarterly-review.md          # Summary + metadata
│   └── 2024-01-15-quarterly-review-transcript.md  # Full transcript
├── internal/meetings/
└── _unfiled/2024-01/meetings/
```

### Custom Templates

Add your own summary templates to `config/templates/`:

```markdown
<!-- config/templates/action-items.md -->

# Action Items

Extract all action items from this meeting transcript.
Format as a checklist with owner and due date if mentioned.
```

---

## Development

```bash
npm start          # Development with hot reload
npm run package    # Build for current platform
npm run make       # Create installer
npm run lint       # Run ESLint
npm run format     # Format with Prettier
```

### Creating a Release

The app uses auto-updates via GitHub Releases. To create a new release:

1. **Update version** in `package.json`
2. **Commit the version bump**:
   ```bash
   git add package.json
   git commit -m "chore: bump version to v1.2.0"
   ```
3. **Create and push a version tag**:
   ```bash
   git tag v1.2.0
   git push origin main
   git push origin v1.2.0
   ```

The GitHub Actions workflow will automatically:

- Build the Windows installer
- Create a GitHub Release with the Squirrel artifacts
- Users with the app installed will receive the update automatically

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── recording/  # Recall.ai SDK integration
│   ├── services/   # Transcription, LLM, encryption
│   ├── routing/    # Meeting organization logic
│   └── integrations/  # Google Calendar/Contacts
├── renderer/       # React UI
└── preload.js      # IPC bridge
```

---

## Cost Estimates

| Component     | Cost           | Notes                  |
| ------------- | -------------- | ---------------------- |
| Transcription | $0.37-0.43/hr  | AssemblyAI or Deepgram |
| AI Summary    | ~$0.05/meeting | With prompt caching    |
| **Total**     | **~$0.50/hr**  | For a typical meeting  |

Prompt caching provides 85-90% cost reduction on LLM calls by reusing the transcript context across multiple summary sections.

---

## Security

- API keys stored in Windows Credential Manager (not plain text)
- XSS protection with DOMPurify
- Path traversal prevention
- OAuth CSRF protection with state validation
- All data stored locally—nothing sent to third parties except chosen API providers

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Areas for Contribution

- macOS/Linux support
- Additional transcription providers
- New summary templates
- UI/UX improvements
- Documentation

---

## Roadmap

- [ ] Real-time transcription during meetings
- [ ] CRM integrations (HubSpot, Salesforce)
- [ ] System tray controls
- [ ] Keyboard shortcuts
- [ ] macOS support

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Recall.ai](https://recall.ai) for the desktop recording SDK
- [AssemblyAI](https://assemblyai.com) and [Deepgram](https://deepgram.com) for transcription
- [Obsidian](https://obsidian.md) for being an amazing knowledge base

---

<div align="center">

**[Report Bug](https://github.com/jdbrucecpa/jd-notes-things/issues) · [Request Feature](https://github.com/jdbrucecpa/jd-notes-things/issues)**

Made by [JD Knows Things](https://jdknowsthings.com)

</div>
