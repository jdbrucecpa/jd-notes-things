v1.2 User Test Checklist

Feature 1: Calendar/Recording UX

1.1 Meeting Card Improvements

- Connect Google Calendar in Settings > General
- Verify calendar meetings show date (e.g., "Wed, Dec 11") in addition to time
- Click "Join Meeting" button on a calendar meeting - should open the meeting link in browser
- Click "Record Meeting" button - should create a new note pre-populated with meeting title, platform, and participants

JD Notes---
Missing:

When I open a zoom meeting with the join meeting button, It opens the zoom window, but doesn't open a new meeting and start recording. It should do that too. In fact, for a given meeting, the join meeting button should be there, or the record meeting button, but not both. Both buttons should essentially be "start recording", but one is specific to the meeting type and will open the zoom window, and others will open the Teams version, and one the Meet version, and the other the "in-person" version.

---

1.2 Recording Widget

- In Settings > Notifications, verify "Show Recording Widget" is enabled
- When a meeting platform (Zoom/Teams/Meet) is detected, a floating widget should appear
- Widget should show meeting title and platform
- Widget should be draggable (click and drag the header)
- Click Start Recording in widget - recording should start and widget shows elapsed time
- Click Stop Recording in widget - recording should stop
- Click X to dismiss widget

JD Notes---
The widget should be able to be opened and should appear anytime I want it to, not just when a meeting is detected. It should change and ask me to start recording based on the calendar timing or zoom/teams/meet meeting detection. But the widget should be accessible at any time and also allow it to have an "always on top" option so it doesn't get lost behind other windows if turned on.

---

1.3 Auto-Start Recording

- In Settings > Notifications, toggle "Auto-start recording when meeting begins"
- With auto-start ON: When a calendar meeting time arrives and platform is detected, recording should start automatically
- With auto-start OFF: Widget should appear asking if you want to start recording
- If multiple calendar meetings overlap, widget should show a dropdown to select which meeting

---

Feature 2: Filters & Saved Views

2.1 Filter Dropdowns

- Click the filter icon (funnel) in the toolbar
- Filter dropdown should appear with: Company, Contact, Platform, Sync Status
- Select a Company filter - meeting list should filter to only that company
- Select a Platform filter (Zoom/Teams/Meet) - meetings should filter accordingly
- Select Sync Status "Not Synced" - should show only meetings not exported to Obsidian
- Apply multiple filters - they should combine (AND logic)
- Click "Clear Filters" - all filters should reset
- Filter badge should show count of active filters

JD Notes---
Your matching did not work properly for a given meeting. It just had stepahnie, so it listed the wrong stephanie. It should use Company as a helpful hint on which stephanie to pick. Not including me as a participant, if there is a confidently known contact, first check to see if any other contact with that smae company exists, and use that one,
I have a contact, John@brooklynfi.com and his company is Brooklyn FI. When I select Brooklyn FI as a filter, I do not see his meeting. None of the company filters work for me, they just show zero results.

---

2.2 Saved Views

- Apply some filters, then click "Save View"
- Enter a name for the view (e.g., "Client Meetings")
- View should appear in the Views dropdown
- Clear filters, then select your saved view from dropdown - filters should restore
- Create another view with different filters
- Switch between views - filters should update correctly
- Views should persist after app restart

JD Notes---
There needs to be a way to edit and delete saved views.

---

Feature 3: Stream Deck Integration

3.1 Settings

- Go to Settings > Stream Deck
- Toggle "Enable Stream Deck" ON
- Status should show "Enabled, waiting for connections..."
- WebSocket endpoint should display: ws://localhost:13373/streamdeck
- Toggle OFF - status should show "Disabled"

  3.2 WebSocket Connection (requires WebSocket client)

- With Stream Deck enabled, connect a WebSocket client to ws://localhost:13373/streamdeck
- Should receive {"event":"connected","data":{...}} message
- Send {"action":"getStatus"} - should receive status update
- Send {"action":"startRecording"} when meeting detected - should start recording
- Send {"action":"stopRecording"} - should stop recording
- Settings should show "Connected (1 client)"

JD Notes---
I can't do that last testing. Let's get an actual stream deck install file so I can actually test it on the streamdeck.

---

---

Feature 4: Tunnel Auto-Reconnect

4.1 Tunnel Recovery

- App should establish tunnel on startup (check console for "TUNNEL ESTABLISHED")
- If tunnel errors appear, it should auto-reconnect within 5-25 seconds
- After reconnect, webhook URL should update automatically
- Local server should remain accessible at http://localhost:13373

---

General

- App starts without errors
- No console JavaScript errors in DevTools (Ctrl+Shift+I)
- All existing functionality still works (create notes, record, transcribe, export)

Summary of Fixes

1. Company Filter Bug (Fixed)

- File: src/renderer.js
- Issue: Company filter showed zero results because it only checked meeting.organization or meeting.company, not participant
  companies from Google Contacts
- Fix: Enhanced filterMeetings() to also check participant companies from the Google Contacts cache (meeting.participants and
  meeting.participantEmails arrays)

2. Contact Matching with Company Hint (Fixed)

- File: src/main/integrations/SpeakerMatcher.js
- Issue: When multiple contacts have the same name (e.g., two "Stephanies"), the wrong one was selected
- Fix: Enhanced findEmailForParticipant() to:
  - Collect all matching contacts
  - Use explicit company hint if provided
  - Infer company from other meeting participants' companies/domains
  - Prefer full-name matches over first-name matches

3. Unified Join/Record Button (Fixed)

- Files: src/renderer.js, src/index.css
- Issue: Meetings had both "Join Meeting" and "Record Meeting" buttons
- Fix: Replaced with single "Start Recording" / "Join & Record" button that:
  - Opens the meeting platform (Zoom/Teams/Meet)
  - Creates a new note with meeting info
  - Text is contextual based on platform

4. Recording Widget Accessibility (Fixed)

- Files: src/main.js, src/preload.js, src/widget.html, src/widgetPreload.js, src/index.html
- Issue: Widget only appeared when meeting was detected
- Fix:
  - Added toolbar button to toggle widget anytime
  - Added "always-on-top" toggle (pin button) in widget header
  - Widget can now be shown in standalone mode without a meeting
  - Added IPC handlers: widget:toggle, widget:toggleAlwaysOnTop, widget:getState

5. Edit/Delete Saved Views (Fixed)

- Files: src/renderer.js, src/index.html
- Issue: No way to edit or delete saved views
- Fix:
  - Added "Manage Views..." option to views dropdown
  - Created Manage Views modal showing all custom views with Edit/Delete buttons
  - Created Edit View modal for renaming views
  - Delete from edit modal or manage modal with confirmation

6. Stream Deck Plugin (Created)

- Location: streamdeck-plugin/
- Files: manifest.json, plugin.js, SVG icons, README, install script
- Features:
  - Toggle Recording action (Start/Stop)
  - Status action (shows elapsed time)
  - Auto-reconnects to JD Notes
  - Install script (install-plugin.bat) for easy setup
