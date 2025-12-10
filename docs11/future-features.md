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
### Transcription Upgrades

- Explore real-time streaming options
- Test streaming transcription latency
- Review local transcription option with Parakeet/NeMo/Whisper
- See if we can do realtime for in-person or quick notes and async for Zoom, etc.
- Test the Recall.ai transcription service to see if the 2.0 version of the SDK is working correctly for transcription to add that option
- make sure the vocabulary systems are set up correctly for assembly.ai. I don't think we're doing it right.


---
### Recording widget like Krisp.ai

- Pop up a UI mini-widget that allows starting a meeting when one is detected. Like a mini-player.
- autostart/stop recording when meeting starts/ends. The current button doesn't seem to do anything.

---
### Improve Google Calendar meeting cards

- The record meeting or join meeting buttons so not work or do anything
- Should have a distinct link to the meeting.
- Should be able to pull up an actual meeting from Google Calendar and see the meeting card with the correct info.
- Auto start meeting when Calendar Item starts and meeting is detected. If calendar meeting is supposed to start, but no meeting is detected, pop up the recording widget and ask. So, workflow would be. If calendar time hits, look to see if a meeting is detected, if it is, auto start recording (if auto start setting is on). If no meeting is detected, or auto-start is off, pop up the widget and ask if the user wants to start recording. 
- There should be another setting in notifications tab asking if we want the pop up behavior (if auto start is not on) or not. 
- Include the date in addition to the time. 

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

---
#### filters

- Add filters on main page for:
	- Company (or maybe allow for grouping by Company?)
	- Contact (also maybe show filter list with number of meetings per contact)
	- Synced to Obsidian (unsynced to Obsidian is the only one already there)
	- Platform (Zoom, etc)
- Alternatively, think about creating and saving custom views (All meetings with Alman Partners OR Paul Shepherd) (All meetings with any company from this list, AES, Plancorp, etc). Then the user can build whatever views/filters desired. 
---
