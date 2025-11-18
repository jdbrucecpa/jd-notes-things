# JD Notes Things - Product Specification

**Project Name:** JD Notes Things
**Organization:** JD Knows Things
**Purpose:** Personal AI Meeting Notetaker for Zoom, Microsoft Teams, Google Meet, and Manual Recording
**Version:** 1.0
**Last Updated:** January 14, 2025

---

## Development Status

**Current Baseline:** Muesli (Recall.ai reference implementation)
**Phase:** Phase 10 - Advanced UI & Settings
**Status:** Phase 10.8.2 COMPLETE (Pattern Testing Component) - Phase 10.8.3 removed - Remaining: 10.9 (Code Quality - optional cleanup tasks)

**Development Philosophy:** Unless otherwise instructed, progress through phases in sequential order. We follow our initial plan to maintain consistency and ensure dependencies are properly met.

**Completed Phases:**

- ✅ Phase 1: Core Recording & Transcription (Recall.ai SDK + Async Webhook Transcription)
- ✅ Phase 2: Routing System
- ✅ Phase 3: Calendar Integration & Auto-Recording
- ✅ Phase 4: LLM Integration & Summaries (Template System + Modular Provider Architecture + Prompt Caching)
- ✅ Phase 5: Obsidian Export & File Generation (auto-export, publish buttons, link tracking)
- ✅ Phase 6: Speaker Recognition & Contact Matching
- ✅ Phase 7: Platform-Specific Recording (Zoom/Teams/Meet detection)
- ✅ Pre-Phase 7 Bug Fixes: All 5 critical bugs resolved
- ✅ Phase 8: Import Prior Transcripts (bulk import, folder scanning, template selection)
- ✅ Phase 9: Security & Encryption (Core hardening + Comprehensive security audit)
  - ✅ XSS vulnerability mitigation with DOMPurify (6 attack vectors fixed)
  - ✅ Path traversal protection in VaultStructure
  - ✅ OAuth CSRF protection with state parameter validation
  - ✅ IPC input validation infrastructure (Zod schemas)
  - ✅ Token file permission validation (Windows icacls)
  - ✅ Memory leak prevention (auth window event listener cleanup)
  - ✅ Comprehensive security audit (15/15 tests passing, 0 critical vulnerabilities)
- 🔧 Phase 10: Advanced UI & Settings (IN PROGRESS)
  - ✅ Phase 10.1: Settings Infrastructure & Theme Foundation
  - ✅ Phase 10.2: Security & Credentials (API Key Management with Windows Credential Manager)
  - ✅ Phase 10.3: Template Editor & LLM Configuration (Monaco Editor, full-page settings, .txt template support)
  - ✅ Phase 10.4: Routing Configuration Editor (Visual YAML editor, validation, backup, routing test tool)
  - ✅ Phase 10.5: Meeting Detail View Redesign + Speaker Correction (COMPLETE)
    - ✅ Modern meeting detail view with tabbed interface (Summary, Transcript, Templates, Metadata)
    - ✅ ContactsService shared component with search and caching
    - ✅ Contact search IPC handlers with Google Contacts integration
    - ✅ Speaker correction UI with inline editing and contact search
    - ✅ Improved record button styling (gradient backgrounds, icons)
    - ✅ Removed unused user avatar icon from nav bar
  - ✅ Phase 10.6: Search & Participant Management (COMPLETE)
    - ✅ Meeting search functionality (search by title, participant, date)
      - Debounced search input (300ms) for performance
      - Real-time filtering of meetings list
      - Search by title, participant names/emails, and date ranges
      - Empty state with "Clear Search" button
      - Search results counter
    - ✅ Advanced participant management in metadata tab
      - ✅ Contact search modal with Google Contacts integration
      - ✅ Search contacts by name or email with live results
      - ✅ Add contacts as participants with search dropdown
      - ✅ Remove participants
      - ✅ Auto-add participants when speaker is assigned via speaker correction
      - ✅ Auto-replace duplicate participants (match by email)
      - ✅ Toast notifications for user actions
    - ✅ Bulk operations (multi-select meetings, batch export)
      - ✅ Multi-select UI with checkboxes on meeting cards
      - ✅ "Select" button in Notes section header to toggle selection mode
      - ✅ Bulk actions toolbar with selection count
      - ✅ Select All / Deselect All buttons
      - ✅ Click anywhere on card to select (when in selection mode)
      - ✅ Export to Obsidian batch operation
      - ✅ Meeting cards cannot be opened in selection mode
      - ✅ Programmatic checkbox creation to bypass DOMPurify sanitization
    - ✅ Phase 10.6 Bug Fixing (COMPLETE)
      - Bug #1: Auto-summary template appearing in template selection modal (fixed: renderer.js:3132)
      - Bug #2: Bulk delete functionality (implemented with disabled individual delete buttons)
      - Bug #3: Multi-select export IPC function name mismatch (fixed: renderer.js:175)
      - Bug #4: Multi-select button placement and aesthetics redesign (new outlined style)
      - Bug #5: Summary generation null innerHTML errors (replaced displaySummaries() with updateMeetingDetail())
      - Bug #6: Multi-select toolbar sticky positioning (fixed: index.css:374-376)
      - Bug #7: LLM provider not respected during regenerate (fixed: main.js:3438-3568)
      - Bug #8: Handlebars template syntax in output (fixed: main.js:5338-5353)
      - Bug #9: Crash when navigating away during regeneration (added null checks and early exits)
      - Bug #10: Button text showing "Select" instead of "Multi-Select" (fixed dynamic HTML generation)
      - Bug #11: Generic meeting title not replaced during regenerate (fixed: main.js:5475-5491, 5512-5528)
      - Bug #12: Meeting title not updating immediately in UI (fixed: renderer.js:2229, 2361, 3306)
  - ✅ Phase 10.7: Desktop App Polish (COMPLETE)
    - ✅ System tray menu with quick actions (Open, Quick Record, Stop, Open Vault, Settings, Logs, Quit)
    - ✅ Global keyboard shortcuts (CommandOrControl+Shift+R for toggle, CommandOrControl+Shift+Q for quick record)
    - ✅ Recording quality settings (audio format, sample rate, bitrate)
    - ✅ Notification preferences (toast notifications, sounds, minimize to tray)
    - ✅ Multi-monitor support with window bounds persistence
    - ✅ Logs and diagnostics viewer with filtering and live updates
  - ✅ Phase 10.8: Transcript Pattern Learning System (COMPLETE - 2 sub-phases)
    - ✅ Phase 10.8.1: Pattern Configuration System (file-based YAML config with regex patterns)
    - ✅ Phase 10.8.2: Unified Pattern Testing Component (dual-mode preview + editor with Monaco)
    - ❌ Phase 10.8.3: LLM Pattern Builder (REMOVED - deemed unnecessary)

**Recent Architectural Changes (Nov 10-12, 2025):**

- ✅ Migrated from AssemblyAI real-time streaming to Recall.ai async transcription (Nov 10)
- ✅ Implemented webhook-based workflow with ngrok tunnel automation (Nov 10)
- ✅ Removed polling dependencies, now 100% webhook-driven (Nov 10)
- ✅ Added Svix signature verification for webhook security (Nov 10)
- ✅ Implemented upload progress tracking with UI progress bar (Nov 10)
- ✅ Discovered Recall.ai SDK upload broken, implemented multi-provider transcription (Nov 12)
- ✅ **Implemented prompt caching across all LLM providers** (Nov 12)
  - 85-90% cost reduction on template generation
  - Azure OpenAI, OpenAI, and Anthropic Claude all support caching
  - Token budgets optimized: 50,000 for auto-summary, 15,000 for template sections
  - Cache verification logging with performance metrics
  - Total cost per meeting: ~$0.70 (well under $1 budget target)

**Recent Updates (November 8-13, 2025):**

- ✅ **Phase 9 Security Hardening** - Resolved all critical vulnerabilities (Nov 13)
  - XSS protection, path traversal prevention, CSRF protection, input validation
  - Detailed security report: `docs/phase9-security-report.md`
- ✅ Implemented modular LLM service architecture with adapter pattern (Nov 8)
- ✅ Added support for OpenAI, Anthropic Claude, and Azure OpenAI providers (Nov 8)
- ✅ Built UI dropdown for runtime provider switching (no restart required) (Nov 8)
- ✅ Configured Azure OpenAI with gpt-5-mini reasoning model (cheapest option) (Nov 8)
- ✅ Fixed generic title detection to catch numbered variants (Transcript2, Meeting1, etc.) (Nov 12)
- ✅ Enhanced MetadataExtractor with fallback speaker detection from transcript content (Nov 12)
- ✅ Fixed provider-specific parameter handling (max_completion_tokens, temperature constraints) (Nov 8)
- ✅ Achieved 10x speedup with parallel API calls (~6s for 20 template sections) (Nov 8)
- ✅ **Prompt caching implementation with 85-90% cost savings** (Nov 12)
- ✅ **Import transcripts feature with background processing** (Nov 12)

**Post-Phase 9 Refinements (Jan 13, 2025):**

- ✅ **Code refactoring** - Eliminated ~70 lines of duplicate auto-summary code
  - Created shared `generateAndSaveAutoSummary()` function (main.js:4541-4620)
  - DRY principle: Single source of truth for auto-summary workflow
  - Improves maintainability: Bug fixes only need to be applied once
- ✅ **Bug fix** - Recording icon not clearing after meetings ended
  - Fixed function name error: `updateRecordingButtonState` → `updateRecordingButtonUI`
  - File: src/renderer.js:2019
- ✅ **Bug fix** - Meeting title not updating in UI (auto-save race condition)
  - Root cause: Auto-save reading stale DOM state and overwriting file updates
  - Solution: Update DOM title in `onSummaryGenerated` event handler
  - File: src/renderer.js:1972-1991
  - Technical detail: Three-way state synchronization (DOM ↔ memory ↔ file)
- ✅ **UX improvement** - Immediate recording button feedback
  - Recording cleanup now happens instantly when meeting ends
  - Transcription and summary continue in background (no user delay)
  - File: src/main.js:948-986
  - Impact: 45-second delay eliminated from user experience

**Phase 10.1: Settings Management (Jan 13, 2025):**

- ✅ Settings module implementation with IPC handlers
  - `settings:getAppVersion` - Returns application version from package.json
  - `settings:getVaultPath` - Returns configured Obsidian vault path
  - File: src/preload.js:92-94

**Phase 10.3: Template Editor & LLM Configuration (Jan 14, 2025):**

- ✅ Full-page settings UI (converted from modal for better UX)
- ✅ Monaco Editor integration with syntax highlighting (YAML, JSON, Markdown, plaintext)
- ✅ Template editor with three-column layout and live preview
- ✅ Plain text template support (.txt files)
- ✅ Auto-summary template file (config/templates/auto-summary-prompt.txt)

**Phase 10.4: Routing Configuration Editor (Jan 14, 2025):**

- ✅ Visual YAML editor for routing.yaml using Monaco Editor
- ✅ Organization list sidebar with grouped display (Clients, Industry, Internal)
- ✅ YAML validation with error reporting
- ✅ Automatic backup before saving (routing.backup.yaml)
- ✅ Routing test tool - Preview where meetings would be saved based on participant emails
- ✅ **Add Organization** - Modal dialog with form validation, supports Clients and Industry types
- ✅ **Delete Organization** - Confirmation modal with safety checks (prevents deleting Internal)
- ✅ **Refresh Button** - Reload configuration from disk without leaving tab
- ✅ **Undo Button** - Restore from backup with confirmation modal
- ✅ IPC handlers for routing operations (7 total):
  - `routing:getConfig` - Load routing configuration and parse YAML
  - `routing:saveConfig` - Save with validation and backup
  - `routing:validateConfig` - Validate configuration structure
  - `routing:testEmails` - Test routing logic with mock emails
  - `routing:addOrganization` - Add new client or industry organization
  - `routing:deleteOrganization` - Delete organization with safety checks
  - `routing:restoreBackup` - Restore from backup file
- ✅ Integration with existing RoutingEngine for live testing
- ✅ Bug fixes:
  - Fixed routing config path to match RoutingEngine (dev vs production)
  - Fixed type mapping (clients plural vs client singular)
  - Prevent deleting empty sections (keeps structure for RoutingEngine)
- Files: src/renderer/routing.js (700+ lines), src/index.html (routing panel + modals), src/index.css (routing + modal styles, 450+ lines), src/main.js:2528-2865 (330+ lines), src/preload.js (7 routing APIs)
- ✅ Template content IPC handler (templates:getContent)
- ✅ Webpack native module fix for keytar bundling

**Phase 10.5: Meeting Detail View Redesign + Speaker Correction (Jan 14, 2025):**

- ✅ **Modern Meeting Detail View** - Complete redesign of meeting page
  - Card-based layout with clean, professional styling
  - Tabbed interface: Summary, Transcript, Templates, Metadata
  - Meeting info card with date/time/duration, participants, sync status
  - Participants card with avatars and initials
  - Action buttons for export and regenerate
- ✅ **ContactsService** - Shared component for Google Contacts integration
  - Search with client-side caching (5-minute TTL)
  - Debounced search (300ms) to prevent excessive API calls
  - Contact formatting with initials generation
  - Singleton pattern for app-wide use
  - File: src/renderer/services/contactsService.js (170 lines)
- ✅ **Contact Search IPC Handlers**
  - `contacts:searchContacts` - Search contacts by name or email (returns up to 50 results)
  - Integration with GoogleContacts LRU cache for performance
  - File: src/main.js:2285-2318
  - Preload API: src/preload.js:89
- ✅ **Speaker Correction UI** - Inline editing with contact search
  - Clickable speaker names with edit icon on hover
  - Inline dropdown editor with search input
  - Live contact search from Google Contacts
  - Contact results with avatars, names, and emails
  - Save/Cancel buttons with keyboard shortcuts (Enter/Escape)
  - Click outside to close
  - Immediate save to meeting data
  - File: src/renderer/meetingDetail.js (speaker editor functions)
  - Styling: src/index.css:4199-4387 (190+ lines)
- ✅ **UI Polish**
  - Improved record button styling with gradients and icons
  - "Record In-Person Meeting" - Dark gradient with microphone icon
  - "Record Zoom Meeting" - Slate blue gradient with video camera icon
  - Hover effects with lift animation
  - Better disabled states
- Files: src/renderer/meetingDetail.js (1060+ lines), src/index.css (4387+ lines), src/index.html (meeting detail structure), src/renderer.js (integration), src/preload.js (contact search API)

**Phase 10.6: Search & Participant Management + Bulk Operations (Jan 14, 2025):**

- ✅ **Meeting Search Functionality** - Real-time search across meetings
  - Debounced search input (300ms) for performance optimization
  - Search by title, participant names/emails, and date ranges
  - Real-time filtering of meetings list
  - Empty state with "Clear Search" button
  - Search results counter showing filtered count
  - File: src/renderer.js (search functions ~100 lines)
- ✅ **Advanced Participant Management** - Metadata tab enhancements
  - Contact search modal with Google Contacts integration
  - Search contacts by name or email with live results
  - Add contacts as participants using search dropdown
  - Remove participants with confirmation
  - Auto-add participants when speaker is assigned via speaker correction
  - Auto-replace duplicate participants (match by email)
  - Toast notifications for user feedback
  - File: src/renderer/meetingDetail.js (participant management functions)
- ✅ **Bulk Operations** - Multi-select meetings with batch actions
  - Multi-select UI with checkboxes on meeting cards
  - "Select" button in Notes section header to toggle selection mode
  - Bulk actions toolbar showing selection count
  - Select All / Deselect All buttons
  - Click anywhere on meeting card to select (when in selection mode)
  - Export to Obsidian batch operation
  - Meeting cards cannot be opened while in selection mode
  - Programmatic checkbox creation to bypass DOMPurify sanitization (security + functionality)
  - Files: src/renderer.js (bulk selection state ~200 lines), src/index.html (toolbar), src/index.css (checkbox and toolbar styles)
- ✅ **Critical Bug Fixes** - Data persistence and UI issues resolved
  - Fixed legacy editor interference causing console errors (renderer.js:2620-2650)
  - Fixed async save chain race conditions (meetingDetail.js:1211-1228, renderer.js:966-1004)
  - **CRITICAL**: Fixed data merge bug in main.js where old file data overwrote renderer edits (main.js:1909-1930)
  - Fixed bulk operations UI not rendering section header (renderer.js:1362-1380)
  - Fixed DOMPurify stripping checkboxes by creating elements programmatically (renderer.js:635-658)
  - Fixed meeting opening when clicking card in selection mode (renderer.js:2636-2639)
  - All changes now persist correctly after app restart
- ✅ **Phase 10.6 Bug Fixing Complete** (January 16, 2025)
  - 12 bugs identified and resolved (auto-summary template filtering, bulk operations, IPC fixes, UI updates, title replacement, LLM provider switching)
  - All critical bugs resolved before Phase 10.7
  - Application ready for Phase 10.7 (Desktop App Polish)
- Files: src/renderer.js (2900+ lines), src/renderer/meetingDetail.js (1200+ lines), src/main.js (save merge logic), src/index.html (bulk actions toolbar), src/index.css (bulk operations styles)

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
- **Transcription:** Flexible multi-provider system with runtime switching
  - **Supported Providers:** Recall.ai (async webhook), AssemblyAI, Deepgram
  - **Current Primary:** AssemblyAI or Deepgram (Recall.ai SDK upload broken)
  - **Provider Selection:** UI dropdown with localStorage persistence
  - **Architecture:** Unified `TranscriptionService` with provider-specific adapters
  - **Cost Comparison:** AssemblyAI ($0.37/hr) or Deepgram ($0.43/hr) vs Recall.ai ($0.85/hr)
- **Webhook Infrastructure:** Express server (port 13373) + ngrok tunnel + Svix signature verification
- **LLM Integration:** Modular adapter pattern with runtime provider switching
  - **Supported Providers:** OpenAI (gpt-4o-mini), Anthropic (Claude Haiku 4.5), Azure OpenAI (gpt-5-mini)
  - **Current Provider:** Azure OpenAI with gpt-5-mini reasoning model
  - **Architecture:** Unified interface (`LLMService`) with provider-specific adapters
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
    vault_path: 'clients/client-name'
    emails:
      - 'clientdomain.com'
    contacts:
      - 'person@clientdomain.com'

industry:
  industry-contact-slug:
    vault_path: 'industry/contact-name'
    emails:
      - 'domain.com'

internal:
  vault_path: 'internal/meetings'

email_overrides:
  'personal@gmail.com': 'client-slug'

settings:
  unfiled_path: '_unfiled'
  duplicate_multi_org: 'all' # Options: "all", "primary", "unfiled"
  domain_priority: 'most_attendees' # Options: "most_attendees", "first"
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
title: 'Strategy Call with Acme Corp'
date: 2025-11-07
start_time: '14:00'
end_time: '14:45'
duration: '45 minutes'
platform: 'zoom'
recording_file: '2025-11-07-strategy-call.wav'
transcript_file: '2025-11-07-strategy-call-transcript.md'

participants:
  - name: 'John Doe'
    email: 'john@acme.com'
    organization: 'Acme Corp'
    role: 'CEO'
  - name: 'Jane Smith'
    email: 'jane@acme.com'
    organization: 'Acme Corp'
    role: 'CFO'
  - name: 'J.D. Bruce'
    email: 'jd@jdknowsthings.com'
    organization: 'JD Knows Things'
    role: 'Consultant'

tags: [meeting, client, acme-corp, strategy, partnership, q4-planning]
topics: [partnership-structure, revenue-projections, governance]
meeting_type: 'client'
organization_slug: 'acme-corp'
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

- [ ] **John Doe** - Present partnership proposal to board of advisors - _Due: 2025-11-14_
- [ ] **Jane Smith** - Prepare 3-year financial model with partnership scenarios - _Due: 2025-11-21_
- [ ] **J.D. Bruce** - Draft engagement letter and send by EOW - _Due: 2025-11-10_
- [ ] **J.D. Bruce** - Research legal counsel recommendations - _Due: 2025-11-12_

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

_Generated by JD Notes Things_
```

### Secondary File: Transcript (Example: `2025-11-07-strategy-call-transcript.md`)

```markdown
---
title: 'Strategy Call with Acme Corp - Full Transcript'
date: 2025-11-07
summary_file: '2025-11-07-strategy-call.md'
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

_Generated by JD Notes Things_
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
name: 'Client Meeting Summary'
description: 'Summary for client-facing meetings'
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
name: 'Decisions and Actions'
description: 'Focus on actionable outcomes'
sections:
  - title: 'Key Decisions'
    prompt: 'Extract all decisions made during the meeting'
  - title: 'Action Items'
    prompt: 'List all action items with owner and deadline'
  - title: 'Blockers'
    prompt: 'Identify any blockers or risks mentioned'
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
const decrypted = dpapi.unprotect(encrypted, null, 'CurrentUser');
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
5. ✅ Transcription integration (Recall.ai async API with webhooks)
6. ✅ Save transcripts to file system
7. ✅ Recording widget UI
8. ✅ Meeting detection (Zoom, Teams, Google Meet, Slack)
9. ✅ Webhook server with ngrok tunnel automation
10. ✅ Upload progress tracking with UI progress bar

#### Success Criteria

- ✅ User can start manual recording
- ✅ Audio is captured clearly (microphone confirmed working)
- ✅ Transcript is generated with timestamps
- ✅ Async webhook-based transcription (Recall.ai)
- ✅ Speaker diarization with participant metadata (participantId, isHost)
- ✅ Webhook signature verification for security

#### Implementation Details

- **Built on**: Muesli (Recall.ai reference implementation) - November 6, 2025
- **Recording**: Manual desktop audio with `prepareDesktopAudioRecording()`
- **Auto-detection**: Automatic meeting detection for supported platforms
- **Transcription**: Flexible multi-provider system (November 12, 2025)
  - **Providers**: AssemblyAI, Deepgram, Recall.ai (3 options)
  - **UI Selection**: Dropdown in main UI with real-time switching
  - **Persistence**: localStorage saves user's provider choice
  - **Recall.ai Status**: SDK upload broken (returns null, no progress events), kept as fallback option for when SDK is fixed
  - **Current Workflow**: Recall.ai SDK records locally → Direct upload to AssemblyAI or Deepgram → Transcript with speaker diarization
  - **AssemblyAI**: 3-step process (upload file → request transcription → poll for completion)
  - **Deepgram**: Direct upload with immediate transcription response
  - **Cost Savings**: 49-57% cheaper than Recall.ai full stack ($0.37-$0.43/hr vs $0.85/hr)
  - **Module**: `src/main/services/transcriptionService.js` with unified interface
- **Storage**: Meetings stored in `userData/meetings.json`
- **Files**: Recording files saved to `userData/recordings/`
- **Transcript Format**: Array of participant objects with words arrays, includes participantId and isHost metadata

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

- **Modules**: `src/main/templates/TemplateParser.js`, `src/main/templates/TemplateManager.js`, `src/main/services/llmService.js`
- **Features**: Multi-format support (.md, .yaml, .json), token cost estimation, modal selection UI
- **Storage**: Summaries stored in `meetings.json` under each meeting object
- **UI**: Template selection modal with checkboxes, cost estimates, and collapsible summary cards
- **LLM Service Architecture** (November 8, 2025):
  - Modular adapter pattern supporting multiple providers (OpenAI, Anthropic, Azure OpenAI)
  - Auto-detection of available providers based on environment variables
  - Runtime provider switching via UI dropdown (no restart required)
  - Unified interface for all providers: `generateCompletion()` and `streamCompletion()`
  - Provider-specific parameter handling (e.g., Azure's `max_completion_tokens`, no temperature for gpt-5-mini reasoning model)
- **Prompt Caching Implementation** (November 12, 2025):
  - **Cost Savings**: 85-90% reduction on template generation (from $0.188 to $0.027 per 20 sections)
  - **Architecture**: Separate static content (transcript) from dynamic content (section prompts) using `cacheableContext` parameter
  - **Provider Support**:
    - **Azure OpenAI**: Multi-message structure with automatic caching (minimum 1024 tokens required)
    - **OpenAI**: Same multi-message structure with `prompt_tokens_details.cached_tokens` tracking
    - **Anthropic Claude**: Explicit `cache_control: { type: "ephemeral" }` blocks in system prompt
  - **Cache Verification**: Detailed logging with emoji indicators (🎯 cache hits, ❌ cache misses, 💰 savings)
  - **Performance Metrics**:
    - First call: Creates cache (~$0.009 input cost for 37k tokens)
    - Subsequent calls: 99%+ cache hit rate (~$0.001 input cost each)
    - Cache savings displayed in logs with dollar amounts
- **Token Budgets** (Optimized for ~$1 per meeting):
  - Auto-summary: 50,000 tokens (~$0.10 output cost)
  - Template sections: 15,000 tokens each (~$0.03 per section, $0.60 for 20 sections)
  - Total cost per 2-hour meeting: ~$0.70 including transcription
- **Current Provider**: Azure OpenAI with gpt-5-mini deployment (reasoning model)
- **Performance**: 20 parallel API calls complete in ~6 seconds (10x faster than sequential)

#### User Value

Automatic generation of actionable meeting summaries (decisions, action items, etc.) at minimal cost with prompt caching optimization.

---

### Phase 5: Obsidian Export & File Generation ✅ COMPLETE

**Goal:** Export meeting data to Obsidian vault with two-file structure

#### Deliverables

1. ✅ Connect VaultStructure and RoutingEngine to main.js
2. ✅ Generate summary file with rich metadata frontmatter
3. ✅ Generate transcript file with speaker labels and timestamps
4. ✅ Extract and populate topics/tags in frontmatter
5. ✅ Create bidirectional links between summary and transcript
6. ✅ Handle multi-organization routing (duplicate files when needed)
7. ⏳ Export recording audio file (optional - deferred)
8. ✅ **Automatic export after template generation** (main.js:1905-1916)
9. ✅ **Manual "Publish to Obsidian" / "Republish to Obsidian" button** (renderer.js:2785-2839)
10. ✅ **Obsidian link tracking (meeting → vault folder)** (validation.js:45, main.js:1077-1086)
11. 🟡 **Manual vault link override** (backend complete main.js:976-978, UI missing)
12. ✅ **Multiple template concatenation** (all selected templates in one summary file - main.js:1186-1192)
13. ✅ **UI status indicator** (green badge on meeting cards - renderer.js:350-358)

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
- ✅ Export automatically triggered after template generation
- ✅ UI shows sync status (published, not published, republish available)
- 🟡 User can manually override vault location (backend ready, UI input field missing)
- ✅ Multiple templates concatenated into single summary file with section headers
- ✅ Republish confirmation prevents accidental overwrites

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

#### Known Limitation

**Manual vault link override UI missing**: While the backend correctly handles manual overrides when `obsidianLink` field exists, there's no UI input field to edit this value. Users would need to manually edit the JSON data file to change routing. This is a minor enhancement deferred to Phase 11 (Advanced UI & Settings).

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

### Pre-Phase 7: Critical Bug Fixes ✅ COMPLETE

**Status:** All bugs fixed (verified Nov 10, 2025)

**Issues Identified and Resolved (Code Review - Nov 8, 2025):**

**1. ✅ Fix RoutingEngine Method Signature Bug**

- **Status**: FIXED in main.js:1029, RoutingEngine.js:25
- **Solution**: Correctly calls `routingEngine.route({ participantEmails, meetingTitle, meetingDate })`
- **Verification**: Method signature matches, no runtime errors

**2. ✅ Improve Service Initialization Robustness**

- **Status**: FIXED in main.js:248-363
- **Solution**: Sequential initialization with proper await handling in `app.whenReady()`, `initializeGoogleServices()` awaited before `startMeetingMonitor()`
- **Verification**: Services initialize reliably on every app start

**3. ✅ Add Token Refresh User Notification**

- **Status**: FIXED in GoogleContacts.js:85-94, 245-263
- **Solution**: `auth:expired` IPC event sent to renderer via `_notifyAuthExpired()` method
- **Verification**: User notified when Google authentication expires

**4. ✅ Fix File Operation Read/Write Race**

- **Status**: FIXED in main.js:503-623
- **Solution**: `readWaiters` array implemented, reads queue when writes are in progress
- **Verification**: No data corruption during concurrent file operations

**5. ✅ Implement LRU Cache for Contacts**

- **Status**: FIXED in GoogleContacts.js:9, 23-29
- **Solution**: Using `lru-cache` npm package with max 5,000 entries and 24-hour TTL
- **Verification**: Contact cache memory usage bounded (<50MB)

**Success Criteria Met:**

- ✅ All meetings route correctly without errors
- ✅ Services initialize reliably on every app start
- ✅ User notified when Google authentication expires
- ✅ No data corruption during concurrent file operations
- ✅ Contact cache memory usage remains reasonable (<50MB)

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

### Pre-Phase 8: Complete Deferred Features from Phases 1-7

**Status:** Required before Phase 8 development

**Overview:** During Phases 1-7, several features were deferred or marked as optional. Before moving to Phase 8 (Import Prior Transcripts), these items need to be completed or explicitly postponed to ensure a solid foundation.

---

#### Missing UI Features

**1. Manual Vault Link Override UI (Phase 5)**

- **Issue**: Backend logic exists (main.js:976-978) to handle manual `obsidianLink` overrides, but no UI to edit this field
- **Impact**: Users cannot correct routing errors or manually specify vault paths without editing JSON
- **Fix**: Add editable text input field in meeting editor view
  - Display current `obsidianLink` value
  - Allow user to type/paste custom vault path (e.g., `clients/acme-corp/meetings/2025-11-08-strategy-call.md`)
  - Validate path format before saving
  - Add "Reset to Auto-Route" button to clear manual overrides
- **Priority**: Medium - workaround exists (manual JSON editing)
- **Estimated effort**: 2-3 hours

**2. Manual Speaker ID Correction UI (Phase 6)**

- **Issue**: IPC handler `speakers:updateSpeakerLabel` exists but no UI to use it
- **Impact**: Users cannot correct misidentified speakers after transcription completes
- **Fix**: Add speaker correction UI in transcript view
  - Click speaker name to edit
  - Dropdown to select from meeting participants
  - Save corrected speaker labels to transcript
  - Update all instances of that speaker in transcript
- **Priority**: Medium - heuristic matching is usually accurate
- **Estimated effort**: 3-4 hours

**3. Manual Participant Input During Recording (Phase 2 → Phase 3)**

- **Issue**: Deferred from Phase 2, never implemented in Phase 3
- **Impact**: Cannot add participant info for manually recorded meetings without calendar events
- **Fix**: Add participant input form during manual recording
  - Text area for email addresses (one per line)
  - Optional: Name + email pairs
  - Save to meeting metadata before routing
- **Priority**: Medium - most meetings have calendar events
- **Estimated effort**: 2-3 hours

**4. Post-Recording Routing with User Confirmation (Phase 2 → Phase 3)**

- **Issue**: Routing happens automatically, no user confirmation or override
- **Impact**: Meetings might be routed incorrectly without user awareness
- **Fix**: Add routing confirmation modal after transcription
  - Show detected route (e.g., "clients/acme-corp/meetings")
  - Allow user to confirm or change destination
  - "Don't ask again for this organization" checkbox
- **Priority**: Low - routing is generally accurate, manual override UI addresses this
- **Estimated effort**: 2-3 hours

---

#### Optional/Deferred Features

**5. Export Recording Audio File (Phase 5)**

- **Issue**: Marked "optional - deferred", no target phase
- **Impact**: Audio files stored locally but not exported to vault
- **Decision**: Keep deferred - audio files are large, primary value is in transcripts
- **Priority**: Low - optional feature
- **If needed**: Add checkbox in settings to enable audio export to vault

**6. Contact Cache Validation (Phase 6)**

- **Issue**: Marked "deferred - low risk from trusted API"
- **Impact**: Cached contact data not validated against Google API responses
- **Decision**: Keep deferred - Google Contacts API is trusted source, low risk
- **Priority**: Low - security enhancement
- **If needed**: Add checksum validation or periodic cache integrity checks

---

#### Technical Debt & Code Quality

**7. Implement Proper Logging Framework**

- **Issue**: Using `console.log` throughout codebase instead of structured logging
- **Fix**: Install `electron-log`, create `src/shared/logger.js`, replace incrementally
- **Priority**: Medium - improves debugging and production monitoring
- **Estimated effort**: 2-3 hours setup + incremental replacement

**8. Add ESLint & Prettier Configuration**

- **Issue**: No code linting or formatting standards
- **Fix**: Install ESLint + Prettier, create config files, add npm scripts
- **Priority**: Medium - prevents bugs, improves code consistency
- **Estimated effort**: 1-2 hours

**9. Split main.js Into Modules**

- **Issue**: `src/main.js` is too large and handles too many concerns
- **Fix**: Extract focused modules (RecallAI API, File Manager, etc.)
- **Priority**: Low - code works, but harder to maintain
- **Estimated effort**: 8-10 hours (incremental)

**10. TypeScript Migration**

- **Issue**: JavaScript codebase lacks type safety
- **Fix**: Migrate to TypeScript incrementally, starting with shared types
- **Priority**: Low - would help with future development
- **Estimated effort**: 20-30 hours (incremental)

**11. React Component Extraction**

- **Issue**: `src/renderer.js` is a 2,000+ line monolith
- **Fix**: Extract modular components (MeetingCard, TranscriptView, etc.)
- **Priority**: Low - UI works, but harder to maintain
- **Estimated effort**: 12-15 hours

---

#### Recommendations

**MUST DO before Phase 8:**

1. Manual Vault Link Override UI (#1) - Edit obsidianLink field in meeting editor
2. Proper Logging Framework (#7) - Essential for debugging future phases
3. ESLint & Prettier (#8) - Quick setup, prevents bugs in new code

**DEFERRED to Phase 10 (Advanced UI & Settings):** 4. Manual Speaker ID Correction UI (#2) - Important but not blocking, heuristic matching works well 5. Manual Participant Input During Recording (#3) - Most meetings have calendar events 6. Post-Recording Routing Confirmation (#4) - Manual vault override UI covers this 7. Export Recording Audio (#5) - Optional feature, not critical 8. Contact Cache Validation (#6) - Low risk, nice-to-have 9. Split main.js (#9) - Code quality, not blocking 10. TypeScript Migration (#10) - Long-term improvement 11. React Component Extraction (#11) - Long-term improvement

---

#### Success Criteria

- ✅ Users can manually override vault routing via UI
- ✅ Logging framework in place for better debugging
- ✅ Code linting prevents common bugs in new code

**Estimated Total Effort:** 5-8 hours

---

### Phase 8: Import Prior Transcripts ✅ COMPLETE

**Goal:** Retroactively process existing meeting notes

#### Deliverables

1. ✅ File import UI (drag-and-drop + file/folder selection)
2. ✅ Support for .txt, .md, VTT, SRT formats
3. ✅ Metadata extraction from filename/content
4. ✅ Manual metadata input form
5. ✅ Batch processing with background operation
6. ✅ Apply routing to imported transcripts
7. ✅ Generate summaries for imported transcripts
8. ✅ Progress indicator with toast notifications
9. ✅ Granular template selection (checkboxes per template)
10. ✅ LLM-based title suggestions for generic titles
11. ✅ File overwrite protection with confirmation
12. ✅ Folder import with recursive scanning

#### Success Criteria

- ✅ Import 100+ transcripts successfully
- ✅ Metadata extracted accurately (>80%)
- ✅ Routing works for historical transcripts
- ✅ Summaries generated for imports with prompt caching
- ✅ User can monitor import progress via background notifications
- ✅ Supports both single file and bulk folder imports

#### Implementation Details (November 12, 2025)

- **UI Components**: Drag-and-drop zone, file/folder selection buttons, template checkboxes
- **Background Processing**: Imports run in background, user can continue working
- **Generic Title Detection**: Automatically detects titles like "Krisp Transcript", "Zoom Meeting", "Transcript2", suggests better titles via LLM
  - Fixed detection pattern to catch numbered variants (e.g., "Transcript2", "Meeting1") using `startsWith(generic)` instead of exact match
  - Auto-summary system extracts AI-generated title from "# Suggested Title" section when generic title detected
- **Speaker Extraction**: Enhanced MetadataExtractor with fallback pattern matching for transcripts where parser marks all speakers as "Unknown"
  - Searches raw text for "Name:" patterns to extract participant names from transcript content
- **File Overwrite Protection**: Warns user before overwriting existing files in vault
- **Folder Import**: Recursively scans folders for supported transcript formats
- **Template Selection**: Granular checkboxes allow user to select which templates to generate per import
- **Cost Optimization**: Uses prompt caching for batch imports (85-90% savings on 2nd+ imports)
- **IPC Handlers**: `import:importFile`, `import:importBatch`, `import:selectFiles`, `import:selectFolder`, `import:getStatus`
- **Progress Tracking**: Toast notifications show import progress and completion

#### User Value

Entire meeting history organized and searchable using new system. Background processing allows continued work during bulk imports.

---

### Phase 9: Encryption & Security ✅ COMPLETE (Nov 13, 2025 + Jan 13, 2025 Audit)

**Goal:** Protect sensitive meeting data and resolve critical vulnerabilities

**Status:** ✅ **COMPLETE** - Core hardening (7/11 tasks) + Comprehensive security audit passed

#### Deliverables Completed ✅

1. ✅ **XSS Vulnerability Mitigation** - DOMPurify sanitization for all user input (6 attack vectors)
2. ✅ **Path Traversal Protection** - Validation in VaultStructure.js prevents directory escape
3. ✅ **OAuth CSRF Protection** - State parameter validation in Google OAuth flow
4. ✅ **IPC Input Validation** - Zod schema infrastructure for all handlers (2/36 applied)
5. ✅ **Token File Permission Validation** - Windows icacls verification with fallback deletion
6. ✅ **Memory Leak Prevention** - Auth window event listener cleanup
7. ✅ **Security Dependencies** - DOMPurify, Zod, keytar, marked

#### Security Audit Completed ✅ (Jan 13, 2025)

**Comprehensive Pre-Production Security Audit:**
- ✅ **15/15 automated tests passing** (100% pass rate)
- ✅ **2 critical vulnerabilities found and fixed** (path traversal, OAuth CSRF bypass)
- ✅ **0 high-severity vulnerabilities remaining**
- ✅ **Penetration testing**: XSS (6 vectors), Path Traversal (10 scenarios), OAuth CSRF (5 scenarios)
- ✅ **Automated scanning**: npm audit, ESLint security plugins
- ✅ **Manual code review**: 36 IPC handlers, file operations, API key storage
- ✅ **Documentation**: 45-page comprehensive audit report (`docs/security-audit-2025-01-13.md`)
- ✅ **Test suites created**: XSS, Path Traversal, OAuth CSRF (automated)
- ✅ **Security posture**: STRONG - Ready for personal use deployment
- ✅ **Risk rating**: LOW

**Vulnerabilities Fixed During Audit:**
1. **Path Traversal (Critical)** - Enhanced `validateRelativePath()` blocks all attacks
2. **OAuth CSRF Bypass (Critical)** - Made state parameter mandatory

**Audit Artifacts:**
- `docs/security-audit-2025-01-13.md` - Comprehensive report
- `tests/security/xss-test-payloads.js` - OWASP test suite
- `tests/security/path-traversal-tests.js` - Penetration tests (10/10 pass)
- `tests/security/oauth-csrf-tests.js` - Attack scenarios (5/5 pass)
- `.eslintrc.json` - Security linting configuration

#### Deliverables Deferred 📋

8. **Windows DPAPI Integration** → Moved to Phase 10 (#16)
9. **API Key Storage in Credential Manager** → Moved to Phase 10 (#14)
10. **Encryption Toggle UI** → Moved to Phase 10 (#15)

#### Success Criteria Met ✅

**Phase 9 Core Hardening (Nov 13, 2025):**
- ✅ Zero critical vulnerabilities (resolved 6 issues)
- ✅ All XSS attack vectors sanitized (6 locations)
- ✅ Path traversal attacks blocked (initial implementation)
- ✅ OAuth CSRF attacks prevented (state parameter added)
- ✅ Token files secured or deleted (icacls verification)
- ✅ Memory leaks prevented in auth flow
- 📋 File encryption (optional enhancement - deferred to Phase 10)
- 📋 API keys in Credential Manager (requires UI - deferred to Phase 10)

**Security Audit (Jan 13, 2025):**
- ✅ **15/15 automated tests passing** (100%)
- ✅ **Path traversal completely secured** (enhanced validation, 10/10 attacks blocked)
- ✅ **OAuth CSRF fully protected** (mandatory state validation, 5/5 attacks blocked)
- ✅ **0 critical or high-severity vulnerabilities**
- ✅ **Security posture: STRONG** (ready for personal use)
- ✅ **Risk rating: LOW**
- 🟡 **2 medium-severity accepted risks** (API keys in .env, partial IPC validation - deferred to Phase 10)

#### User Value

**Delivered:**
- ✅ Application is **production-ready** for personal use
- ✅ Protection against: XSS, path traversal, OAuth CSRF, token theft
- ✅ Comprehensive security testing and validation
- ✅ Automated test suites for ongoing security validation
- ✅ Industry-standard security practices implemented

**Future (Phase 10):**
- Optional file encryption (Windows DPAPI)
- Secure API key management (Windows Credential Manager)
- Complete IPC validation rollout (34 remaining handlers)

#### Documentation

- **Phase 9 Security Report:** `docs/phase9-security-report.md` (400+ lines - Nov 13, 2025)
- **Comprehensive Security Audit:** `docs/security-audit-2025-01-13.md` (45 pages - Jan 13, 2025)
- **Automated Test Suites:** `tests/security/*.js` (XSS, Path Traversal, OAuth CSRF)
- **ESLint Security Config:** `.eslintrc.json`

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
    ALLOWED_ATTR: [],
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
    participantEmails: z.array(z.string().email()),
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

### Phase 10: Advanced UI & Settings

**Goal:** Polish user experience and configurability

**Execution Strategy:** Optimized subphase order to minimize dependencies and maximize user value delivery

---

#### Phase 10.1: Settings Infrastructure & Theme Foundation 🏗️

**Status:** ✅ COMPLETE (January 13, 2025)

**Goal:** Foundation for all other features

**Deliverables:**
- ✅ Comprehensive settings panel with tab/section navigation
- ✅ Settings persistence (localStorage)
- ✅ Theme support (light/dark mode) - UI controls implemented
- ✅ Settings import/export for backup
- ✅ IPC handlers: `settings:getAppVersion`, `settings:getVaultPath`

**Estimated Effort:** Medium | **Priority:** Critical (foundation)

**Files Created:**
- `src/renderer/settings.js` (340 lines)

**Files Modified:**
- `src/index.html` - Added settings modal with sidebar navigation
- `src/index.css` - Added 400+ lines of settings UI styles
- `src/main.js` - Added settings IPC handlers
- `src/preload.js` - Exposed settings APIs

---

#### Phase 10.2: Security & Credentials 🔒

**Status:** ✅ COMPLETE (January 13, 2025)

**Goal:** Complete Phase 9 security story

**Deliverables:**
- ✅ API Key Management UI with Security tab in settings
- ✅ Migration from `.env` to Windows Credential Manager (using `keytar`)
- ✅ Migration wizard for existing API keys (one-click migration)
- ✅ Edit/Test/Delete functionality for all 14 API key types
- ✅ Inline editing with password input fields
- ✅ Key validation with provider-specific format checking
- ✅ Backwards compatibility (automatic fallback to `.env`)
- ✅ Secure storage using Windows Credential Manager
- ❌ ~~Windows DPAPI file encryption~~ - **REMOVED**: Obsidian requires plain text markdown files
- ❌ ~~Encryption Settings UI~~ - **REMOVED**: Incompatible with Obsidian integration

**Estimated Effort:** Large | **Priority:** High (production security)

**Files Created:**
- `src/main/services/keyManagementService.js` (298 lines) - Windows Credential Manager integration
- `src/main/services/encryptionService.js` (450 lines) - DPAPI service (unused, kept for future non-vault files)
- `src/renderer/securitySettings.js` (334 lines) - Security panel UI logic

**Files Modified:**
- `src/main.js` - Added key management IPC handlers + `getAPIKey()` helper
- `src/preload.js` - Added key management APIs
- `src/index.html` - Added Security tab and API keys table
- `src/index.css` - Added 250+ lines of security panel styles
- `webpack.main.config.js` - Added `keytar` to externals

**Implementation Notes:**
- File encryption removed due to Obsidian compatibility requirements
- `encryptionService.js` kept but not actively used (potential future use for audio files)
- All API keys stored securely in Windows Credential Manager
- Migration wizard shows when keys exist in `.env` but not Credential Manager

---

#### Phase 10.3: LLM & Template Configuration 🤖

**Status:** ✅ COMPLETE (January 14, 2025)

**Goal:** Power-user control over AI + builds Monaco editor infrastructure

**Deliverables:**
- ❌ Separate LLM model config for auto-summary vs template summaries (deferred)
- ✅ Auto-summary template file (user-editable, replaces hardcoded prompt)
- ✅ Template editor with syntax highlighting (Monaco Editor)
- ✅ Template management UI (create, duplicate, delete buttons - save functionality pending)
- ✅ Live template preview (basic preview panel with format-aware rendering)
- ❌ Template metadata editor (name, description, tags) (deferred)

**Estimated Effort:** Large | **Priority:** Medium (customization)

**Implementation Details:**
- ✅ Monaco Editor integrated with Webpack (MonacoWebpackPlugin)
- ✅ Created `config/templates/auto-summary-prompt.txt` for editable summary prompt
- ✅ Full-page settings view (converted from modal for adequate workspace)
- ✅ Two-view architecture: mainView and settingsView
- ✅ Theme synchronization with app dark/light mode
- ✅ Plain text template support (.txt files) added to TemplateParser
- ✅ Template content IPC handler (`templates:getContent`)
- ✅ Syntax highlighting for YAML, JSON, Markdown, plaintext
- ✅ Live preview panel with format-aware rendering
- 🟡 Template save functionality stubbed (IPC handler needed)
- 🟡 Create/delete template functionality stubbed (UI exists, backend needed)

**Files Created:**
- `config/templates/auto-summary-prompt.txt` (editable auto-summary prompt)

**Files Modified:**
- `webpack.renderer.config.js` - Added MonacoWebpackPlugin
- `webpack.rules.js` - Fixed keytar native module bundling
- `src/index.html` - Full-page settings restructure
- `src/index.css` - 215 lines of template editor styles
- `src/renderer/templates.js` - Complete rewrite with Monaco integration
- `src/renderer/settings.js` - Full-page navigation logic
- `src/main.js` - Added `templates:getContent` IPC handler, `loadAutoSummaryPrompt()` function
- `src/preload.js` - Exposed `templatesGetContent` API
- `src/main/templates/TemplateManager.js` - Added .txt file support
- `src/main/templates/TemplateParser.js` - Added `parseTextFile()` method

**Known Issues:**
- Duplicate ID bug fixed (changed `templateList` → `templateEditorList`)
- Save/create/delete templates currently show "coming soon" toasts

---

#### Phase 10.4: Advanced Configuration Editors ⚙️

**Status:** ✅ COMPLETED (Jan 14, 2025)

**Goal:** Visual editors for configuration files (reuses Monaco editor from 10.3)

**Deliverables:**
- ✅ Routing Configuration Editor (visual editor for `routing.yaml`)
- ✅ Organization/contact management UI
- ✅ Validation and error highlighting (live linting)
- ✅ Config backup before edits
- ✅ Routing test tool (preview where a meeting would be saved)

**Estimated Effort:** Large | **Priority:** Medium (nice-to-have)

**Dependencies:** Requires Monaco Editor from Phase 10.3

**Implementation Notes:**
- Created new "Routing" tab in settings panel between Security and Templates
- Monaco Editor reused for YAML syntax highlighting
- Organization sidebar shows Clients, Industry, and Internal sections with navigation
- Validation uses js-yaml library with comprehensive error reporting
- Automatic backup to routing.backup.yaml before each save
- Routing test tab allows entering comma-separated emails to preview vault path
- Integration with existing RoutingEngine for live testing
- Full theme support (light/dark mode)
- **Add Organization Dialog:**
  - Type selection (Client or Industry)
  - Organization ID validation (lowercase-with-hyphens format)
  - Vault path (required)
  - Email domains and specific contacts (optional)
  - Duplicate check and YAML regeneration
- **Delete Organization Dialog:**
  - Confirmation modal with warnings
  - Prevents deleting Internal organization
  - Preserves empty sections for RoutingEngine compatibility
- **Toolbar Actions:**
  - Refresh: Reload from disk
  - Undo: Restore from backup with confirmation
  - Validate: YAML structure validation
  - Test: Switch to routing test tab
  - Save: Write to disk with backup

**Files Modified:**
- `src/renderer/routing.js` - New routing editor module (700+ lines with full CRUD operations)
- `src/index.html` - Added routing panel HTML structure with toolbar buttons
- `src/index.css` - Added 450+ lines (routing editor + modal dialog styles)
- `src/renderer/settings.js` - Added routing panel to settings tabs
- `src/renderer.js` - Initialize routing editor
- `src/preload.js` - Added 7 routing IPC handlers
- `src/main.js` - Added routing IPC handlers with validation and backup (330+ lines, 7 handlers)

---

#### Phase 10.5: Meeting Metadata Management ✏️

**Status:** ⏳ NOT STARTED

**Goal:** Fix individual meeting data quality issues

**Deliverables:**
- ⏳ Manual Speaker ID Correction UI (inline editing in transcript view)
- ⏳ Manual Participant Input During Recording (add participants mid-meeting)
- ⏳ Manual Vault Link Override UI (wire up existing backend in `main.js`)
- ⏳ Participant autocomplete from Google Contacts
- ⏳ Undo/redo for metadata edits

**Estimated Effort:** Medium | **Priority:** High (data quality)

**Technical Notes:**
- Backend for vault link override already exists in `main.js:976-978`
- Needs UI input field in meeting detail view
- Speaker correction requires transcript re-rendering

---

#### Phase 10.6: Bulk Meeting Operations 📦

**Status:** ⏳ NOT STARTED

**Goal:** Batch operations for power users (builds on 10.5 + uses 10.3 templates)

**Deliverables:**
- ⏳ Bulk re-export (update vault files if routing/structure changed)
- ⏳ Batch template generation (apply new templates to old meetings)
- ⏳ Bulk speaker corrections (fix recurring misidentifications)
- ⏳ Batch routing updates (move meetings to new organizations)
- ⏳ Multi-select UI with progress tracking
- ⏳ Dry-run preview before applying changes
- ⏳ Undo/rollback for bulk operations

**Estimated Effort:** Large | **Priority:** Medium (power-user feature)

**Dependencies:** Requires 10.3 (templates) and 10.5 (speaker correction)

---

#### Phase 10.7: Desktop App Polish ✨

**Status:** ✅ COMPLETE (January 16, 2025)

**Goal:** Professional desktop experience

**Deliverables:**
- ✅ System tray menu (quick record, open vault, quit)
- ✅ Global keyboard shortcuts (start/stop recording)
- ✅ Recording quality settings (audio bitrate, format)
- ✅ Notification preferences (control toasts, sounds)
- ✅ Multi-monitor support (widget placement persistence)
- ✅ Logs and diagnostics viewer

**Estimated Effort:** Medium | **Priority:** Low (polish)

**Implementation Details:**

**System Tray Integration:**
- Context menu with quick actions (Open, Quick Record, Stop Recording, Open Vault, Settings, Logs, Quit)
- Double-click to show/hide window
- Minimize to tray behavior (configurable)
- Dynamic menu updates (Stop Recording enabled only when recording active)
- Graceful fallback when tray icon missing

**Global Keyboard Shortcuts:**
- `CommandOrControl+Shift+R` - Start/Stop Recording toggle
- `CommandOrControl+Shift+Q` - Quick Record (immediate in-person meeting)
- Customizable via settings panel
- Automatic registration/unregistration on app start/quit
- Re-registration when shortcuts updated

**Recording Quality Settings:**
- Audio format selection (WAV uncompressed, MP3 compressed)
- Sample rate options (16kHz Speech, 44.1kHz CD, 48kHz Professional)
- Bitrate settings for compressed formats (64-256 kbps)
- Settings persisted to `app-settings.json` in user data directory

**Notification Preferences:**
- Toggle toast notifications on/off
- Toggle notification sounds
- Minimize to tray instead of closing app
- All preferences saved and restored on app restart

**Multi-Monitor Support:**
- Window position/size saved when moved or resized (debounced 500ms)
- Display ID tracked to detect monitor changes
- Graceful fallback to default position if saved display disconnected
- Window bounds restored on app launch

**Logs & Diagnostics Viewer:**
- Real-time log viewing with level filtering (All, Error, Warn, Info, Debug)
- Color-coded log levels with syntax highlighting
- Refresh, Clear, and Open in Editor actions
- Log statistics display (filtered lines / total lines)
- Log file path display
- Monospace font rendering for readability

**Settings Persistence:**
- Settings stored in `app-settings.json` (user data directory)
- Automatic load on app start
- Save on each setting change
- Merge strategy for new settings (preserves defaults)

**IPC Handlers (Phase 10.7):**
- `app:getSettings` - Retrieve all app settings
- `app:updateSettings` - Update settings with automatic save
- `app:getLogs` - Fetch logs with filtering and pagination
- `app:clearLogs` - Clear log file with confirmation
- `app:openLogFile` - Open log in default editor

**Event Listeners (Phase 10.7):**
- `quick-record-requested` - Tray/shortcut triggered quick record
- `toggle-recording-shortcut` - Global shortcut toggle
- `stop-recording-requested` - Tray stop button
- `open-settings` - Tray settings menu
- `open-logs-viewer` - Tray logs menu

**Files Created:**
- `src/renderer/appSettings.js` (341 lines) - Phase 10.7 settings UI logic
- Settings panels in `src/index.html` (Recording, Notifications, Shortcuts, Logs)
- Phase 10.7 styles in `src/index.css` (95+ lines)

**Files Modified:**
- `src/main.js` - System tray, global shortcuts, settings persistence, IPC handlers (500+ lines added)
- `src/preload.js` - Phase 10.7 API exposure (15 new APIs)
- `src/renderer.js` - Import and initialize appSettings module
- `src/index.html` - New settings tabs and panels (170+ lines)
- `src/index.css` - Log viewer and info box styles (95+ lines)

**User Value:**
- Professional desktop app experience with system tray integration
- Quick access to recording functions from anywhere via global shortcuts
- Full control over recording quality and notification behavior
- Window position remembered across app restarts and monitor changes
- Easy access to logs for troubleshooting without leaving the app

---
#### Phase 10.8: Transcript Pattern Learning System 🎯

**Status:** ⏳ PLANNED (3-phase implementation)

**Goal:** Flexible, extensible transcript parsing that can learn new patterns without code changes

**Context:** The current transcript parser (Phase 8) supports two hardcoded patterns for plain text transcripts:
1. **Inline:** `Name: transcribed speech` - Regex: `/^([A-Za-z\s]+):\s+(.+)/`
2. **Header:** `Name:\n"transcribed speech"` - Regex: `/^([A-Za-z\s]+):$/`

**Current Limitations:**
- Hardcoded regex patterns (not user-configurable)
- No preview/confirmation before import
- Can't learn new patterns without code changes
- Won't match speaker names with numbers, hyphens, special chars (e.g., `Speaker 1:`, `Dr. Smith:`, `O'Brien:`)
- No UI for pattern validation or testing

**Strategic Approach:** 3-phase implementation building on existing architecture (routing.yaml, template files, file-based config philosophy)

---

##### Phase 10.8.1: Pattern Configuration System (Foundation) 🏗️

**Status:** ✅ COMPLETE (January 16, 2025)

**Goal:** Make transcript patterns user-configurable via YAML file (follows routing/template precedent)

**Deliverables:**
1. ✅ Create `config/transcript-patterns.yaml` configuration file
2. ✅ Implement `PatternConfigLoader.js` to load and validate patterns
3. ✅ Refactor `TranscriptParser.js` to use config patterns instead of hardcoded regex
4. ✅ Ship default patterns covering common formats (11 patterns: 4 header, 4 inline, 3 timestamp)
5. ✅ Pattern priority system (allows ordering pattern checks)
6. ✅ Enable/disable individual patterns
7. ✅ **Extended to markdown files (.md)** - Pattern system works for both .txt and .md formats

**Pattern YAML Schema:**
```yaml
patterns:
  - id: "inline-basic"
    name: "Inline Speaker with Text"
    description: "Name: transcribed speech"
    type: "inline"
    regex: "^([A-Za-z\\s]+):\\s+(.+)"
    captureGroups:
      speaker: 1
      text: 2
    enabled: true
    priority: 2

  - id: "header-quoted"
    name: "Speaker Header on Own Line"
    description: "Name:\n\"text\""
    type: "header"
    regex: "^([A-Za-z\\s]+):$"
    captureGroups:
      speaker: 1
    enabled: true
    priority: 1

  - id: "inline-extended"
    name: "Speaker with Numbers/Special Chars"
    description: "Supports: Dr. Smith:, Speaker 1:, O'Brien:"
    type: "inline"
    regex: "^([A-Za-z0-9\\s.'-]+):\\s+(.+)"
    captureGroups:
      speaker: 1
      text: 2
    enabled: true
    priority: 3
```

**Success Criteria:**
- ✅ Parser loads patterns from YAML config
- ✅ Can add/edit patterns without code changes
- ✅ Backward compatible with existing imports
- ✅ Priority ordering works correctly
- ✅ Enable/disable toggles function

**Implementation Details:**
- **Files Created:**
  - `config/transcript-patterns.yaml` (197 lines) - Pattern configuration with 11 default patterns (includes markdown-specific)
  - `src/main/import/PatternConfigLoader.js` (285 lines) - Load, validate, cache patterns
  - `test-pattern-loader.js` (127 lines) - Comprehensive test suite
  - `test-transcript-patterns.txt` - Sample transcript for testing
  - `test-transcripts/` folder with 6 test files (.txt and .md formats)
- **Files Modified:**
  - `src/main/import/TranscriptParser.js` - Refactored both `parsePlainText()` and `parseMarkdown()` to use config patterns (~400 lines refactored)
- **Architecture:**
  - Singleton pattern for config loader with hot-reload capability
  - Patterns loaded on demand and cached for performance
  - Separated patterns by type (header, inline, timestamp) for efficient matching
- **Validation:**
  - Zod schema for pattern structure validation
  - Regex compilation validation
  - Comprehensive error reporting with path and message
- **Backward Compatibility:**
  - Default patterns match original hardcoded behavior
  - Basic patterns (priority 1-3) identical to Phase 8 implementation
  - Extended patterns (priority 4+) add support for special characters
- **Default Patterns Included:**
  - Header patterns: Basic (letters/spaces), Extended (numbers, apostrophes, periods, hyphens)
  - Inline patterns: Basic, Extended, Bracketed role (disabled), Parenthetical role (disabled)
  - Timestamp patterns: Bracketed, Plain, Dash separator
- **Settings:**
  - `skipEmptyLines`, `stripQuotes`, `combineConsecutiveSpeaker`
  - `defaultSpeaker`, `headerStopPatterns` (configurable stop conditions)

**User Value:**
- ✅ Immediate flexibility to add new transcript formats
- ✅ No code changes needed for new patterns
- ✅ Users can edit patterns like they edit routing.yaml
- ✅ Power users can customize for their specific transcript sources
- ✅ Supports speaker names with numbers, apostrophes, periods (Dr. Smith, O'Brien, Speaker 1)
- ✅ Works with both .txt and .md files (markdown support extended after testing with real transcript)
- ✅ Handles curly quotes (″) and other Unicode quote characters

**Actual Effort:** 4 hours (3 hours initial + 1 hour markdown extension)

---

##### Phase 10.8.2: Unified Pattern Testing Component 🔍

**Status:** ✅ COMPLETE (January 16, 2025)

**Goal:** Build ONE reusable component serving both import preview and pattern development

**Deliverables:** ✅ All Complete
1. ✅ Created `PatternTestingPanel.js` (~500 lines) - Dual-mode component with shared statistics/visualization logic
2. ✅ **Mode 1: Import Preview** - Optional preview via checkbox in import flow
   - Pattern preview modal shows parsed transcript before confirming import
   - Speaker detection statistics (unique speakers, match rate %)
   - Speaker distribution bars with visual indicators
   - Sample parsed entries (first 10 with pagination indicator)
   - Warning alerts if many "Unknown" speakers detected (< 90% match rate)
   - Confirm/Cancel buttons (confirm proceeds with import, cancel returns to import modal)
   - File info header with filename and size
3. ✅ **Mode 2: Pattern Editor** - Standalone tab in settings ("Transcript Patterns")
   - Monaco YAML editor with syntax highlighting (reuses from template editor)
   - Test area with pre-defined sample dropdown (inline, header, krisp, markdown, timestamp)
   - Live parse results with statistics, speaker distribution, and sample entries
   - "Save Patterns" button with validation (saves to config/transcript-patterns.yaml)
   - Test button for manual testing with custom samples
   - Visual feedback for parse success/failure rates
4. ✅ Integration into existing import modal - Added optional "Preview parsing before importing" checkbox
5. ✅ Integration into settings panel - New "Transcript Patterns" tab with icon

**Component Interface:**
```javascript
// Import Preview Mode (embedded in import flow)
<PatternTestingPanel
  mode="import-preview"
  sourceFile={selectedFile}
  patterns={userPatterns}
  onConfirm={handleImport}
  onCancel={cancelImport}
/>

// Pattern Editor Mode (standalone in settings)
<PatternTestingPanel
  mode="pattern-editor"
  editable={true}
  allowSave={true}
/>
```

**Shared Features (both modes):**
- Parser preview (displays parsed entries with speaker names)
- Speaker detection stats (count, unique speakers, match rate %)
- Match rate visualization (progress bar or chart)
- Sample text input area
- Pattern selection dropdown (test with different pattern sets)

**Mode-Specific Features:**
- **Import Preview:** File info header, "Confirm/Cancel" buttons, file path display
- **Pattern Editor:** Monaco YAML editor, "Save Pattern" button, test samples library, validation errors

**Success Criteria:**
- ✅ Import flow shows preview before importing
- ✅ User can validate parsing quality before committing
- ✅ Settings has pattern testing sandbox
- ✅ Both modes use same component (DRY principle)
- ✅ Monaco editor has YAML syntax highlighting
- ✅ Live preview updates as patterns change
- ✅ Visual feedback for parse success/failure

**Implementation Details:**
- **Files:**
  - `src/renderer/components/PatternTestingPanel.js` (~400-500 lines) - Unified component
  - `src/renderer/import.js` (modify ~30 lines) - Integrate preview mode
  - `src/renderer/settings.js` (add ~50 lines) - Add pattern editor tab
  - `src/index.html` (add ~30 lines) - Pattern editor tab markup
  - `src/index.css` (add ~100 lines) - Pattern testing styles
- **IPC Handlers:**
  - `patterns:testParse` - Test parsing with given patterns and sample text
  - `patterns:getConfig` - Load current pattern configuration
  - `patterns:saveConfig` - Save edited patterns with validation
- **UI Components:**
  - Pattern statistics display (speakers found, match rate)
  - Parsed entries preview (table or card layout)
  - Monaco editor integration (reuse from template editor)
  - Test sample library (common transcript formats)

**Implementation Summary:**
- **Files Created/Modified:**
  - `src/renderer/components/PatternTestingPanel.js` (NEW, 507 lines) - Dual-mode component
  - `src/main.js` (added 3 IPC handlers, ~120 lines) - patterns:testParse, patterns:getConfig, patterns:saveConfig
  - `src/preload.js` (added 3 API methods) - Exposed pattern testing IPC to renderer
  - `src/renderer/settings.js` (modified ~30 lines) - Added patterns tab initialization
  - `src/renderer.js` (added ~110 lines) - Import preview integration, performBatchImport refactor
  - `src/index.html` (added ~110 lines) - Pattern preview modal + patterns settings tab
  - `src/index.css` (added ~315 lines) - Complete pattern testing UI styles
- **IPC Handlers:** All 3 implemented with validation
  - `patterns:testParse` - Parses content and returns statistics (entries, speakers, match rate, distribution)
  - `patterns:getConfig` - Loads current YAML config via PatternConfigLoader singleton
  - `patterns:saveConfig` - Validates and saves YAML with Zod schema validation
- **UI Components:** All implemented
  - Statistics grid (4-column responsive grid with color-coded match rate)
  - Speaker distribution bars (gradient fills, special styling for "Unknown")
  - Sample entries list (cards with speaker labels, timestamps, truncated text)
  - Monaco editor integration (YAML syntax, dark/light theme support)
  - Test sample library (5 pre-defined samples with one-click load)
  - Warning display (amber alert when match rate < 90%)
  - File info header (filename + size display)

**User Value:**
- ✅ No more "import and hope" - optional preview shows parsing quality before committing
- ✅ Confidence that speakers will be detected correctly - visual match rate % with color coding
- ✅ Pattern development sandbox for testing new formats - full Monaco editor with live preview
- ✅ Consistent UX across import and settings - shared component, shared styling
- ✅ Prevents failed imports due to pattern mismatches - warnings and stats guide user decisions

**Bugs Fixed During Implementation:**
- ✅ Duplicate element IDs between import preview modal and settings panel (fixed with mode-based ID prefixing)
- ✅ CSS grid collapse with `auto-fit` causing zero-height containers (fixed with explicit 4-column grid)
- ✅ IPC handler needed for file reading in renderer process (added `patterns:readFile`)
- ✅ YAML config loading via `app.getAppPath()` for webpack compatibility

**Actual Effort:** 8 hours

---

##### Phase 10.8.3: LLM Pattern Builder (AI Magic) 🤖

**Status:** ✅ COMPLETE (January 16, 2025)

**Goal:** AI-assisted pattern generation from sample transcripts

**Deliverables:** ✅ All Complete
1. ✅ Create `PatternGenerationService.js` - LLM-based pattern builder
2. ✅ Design specialized LLM prompt for regex pattern generation
3. ✅ Add "Generate Pattern with AI" button to `PatternTestingPanel`
4. ✅ Sample transcript input modal (5-10 lines minimum)
5. ✅ AI-generated pattern preview with test results
6. ✅ Option to save generated pattern to config
7. ✅ Model tracking for pattern generation (shows which AI model was used)

**User Flow:**
1. User clicks "Generate Pattern with AI" (available in import preview OR settings)
2. Modal appears: "Paste 5-10 lines of sample transcript"
3. User pastes sample (e.g., transcript from new source)
4. LLM analyzes structure → suggests regex pattern + YAML config
5. Pattern loads into `PatternTestingPanel` for validation
6. User tests pattern with full transcript sample
7. User saves to `transcript-patterns.yaml`

**LLM Prompt Strategy:**
```javascript
// Pseudo-code example
const prompt = `
Analyze this transcript sample and generate a regex pattern to extract speaker names and text.

Sample transcript:
${sampleText}

Requirements:
- Identify the pattern of speaker identification (inline, header, prefix, etc.)
- Generate a JavaScript-compatible regex pattern
- Specify capture groups for speaker name and text
- Output as YAML config matching this schema:
  id: string (kebab-case)
  name: string (human-readable)
  description: string
  type: "inline" | "header" | "timestamp"
  regex: string (JavaScript regex)
  captureGroups:
    speaker: number (capture group index)
    text: number (capture group index)
  enabled: true
  priority: number

Return ONLY the YAML configuration, no additional text.
`;
```

**Success Criteria:**
- ✅ AI generates valid regex patterns from samples
- ✅ Generated patterns work on full transcripts
- ✅ YAML output is valid and loadable
- ✅ User can test before saving
- ✅ Cost per generation < $0.05
- ✅ Works with various transcript formats
- ✅ Handles edge cases (multi-line, timestamps, special chars)

**Implementation Details:**
- **Files:**
  - `src/main/services/patternGenerationService.js` (~200 lines) - LLM pattern builder
  - `src/renderer/components/PatternTestingPanel.js` (add ~100 lines) - "Generate with AI" button and modal
  - `src/main.js` (add ~30 lines) - IPC handler for pattern generation
- **LLM Integration:**
  - Use existing `llmService.js` with provider switching
  - Small token budget (~1,000 tokens input, ~500 tokens output)
  - Estimated cost: $0.01-$0.03 per generation
  - Cache-friendly (sample transcripts are small)
- **IPC Handlers:**
  - `patterns:generateFromSample` - Send sample to LLM, return YAML pattern
- **Validation:**
  - Test generated regex against sample text
  - Validate YAML structure before returning
  - Show success/failure rate in UI

**Integration with Phase 10.8.2:**
- "Generate with AI" button appears in both modes (import preview, pattern editor)
- Generated pattern automatically loads into testing panel
- User can immediately test with full transcript
- Save button enabled after successful test

**User Value:**
- Zero regex knowledge required
- New transcript format? Paste sample → get pattern in seconds
- Reduces barrier to extensibility
- "Magic" factor - app learns from examples
- Empowers non-technical users to customize

**Cost Analysis:**
- **Per generation:** ~1,500 tokens total (~$0.02 with gpt-4o-mini)
- **Usage pattern:** Infrequent (1-5 times per year per user)
- **Total annual cost:** < $0.10 per user
- **Value:** Saves hours of regex debugging

**Implementation Summary:**
- **Files Created:**
  - `src/main/services/patternGenerationService.js` (212 lines) - LLM-based pattern builder with specialized prompts
- **Files Modified:**
  - `src/main.js` (~50 lines) - Added `patterns:generateFromSample` IPC handler, updated `withProviderSwitch()` and `getProviderPreferences()`
  - `src/preload.js` (~3 lines) - Exposed `patternsGenerateFromSample` API
  - `src/renderer/components/PatternTestingPanel.js` (~200 lines) - Added AI generation modal, button, and auto-load logic
  - `src/index.html` (~60 lines) - Added AI pattern generation modal and pattern generation provider setting
  - `src/renderer/settings.js` (~20 lines) - Added pattern generation provider dropdown handling
- **Architecture:**
  - Uses `withProviderSwitch('pattern', callback)` pattern matching auto-summary and template-summary
  - Global `patternGenerationService` initialized at startup using shared `llmService`
  - Specialized LLM prompt outputs YAML matching pattern schema
  - Pattern validation and testing before returning to UI
  - Auto-loads generated pattern into Monaco editor
  - Auto-tests pattern with sample text showing match rate
- **Provider Selection:**
  - Added "Pattern Generation Provider" setting in General tab
  - Default: OpenAI gpt-4o-mini (lightweight, cost-effective for regex tasks)
  - Options: OpenAI gpt-4o-mini, Azure gpt-5-mini, Claude Haiku 4.5
  - Respects user preference via localStorage sync

**Estimated Effort:** 4-6 hours | **Actual Effort:** ~5 hours

---

##### Overall Transcript Pattern Learning Summary

**Total Effort Estimate:** 12-20 hours (across 3 phases)

**Sequential Dependencies:**
- Phase 10.8.1 MUST complete before 10.8.2 (testing needs config system)
- Phase 10.8.3 builds on 10.8.2 (AI generates into testing panel)

**User Value Progression:**
1. **After 10.8.1:** Users can add patterns via YAML (power users)
2. **After 10.8.2:** All users see preview, validate before import (confidence)
3. **After 10.8.3:** Non-technical users generate patterns with AI (magic)

**Architectural Benefits:**
- Follows existing design patterns (routing.yaml, template files)
- Reuses Monaco editor from template system
- Leverages existing LLM service with prompt caching
- One component serves two use cases (DRY principle)
- File-based config (users can version control, backup)

**Edge Cases Handled:**
- Speaker names with numbers: `Speaker 1:`, `John-2:`
- Special characters: `Dr. Smith:`, `O'Brien:`, `[Moderator] John:`
- Timestamps: `[10:23] John: Hello`, `10:23 - John: Hello`
- Indentation: `    John: text`
- Mixed formats in same file (priority system)
- Quote variations: `«text»`, `'text'`, `"text"`

**Testing Checkpoints:**

**After Phase 10.8.1:**
- ✅ Load patterns from YAML
- ✅ Parse transcripts with config patterns
- ✅ Backward compatible with Phase 8 imports
- ✅ Priority ordering works

**After Phase 10.8.2:**
- ✅ Import preview shows before import
- ✅ Settings pattern editor saves changes
- ✅ Both modes use same component
- ✅ Monaco editor syntax highlighting works

**After Phase 10.8.3:**
- ✅ AI generates valid patterns
- ✅ Generated patterns test successfully
- ✅ End-to-end: sample → AI → test → save → import

**Files Modified/Created:**

**Phase 10.8.1:**
- NEW: `src/main/import/PatternConfigLoader.js` (~150 lines)
- NEW: `vault/config/transcript-patterns.yaml` (default patterns)
- MODIFY: `src/main/import/TranscriptParser.js` (refactor ~50 lines)

**Phase 10.8.2:**
- NEW: `src/renderer/components/PatternTestingPanel.js` (~400-500 lines)
- MODIFY: `src/renderer/import.js` (~30 lines)
- MODIFY: `src/renderer/settings.js` (~50 lines)
- MODIFY: `src/index.html` (~30 lines)
- MODIFY: `src/index.css` (~100 lines)

**Phase 10.8.3:**
- NEW: `src/main/services/patternGenerationService.js` (~200 lines)
- MODIFY: `src/renderer/components/PatternTestingPanel.js` (~100 lines)
- MODIFY: `src/main.js` (~30 lines for IPC)

**Total Lines of Code:** ~1,200 lines (new + modified)

---

#### Pre 10.9: fixes 🧹

**Status:** ✅ COMPLETE

**Deliverables:**
- ✅ Darkmodefixes.md corrections to remove hardcoded colors

---

#### Phase 10.9: Code Quality & Validation 🧹

**Status:** ⏳ OPTIONAL (Can be deferred or skipped entirely)

**Goal:** Maintainability and robustness improvements (only if measurable impact)

**Decision:** TypeScript migration **REJECTED** - not worth 40-50 hour investment for personal-use app. Plenty of successful open-source projects remain in JavaScript.

**Recommended High-Value Improvements:**

**1. Complete IPC Validation Rollout (HIGH VALUE)**
- **Current:** 2/36 handlers validated with Zod schemas
- **Impact:** Prevents crashes from malformed renderer data, catches bugs at runtime
- **Why:** IPC boundary is where Electron bugs actually happen - compile-time types don't help here
- **Priority:** HIGH - improves reliability
- **Estimated effort:** 8-10 hours (34 handlers × 15 min each)

**2. JSDoc Type Annotations (HIGH VALUE, LOW EFFORT)**
- **Fix:** Add JSDoc comments to key functions for IDE autocomplete
  ```javascript
  /**
   * @param {Meeting} meeting
   * @param {string[]} participantEmails
   * @returns {Promise<string>} Vault path
   */
  async function routeMeeting(meeting, participantEmails) { ... }
  ```
- **Impact:** 80% of TypeScript benefits, zero migration cost, works in VSCode immediately
- **Priority:** HIGH - improves developer experience
- **Estimated effort:** 2-3 hours (20-30 key functions)

**3. Integration Tests for Critical Paths (HIGH VALUE)**
- **Coverage:** Recording → Transcription → Export → Obsidian vault
- **Impact:** Prevents regressions during refactoring, better ROI than TypeScript
- **Priority:** MEDIUM - valuable but optional
- **Estimated effort:** 10-15 hours

**4. ESLint Strict Rules (HIGH VALUE, LOW EFFORT)**
- **Fix:** Add `no-unused-vars`, `no-implicit-globals`, `prefer-const`, etc.
- **Impact:** Catches common bugs automatically
- **Priority:** HIGH - quick wins
- **Estimated effort:** 1 hour setup

**Lower Priority / Optional Improvements:**

**5. Remove Legacy References**
- Remove casual references to "muesli", "electron", or other copyrights/legacy template code
- **Priority:** LOW - cosmetic cleanup
- **Estimated effort:** 2-3 hours

**6. Configuration Centralization**
- **Issue**: Hardcoded values scattered throughout codebase
- **Examples**: `60000` (meeting check interval), `200` (tokens per section)
- **Fix**: Create `config/constants.js` with named constants
- **Priority:** LOW - improves maintainability but no functional impact
- **Estimated effort:** 3-4 hours

**7. Routing Configuration Validation**
- **Issue**: `ConfigLoader.js` validates structure but not data validity
- **Fix**: Use Zod schemas to validate email formats, domain formats, vault paths
- **Priority:** LOW - config errors already caught by YAML parser
- **Estimated effort:** 2-3 hours

**Explicitly SKIPPED (Low ROI):**

**❌ Global State Management Refactoring** - 6-8 hours for no functional benefit
**❌ Code Duplication Cleanup** - 4-6 hours, works fine as-is
**❌ Async File Operations Migration** - 2-3 hours, files are small, sync is fine
**❌ Environment Configuration** - 3-4 hours, only needed for multi-user deployment
**❌ Component Extraction** - Nice-to-have, but app is stable and working
**❌ Performance Profiling** - No reported performance issues
**❌ TypeScript Migration** - 40-50 hours with minimal practical benefit for solo dev

**Recommended Phase 10.9 Scope (if pursuing):**

Focus only on items #1-4 above (total: 21-29 hours) for measurable reliability and developer experience improvements. Skip the rest unless specific bugs or issues arise that justify the effort.

---

## Phase 10.9: Incremental Refactoring Progress

**Status:** ✅ COMPLETE (January 18, 2025)

**Approach:** Implementing high-value refactorings one-by-one with testing and commits between each.

### ✅ Refactor #1: Toast Notification Consolidation (COMPLETE)

**Completed:** January 17, 2025
**Lines Removed:** ~60 lines

**Changes Made:**
1. Removed 4 duplicate toast implementations:
   - `src/renderer/settings.js` - 15-line duplicate removed
   - `src/renderer/securitySettings.js` - 16-line duplicate removed
   - `src/renderer.js` - 18-line inline toast (transcription provider) removed
   - All now use `window.showToast(message, type)` from renderer.js

2. Converted meeting detection from Windows Notification to toast:
   - `src/main.js:1470-1478` - Now sends `show-toast` event to renderer
   - `src/preload.js:51` - Added `onShowToast` listener
   - `src/renderer.js:2151-2155` - Added handler for `show-toast` events

3. Updated 17 toast calls with appropriate type parameters:
   - `'success'` - Green (settings saved, keys migrated, etc.)
   - `'error'` - Red (failures, validation errors)
   - `'warning'` - Orange/amber (empty values, warnings)
   - `'info'` - Blue (testing, informational)

**Files Modified:**
- `src/renderer/settings.js` (6 calls updated, duplicate removed)
- `src/renderer/securitySettings.js` (11 calls updated, duplicate removed)
- `src/renderer.js` (transcription provider toast replaced)
- `src/main.js` (meeting detection changed to toast)
- `src/preload.js` (added onShowToast)

**Testing Completed:**
- ✅ Settings provider changes show green success toasts
- ✅ Transcription provider change shows toast (not big green popup)
- ✅ SDK meeting detection shows blue info toast
- ✅ All toasts display in top-right, 4-second duration, proper animations

---

### ✅ Refactor #2: Modal Dialog Helper Utility (COMPLETE)

**Goal:** Extract reusable modal creation function
**Estimated Lines Saved:** ~200 lines (6 modals consolidated)
**Estimated Time:** ~2 hours

**Implementation Plan:**

1. **Create utility file:**
   ```
   src/renderer/utils/modalHelper.js
   ```

2. **Modal helper function signature:**
   ```javascript
   export function createModal({
     title,              // Modal title (string)
     body,               // HTML content (string, will be sanitized)
     confirmText,        // Confirm button text (default: "Confirm")
     cancelText,         // Cancel button text (default: "Cancel")
     onConfirm,          // Async function called on confirm
     onCancel,           // Optional function called on cancel
     size                // Optional: 'small', 'medium' (default), 'large'
   })
   ```

3. **Modals to refactor (6 total):**
   - `src/renderer/routing.js:367-416` - Add Organization modal
   - `src/renderer/routing.js:544-657` - Delete Organization confirmation
   - `src/renderer/routing.js:676-739` - Restore Backup confirmation
   - `src/renderer/meetingDetail.js:750-864` - Contact search modal (different pattern, may skip)
   - Additional modals in routing.js and other files

4. **Implementation steps:**
   - [ ] Create `src/renderer/utils/modalHelper.js`
   - [ ] Implement `createModal()` function with DOMPurify sanitization
   - [ ] Add keyboard shortcuts (Escape to close, Enter to confirm)
   - [ ] Add click-outside-to-close behavior
   - [ ] Replace first modal in routing.js as proof-of-concept
   - [ ] Test thoroughly
   - [ ] Replace remaining 5 modals
   - [ ] Remove old modal code

**Example usage (before vs after):**

Before (50+ lines):
```javascript
const modal = document.createElement('div');
modal.className = 'modal-overlay';
modal.innerHTML = `...complex HTML...`;
document.body.appendChild(modal);
// ... 30+ lines of event listener setup ...
```

After (5 lines):
```javascript
createModal({
  title: 'Delete Organization',
  body: '<p>Are you sure you want to delete this organization?</p>',
  confirmText: 'Delete',
  onConfirm: async () => await deleteOrg(orgId)
});
```

---

### ✅ Refactor #3: IPC Handler Wrapper (COMPLETE)

**Goal:** Standardize IPC handler error handling and response format
**Estimated Lines Saved:** ~300 lines (66 handlers)
**Estimated Time:** ~3 hours

**Implementation Plan:**

1. **Create utility file:**
   ```
   src/main/utils/ipcHelpers.js
   ```

2. **Helper function:**
   ```javascript
   function createIpcHandler(handlerFn) {
     return async (event, ...args) => {
       try {
         const result = await handlerFn(event, ...args);
         return { success: true, ...result };
       } catch (error) {
         logger.ipc.error('[IPC Error]', error);
         return { success: false, error: error.message };
       }
     };
   }
   ```

3. **Implementation approach:**
   - Start with non-critical handlers (settings, routing)
   - Test each batch (10-15 handlers at a time)
   - Avoid touching critical recording/transcription handlers until stable

4. **Pattern to replace (appears 66 times):**
   ```javascript
   // Before:
   ipcMain.handle('some:handler', async (event, data) => {
     try {
       // ... logic
       return { success: true, data: result };
     } catch (error) {
       console.error('[Handler] Error:', error);
       return { success: false, error: error.message };
     }
   });

   // After:
   ipcMain.handle('some:handler', createIpcHandler(async (event, data) => {
     // ... logic
     return { data: result };
   }));
   ```

---

### ✅ Refactor #4: Button Loading State Helper (COMPLETE)

**Goal:** Standardize button disabled states during async operations
**Estimated Lines Saved:** ~120 lines (15+ occurrences)
**Estimated Time:** ~1 hour

**Implementation Plan:**

1. **Create utility:**
   ```
   src/renderer/utils/buttonHelper.js
   ```

2. **Helper function:**
   ```javascript
   export async function withButtonLoading(buttonId, loadingText, asyncFn) {
     const btn = document.getElementById(buttonId);
     if (!btn) return;

     const originalText = btn.textContent;
     const originalDisabled = btn.disabled;

     btn.disabled = true;
     btn.textContent = loadingText;

     try {
       return await asyncFn();
     } finally {
       btn.disabled = originalDisabled;
       btn.textContent = originalText;
     }
   }
   ```

3. **Usage pattern:**
   ```javascript
   // Before (8 lines):
   const btn = document.getElementById('saveBtn');
   btn.disabled = true;
   const originalText = btn.textContent;
   btn.textContent = 'Saving...';
   try {
     await saveConfig();
   } finally {
     btn.disabled = false;
     btn.textContent = originalText;
   }

   // After (1 line):
   await withButtonLoading('saveBtn', 'Saving...', () => saveConfig());
   ```

---

### ✅ Refactor #5: IPC Call Wrapper for Renderer (COMPLETE)

**Goal:** Standardize renderer-side IPC calls with error handling
**Estimated Lines Saved:** ~400 lines (59 calls)
**Estimated Time:** ~2-3 hours

**Implementation Plan:**

1. **Create utility:**
   ```
   src/renderer/utils/ipcWrapper.js
   ```

2. **Helper function:**
   ```javascript
   export async function callIpc(method, args, options = {}) {
     const {
       successMessage,
       errorMessage = 'Operation failed',
       showSuccessToast = false,
       showErrorToast = true,
       context = 'IPC'
     } = options;

     try {
       const response = await window.electronAPI[method](
         ...(Array.isArray(args) ? args : [args])
       );

       if (!response || !response.success) {
         throw new Error(response?.error || errorMessage);
       }

       if (showSuccessToast && successMessage) {
         window.showToast(successMessage, 'success');
       }

       return response;
     } catch (error) {
       console.error(`[${context}]`, error);
       if (showErrorToast) {
         window.showToast(`${errorMessage}: ${error.message}`, 'error');
       }
       throw error;
     }
   }
   ```

3. **Usage pattern:**
   ```javascript
   // Before (12 lines):
   try {
     const response = await window.electronAPI.routingSaveConfig(content);
     if (!response || !response.success) {
       throw new Error(response?.error || 'Failed to save configuration');
     }
     console.log('Configuration saved');
     window.showToast('Configuration saved successfully', 'success');
   } catch (error) {
     console.error('[RoutingEditor] Error:', error);
     window.showToast('Error: ' + error.message, 'error');
   }

   // After (5 lines):
   await callIpc('routingSaveConfig', [content], {
     successMessage: 'Configuration saved successfully',
     errorMessage: 'Failed to save configuration',
     showSuccessToast: true,
     context: 'RoutingEditor'
   });
   ```

---

### ✅ Refactor #6: Tab Switching Helper (COMPLETE)

**Goal:** Standardize tab UI switching logic
**Estimated Lines Saved:** ~80 lines (4 implementations)
**Estimated Time:** ~1 hour

**Implementation Plan:**

1. **Create utility:**
   ```
   src/renderer/utils/tabHelper.js
   ```

2. **Helper function:**
   ```javascript
   export function initializeTabs(tabs) {
     tabs.forEach(({ buttonId, contentId, onActivate }) => {
       const button = document.getElementById(buttonId);
       const content = document.getElementById(contentId);

       if (!button || !content) return;

       button.addEventListener('click', () => {
         // Deactivate all tabs
         tabs.forEach(({ buttonId: id, contentId: cId }) => {
           document.getElementById(id)?.classList.remove('active');
           const c = document.getElementById(cId);
           if (c) c.style.display = 'none';
         });

         // Activate this tab
         button.classList.add('active');
         content.style.display = 'block';

         if (onActivate) onActivate();
       });
     });
   }
   ```

3. **Files with tab implementations:**
   - `src/renderer/templates.js:56-76`
   - `src/renderer/routing.js:57-76`
   - `src/renderer/meetingDetail.js:144-168`
   - `src/renderer/settings.js:154-186`

---

### Summary: Refactoring Work Completed

| Refactor | Status | Time Spent | Lines Saved | Priority |
|----------|--------|-----------|-------------|----------|
| #1: Toast Consolidation | ✅ DONE | - | 60 | - |
| #2: Modal Helper | ✅ DONE | ~2h | 200 | HIGH |
| #3: IPC Handler Wrapper | ✅ DONE | ~3h | 300 | HIGH |
| #4: Button Loading Helper | ✅ DONE | ~1h | 120 | MEDIUM |
| #5: IPC Call Wrapper | ✅ DONE | ~2-3h | 400 | HIGH |
| #6: Tab Switching Helper | ✅ DONE | ~1h | 80 | MEDIUM |
| **TOTAL** | **100% Complete** | **~9-10h** | **~1,160 lines** | - |

**Phase 10.9 Complete:** All 6 refactorings successfully implemented and tested.

---

#### Overall Success Criteria

- All settings accessible and functional
- In-app editors work for templates and routing config
- User can customize behavior without editing files directly
- Keyboard shortcuts work consistently
- System tray provides quick access
- User can select different LLM models for auto vs template summaries
- Auto-summary prompt editable via template file
- API keys stored securely in Windows Credential Manager
- Bulk operations have dry-run previews and rollback capability

#### User Value

Fully customizable to personal workflow preferences with enterprise-grade security, power-user bulk operations, and professional desktop app polish.

---

### Phase 11: Real-Time Transcription (Optional)

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

### Phase 12: HubSpot Integration

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


### Phase 13: 

**Goal:** Elgato Stream Deck Integration

#### Deliverables

1. Create app to interface with Elgato Stream Deck
2. Add buttons for start/stop recording
3. Visual feedback on recording status

#### Success Criteria

- Stream Deck buttons respond to recording state
- Visual feedback updates in real-time
- Buttons are configurable via settings panel

### Pre-Production: Security Audit & Validation ✅ COMPLETE (Jan 13, 2025)

**Goal:** Final validation of all security measures before production release

**Status:** ✅ **COMPLETE** - Comprehensive security audit passed with 15/15 tests

#### Completed Tasks

1. ✅ **Comprehensive Security Audit**
   - ✅ Penetration testing of all security implementations (15/15 tests passed)
   - ✅ Validated XSS protections with OWASP test payloads (6 attack vectors protected)
   - ✅ Tested path traversal prevention with malicious paths (10/10 attacks blocked)
   - ✅ Verified OAuth CSRF protection against attack scenarios (5/5 attacks blocked)
   - ✅ Validated IPC input validation infrastructure (36 schemas defined, 2 implemented)
   - ✅ Reviewed token file permissions (icacls verification working)
   - 🟡 Memory leak testing (basic validation complete, long-running session pending)

2. ✅ **Automated Security Scanning**
   - ✅ npm audit for dependency vulnerabilities (7 low/moderate in dev deps only)
   - ✅ Static code analysis with ESLint security plugins (0 security issues found)
   - ✅ Path traversal automated test suite (100% pass rate)
   - ✅ OAuth CSRF automated test suite (100% pass rate)

3. ✅ **Manual Code Review**
   - ✅ Reviewed all 36 IPC handlers for validation needs
   - ✅ Audited all file operations for path traversal risks (VaultStructure secured)
   - ✅ Checked all user input points for XSS vulnerabilities (6 vectors secured)
   - ✅ Verified API key and token storage security (accepted risks documented)

4. ✅ **Security Documentation**
   - ✅ Phase 9 Security Report (`docs/phase9-security-report.md`)
   - ✅ Comprehensive Security Audit Report (`docs/security-audit-2025-01-13.md`)
   - ✅ Automated test suites (`tests/security/*.js`)
   - 🟡 Security incident response plan (deferred to production)
   - 🟡 Secure deployment procedures (deferred to production)

#### Audit Results Summary

**Security Posture:** ✅ **STRONG** - Production-ready for personal use

**Vulnerabilities Fixed:**
- 🔴 2 Critical vulnerabilities found and fixed (path traversal, OAuth CSRF)
- 🟠 0 High-severity issues remaining
- 🟡 2 Medium-severity issues (accepted risks, deferred to Phase 10)
- 🟢 7 Low-severity issues (dev dependencies only, no production impact)

**Test Results:**
- **15/15 automated tests passing (100%)**
- **0 critical vulnerabilities**
- **0 high-severity vulnerabilities**
- **All attack vectors successfully blocked**

**Risk Rating:** 🟢 **LOW** - Ready for deployment

#### Success Criteria ✅ ACHIEVED

- ✅ Zero critical or high-severity vulnerabilities remaining
- ✅ All XSS test payloads properly sanitized (DOMPurify implementation validated)
- ✅ Path traversal attacks successfully blocked (10/10 attacks prevented)
- ✅ OAuth CSRF attacks prevented by state validation (5/5 attacks blocked)
- 🟡 IPC validation infrastructure complete (2/36 handlers implemented, remaining deferred to gradual rollout)
- 🟡 Memory leaks - basic validation complete (8+ hour session testing deferred)
- ✅ Security documentation complete and comprehensive

#### Vulnerabilities Found & Fixed

**During Audit (Jan 13, 2025):**

1. **Path Traversal (Critical)** - ✅ FIXED
   - 5 HIGH severity attacks bypassing validation
   - Root cause: Validation after path normalization
   - Fix: Created `validateRelativePath()` - checks before normalization
   - Impact: Complete vault protection
   - File: `src/main/storage/VaultStructure.js`

2. **OAuth CSRF (Critical)** - ✅ FIXED
   - State parameter optional, allowing CSRF bypass
   - Root cause: `if (state)` check with warning, not error
   - Fix: Made state parameter mandatory
   - Impact: Complete CSRF protection
   - File: `src/main/integrations/GoogleAuth.js`

**Phase 9 Fixes Validated:**
- ✅ XSS protections working (DOMPurify + escapeHtml)
- ✅ Token file permissions secure (icacls verification)
- ✅ Memory leak prevention (event listener cleanup)

#### Accepted Risks (Deferred to Phase 10)

1. **API Keys in Plain Text** (Medium)
   - Stored in `.env` file (plain text on disk)
   - Acceptable for personal use, single-user machine
   - Phase 10: Migrate to Windows Credential Manager

2. **Partial IPC Validation** (Medium)
   - 34/36 handlers without validation
   - Infrastructure complete, gradual rollout planned
   - Phase 10: Apply validation to remaining handlers

#### Audit Artifacts

**Created Files:**
- `docs/security-audit-2025-01-13.md` - Comprehensive audit report (45+ pages)
- `tests/security/xss-test-payloads.js` - OWASP XSS test suite
- `tests/security/path-traversal-tests.js` - Path traversal penetration tests
- `tests/security/oauth-csrf-tests.js` - OAuth CSRF attack scenarios
- `.eslintrc.json` - ESLint security configuration

**Run Audit Tests:**
```bash
# Path traversal penetration tests
node tests/security/path-traversal-tests.js

# OAuth CSRF attack scenarios
node tests/security/oauth-csrf-tests.js

# ESLint security scan
npx eslint src/main.js src/renderer.js src/main/**/*.js

# Dependency vulnerability audit
npm audit
```

#### Time Investment

- **Audit Execution**: 10 hours
- **Vulnerability Remediation**: 2 hours
- **Documentation**: 3 hours
- **Total**: 15 hours

#### Next Review

**Before v1.0 Production Release:**
- Manual XSS testing with UI payload injection
- 8+ hour memory leak monitoring
- Phase 10 security enhancements (API key migration, file encryption)

**Audit Approved For:** Personal use deployment

**Recommendation:** Application meets security standards for single-user, personal use. Phase 10 enhancements recommended before enterprise or multi-user deployment.

---

## API & Service Requirements

### Recall.ai

- Account and API key
- Desktop Recording SDK
- Documentation: https://docs.recall.ai/docs/getting-started

### Transcription Service

**Architecture**: Flexible multi-provider system with runtime switching (November 12, 2025)

**Current Implementation**:

- **Multi-Provider Support**: AssemblyAI, Deepgram, Recall.ai (3 options)
- **Provider Selection**: UI dropdown with localStorage persistence
- **Module**: `src/main/services/transcriptionService.js` - Unified interface with provider-specific adapters
- **Workflow**: Recall.ai SDK records locally → Direct file upload to selected provider → Speaker diarization transcript

**Provider Details**:

**AssemblyAI** (Primary - Most Cost-Effective):

- **Cost**: $0.37/hour (57% cheaper than Recall.ai full stack)
- **API**: 3-step process (upload → request transcription → poll for completion)
- **Features**: Speaker diarization, utterances, word-level timestamps, confidence scores
- **Endpoint**: `https://api.assemblyai.com/v2/`
- **Polling**: 5-second intervals, max 10 minutes
- **Format**: `utterances` array with speaker labels

**Deepgram** (Alternative):

- **Cost**: $0.43/hour (49% cheaper than Recall.ai full stack)
- **API**: Direct upload with immediate transcription
- **Features**: Speaker diarization, punctuation, utterances, word-level data
- **Endpoint**: `https://api.deepgram.com/v1/listen?diarize=true&punctuate=true&utterances=true`
- **Format**: `results.utterances` array with speaker labels

**Recall.ai** (Fallback - Currently Broken):

- **Cost**: $0.85/hour (recording + transcription)
- **Status**: SDK `uploadRecording()` method broken (returns null, no progress events)
- **Kept**: Code preserved for when SDK is fixed
- **Workflow**: Upload via SDK → Webhook-driven transcript processing
- **Infrastructure**: Express server (port 13373) + ngrok tunnel + Svix signature verification

**Cost Comparison**:
| Provider | Cost/Hour | Savings vs Recall.ai | Status |
|----------|-----------|---------------------|---------|
| AssemblyAI | $0.37 | 57% cheaper | ✅ Working |
| Deepgram | $0.43 | 49% cheaper | ✅ Working |
| Recall.ai | $0.85 | Baseline | ⚠️ SDK broken |

**Transcript Format** (Standardized):

- Array of entries with: `speaker`, `speakerId`, `text`, `timestamp`, `words[]`
- Provider metadata: `provider`, `confidence`
- Supports mapping to participant names via speaker matching

**Historical Note**:

- November 6, 2025: Migrated from AssemblyAI v3 streaming to Recall.ai async API
- November 10, 2025: Implemented webhook-based workflow with ngrok tunnel
- November 12, 2025: Discovered Recall.ai SDK upload broken, implemented flexible multi-provider system as workaround

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

**Document Version:** 1.0
**Last Updated:** January 13, 2025
