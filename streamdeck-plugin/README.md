# JD Notes Recording - Stream Deck Plugin

Control JD Notes meeting recording from your Elgato Stream Deck.

## Features

- **Toggle Recording**: Start/stop recording with a single button press
- **Status Display**: Shows current recording status and duration
- **Auto-reconnect**: Automatically reconnects to JD Notes if connection is lost

## Installation

### Method 1: Manual Installation

1. Close Stream Deck software if running
2. Copy the `com.jdnotes.recording.sdPlugin` folder to:
   - Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\`
   - macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
3. Restart Stream Deck software

### Method 2: Double-click Install (Windows)

1. Run `install-plugin.bat` as administrator
2. The plugin will be copied to the correct location and Stream Deck will restart

## Requirements

- JD Notes v1.2 or later with Stream Deck integration enabled
- Elgato Stream Deck software v6.0 or later
- Stream Deck hardware device

## Setup in JD Notes

1. Open JD Notes
2. Go to Settings > Stream Deck
3. Enable "Stream Deck Integration"
4. The WebSocket server will start on `ws://localhost:13373/streamdeck`

## Usage

### Toggle Recording Action

Add this action to toggle recording on/off:

- Press when **not recording**: Creates a new note and starts recording
- Press when **recording**: Stops the current recording

### Status Action

Add this action to see the current recording status:

- Shows "Ready" when connected and not recording
- Shows elapsed time (MM:SS) when recording
- Shows "Offline" when JD Notes is not connected

## Troubleshooting

### Plugin shows "Offline"

1. Make sure JD Notes is running
2. Check that Stream Deck integration is enabled in JD Notes settings
3. Verify the WebSocket server is running on port 13373

### Plugin doesn't appear in Stream Deck

1. Verify the plugin is in the correct Plugins folder
2. Restart the Stream Deck software
3. Check the Stream Deck logs for errors

## Development

The plugin uses the Stream Deck SDK v2 and connects to JD Notes via WebSocket.

### Files

- `manifest.json` - Plugin configuration
- `plugin.js` - Main plugin code
- `imgs/` - Button icons

### WebSocket Protocol

The plugin sends JSON messages to JD Notes:

```json
{ "action": "getStatus" }
{ "action": "startRecording" }
{ "action": "stopRecording" }
```

JD Notes responds with events:

```json
{ "event": "status", "data": { "isRecording": false } }
{ "event": "recordingStarted", "data": { "meetingTitle": "..." } }
{ "event": "recordingStopped" }
```
