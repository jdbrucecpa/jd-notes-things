# JD Notes Things - Product Specification

**Project Name:** JD Notes Things
**Organization:** JD Knows Things
**Purpose:** Personal AI Meeting Notetaker for Zoom, Microsoft Teams, Google Meet, and Manual Recording
**Version:** 1.0
**Last Updated:** November 6, 2025

---

## Development Status

**Current Baseline:** Muesli (Recall.ai reference implementation)
**Phase:** 3 In Progress - Calendar Integration (UI complete, auto-recording pending)
**Next Phase:** 3 completion (auto-recording) or 4 - Enhanced AI Summaries

The application is built on the [Muesli](https://github.com/recallai/muesli-public) codebase, which provides a proven foundation for:
- Recall.ai Desktop SDK integration
- Real-time transcription with AssemblyAI v3
- Meeting detection (Zoom, Teams, Google Meet, Slack)
- AI-powered summary generation via OpenRouter

This specification describes the full vision. Development follows the phase plan below, building incrementally on the working baseline.

---

## Executive Summary

JD Notes Things is a Windows desktop application that automatically records, transcribes, and summarizes meetings from Zoom, Microsoft Teams, and Google Meet. The application uses Recall.ai's Desktop Recording SDK for high-quality audio capture and integrates with Google Calendar, Google Contacts, HubSpot, and Obsidian to create a seamless note-taking workflow.

The application will be developed in phases, with each phase delivering usable functionality that builds upon the previous phase.

---

## Technology Stack

### Core Technologies
- **Platform:** Electron + Node.js + TypeScript
- **UI Framework:** React (for renderer process)
- **Recording SDK:** Recall.ai Desktop Recording SDK
- **Transcription:** To be determined (options: Deepgram, AssemblyAI, Whisper API)
- **LLM Integration:** Multi-provider support (OpenAI, Anthropic Claude, Google Gemini) with cost/quality optimization per task
- **Build System:** Webpack + Electron Forge
- **Encryption:** Windows Data Protection API (DPAPI)

### Rationale
Electron + Node.js provides:
- Cross-platform compatibility (future macOS/Linux support)
- Strong ecosystem for API integrations
- Compatible with Recall.ai SDK (proven by muesli-public example app)
- Familiar web technologies for UI development
- Easy packaging and distribution

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Recording  │  │ Transcription│  │   Routing    │      │
│  │   Manager    │  │   Service    │  │   Engine     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Calendar   │  │     LLM      │  │   HubSpot    │      │
│  │  Integration │  │   Service    │  │  Integration │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                    IPC Communication
                            │
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process (React UI)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Main Window │  │    Widget    │  │   Settings   │      │
│  │   (Calendar) │  │  (Recording) │  │    Panel     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Obsidian Vault Structure

The application saves files to an Obsidian vault with the following structure:

```
vault/
├── clients/
│   ├── alman-partners/
│   │   └── meetings/
│   │       └── 2025-10-22-quarterly-review/
│   │           ├── index.md                    (AI-generated meeting index)
│   │           ├── full-notes.md               (Full transcript with timestamps)
│   │           ├── decisions-and-actions.md    (Summary from template)
│   │           └── things-they-said.md         (Summary from template)
│   ├── capital-partners/
│   ├── regency-invests/
│   └── [other-clients]/
│
├── industry/
│   └── herbers/
│       └── meetings/
│
├── internal/
│   └── meetings/
│
├── _unfiled/
│   └── 2025-10/                                (Date-based unfiled meetings)
│       └── 2025-10-25-unknown-meeting/
│
└── config/
    └── routing.yaml                            (Routing configuration)
```

### File Naming Convention
- **Meeting folders:** `YYYY-MM-DD-meeting-title-slug/`
- **Transcript:** `full-notes.md` or `YYYY-MM-DD-meeting-title-full-notes.md`
- **Summaries:** Named based on template (e.g., `decisions-and-actions.md`)
- **Index:** `index.md` (navigation and topic index for LLM retrieval)

---

## Routing System

### Configuration File: `config/routing.yaml`

The routing system determines where meeting notes are saved based on participant email addresses and domains.

#### Structure
```yaml
clients:
  client-slug:
    vault_path: "clients/client-name"
    emails:
      - "clientdomain.com"
    contacts:
      - "person@clientdomain.com"

industry:
  industry-contact-slug:
    vault_path: "industry/contact-name"
    emails:
      - "domain.com"

internal:
  vault_path: "internal/meetings"

email_overrides:
  "personal@gmail.com": "client-slug"

settings:
  unfiled_path: "_unfiled"
  duplicate_multi_org: "all"              # Options: "all", "primary", "unfiled"
  domain_priority: "most_attendees"       # Options: "most_attendees", "first"
  enable_email_overrides: true
  case_sensitive_emails: false
```

#### Routing Priority
1. Email overrides (specific email → organization mapping)
2. Exact contact email match
3. Domain match from emails list
4. Industry contacts
5. Internal (if all attendees are internal team members)
6. Unfiled (fallback for unknown contacts)

#### Multi-Organization Meetings
When participants from multiple organizations attend:
- **"all"**: Create duplicate notes in each organization's folder
- **"primary"**: Create note in organization with most attendees
- **"unfiled"**: Route to unfiled for manual sorting

---

## Meeting Index Format

Each meeting folder contains an `index.md` file that serves as a navigation hub and LLM retrieval aid.

### Example Structure

```markdown
---
title: "Meeting Title with Participants"
date: 2025-10-22
tags: [meeting, topic-tags, participant-names]
type: meeting-index
participants:
  - name: "John Doe"
    email: "john@company.com"
    organization: "Company Name"
  - name: "Jane Smith"
    email: "jane@example.com"
    organization: "Example Corp"
meeting_platform: "zoom"  # or "teams", "meet", "manual"
---

# Meeting Index: [Meeting Title]

**Date:** October 22, 2025 | **Attendees:** John Doe, Jane Smith

## Quick Navigation

| Topic | Found In |
|-------|----------|
| Topic 1 | [[full-notes#Section]], [[decisions-and-actions#Section]] |
| Topic 2 | [[full-notes#Section]], [[things-they-said#Quote]] |

## Files in This Meeting

### [[full-notes]]
Comprehensive meeting notes covering [brief description of main topics].

**Topics:** topic1, topic2, topic3

### [[decisions-and-actions]]
Executive summary of key decisions and action items.

**Topics:** decisions, action items, next steps

## Key Topics Discussed

- **Topic 1**: Found in [[full-notes#Section]]
- **Topic 2**: Found in [[decisions-and-actions#Section]]

## Action Items Summary

[Brief summary of action items with assignees]

## Meeting Details

**Platform:** Zoom
**Duration:** 45 minutes
**Recording:** [Path to audio file if saved]

---

*This index guides AI tools to specific files and sections.*
```

---

## Recording Widget

### UI Design
Based on the Krisp.ai widget example, the recording widget should:

- **Compact overlay window** (always on top)
- **Status indicator**: "Recording Live" with red dot
- **Timer**: MM:SS elapsed time
- **Controls**:
  - Pause button (⏸)
  - Stop button (⏹)
  - Settings/menu button (⚙)
- **Notifications**:
  - Meeting detected notification
  - Recording started notification
  - Recording stopped notification
  - Transcript ready notification

### Behavior
- Appears when recording starts (auto or manual)
- Always on top, draggable
- Minimal, non-intrusive design
- Click to expand for more options
- System tray icon with context menu

---

## Template System

### Template Storage
Templates are stored as individual files in a dedicated folder:

```
config/
└── templates/
    ├── client-meeting.md
    ├── internal-team.md
    ├── decisions-and-actions.yaml
    └── action-items.json
```

### Template Format
Templates can be in Markdown, YAML, or JSON format. The system scans this folder and presents available templates in the UI.

#### Example Template (Markdown)
```markdown
---
name: "Client Meeting Summary"
description: "Summary for client-facing meetings"
---

# Client Meeting Summary

## Meeting Overview
[Extract: meeting purpose, key attendees, date]

## Key Discussion Points
[Extract: main topics discussed with brief summaries]

## Decisions Made
[Extract: any decisions or agreements reached]

## Action Items
[Extract: action items with owners and deadlines]

## Next Steps
[Extract: planned follow-ups and next meeting]
```

#### Example Template (YAML)
```yaml
name: "Decisions and Actions"
description: "Focus on actionable outcomes"
sections:
  - title: "Key Decisions"
    prompt: "Extract all decisions made during the meeting"
  - title: "Action Items"
    prompt: "List all action items with owner and deadline"
  - title: "Blockers"
    prompt: "Identify any blockers or risks mentioned"
```

### Template Processing
The LLM service reads the template and generates content based on:
- Template structure
- Prompts/instructions in template
- Full meeting transcript
- Metadata (participants, date, etc.)

---

## Calendar Integration

### Google Calendar
- **Authentication**: OAuth 2.0
- **Permissions**: Read-only access to calendar events
- **Sync Behavior**:
  - Check calendar on app launch
  - Manual refresh button in UI
  - Display upcoming meetings (next 24 hours)

### Meeting Detection
- Query calendar for events with:
  - Meeting links (Zoom, Teams, Google Meet)
  - Multiple participants (not just user)
  - Event status: confirmed

### UI Display
```
┌─────────────────────────────────────────────┐
│  JD Notes Things           [⟳] [⚙]  [─][×]  │
├─────────────────────────────────────────────┤
│  Upcoming Meetings                          │
│                                             │
│  ● 2:00 PM - Client Strategy Call           │
│    Zoom • 3 participants                    │
│    [Start Recording Now]                    │
│                                             │
│  ○ 4:30 PM - Team Standup                   │
│    Teams • 5 participants                   │
│    [Schedule Recording]                     │
│                                             │
│  [+ Manual Recording]                       │
└─────────────────────────────────────────────┘
```

---

## Google Contacts Integration

### Purpose
Match meeting participants to known contacts for:
- Speaker identification
- Contact routing
- Richer metadata in notes

### Integration Strategy
- **On-demand lookup**: Query Google Contacts API during meeting processing
- **Cache locally**: Store matched contacts for faster future lookups
- **Privacy**: Only store contact information relevant to routing (name, email, organization)

### Matching Logic
1. Extract participant emails from meeting invite
2. Query Google Contacts for matching emails
3. Extract: Name, Organization, Job Title
4. Use for speaker labeling in transcript
5. Use for routing decisions

---

## HubSpot Integration

### Purpose
Automatically log meeting summaries in HubSpot CRM.

### Workflow
1. After meeting processing completes:
   - Generate meeting summary
   - Extract participant emails
2. Query HubSpot API:
   - Match email domains to Companies
   - Find existing Contacts
3. Create HubSpot Note/Activity:
   - Associate with Company
   - Associate with all matched Contacts
   - Include meeting summary
   - Add link to Obsidian notes

### Note Format
```
Meeting: [Meeting Title]
Date: [Date]
Platform: [Zoom/Teams/Meet]
Duration: [Duration]

Summary:
[LLM-generated summary]

Action Items:
- [Action item 1]
- [Action item 2]

Full Notes: obsidian://vault/[path-to-index]
```

### Obsidian Protocol Links
Research needed: Determine if `obsidian://` protocol links are useful for HubSpot integration. May need to explore:
- Direct file path links
- Web-based Obsidian Publish links
- Custom deep linking solution

---

## Speaker Recognition & Identification

### Audio Diarization
Use transcription service with speaker diarization support (Deepgram, AssemblyAI).

### Speaker Labeling Strategy

#### Phase 1: Basic Labeling
- Label speakers as "Speaker 1", "Speaker 2", etc.
- Include timestamps for each speaker segment

#### Phase 2: Contact Matching
- Match speaker voices to known participants:
  1. Get participant list from calendar invite
  2. Use voice characteristics + context to match
  3. Label as "John Doe" instead of "Speaker 1"

#### Phase 3: Historical Learning
- Build voice profile database over time
- Improve matching accuracy with historical data
- Optional: User confirmation/correction of speaker IDs

### Transcript Format
```markdown
---
meeting: Client Strategy Call
date: 2025-10-22
participants:
  - John Doe (john@client.com)
  - Jane Smith (jane@client.com)
  - You
---

# Full Meeting Transcript

## 2:00:05 PM - John Doe
Let's start with the quarterly review. We've seen strong growth in Q3...

## 2:01:30 PM - You
That's great to hear. Can you break down the growth by segment?

## 2:02:15 PM - Jane Smith
Sure, our enterprise segment grew by 25%...
```

---

## Import Prior Transcripts

### Supported Formats
- Plain text (.txt)
- Markdown (.md)
- VTT (Video Text Tracks)
- SRT (SubRip Subtitle)
- JSON (structured transcripts)

### Import Process
1. **File Selection**: User selects files or folder to import
2. **Metadata Extraction**:
   - Try to parse date from filename (e.g., "2025-10-22-meeting.txt")
   - Try to parse participants from content or filename
   - Allow user to manually input metadata
3. **Content Processing**:
   - Convert to standard transcript format
   - Apply LLM summarization
   - Generate meeting index
4. **Routing**:
   - Use existing routing logic to determine save location
   - Allow manual override for unfiled imports

### Import UI
```
┌─────────────────────────────────────────────┐
│  Import Transcripts                         │
├─────────────────────────────────────────────┤
│                                             │
│  [Select Files] [Select Folder]             │
│                                             │
│  Files to Import: 12                        │
│                                             │
│  ☑ Auto-detect dates from filenames         │
│  ☑ Auto-detect participants from content    │
│  ☑ Generate summaries                       │
│  ☑ Generate indexes                         │
│                                             │
│  [Import] [Cancel]                          │
└─────────────────────────────────────────────┘
```

---

## Encryption & Security

### Data Protection
- **Transcripts**: Encrypted at rest using Windows DPAPI
- **Audio Files**: Encrypted at rest using Windows DPAPI
- **API Keys**: Stored in Windows Credential Manager
- **Encryption Scope**: All files in vault folder (opt-in per user)

### Windows DPAPI Integration
```typescript
// Pseudo-code example
import { dpapi } from 'node-dpapi';

// Encrypt before saving
const encrypted = dpapi.protect(
  Buffer.from(transcript),
  null, // Current user
  'CurrentUser'
);
fs.writeFileSync('transcript.md.enc', encrypted);

// Decrypt when reading
const encrypted = fs.readFileSync('transcript.md.enc');
const decrypted = dpapi.unprotect(
  encrypted,
  null,
  'CurrentUser'
);
```

### Security Settings
- Toggle encryption on/off
- Re-encrypt existing files when enabling
- Warning when disabling encryption
- No automatic deletion (user controlled)

---

## Settings Panel

### Configuration Categories

#### General
- Vault path (Obsidian folder)
- Default save location
- Auto-start with Windows
- Minimize to system tray

#### Recording
- Audio quality (sample rate, bitrate)
- Audio format (WAV, MP3)
- Auto-start recording for calendar events
- Recording notification sounds

#### Transcription
- Transcription service selection
- Language preferences
- Enable speaker diarization
- Real-time transcription (if supported)

#### Routing
- Edit routing.yaml file (with syntax highlighting)
- Test routing with sample emails
- View routing logs

#### Templates
- Manage template files
- Enable/disable templates
- Set default templates per organization type

#### Integrations
- Google Calendar (connect/disconnect)
- Google Contacts (connect/disconnect)
- HubSpot (connect/disconnect, API key)
- LLM provider settings (API keys, model selection)

#### Security
- Enable/disable encryption
- Re-encrypt existing files
- Clear cache
- Export logs

---

## Phase-Based Development Plan

### Phase 1: Core Recording & Transcription
**Goal:** Basic functional MVP - record meetings and save transcripts

#### Deliverables
1. Electron app skeleton with React UI
2. Recall.ai SDK integration
3. Manual recording with start/stop controls
4. Basic audio recording (system audio capture)
5. Transcription integration (select best service: Deepgram/AssemblyAI/Whisper)
6. Save transcripts to file system as markdown
7. Simple recording widget UI
8. Basic file naming (date-based)

#### Success Criteria
- User can start manual recording
- Audio is captured clearly
- Transcript is generated with timestamps
- Transcript saved as `YYYY-MM-DD-HH-MM-transcript.md`
- Basic speaker labels (Speaker 1, Speaker 2)

#### User Value
Can manually record meetings and get transcribed notes saved locally.

---

### Phase 2: Routing System ✅ COMPLETE
**Goal:** Intelligent file organization based on participants

#### Deliverables
1. ✅ Routing configuration file (`config/routing.yaml`)
2. ✅ Email domain matching logic
3. ✅ Vault folder structure creation
4. ✅ Client/industry/internal/unfiled routing
5. ⏳ Manual participant input during recording (deferred to Phase 3)
6. ⏳ Post-recording routing with user confirmation (deferred to Phase 3)

#### Success Criteria
- ✅ Routing config file loads correctly
- ✅ Email domains matched to organizations
- ✅ Files saved to correct vault paths
- ✅ Unfiled meetings saved with date-based folders
- ⏳ User can override routing decisions (deferred to Phase 3 UI)

#### Modules Implemented
- `src/main/routing/ConfigLoader.js` - YAML configuration loader with validation
- `src/main/routing/EmailMatcher.js` - Priority-based email/domain matching
- `src/main/routing/RoutingEngine.js` - Main routing decision engine
- `src/main/storage/VaultStructure.js` - Vault folder creation and file generation
- `test-routing.js` - Comprehensive test suite (5 scenarios, 9 routes, 100% success)

#### User Value
Meetings automatically organized into proper client/project folders.

#### Technical Debt Items (Phase 2)

**5. Implement Proper Logging Framework**
- Install `electron-log` for structured logging
- Create `src/shared/logger.js` with log levels and formatting
- Replace `console.log` statements incrementally as files are modified
- Priority: Do incrementally - replace logging in files touched during Phase 2 development
- Estimated effort: 2-3 hours initial setup, then incremental

**6. Add ESLint & Prettier Configuration**
- Install ESLint, Prettier, and related plugins
- Create `.eslintrc.js` and `.prettierrc` configuration files
- Add lint/format scripts to `package.json`
- Priority: Set up early in Phase 2, run periodically
- Estimated effort: 1 hour setup

**7. Split main.js Into Modules**
- Extract code from 1,818-line `src/main.js` into focused modules:
  - `src/main/api/recallai.js` - Upload token creation
  - `src/main/storage/FileManager.js` - File operations
  - `src/main/llm/SummaryGenerator.js` - LLM service (if applicable)
- Extract 1 module at a time, test after each extraction
- Focus on modules actively being worked on in Phase 2
- Priority: Incremental during Phase 2 - extract as you add features
- Estimated effort: 8-10 hours total, done incrementally

---

### Phase 3: Calendar Integration & Auto-Recording
**Goal:** Automated meeting detection and recording

#### Deliverables
1. ✅ Google Calendar OAuth integration
2. ✅ Calendar event fetching
3. ✅ Upcoming meetings display in UI
4. ✅ Meeting detection (Zoom/Teams/Meet links)
5. ⏳ Auto-start recording when meeting begins
6. ✅ Extract meeting metadata (title, participants)
7. ⏳ Recording notification system
8. ✅ Manual refresh button

#### Success Criteria
- ✅ Calendar events displayed in main window
- ✅ Meetings with 2+ participants detected
- ⏳ Recording starts automatically (with notification)
- ✅ Meeting title and participants extracted
- ✅ User can stop recording via widget

#### Implementation Details
- **Module**: `src/main/integrations/GoogleCalendar.js` (369 lines)
- **Features**: OAuth 2.0 flow, token storage, meeting platform detection (Zoom/Teams/Meet/Webex/Whereby)
- **Token Storage**: `C:\Users\brigh\AppData\Roaming\JD Notes Things\google-calendar-token.json`
- **UI**: Calendar meeting cards with Join/Record buttons, platform badges, participant counts
- **Model**: Currently using `gpt-4o-mini` for AI summaries (switched from gpt-5-nano due to streaming bug)

#### User Value
No manual intervention needed - app automatically records scheduled meetings.

#### Technical Debt Items (Phase 3)

**8. TypeScript Migration**
- Migrate project from JavaScript to TypeScript for type safety
- Start with shared types in `src/shared/types.ts`
- Incrementally migrate modules (prioritize new code over legacy)
- Configure tsconfig.json with appropriate compiler options
- Best done before Phase 4 (LLM integration) to help with provider abstraction
- Priority: Start during Phase 3, complete before Phase 4
- Estimated effort: 20-30 hours total, done incrementally

**9. React Component Extraction**
- Extract components from 2,004-line `src/renderer.js` monolith
- Create modular component structure:
  - `components/MeetingList.jsx`, `MeetingCard.jsx`, `MeetingEditor.jsx`
  - `components/TranscriptView.jsx`, `RecordingControls.jsx`
  - `hooks/useMeetings.js`, `useRecording.js`
- Essential for Phase 3 Calendar UI implementation
- Extract components as needed when building Calendar view
- Priority: Do during Phase 3 when adding Calendar UI
- Estimated effort: 12-15 hours

**10. Comprehensive Testing**
- Set up testing infrastructure: Jest, React Testing Library
- Install: `jest`, `@testing-library/react`, `@testing-library/jest-dom`
- Write tests incrementally for new features added in Phase 3+
- Focus on critical paths: routing logic, file operations, IPC handlers
- Target: 50% test coverage by Phase 4
- Priority: Set up infrastructure in Phase 3, write tests incrementally
- Estimated effort: 30+ hours ongoing

---

### Phase 4: LLM Integration & Summaries
**Goal:** Automated meeting summarization with templates

#### Deliverables
1. Template system (scan folder for .md/.yaml/.json files)
2. Template parser for different formats
3. LLM service integration (OpenAI/Claude/Gemini)
4. Summary generation based on templates
5. Multiple summary types per meeting
6. Cost tracking per LLM call
7. Template selection UI

#### Success Criteria
- Templates loaded from config folder
- LLM generates summaries matching template structure
- Multiple summaries created per meeting
- Summaries saved alongside transcript
- User can select which templates to apply

#### User Value
Automatic generation of actionable meeting summaries (decisions, action items, etc.).

---

### Phase 5: Meeting Index Generation
**Goal:** LLM-optimized navigation and retrieval

#### Deliverables
1. Meeting index generation (index.md)
2. Topic extraction from transcript
3. Quick navigation table with links
4. File summaries for each meeting document
5. Action items extraction
6. Metadata enrichment

#### Success Criteria
- Index.md generated for each meeting
- Topics correctly identified and linked
- Links work in Obsidian
- Index useful for LLM retrieval
- Format matches example template

#### User Value
Easy navigation of meeting content, optimized for AI-assisted search.

---

### Phase 6: Speaker Recognition & Contact Matching
**Goal:** Identify who said what

#### Deliverables
1. Speaker diarization in transcription
2. Google Contacts integration
3. Participant email → contact matching
4. Speaker voice → participant matching (basic)
5. Speaker labels in transcript
6. Manual speaker ID correction UI

#### Success Criteria
- Transcript shows speaker names (not just "Speaker 1")
- Participant emails matched to Google Contacts
- Speaker identification >70% accurate
- User can correct misidentifications

#### User Value
Clear attribution of statements to specific people.

---

### Phase 7: Platform-Specific Recording (Zoom/Teams/Meet)
**Goal:** Optimized recording for specific meeting platforms

#### Deliverables
1. Zoom meeting detection (when Zoom window active)
2. Microsoft Teams meeting detection
3. Google Meet meeting detection
4. Platform-specific audio capture optimization
5. Calendar event → platform detection
6. Platform logo/indicator in UI

#### Success Criteria
- App detects which platform is active
- Recording quality optimized per platform
- Calendar events matched to platform type
- Meeting metadata includes platform

#### User Value
Better reliability and quality for platform-specific meetings.

---

### Phase 8: HubSpot Integration
**Goal:** Sync meeting summaries to CRM

#### Deliverables
1. HubSpot OAuth integration
2. Company matching by email domain
3. Contact matching by email
4. Create Note/Activity in HubSpot
5. Associate with Company and Contacts
6. Include meeting summary and Obsidian link
7. Error handling for missing matches

#### Success Criteria
- Meeting summaries appear in HubSpot
- Associated with correct Company
- Contacts properly linked
- Obsidian link included and functional
- User notified of successful sync

#### User Value
CRM stays updated without manual data entry.

---

### Phase 9: Import Prior Transcripts
**Goal:** Retroactively process existing meeting notes

#### Deliverables
1. File import UI (single file or bulk)
2. Support for .txt, .md, VTT, SRT formats
3. Metadata extraction from filename/content
4. Manual metadata input form
5. Batch processing
6. Apply routing to imported transcripts
7. Generate summaries for imported transcripts
8. Progress indicator for bulk imports

#### Success Criteria
- Import 100+ transcripts successfully
- Metadata extracted accurately (>80%)
- Routing works for historical transcripts
- Summaries generated for imports
- User can monitor import progress

#### User Value
Entire meeting history organized and searchable using new system.

---

### Phase 10: Encryption & Security
**Goal:** Protect sensitive meeting data

#### Deliverables
1. Windows DPAPI integration
2. Encrypt transcripts at rest
3. Encrypt audio files at rest
4. API key storage in Windows Credential Manager
5. Enable/disable encryption toggle
6. Re-encrypt existing files option
7. Decryption on read (transparent to user)

#### Success Criteria
- Files encrypted using DPAPI
- Decryption transparent in Obsidian (if supported)
- API keys stored securely
- User can toggle encryption without data loss
- No performance degradation

#### User Value
Sensitive client information protected from unauthorized access.

#### Technical Debt Items (Phase 10)

**11. Memory Leak Prevention**
- Clean up event listeners on window/app close
- Affected areas:
  - IPC listeners in main process
  - SDK event listeners (Recall.ai)
  - Renderer process event listeners
- Add proper cleanup handlers for all event registrations
- Test with long-running sessions to verify no memory accumulation
- Priority: Implement during Phase 10 security hardening
- Estimated effort: 4-6 hours

**13. XSS Vulnerabilities**
- Replace unsafe `innerHTML` usage with safer alternatives
- Use `textContent` for plain text or DOMPurify for HTML sanitization
- Audit renderer process for potential XSS vectors
- Primarily affects transcript display and summary rendering
- Priority: Low risk (data from trusted sources), address during security phase
- Estimated effort: 2-3 hours

---

### Phase 11: Advanced UI & Settings
**Goal:** Polish user experience and configurability

#### Deliverables
1. Comprehensive settings panel
2. Template editor with syntax highlighting
3. Routing configuration editor
4. Routing test tool
5. Audio quality settings
6. Notification preferences
7. Theme support (light/dark)
8. Keyboard shortcuts
9. System tray menu
10. Logs and diagnostics viewer

#### Success Criteria
- All settings accessible and functional
- In-app routing config editor works
- User can customize behavior without editing files
- Keyboard shortcuts work consistently
- System tray provides quick access

#### User Value
Fully customizable to personal workflow preferences.

#### Technical Debt Items (Phase 11)

**12. Code Duplication**
- Refactor repeated patterns identified during development:
  - Video file checking logic
  - Upload token creation
  - Error handling patterns
- Extract common code into utility functions/modules
- Approach: Refactor opportunistically when touching duplicated code
- Priority: Low - fix when convenient during normal development
- Estimated effort: 4-6 hours total, done opportunistically

**14. Environment Configuration**
- Implement dev/staging/production environment separation
- Create environment-specific configuration files
- Support for different API endpoints per environment
- Enable easier testing with different configurations
- Priority: Implement when deployment/distribution needs arise
- Estimated effort: 3-4 hours

---

### Phase 12: Real-Time Transcription (Optional)
**Goal:** See transcript while meeting is in progress

#### Deliverables
1. Streaming transcription support
2. Live transcript view in widget or window
3. Real-time speaker identification
4. Editable live transcript
5. Auto-save partial transcript
6. Resume transcription after pause

#### Success Criteria
- Transcript appears within 5 seconds of speech
- Accuracy matches post-processing
- Live view doesn't impact recording quality
- User can edit and correct in real-time

#### User Value
Take notes and review what was said during the meeting.

---

## API & Service Requirements

### Recall.ai
- Account and API key
- Desktop Recording SDK
- Documentation: https://docs.recall.ai/docs/getting-started

### Transcription Service (Provider Pattern)
**Architecture**: Pluggable provider system supporting multiple backends

**Phase 1 - AssemblyAI Provider**:
- **AssemblyAI**: Excellent diarization (50 speakers), mid-tier pricing ($0.27/hr)
- Primary implementation for immediate use
- Cloud-based, requires API key

**Phase 1.5 - Parakeet Provider** (Future):
- **Parakeet (NVIDIA)**: Local transcription, privacy-focused, offline, free
- Similar to Meetify's implementation
- Requires GPU for optimal performance

**Other Options Considered**:
- **Deepgram**: Real-time + speaker diarization, good pricing (may use in Phase 12)
- **Whisper API**: OpenAI, high quality, potentially expensive

### LLM Services
- **OpenAI**: GPT-4o (for complex summaries)
- **Anthropic Claude**: Claude 3.5 Sonnet (for detailed analysis)
- **Google Gemini**: Gemini 1.5 Pro (cost-effective for long context)

### Google APIs
- **Google Calendar API**: OAuth 2.0, read-only calendar access
- **Google Contacts API**: OAuth 2.0, read contacts

### HubSpot API
- Private App or OAuth integration
- Scopes needed: `crm.objects.contacts`, `crm.objects.companies`, `timeline`

---

## File Structure (Project)

```
jdnotesthings/
├── src/
│   ├── main/                       # Electron main process
│   │   ├── index.ts                # Main entry point
│   │   ├── recording/
│   │   │   ├── RecordingManager.ts
│   │   │   ├── RecallSDK.ts
│   │   │   └── AudioCapture.ts
│   │   ├── transcription/
│   │   │   ├── TranscriptionService.ts       # Provider factory/interface
│   │   │   ├── ITranscriptionProvider.ts     # Abstract provider interface
│   │   │   ├── AssemblyAIProvider.ts         # AssemblyAI implementation
│   │   │   └── ParakeetProvider.ts           # Future: Local transcription
│   │   ├── routing/
│   │   │   ├── RoutingEngine.ts
│   │   │   ├── ConfigLoader.ts
│   │   │   └── EmailMatcher.ts
│   │   ├── llm/
│   │   │   ├── LLMService.ts
│   │   │   ├── TemplateProcessor.ts
│   │   │   └── SummaryGenerator.ts
│   │   ├── integrations/
│   │   │   ├── GoogleCalendar.ts
│   │   │   ├── GoogleContacts.ts
│   │   │   └── HubSpotAPI.ts
│   │   ├── storage/
│   │   │   ├── FileManager.ts
│   │   │   ├── Encryption.ts
│   │   │   └── VaultStructure.ts
│   │   └── utils/
│   │       ├── Logger.ts
│   │       └── Config.ts
│   │
│   ├── renderer/                   # Electron renderer process (React)
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── MainWindow.tsx
│   │   │   ├── RecordingWidget.tsx
│   │   │   ├── SettingsPanel.tsx
│   │   │   ├── CalendarView.tsx
│   │   │   └── ImportWizard.tsx
│   │   ├── hooks/
│   │   └── styles/
│   │
│   └── shared/                     # Shared types and constants
│       ├── types.ts
│       └── constants.ts
│
├── config/                         # User configuration
│   ├── routing.yaml
│   └── templates/
│       ├── client-meeting.md
│       └── internal-team.md
│
├── docs/                           # Documentation
│   ├── SPECIFICATION.md
│   ├── API.md
│   └── examples/
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── webpack.main.config.js
├── webpack.renderer.config.js
├── forge.config.js
├── package.json
├── tsconfig.json
└── README.md
```

---

## Open Questions & Research Items

### 1. Obsidian Protocol Links
- Research `obsidian://` URI scheme
- Test if clickable in HubSpot
- Alternative: file path, Obsidian Publish URL

### 2. Recall.ai SDK Capabilities
- Confirm Windows support
- Test audio quality settings
- Check system audio capture vs app-specific

### 3. Transcription Service Selection
- Compare Deepgram vs AssemblyAI vs Whisper
- Test speaker diarization accuracy
- Evaluate cost per hour of audio

### 4. Speaker Matching Algorithms
- Research voice fingerprinting
- Speaker embedding models
- Privacy considerations for voice profiles

### 5. Encryption & Obsidian Compatibility
- Test if encrypted files readable in Obsidian
- Consider transparent encryption layer
- Evaluate performance impact

### 6. Real-Time Transcription Feasibility
- Test streaming transcription latency
- Evaluate resource usage
- Determine if worth complexity

---

## Success Metrics

### Phase 1 Success
- Can record and transcribe a 30-minute meeting
- Transcript accuracy >85%
- Files saved correctly

### Phase 2 Success
- 100% of meetings routed to correct folders
- Zero manual routing needed for known contacts

### Phase 3 Success
- Zero missed scheduled meetings
- 100% auto-start rate for calendar events

### Phase 4 Success
- Summaries generated in <2 minutes post-meeting
- Summary quality rated "useful" by user
- Multiple summary types per meeting

### Overall Success
- Daily use for all meetings (100% adoption)
- Manual note-taking time reduced by 80%
- Meeting notes organized and searchable
- CRM sync reduces admin time by 50%

---

## Timeline Philosophy

This is a phase-based project without hard deadlines. Each phase should be:
1. **Fully functional** - Delivers real value independently
2. **Testable** - Can be used in real meetings immediately
3. **Iterative** - Feedback from one phase informs the next
4. **Incremental** - Each phase adds new capability without breaking previous functionality

Phases 1-3 create the MVP. Phases 4-11 add intelligence and automation. Phase 12 is optional polish.

---

## Next Steps

1. **Review this specification** - Confirm alignment with vision
2. **Set up development environment** - Install Electron, Node.js, TypeScript
3. **Create Recall.ai account** - Obtain API key and test SDK
4. **Select transcription service** - Test quality and pricing
5. **Begin Phase 1 implementation** - Core recording and transcription
6. **Iterate based on real-world usage** - Refine and improve

---

**Document Version:** 1.0
**Last Updated:** November 5, 2025
**Author:** Claude Code
**Approved By:** J.D. Bruce
