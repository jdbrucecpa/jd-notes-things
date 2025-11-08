# JD Notes Things - Product Specification

**Project Name:** JD Notes Things
**Organization:** JD Knows Things
**Purpose:** Personal AI Meeting Notetaker for Zoom, Microsoft Teams, Google Meet, and Manual Recording
**Version:** 1.0
**Last Updated:** November 8, 2025

---

## Development Status

**Current Baseline:** Muesli (Recall.ai reference implementation)
**Phase:** 5 In Progress - Completing Obsidian Export Workflow
**Status:** Export workflow refinement in progress

**Completed Phases:**
- ✅ Phase 1: Core Recording & Transcription
- ✅ Phase 2: Routing System
- ✅ Phase 3: Calendar Integration & Auto-Recording
- ✅ Phase 4: LLM Integration & Summaries (Template System)
- 🚧 Phase 5: Obsidian Export & File Generation (export code exists, workflow integration needed)
- ✅ Phase 6: Speaker Recognition & Contact Matching
- ✅ Phase 7: Platform-Specific Recording (Zoom/Teams/Meet)

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
│   │       ├── 2025-10-22-quarterly-review.md              (Summary with metadata)
│   │       ├── 2025-10-22-quarterly-review-transcript.md   (Full transcript)
│   │       ├── 2025-11-05-strategy-call.md
│   │       └── 2025-11-05-strategy-call-transcript.md
│   ├── capital-partners/
│   │   └── meetings/
│   ├── regency-invests/
│   │   └── meetings/
│   └── [other-clients]/
│       └── meetings/
│
├── industry/
│   └── herbers/
│       └── meetings/
│           ├── 2025-10-15-industry-roundtable.md
│           └── 2025-10-15-industry-roundtable-transcript.md
│
├── internal/
│   └── meetings/
│       ├── 2025-10-20-team-standup.md
│       └── 2025-10-20-team-standup-transcript.md
│
├── _unfiled/
│   └── 2025-10/                                (Date-based unfiled meetings)
│       └── meetings/
│           ├── 2025-10-25-unknown-meeting.md
│           └── 2025-10-25-unknown-meeting-transcript.md
│
└── config/
    ├── routing.yaml                            (Routing configuration)
    └── templates/                              (LLM summary templates)
```

### File Naming Convention
- **Summary file:** `YYYY-MM-DD-meeting-title-slug.md` (primary file with metadata + AI summary)
- **Transcript file:** `YYYY-MM-DD-meeting-title-slug-transcript.md` (full transcript with timestamps)
- **Recording audio:** `YYYY-MM-DD-meeting-title-slug.wav` (optional, if audio saved)

### Two-File Architecture

Each meeting generates exactly two markdown files:

**Primary File (Summary):**
- YAML frontmatter with complete meeting metadata
- AI-generated executive summary
- Key decisions and action items
- Discussion topics
- Link to transcript file
- **Purpose:** Quick reference, LLM queries, CRM linking, Obsidian search
- **Token cost:** ~1,500 tokens (~$0.005 per LLM read)

**Secondary File (Transcript):**
- Minimal YAML frontmatter (title, date, link back to summary)
- Complete timestamped transcript with speaker labels
- **Purpose:** Deep dives, finding exact quotes, full context retrieval
- **Token cost:** ~8,000-10,000 tokens (~$0.03 per LLM read)

**Rationale:**
- **60% token cost savings** - Most queries only need summary
- **Better UX** - Quick reviews use summary, deep dives use transcript
- **Flexible retention** - Can delete old transcripts, keep summaries
- **Optimized for RAG** - Search summaries first, load transcripts when needed

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

## Meeting File Formats

Each meeting generates two markdown files with complementary purposes.

### Primary File: Summary (Example: `2025-11-07-strategy-call.md`)

```markdown
---
title: "Strategy Call with Acme Corp"
date: 2025-11-07
start_time: "14:00"
end_time: "14:45"
duration: "45 minutes"
platform: "zoom"
recording_file: "2025-11-07-strategy-call.wav"
transcript_file: "2025-11-07-strategy-call-transcript.md"

participants:
  - name: "John Doe"
    email: "john@acme.com"
    organization: "Acme Corp"
    role: "CEO"
  - name: "Jane Smith"
    email: "jane@acme.com"
    organization: "Acme Corp"
    role: "CFO"
  - name: "J.D. Bruce"
    email: "jd@jdknowsthings.com"
    organization: "JD Knows Things"
    role: "Consultant"

tags: [meeting, client, acme-corp, strategy, partnership, q4-planning]
topics: [partnership-structure, revenue-projections, governance]
meeting_type: "client"
organization_slug: "acme-corp"
crm_synced: false
---

# Strategy Call with Acme Corp

**Date:** November 7, 2025, 2:00 PM - 2:45 PM
**Platform:** Zoom
**Attendees:** John Doe (CEO, Acme Corp), Jane Smith (CFO, Acme Corp), J.D. Bruce

---

## Executive Summary

Acme Corp leadership discussed transitioning from single-owner structure to broad-based partnership model targeting 5-7 partners by Q2 2026. Key decision made to engage external counsel for new operating agreement. Main concerns centered on past partnership failures and ensuring proper governance.

---

## Key Decisions

- **Partnership Model Approved:** Agreed to pursue broad-based partnership (5-7 partners) rather than single-successor approach
- **Legal Engagement:** Will hire external counsel to draft comprehensive operating agreement
- **Partner Buy-In:** Target $150k per partner with flexible payment terms
- **Timeline:** Target partner promotions for Q2 2026

---

## Action Items

- [ ] **John Doe** - Present partnership proposal to board of advisors - *Due: 2025-11-14*
- [ ] **Jane Smith** - Prepare 3-year financial model with partnership scenarios - *Due: 2025-11-21*
- [ ] **J.D. Bruce** - Draft engagement letter and send by EOW - *Due: 2025-11-10*
- [ ] **J.D. Bruce** - Research legal counsel recommendations - *Due: 2025-11-12*

---

## Discussion Topics

### Partnership Structure Vision

John expressed strong interest in broad-based partnership rather than single successor. Cited previous negative experiences with traditional 2-3 partner firms where conflicts arose. Wants to create "team of equals" model with clear governance.

**Key Quote:** "I've seen too many partnerships fail because two people couldn't agree. I want a model where we're all invested in success."

### Financial Considerations

Jane shared current firm financials: $3M revenue, 35% margins with target of 40% over next 18 months. Discussed partner compensation structure and buy-in affordability. Concern about maintaining profitability while adding partners.

Revenue breakdown:
- Recurring advisory: 60% ($1.8M)
- Project work: 30% ($900k)
- Other services: 10% ($300k)

### Governance and Decision-Making

Discussion of how decisions would be made with 5-7 partners. Consensus on needing clear operating agreement with voting thresholds, partner roles, and exit mechanisms. Identified this as critical success factor.

**Concerns raised:**
- How to handle deadlocks
- Partner removal process
- Buy-out valuations
- Succession planning

---

## Next Steps

1. Board approval expected within 2 weeks
2. Schedule 2-hour kickoff meeting (all partners + J.D.) - targeting Nov 20-22
3. Begin legal counsel search immediately
4. Financial modeling to validate partnership economics

**Follow-up meeting:** Scheduled for November 20, 2025 at 2:00 PM (2 hours)

---

## Meeting Metadata

**Recording Duration:** 45 minutes
**Word Count:** 8,432 words
**Transcription Provider:** AssemblyAI
**AI Summary Model:** gpt-4o-mini
**Transcription Cost:** $0.03
**Summary Cost:** $0.02
**Generated:** 2025-11-07 15:05:32

---

**Full Transcript:** [[2025-11-07-strategy-call-transcript]]

*Generated by JD Notes Things*
```

### Secondary File: Transcript (Example: `2025-11-07-strategy-call-transcript.md`)

```markdown
---
title: "Strategy Call with Acme Corp - Full Transcript"
date: 2025-11-07
summary_file: "2025-11-07-strategy-call.md"
participants:
  - John Doe (Acme Corp)
  - Jane Smith (Acme Corp)
  - J.D. Bruce (JD Knows Things)
---

# Full Transcript: Strategy Call with Acme Corp

**Back to summary:** [[2025-11-07-strategy-call]]

**Date:** November 7, 2025, 2:00 PM - 2:45 PM
**Duration:** 45 minutes
**Platform:** Zoom

---

### 14:00:15 - John Doe
Let's start by discussing where we are today. We're at about $3M in revenue, 16 employees, and we've been growing at over 30% annually for the past few years.

### 14:01:02 - Jane Smith
I can add some color on the financials. Our margins are currently around 35%, which is good for our industry, but we're targeting 40% over the next 18 months.

### 14:01:45 - J.D. Bruce
That's helpful context. Before we dive into the partnership structure, can you tell me a bit about your vision for the future? What does success look like in 3-5 years?

### 14:02:30 - John Doe
Great question. I see us with a strong partnership team, maybe 5 to 7 partners, all invested in the long-term success of the firm. I don't want the traditional model where it's just me and one other person. I've seen that fail too many times.

[... full transcript continues with timestamps and speaker labels ...]

### 14:43:15 - J.D. Bruce
Perfect. I'll send over the engagement letter by end of week and we can get started.

### 14:43:45 - John Doe
Sounds great. Looking forward to it. Thanks for your time today.

### 14:44:00 - Jane Smith
Thank you!

---

**Total Duration:** 44 minutes, 45 seconds
**Total Words:** 8,432
**Speakers:** 3
**Transcription:** AssemblyAI v3 (speaker diarization enabled)

*Generated by JD Notes Things*
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

### Phase 1: Core Recording & Transcription ✅ COMPLETE
**Goal:** Basic functional MVP - record meetings and save transcripts

#### Deliverables
1. ✅ Electron app skeleton with React UI
2. ✅ Recall.ai SDK integration (v1.3.2)
3. ✅ Manual recording with start/stop controls
4. ✅ Desktop audio recording (system audio capture)
5. ✅ Transcription integration (AssemblyAI v3 streaming)
6. ✅ Save transcripts to file system
7. ✅ Recording widget UI
8. ✅ Meeting detection (Zoom, Teams, Google Meet, Slack)

#### Success Criteria
- ✅ User can start manual recording
- ✅ Audio is captured clearly (microphone confirmed working)
- ✅ Transcript is generated with timestamps
- ✅ Real-time transcription with AssemblyAI streaming
- ✅ Speaker diarization (Speaker 1, Speaker 2, etc.)

#### Implementation Details
- **Built on**: Muesli (Recall.ai reference implementation) - November 6, 2025
- **Recording**: Manual desktop audio with `prepareDesktopAudioRecording()`
- **Auto-detection**: Automatic meeting detection for supported platforms
- **Transcription**: AssemblyAI v3 streaming with speaker diarization
- **Storage**: Meetings stored in `userData/meetings.json`
- **Files**: Recording files saved to `userData/recordings/`

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

### Phase 3: Calendar Integration & Auto-Recording ✅ COMPLETE
**Goal:** Automated meeting detection and recording

#### Deliverables
1. ✅ Google Calendar OAuth integration
2. ✅ Calendar event fetching
3. ✅ Upcoming meetings display in UI
4. ✅ Meeting detection (Zoom/Teams/Meet links)
5. ✅ Auto-start recording when meeting begins
6. ✅ Extract meeting metadata (title, participants)
7. ✅ Recording notification system
8. ✅ Manual refresh button

#### Success Criteria
- ✅ Calendar events displayed in main window
- ✅ Meetings with 2+ participants detected
- ✅ Recording starts automatically (with notification)
- ✅ Meeting title and participants extracted
- ✅ User can stop recording via widget

#### Implementation Details
- **Module**: `src/main/integrations/GoogleCalendar.js` (369 lines)
- **Features**: OAuth 2.0 flow, token storage, meeting platform detection (Zoom/Teams/Meet/Webex/Whereby)
- **Token Storage**: `C:\Users\brigh\AppData\Roaming\JD Notes Things\google-calendar-token.json`
- **UI**: Calendar meeting cards with Join/Record buttons, platform badges, participant counts, in-app OAuth flow
- **Meeting Monitor**: 60-second interval-based monitoring with automatic recording start and notifications
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

### Phase 4: LLM Integration & Summaries ✅ COMPLETE
**Goal:** Automated meeting summarization with templates

#### Deliverables
1. ✅ Template system (scan folder for .md/.yaml/.json files)
2. ✅ Template parser for different formats
3. ✅ LLM service integration (OpenAI/Claude/Gemini)
4. ✅ Summary generation based on templates
5. ✅ Multiple summary types per meeting
6. ✅ Cost tracking per LLM call
7. ✅ Template selection UI

#### Success Criteria
- ✅ Templates loaded from config folder
- ✅ LLM generates summaries matching template structure
- ✅ Multiple summaries created per meeting
- ✅ Summaries saved alongside transcript
- ✅ User can select which templates to apply

#### Implementation Details
- **Modules**: `src/main/templates/TemplateParser.js`, `src/main/templates/TemplateManager.js`
- **Features**: Multi-format support (.md, .yaml, .json), token cost estimation, modal selection UI
- **Storage**: Summaries stored in `meetings.json` under each meeting object
- **UI**: Template selection modal with checkboxes, cost estimates, and collapsible summary cards
- **Model**: Currently using `gpt-4o-mini` for summary generation

#### User Value
Automatic generation of actionable meeting summaries (decisions, action items, etc.).

---

### Phase 5: Obsidian Export & File Generation 🚧 IN PROGRESS
**Goal:** Export meeting data to Obsidian vault with two-file structure

#### Deliverables
1. ✅ Connect VaultStructure and RoutingEngine to main.js
2. ✅ Generate summary file with rich metadata frontmatter
3. ✅ Generate transcript file with speaker labels and timestamps
4. ✅ Extract and populate topics/tags in frontmatter
5. ✅ Create bidirectional links between summary and transcript
6. ✅ Handle multi-organization routing (duplicate files when needed)
7. ⏳ Export recording audio file (optional - deferred)
8. ⏳ **Automatic export after template generation**
9. ⏳ **Manual "Publish to Obsidian" / "Republish to Obsidian" button**
10. ⏳ **Obsidian link tracking (meeting → vault folder)**
11. ⏳ **Manual vault link override** (bypass routing, correct errors)
12. ⏳ **Multiple template concatenation** (all selected templates in one summary file)
13. ⏳ **UI status indicator** (show if meeting synced to Obsidian)

#### Complete Workflow (User Perspective)
1. **Meeting ends** → Automatic basic summary generated
2. **Nothing exported yet** → Meeting stored locally only
3. **Click "Generate"** → User selects templates, all chosen templates are generated
4. **Auto-export to Obsidian** → Creates `summary.md` (with all templates concatenated) + `transcript.md`
5. **UI shows Obsidian link** → Icon/badge indicates meeting is synced to vault
6. **Manual override option** → User can edit vault link to correct routing errors or bypass routing
7. **Republish capability** → "Republish to Obsidian" button (with confirmation) replaces existing files
8. **Fallback**: If Generate never clicked, user can manually publish with basic summary only

#### Success Criteria
- ✅ Files saved to correct organization folders based on routing rules
- ✅ Summary file contains all metadata, decisions, and action items
- ✅ Transcript file contains full conversation with timestamps
- ✅ Links work correctly in Obsidian (summary ↔ transcript)
- ✅ Frontmatter tags enable Dataview queries
- ✅ Multi-org meetings duplicated to all relevant folders
- ⏳ Export automatically triggered after template generation
- ⏳ UI shows sync status (published, not published, republish available)
- ⏳ User can manually override vault location
- ⏳ Multiple templates concatenated into single summary file with section headers
- ⏳ Republish confirmation prevents accidental overwrites

#### Implementation Details
- **Integration**: Export system initialized in `main.js` (lines 320-349)
- **Vault Path**: Configured via `VAULT_PATH` in `.env` file (currently `./vault` for development)
- **Two-File Architecture**:
  - `YYYY-MM-DD-meeting-slug.md` - Summary with YAML frontmatter (primary file for LLM queries)
  - `YYYY-MM-DD-meeting-slug-transcript.md` - Full transcript with timestamps (secondary file)
- **Cost Optimization**: Two-file structure provides ~60% token cost savings
- **Frontmatter**: Includes meeting metadata, participants, tags, topics, platform, duration, routing info, costs
- **Bidirectional Links**: Obsidian wiki-links connect summary ↔ transcript
- **IPC Handlers**: `obsidian:exportMeeting`, `obsidian:getStatus`

#### Technical Specification - Export Workflow

**Data Model - Meeting Object:**
```javascript
{
  id: "meeting-123456789",
  title: "Strategy Call with Acme",
  content: "# Automatic Summary\n...",  // Basic summary or combined templates
  summaries: [                           // Template-based summaries
    { templateId: "client-meeting", templateName: "Client Meeting", content: "..." },
    { templateId: "action-items", templateName: "Action Items", content: "..." }
  ],
  transcript: [...],
  obsidianLink: "clients/acme-corp/meetings/2025-11-08-strategy-call.md"  // Path in vault
}
```

**Workflow States:**
1. **Not Published** - `obsidianLink` is null/undefined, UI shows "Publish to Obsidian" button
2. **Published** - `obsidianLink` exists, UI shows Obsidian icon/badge + "Republish" button
3. **Manual Override** - User edits `obsidianLink` directly, bypasses routing on next export

**Summary File Generation Logic:**
- If `meeting.summaries` exists and has items → Concatenate all templates with section headers:
  ```markdown
  ## Client Meeting Summary
  [template content]

  ## Action Items Summary
  [template content]
  ```
- If `meeting.summaries` is empty/missing → Use `meeting.content` (basic auto-summary)

**Export Triggers:**
1. **Manual**: User clicks "Publish to Obsidian" button (IPC: `obsidian:exportMeeting`)
2. **Automatic**: After template generation completes successfully
3. **Republish**: User clicks "Republish to Obsidian" with confirmation dialog

**Routing Logic:**
- If `meeting.obsidianLink` exists (manual override) → Use that path, skip routing
- If `meeting.obsidianLink` is null → Run routing engine based on `participantEmails`
- After successful export → Save vault path to `meeting.obsidianLink`

#### User Value
Automatic, organized meeting notes in Obsidian vault, optimized for both human review and LLM retrieval. No manual file management required.

---

### Phase 6: Speaker Recognition & Contact Matching ✅ COMPLETE
**Goal:** Identify who said what

#### Deliverables
1. ✅ Speaker diarization in transcription (AssemblyAI)
2. ✅ Google Contacts integration
3. ✅ Participant email → contact matching
4. ✅ Speaker voice → participant matching (heuristic-based)
5. ✅ Speaker labels in transcript
6. ✅ Unified Google authentication (Calendar + Contacts)
7. ⏳ Manual speaker ID correction UI (IPC handler ready, UI deferred)

#### Success Criteria
- ✅ Transcript shows speaker names (not just "Speaker 1")
- ✅ Participant emails matched to Google Contacts
- ✅ Speaker identification with heuristic algorithms
- ✅ User can correct misidentifications (backend ready)
- ✅ Single authentication flow for Calendar + Contacts

#### Implementation Details
- **Unified Authentication**: `GoogleAuth.js` - Single OAuth 2.0 flow for Calendar + Contacts
  - Combined scopes: `calendar.readonly` + `contacts.readonly`
  - Single token file (`google-token.json`) with automatic refresh
  - Platform-specific token file permissions (chmod 0o600 on Unix, icacls on Windows)
- **Google Contacts**: `GoogleContacts.js` (223 lines)
  - Contact caching with 24-hour expiry
  - Batch email lookups with `findContactsByEmails()`
  - Contact count tracking (unique contacts vs email addresses)
- **Speaker Matching**: `SpeakerMatcher.js`
  - Heuristic-based matching algorithms:
    1. Count-based (1:1 mapping when speakers = participants)
    2. First speaker heuristic (often organizer)
    3. Most talkative heuristic (likely host)
    4. Sequential fallback mapping
  - Confidence scoring (high/medium/low/none)
- **Security Fixes** (November 7, 2025):
  - ✅ Fixed race condition in service initialization (centralized `initializeGoogleServices()`)
  - ✅ Secured token file permissions (0o600 Unix, icacls Windows)
  - ✅ Implemented token refresh failure recovery (clears state, re-authentication flow)
  - ✅ Fixed auth window memory leak (proper cleanup with timeout)
  - ⏳ Contact cache validation (deferred - low risk from trusted API)
- **IPC Handlers**: Consolidated from 10 → 6 unified `google:*` handlers
- **UI**: Single Google button with official logo, contact count display

#### User Value
Clear attribution of statements to specific people with minimal manual effort.

---

### Pre-Phase 7: Critical Bug Fixes

**Status:** Required before Phase 7 development

**Critical Issues Identified (Code Review - Nov 8, 2025):**

**1. Fix RoutingEngine Method Signature Bug**
- **Issue**: `main.js` line 948 calls `routingEngine.routeMeeting(participantEmails, title)` but `RoutingEngine.js` defines `route(meetingData)` expecting an object
- **Impact**: Runtime error when routing meetings
- **Fix**: Change call to `routingEngine.route({ participantEmails, meetingTitle, meetingDate })`
- **Priority**: Critical - blocks meeting routing

**2. Improve Service Initialization Robustness**
- **Issue**: Race condition partially fixed in Phase 6, but still possible for `startMeetingMonitor()` to run before services ready
- **Current State**: Services initialized asynchronously in `app.whenReady()`
- **Fix**: Ensure strict sequential initialization: `initializeServices() → startMeetingMonitor() → createWindow()`
- **Priority**: High - causes crashes during development

**3. Add Token Refresh User Notification**
- **Issue**: Token refresh failures throw errors but UI doesn't notify user to re-authenticate
- **Current State**: Error logged, app continues with broken authentication
- **Fix**: Add IPC event `auth:expired` to notify renderer, show "Sign in again" prompt
- **Priority**: High - affects daily development use

**4. Fix File Operation Read/Write Race**
- **Issue**: `fileOperationManager.readMeetingsData()` doesn't wait for pending writes
- **Current State**: Cache check doesn't account for in-progress writes
- **Fix**: Add `readWaiters` array, queue reads when writes are in progress
- **Priority**: Medium - could cause data inconsistency

**5. Implement LRU Cache for Contacts**
- **Issue**: Contact cache in `GoogleContacts.js` grows unbounded (could reach 10,000+ entries)
- **Current State**: Simple Map with 24-hour expiry, no eviction
- **Fix**: Use `lru-cache` with max 5,000 entries and 24-hour TTL
- **Priority**: Medium - memory usage concern

**Success Criteria:**
- All meetings route correctly without errors
- Services initialize reliably on every app start
- User notified when Google authentication expires
- No data corruption during concurrent file operations
- Contact cache memory usage remains reasonable (<50MB)

**Estimated Effort:** 4-6 hours

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

#### Security Hardening Items (Phase 10)

**11. XSS Vulnerability Mitigation**
- **Issue**: `renderer.js` uses `innerHTML` with user-controlled data (meeting titles, summaries, template names)
- **Risk**: Malicious content could execute scripts, potentially stealing OAuth tokens
- **Files**: `src/renderer.js` lines 240-250, 354-367, 1065-1068
- **Fix**: Install and use DOMPurify library:
  ```javascript
  import DOMPurify from 'dompurify';
  card.innerHTML = DOMPurify.sanitize(htmlContent, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'p', 'ul', 'li', 'strong', 'em', 'code'],
    ALLOWED_ATTR: []
  });
  ```
- **Also**: Replace custom `markdownToHtml()` function with `marked` + DOMPurify
- **Priority**: Critical for production use
- **Estimated effort**: 2-3 hours

**12. Path Traversal Validation**
- **Issue**: `VaultStructure.js` doesn't validate paths stay within vault directory
- **Risk**: Malicious paths like `../../../sensitive.txt` could write outside vault
- **File**: `src/main/storage/VaultStructure.js` line 263-277
- **Fix**: Add validation in `saveFile()`:
  ```javascript
  const normalizedVault = path.normalize(this.vaultBasePath);
  const normalizedTarget = path.normalize(absolutePath);
  if (!normalizedTarget.startsWith(normalizedVault + path.sep)) {
    throw new Error('Path traversal detected');
  }
  ```
- **Priority**: High - prevents data corruption/leakage
- **Estimated effort**: 1 hour

**13. IPC Handler Input Validation**
- **Issue**: All IPC handlers accept data without validation
- **Risk**: Malformed data from renderer could crash main process
- **Files**: `src/main.js` lines 1419-1713 (all handlers)
- **Fix**: Add Zod schema validation:
  ```javascript
  const SpeakersMatchSchema = z.object({
    transcript: z.array(z.object({ speaker: z.string(), text: z.string() })),
    participantEmails: z.array(z.string().email())
  });
  ipcMain.handle('speakers:matchSpeakers', async (event, data) => {
    const validated = SpeakersMatchSchema.parse(data);
    // ... use validated data
  });
  ```
- **Priority**: High - improves reliability
- **Estimated effort**: 4-6 hours (all handlers)

**14. OAuth CSRF Protection**
- **Issue**: OAuth callback doesn't validate state parameter
- **Risk**: CSRF attack could trick user into authorizing attacker's Google account
- **File**: `src/main.js` lines 1371-1398
- **Fix**: Add state parameter generation and validation:
  ```javascript
  // In GoogleAuth.js
  getAuthUrl() {
    const state = crypto.randomBytes(32).toString('hex');
    this.pendingState = state;
    return this.oauth2Client.generateAuthUrl({ ..., state });
  }
  // In callback handler
  if (state !== googleAuth.pendingState) {
    throw new Error('Invalid state - possible CSRF');
  }
  ```
- **Priority**: Medium - standard OAuth security practice
- **Estimated effort**: 1-2 hours

**15. Memory Leak Prevention**
- **Issue**: Event listeners not properly cleaned up, especially auth window handlers
- **Files**: `src/main.js` lines 1329-1412 (auth window), IPC listeners throughout
- **Fix**: Implement cleanup handlers:
  - Auth window: Store handler references, call `.off()` in cleanup function
  - IPC listeners: Track all registered handlers, clean up on `app.quit`
  - Add timeout to auth window (5 minute max)
- **Test**: Run app for extended periods, monitor memory usage
- **Priority**: Medium - affects long-running sessions
- **Estimated effort**: 3-4 hours

**16. API Key Migration to Credential Manager**
- **Issue**: API keys stored in plain text `.env` file
- **Specification Requirement**: Use Windows Credential Manager for sensitive keys
- **Current**: `process.env.OPENAI_API_KEY` read from `.env`
- **Fix**: Use `keytar` or `windows-credential-manager` npm package:
  ```javascript
  const keytar = require('keytar');
  const apiKey = await keytar.getPassword('JD-Notes-Things', 'OpenAI');
  ```
- **UI**: Add settings panel for users to input/update API keys securely
- **Priority**: High - aligns with spec, improves security
- **Estimated effort**: 4-5 hours (includes UI)

**17. Token File Permission Validation**
- **Issue**: Windows `icacls` command may fail silently
- **Current**: Error logged but not thrown, token file created anyway
- **File**: `src/main/integrations/GoogleAuth.js` lines 95-127
- **Fix**: Validate permissions were actually set, delete token file if failed:
  ```javascript
  try {
    await execAsync(`icacls "${this.tokenPath}" ...`);
    // Verify permissions were set
  } catch (err) {
    await fs.unlink(this.tokenPath).catch(() => {});
    throw new Error('Failed to secure token file');
  }
  ```
- **Priority**: High - prevents token theft
- **Estimated effort**: 1-2 hours

**18. Comprehensive Security Audit**
- Penetration test OAuth flow with various attack vectors
- Test XSS payloads in all user input fields
- Verify file permissions across Windows 10/11 versions
- Test path traversal attempts in vault operations
- Validate IPC handlers with malformed/malicious data
- Review all API key and token handling paths
- **Priority**: Before production release
- **Estimated effort**: 8-10 hours

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
11. **LLM Model Configuration** - Separate model selection for auto-summary vs template-based summaries
12. **Auto-Summary Template** - Editable template file for automatic post-recording summary (instead of hardcoded prompt)

#### Success Criteria
- All settings accessible and functional
- In-app routing config editor works
- User can customize behavior without editing files
- Keyboard shortcuts work consistently
- System tray provides quick access
- User can select different LLM models for auto vs template summaries
- Auto-summary prompt editable via template file

#### User Value
Fully customizable to personal workflow preferences.

#### Code Quality Improvements (Phase 11)

**19. Global State Management Refactoring**
- **Issue**: `main.js` uses module-level variables for state (40+ globals)
- **Current**: `let detectedMeeting, googleAuth, googleCalendar, templateManager...`
- **Fix**: Create `AppState` class to encapsulate state:
  ```javascript
  class AppState {
    constructor() {
      this.detectedMeeting = null;
      this.services = {};
    }
    async initialize() { /* centralized init */ }
  }
  ```
- **Benefits**: Easier testing, clearer state ownership, better encapsulation
- **Priority**: Medium - improves maintainability
- **Estimated effort**: 6-8 hours

**20. Configuration Centralization**
- **Issue**: Hardcoded values scattered throughout codebase
- **Examples**:
  - `60000` (meeting check interval)
  - `200` (tokens per section)
  - `0.150` (LLM pricing)
- **Fix**: Create `config/constants.js` with named constants:
  ```javascript
  module.exports = {
    INTERVALS: { MEETING_CHECK_MS: 60 * 1000 },
    LLM_PRICING: { 'gpt-4o-mini': { input: 0.150 / 1_000_000 } }
  };
  ```
- **Priority**: Medium - improves maintainability
- **Estimated effort**: 3-4 hours

**21. Routing Configuration Validation**
- **Issue**: `ConfigLoader.js` validates structure but not data validity
- **Fix**: Use Zod schemas to validate:
  - Email formats (`z.string().email()`)
  - Domain formats (`z.string().regex(/^[a-z0-9.-]+$/i)`)
  - Valid vault paths
  - No duplicate entries
- **Priority**: Medium - prevents configuration errors
- **Estimated effort**: 2-3 hours

**22. Code Duplication Cleanup**
- Refactor repeated patterns identified during development:
  - Video file checking logic
  - Upload token creation
  - Error handling patterns
- Extract common code into utility functions/modules
- Approach: Refactor opportunistically when touching duplicated code
- **Priority**: Low - fix when convenient
- **Estimated effort**: 4-6 hours total, done opportunistically

**23. Async File Operations Migration**
- **Issue**: `VaultStructure.js` and `ConfigLoader.js` use sync operations
- **Current**: `fs.writeFileSync()`, `fs.readFileSync()` block event loop
- **Fix**: Migrate to async versions: `fs.promises.writeFile()`, etc.
- **Impact**: Large files won't freeze UI
- **Priority**: Low - mostly small files in this app
- **Estimated effort**: 2-3 hours

**24. Environment Configuration**
- Implement dev/staging/production environment separation
- Create environment-specific configuration files
- Support for different API endpoints per environment
- Enable easier testing with different configurations
- **Priority**: Implement when deployment/distribution needs arise
- **Estimated effort**: 3-4 hours

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
**Last Updated:** November 7, 2025
**Author:** Claude Code
**Approved By:** J.D. Bruce
