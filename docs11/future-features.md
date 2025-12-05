# Future Features (Post v1.1)

---

### HubSpot Integration

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

### Elgato Stream Deck Plugin

**Goal:** Elgato Stream Deck Integration

#### Deliverables

1. Create app to interface with Elgato Stream Deck
2. Add buttons for start/stop recording
3. Visual feedback on recording status

#### Success Criteria

- Stream Deck buttons respond to recording state
- Visual feedback updates in real-time
- Buttons are configurable via settings panel

---

### Obsidian Protocol Links

- Research `obsidian://` URI scheme
- Test if clickable in HubSpot
- Alternative: file path, Obsidian Publish URL

---

### Real-Time Transcription Feasibility

- Test streaming transcription latency
- Evaluate resource usage
- Determine if worth complexity
- local transcription with Parakeet/NeMo/Whisper
- Only for local meetings or quick notes

---

### Recording widget like Krisp.ai

- Pop up a mini-widget that allows starting a meeting when one is detected. Like a mini-player.
- autostart/stop recording when meeting starts/ends. The current button doesn't seem to do anything.

---

### Improve Google Calendar meeting cards

- Not sure if the record meeting or join meeting buttons work
- Should have a distinct link to the meeting.
- Should be able to pull up an actual meeting from Google Calendar and see the meeting card with the correct info.

---

### Gmail Integration

- Add Gmail API scope to existing Google OAuth
- View email threads with contacts from within the app
- Link to Gmail conversations from contact pages in Obsidian
- Show recent emails in contact detail view

---

#### Transition to SQLite for meeting data

- eventually the meetings.json file will get too large
- can do interim feature to archive old meetings to a separate file. 
- SQLite will solve the problem, but adds complexity.