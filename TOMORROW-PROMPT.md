# Tomorrow's Work Session - Phase 3 Continuation

**Date Created:** November 7, 2025
**Current Phase:** Phase 3 - Calendar Integration (In Progress)
**Status:** Calendar UI complete, AI summaries working, auto-recording pending

---

## Session Context

### What We Accomplished Today (Nov 7, 2025)

We made significant progress on Phase 3 Calendar Integration:

1. **Google Calendar Integration**
   - ✅ Built complete OAuth 2.0 flow (`src/main/integrations/GoogleCalendar.js`, 369 lines)
   - ✅ Calendar event fetching (next 24 hours)
   - ✅ Platform detection (Zoom, Teams, Google Meet, Webex, Whereby)
   - ✅ Meeting metadata extraction (title, participants, links, organizer)
   - ✅ Token persistence with context-aware storage paths

2. **UI Implementation**
   - ✅ Calendar meeting cards in main window
   - ✅ Join/Record buttons for each meeting
   - ✅ Platform badges and participant counts
   - ✅ Manual refresh functionality

3. **Three Critical Bug Fixes**
   - ✅ Calendar card click opening wrong editor (renderer.js:1812-1814)
   - ✅ Validation breaking new meetings (validation.js timestamp type coercion)
   - ✅ AI summary empty content (switched from gpt-5-nano to gpt-4o-mini)

4. **Model Selection Journey**
   - Started: `gpt-5-nano` → Streaming bug (finish_reason: "length" with 0 tokens)
   - Attempted: `gpt-5-mini` → Protected model requiring verification, no temperature support
   - Final: `gpt-4o-mini` with `temperature: 0.7` ✅

### Current State

**What Works:**
- Manual recording and transcription (Recall.ai + AssemblyAI)
- Intelligent routing to Obsidian vault (Phase 2 complete)
- Google Calendar OAuth authentication (CLI-based)
- Calendar meetings displayed in UI
- AI summary generation with gpt-4o-mini
- Platform detection for meeting links

**What's Pending (Phase 3):**
- Calendar authentication UI (OAuth flow currently requires CLI)
- Auto-start recording when calendar meeting begins
- Recording notification system
- Integration of calendar participant emails with routing system

---

## Options for Next Session

### Option A: Complete Phase 3 (Recommended)

Finish calendar integration with auto-recording functionality for a cohesive user experience.

**Tasks:**
1. **Calendar Authentication UI**
   - Build in-app OAuth flow (currently requires CLI + browser)
   - Add "Connect Calendar" button to settings or main UI
   - Handle OAuth callback within Electron window
   - Display authentication status (connected/disconnected)

2. **Auto-Start Recording**
   - Monitor upcoming meetings (check every minute)
   - Detect when meeting start time arrives (within 2-minute window)
   - Automatically click "Start Recording" for the user
   - Show system notification when auto-recording starts

3. **Recording Notifications**
   - System notification when meeting is detected
   - Notification when auto-recording starts
   - Allow user to stop/cancel from notification
   - Toast notifications in app window

4. **Routing Integration**
   - Pass calendar participant emails to routing engine
   - Use calendar meeting title for folder naming
   - Associate recording with calendar event ID
   - Save meeting link and organizer in metadata

**Deliverables:**
- Fully automated calendar → recording workflow
- No manual intervention needed for scheduled meetings
- Calendar-aware routing decisions

**Estimated Effort:** 6-8 hours

---

### Option B: Begin Phase 4 (Enhanced AI Summaries)

Start implementing user-editable templates for multiple summary types.

**Tasks:**
1. **Template System**
   - Implement `config/templates/` folder scanning
   - Support `.md`, `.yaml`, `.json` template formats
   - Parse template structure (sections, prompts)
   - Load templates at app startup

2. **Template Parser**
   - Markdown template parser (extract prompts from comments/frontmatter)
   - YAML template parser (structured sections)
   - JSON template parser (schema-based)
   - Validation for template syntax

3. **Multi-Summary Generation**
   - Apply multiple templates to same meeting
   - Generate separate markdown files per template
   - Save all summaries to meeting folder
   - Progress tracking for multiple LLM calls

4. **Template Selection UI**
   - Display available templates in UI
   - Allow user to select which templates to apply
   - Set default templates per organization type
   - Template preview/editing (future enhancement)

5. **Cost Tracking**
   - Track tokens used per template
   - Display cost estimates before generation
   - Log LLM usage per meeting
   - Monthly usage reports

**Deliverables:**
- User-editable template system
- Multiple summary types per meeting
- Cost transparency and tracking

**Estimated Effort:** 10-12 hours

---

## Recommendation

**Complete Phase 3 first** for these reasons:

1. **Cohesive User Experience**: Calendar → auto-record → summary is the core workflow
2. **Real-World Testing**: Need auto-recording working to properly test Phase 4 templates
3. **Smaller Scope**: Phase 3 completion is ~6-8 hours vs 10-12 hours for Phase 4
4. **User Value**: Auto-recording provides immediate daily value

Once Phase 3 is complete, the app will be fully functional for automated meeting capture. Phase 4 enhances the output quality with custom templates.

---

## Technical Context

### Key Files & Modules

**Calendar Integration:**
- `src/main/integrations/GoogleCalendar.js` - OAuth 2.0, event fetching, platform detection
- `src/renderer.js` - Calendar meeting cards UI (lines 274-336)
- `src/main.js` - IPC handlers for calendar operations

**AI Summaries:**
- `src/main.js` - LLM configuration (lines 14-24: MODELS object)
- `src/main.js` - Streaming summary generation (lines 1667-1713)
- Model: `gpt-4o-mini` with `temperature: 0.7`

**Routing System:**
- `src/main/routing/RoutingEngine.js` - Main routing decision engine
- `src/main/routing/EmailMatcher.js` - Email/domain matching
- `config/routing.yaml` - User configuration

**Validation:**
- `src/shared/validation.js` - Zod schemas with type coercion (timestamp fix)

### Environment

**API Keys Required (.env):**
```
RECALLAI_API_URL=https://us-west-2.recall.ai
RECALLAI_API_KEY=your_key_here
ASSEMBLYAI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_CALENDAR_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=your_client_secret
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/oauth2callback
```

**Token Storage:**
- Path: `C:\Users\brigh\AppData\Roaming\JD Notes Things\google-calendar-token.json`
- Format: JSON with `access_token`, `refresh_token`, `expiry_date`

**Running the App:**
```bash
cd "C:\Users\brigh\Documents\code\jd-notes-things"
npm start
```

---

## Known Issues & Limitations

**Current Limitations:**
- ⚠️ Calendar OAuth requires manual CLI steps (no in-app UI)
- ⚠️ No auto-start recording for calendar events
- ❌ No contact matching (speaker labels are generic "Speaker 1", "Speaker 2")
- ❌ No encryption (planned for Phase 10)
- ❌ No custom templates (single hardcoded format)

**Non-Blocking Issues:**
- ⚠️ JSON parsing warnings in Recall.ai SDK (cosmetic, doesn't affect functionality)
- ⚠️ Many background bash processes (can be cleaned up)

---

## Success Metrics

**Phase 3 Completion Criteria:**
- ✅ Calendar events displayed in main window (DONE)
- ✅ Meetings with 2+ participants detected (DONE)
- ✅ Meeting title and participants extracted (DONE)
- ⏳ OAuth flow accessible from UI (NOT DONE - currently CLI)
- ⏳ Recording starts automatically with notification (NOT DONE)
- ⏳ Calendar participants used in routing decisions (NOT DONE)

**Phase 4 Completion Criteria (Future):**
- User can create custom summary templates
- Multiple summary types generated per meeting
- Template selection UI functional
- Cost tracking visible to user

---

## Testing Checklist (Phase 3 Completion)

When implementing auto-recording, test:

1. **Meeting Detection:**
   - Meeting starts within 2 minutes → notification appears
   - Meeting starts exactly on time → auto-record triggers
   - Meeting starts late (5+ min) → no auto-record (user can manual start)

2. **Auto-Recording:**
   - Recording starts automatically without user intervention
   - System notification shows meeting title and platform
   - User can stop recording from notification or widget
   - Recording stops when meeting window closes

3. **Routing Integration:**
   - Calendar participant emails extracted correctly
   - Routing engine uses calendar emails for organization matching
   - Meeting saved to correct vault folder
   - Meeting title used in folder naming

4. **OAuth UI:**
   - User can connect/disconnect calendar from UI
   - Authentication status visible in settings
   - Token refresh works automatically
   - Error handling for expired/invalid tokens

---

## Reference Documentation

**Full Specification:** `SPECIFICATION.md`
**Development Progress:** `PROGRESS.md` (updated Nov 7, 2025)
**Project Instructions:** `CLAUDE.md`
**Routing Example:** `config/routing.yaml`

**External Docs:**
- Google Calendar API: https://developers.google.com/calendar/api/v3/reference
- Recall.ai SDK: https://docs.recall.ai/docs/getting-started
- AssemblyAI: https://www.assemblyai.com/docs
- OpenAI API: https://platform.openai.com/docs/api-reference

---

## Getting Started Tomorrow

**Quick Start:**
1. Read this prompt for context
2. Review updated `PROGRESS.md` for today's changes
3. Choose Option A (complete Phase 3) or Option B (start Phase 4)
4. If Option A: Start with calendar authentication UI
5. If Option B: Start with template system folder scanning

**First Task (Option A):**
Create calendar authentication UI component:
- Add "Connect Calendar" button to settings or toolbar
- Open BrowserWindow for OAuth flow
- Capture OAuth callback and exchange for tokens
- Display authentication status

**First Task (Option B):**
Implement template folder scanning:
- Create `config/templates/` if it doesn't exist
- Scan for `.md`, `.yaml`, `.json` files
- Parse template metadata (name, description)
- Display available templates in UI

---

**Let's ship Phase 3! 🚀**
