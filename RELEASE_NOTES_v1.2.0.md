# JD Notes Things v1.2 Release Notes

**Release Date:** December 2025

This release introduces a floating recording widget, Stream Deck hardware integration, Azure OpenAI deployment management, speaker statistics, and new AI-powered templates for specialized meeting analysis.

---

## Highlights

- **Recording Widget** - Compact floating window for quick recording control without switching to the main app
- **Stream Deck Plugin** - Control recording from your Elgato Stream Deck hardware
- **Azure OpenAI Management** - Add and manage custom Azure OpenAI deployments with pricing tiers
- **Speaker Statistics** - Visual talk time percentages and distribution bars for each participant
- **New Templates** - Five new specialized templates for content mining, firm profiling, and sentiment analysis

---

## New Features

### Recording Widget

#### Floating Recording Control

A new compact, always-on-top widget provides quick access to recording controls:

- **Timer Display:** Shows elapsed recording time (MM:SS or HH:MM:SS)
- **Status Indicator:** Visual dot showing recording state (red=recording, green=ready)
- **Quick Controls:** Start/stop recording with a single click
- **Pin Toggle:** Keep widget always-on-top or allow it to go behind other windows
- **Meeting Info:** Hover tooltip shows current meeting details

#### Context-Aware Recording

When starting a recording, the widget intelligently detects your context:

- **Existing Recording:** Offers options to append, overwrite, or create new
- **Upcoming Meeting:** Shows upcoming calendar meetings to associate with
- **New Meeting:** Creates a fresh meeting note automatically
- **Platform Detection:** Shows appropriate icons for Zoom, Teams, Meet, etc.

#### Auto-Show Behavior

The widget automatically appears when:

- A recording is in progress (stays visible during recording)
- Starting from the main app (widget mirrors recording state)
- Resuming after app restart (restores widget position)

### Stream Deck Integration

#### Hardware Recording Control

Control JD Notes directly from your Elgato Stream Deck:

- **Toggle Recording Action:** Single button to start/stop recording
- **Status Display Action:** Shows current state and elapsed time
- **Auto-Reconnect:** Maintains connection when JD Notes restarts

#### Setup

1. Enable Stream Deck integration in Settings
2. Install the plugin from `streamdeck-plugin/` folder
3. Add actions to your Stream Deck profile

#### WebSocket Protocol

The integration uses a WebSocket server on `ws://localhost:13373/streamdeck`:

```json
{ "action": "startRecording" }
{ "action": "stopRecording" }
{ "action": "getStatus" }
```

### Azure OpenAI Deployment Management

#### Custom Deployment Configuration

Manage your Azure OpenAI deployments directly in the app:

- **Add Deployments:** Configure deployment name, display name, and pricing
- **Pricing Tiers:** Categorize as Budget, Balanced, Premium, or Ultra-Premium
- **Cost Tracking:** Set input/output prices per million tokens
- **Model Selector:** Custom deployments appear in all model dropdowns

#### Deployment Settings

Each deployment includes:

| Field | Description |
|-------|-------------|
| Deployment Name | Exact name from Azure portal |
| Display Name | How it appears in the UI |
| Pricing Tier | For grouping in model selector |
| Input Price | Cost per million input tokens |
| Output Price | Cost per million output tokens |

### Speaker Statistics

#### Talk Time Analysis

Meeting participants now show speaking statistics:

- **Percentage Badge:** Shows what portion of the meeting each person spoke
- **Visual Bar:** Mini progress bar indicating relative talk time
- **Real-Time Calculation:** Computed from transcript timestamps

#### Participant List Enhancements

- Talk time displayed next to each participant name
- Company/organization info shown when available
- Linked contact indicator (checkmark) for matched contacts
- Click participant to view in Contacts

### New AI Templates

Five new specialized templates for deeper meeting analysis:

#### Content Mining (`content-mining.txt`)

Extracts reusable content from meetings:

- Key quotes and soundbites
- Story-worthy anecdotes
- Data points and statistics
- Potential case study material

#### Firm Profile Signals (`firm-profile-signals.yaml`)

Captures business intelligence signals:

- Organizational structure hints
- Technology stack mentions
- Pain points and challenges
- Budget and timeline indicators
- Decision-maker identification

#### Personal Finance Record (`personal-finance-record.yaml`)

For financial planning meetings:

- Goals and objectives discussed
- Account and asset references
- Risk tolerance indicators
- Action items and follow-ups
- Compliance-relevant statements

#### Quotes and Insights (`quotes-and-insights.txt`)

Extracts memorable moments:

- Direct quotes worth saving
- Surprising insights or revelations
- Commitments made
- Questions raised

#### Sentiment and Dynamics (`sentiment-and-dynamics.txt`)

Analyzes meeting tone and relationships:

- Overall sentiment assessment
- Participation balance
- Agreement/disagreement patterns
- Energy level changes
- Relationship dynamics

### AI Model Updates

#### New Models Available

Updated model options with latest releases:

**OpenAI:**
- GPT-5 nano ($0.05/$0.40 per MTok)
- GPT-4.1 nano ($0.10/$0.40 per MTok)
- GPT-4o mini ($0.15/$0.60 per MTok)
- GPT-5 mini ($0.25/$2.00 per MTok)
- GPT-4.1 mini ($0.40/$1.60 per MTok)

**Anthropic Claude:**
- Claude Haiku 4.5 ($1.00/$5.00 per MTok)
- Claude Sonnet 4 ($3.00/$15.00 per MTok)
- Claude Sonnet 4.5 ($3.00/$15.00 per MTok)

#### Default Provider Change

Default AI provider changed from Azure to OpenAI for broader compatibility.

---

## Improvements

### Speaker Mapping Enhancements

- Improved participant suggestion algorithm
- Better handling of generic speaker names (filters "Summary", "Introduction", etc.)
- Enhanced duplicate detection with similarity scoring
- Streamlined merge workflow for consolidating speakers

### Meeting Detail View

- Date grouping in meeting lists for better organization
- Participant company info displayed when available
- Improved transcript rendering performance
- Better handling of long meeting titles

### UI Refinements

- Consolidated modal styles for consistency
- Improved button designs across the app
- Better notification handling with toast messages
- Enhanced dropdown components

### Code Quality

- Removed unused IPC schemas and validation code
- Consolidated notification handling across components
- Added shared constants for configuration
- Improved speaker validation logic

---

## Bug Fixes

### Contact Selection

**Fixed:** Contact email selection now properly validates that the email is a valid string before attempting to use it.

### Widget State Sync

**Fixed:** Recording widget properly syncs state with main app when:
- App is restarted during recording
- Recording is started/stopped from main window
- Widget is closed and reopened

### Transcription Service

**Fixed:** Removed unused imports (`form-data`, `path`) that were reserved for future features but caused linter warnings.

---

## Configuration Changes

### Template Updates

Removed outdated templates:
- `board-meeting.txt`
- `client-meeting.yaml`
- `decisions-and-actions.txt`
- `internal-meeting.yaml`
- `one-on-one.md`
- `quick-notes.json`
- `things-they-said.txt`

These have been replaced with more specialized templates listed above.

### Documentation Cleanup

Removed outdated research documents from `docs11/`:
- Speaker diarization research
- Speaker matching algorithm docs
- Vocabulary best practices
- CRM structure design
- Obsidian link management

Findings have been consolidated into the implementation.

---

## Upgrade Notes

- Existing data and settings are preserved when upgrading from v1.1
- Custom templates are not affected by bundled template changes
- Azure deployments will need to be re-added if previously configured manually
- Stream Deck plugin requires separate installation (see `streamdeck-plugin/README.md`)

---

## Requirements

- Windows 10/11 (64-bit)
- Node.js 20+ (for development)
- Elgato Stream Deck software v6.0+ (optional, for Stream Deck integration)
