
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

### Obsidian Protocol Links

- Research `obsidian://` URI scheme
- Test if clickable in HubSpot
- Alternative: file path, Obsidian Publish URL

### Speaker Matching Algorithms

- Research voice fingerprinting
- Speaker embedding models
- Privacy considerations for voice profiles

### Real-Time Transcription Feasibility

- Test streaming transcription latency
- Evaluate resource usage
- Determine if worth complexity
- local transcription with Parakeet/NeMo/Whisper

### Recording widget like Krisp.ai
- Pop up a mini-widget that allows starting a meeting when one is detected. Like a mini-player.

### Import settings from previous installation. 
- Copy the config directory from the old installation to the new one if it exists. 
- Include this in the export/import settings functionality.

 ### Improve Google Calendar meeting cards
- Not sure if the record meeting or join meeting buttons work
- Should be able to click to see participants and those should be able to see Contact info from google, and to be able to set up participants. 
- Should be able to see if the contacts would match with an existing workflow and to test the routing for a scheduled meeting to ensure that it matches. 