# WASAPI Loopback Capture Design Spec

## Problem

The v2.0 audio mixer uses FFmpeg dshow for device enumeration and capture. dshow only lists input/capture devices. Users whose audio routes through virtual mixers (e.g., SteelSeries Sonar) or non-default output devices have no capturable system audio source — Stereo Mix only captures from its associated output device (Realtek), not from the actual playback device (Atom DAC 2, Sonar channels, etc.).

This makes local recording non-functional for any setup where system audio doesn't flow through a device that has a dshow loopback capture endpoint.

## Solution

Add WASAPI loopback capture via `native-recorder-nodejs` to capture audio from any Windows output device. Output devices (speakers, headphones, virtual mixer channels) appear alongside input devices in the settings dropdowns. Each source slot can be either a dshow input device (mic) or a WASAPI output device (system audio), mixed together by FFmpeg in real-time.

## Architecture

### Source Types

Each audio source slot has a `type` field:

- **`dshow`** — input/capture device. Captured by FFmpeg directly via `-f dshow -i "audio=NAME"`. Used for microphones.
- **`wasapi`** — output/render device. Captured by `native-recorder-nodejs` AudioRecorder, raw PCM piped to FFmpeg via Windows named pipe. Used for system audio, Sonar channels, etc.

### Capture Flow

```
[Mic - dshow]          -->  FFmpeg -f dshow -i "audio=Mic"
[Sonar Chat - wasapi]  -->  AudioRecorder --> named pipe --> FFmpeg -f s16le -i \\.\pipe\jdnotes_wasapi_0
[Sonar Media - wasapi] -->  AudioRecorder --> named pipe --> FFmpeg -f s16le -i \\.\pipe\jdnotes_wasapi_1
                                                              |
                                                         amix filter
                                                              |
                                                         output.mp3
```

### New Dependency

`native-recorder-nodejs` (npm) — N-API module with prebuilt binaries for Electron 29-40 (our Electron 40.x). Provides:
- `getDevices('output')` — enumerate output devices with `{id, name, type, isDefault}`
- `getDeviceFormat(deviceId)` — get PCM format (sample rate, channels, bit depth)
- `AudioRecorder` — start/stop capture from a specific device, raw PCM via `'data'` events

No compilation required — prebuilt binaries included.

## Device Enumeration

### Combined Device List

`audioDevices:list` IPC handler merges two sources:

1. `LocalProvider._enumerateDevices()` (existing) — dshow audio input devices
2. `native-recorder-nodejs` `getDevices('output')` — WASAPI output devices

Returns a unified array:

```json
[
  { "name": "SteelSeries Alias Pro Input (...)", "type": "dshow", "isMicrophone": true, "isLoopback": false },
  { "name": "Stereo Mix (Realtek USB Audio)", "type": "dshow", "isMicrophone": false, "isLoopback": true },
  { "name": "SteelSeries Sonar - Chat (...)", "type": "wasapi", "deviceId": "...", "isDefault": false },
  { "name": "SteelSeries Sonar - Gaming (...)", "type": "wasapi", "deviceId": "...", "isDefault": false },
  { "name": "SteelSeries Sonar - Media (...)", "type": "wasapi", "deviceId": "...", "isDefault": false },
  { "name": "Headphones - DAC (Atom DAC 2)", "type": "wasapi", "deviceId": "...", "isDefault": true }
]
```

### Graceful Degradation

If `native-recorder-nodejs` is not installed or fails to load, `audioDevices:list` returns only dshow devices. The feature degrades to input-only device enumeration (current behavior). No crash.

## Settings Schema Changes

The `audioSources` array in `app-settings.json` gains `type` and `deviceId` fields:

```json
{
  "audioSources": [
    { "label": "Microphone", "device": "SteelSeries Alias Pro Input (...)", "type": "dshow", "deviceId": null, "volume": 100, "enabled": true },
    { "label": "System Audio", "device": "SteelSeries Sonar - Chat (...)", "type": "wasapi", "deviceId": "wasapi-device-id-string", "volume": 100, "enabled": true },
    { "label": "Source 3", "device": null, "type": null, "deviceId": null, "volume": 100, "enabled": false }
  ],
  "audioMixer": {
    "autoBalance": true
  }
}
```

Backward compatibility: if `type` is absent, defaults to `"dshow"` (existing behavior).

## WasapiCapture Module

New file: `src/main/recording/WasapiCapture.js`

Wraps `native-recorder-nodejs` and manages named pipes. LocalProvider calls this module, never touches the npm package directly.

### API

```javascript
class WasapiCapture extends EventEmitter {
  // Enumerate output devices
  static async getOutputDevices()
  // Returns: [{ name, deviceId, isDefault }]

  // Get PCM format for a device
  static async getDeviceFormat(deviceId)
  // Returns: { sampleRate, channels, bitDepth }

  // Start capturing from a specific device, writing PCM to a named pipe
  async start(deviceId, pipeIndex)
  // Creates \\.\pipe\jdnotes_wasapi_{pipeIndex}
  // Starts AudioRecorder, pipes PCM data to the named pipe
  // Returns: { pipePath, sampleRate, channels }

  // Stop capture and close pipe
  async stop()

  // Events: 'error'
}
```

### Named Pipes

- Path pattern: `\\.\pipe\jdnotes_wasapi_0`, `\\.\pipe\jdnotes_wasapi_1`
- Created via Node.js `net.createServer` with `{ allowHalfOpen: true }` on the pipe path
- PCM data from AudioRecorder `'data'` events is written to the pipe
- FFmpeg connects as a client and reads the PCM stream
- Pipe is destroyed on `stop()`

## buildFFmpegArgs Changes

The function signature stays the same, but each source gains format info:

```javascript
// Source object now includes type and optional PCM format
{ device: "Mic Name", volume: 100, type: "dshow" }
{ device: "\\.\pipe\jdnotes_wasapi_0", volume: 100, type: "wasapi", sampleRate: 48000, channels: 2 }
```

For `dshow` sources: `-f dshow -i "audio=NAME"` (unchanged)

For `wasapi` sources: `-f s16le -ar RATE -ac CHANNELS -i PIPE_PATH`

The amix filter chain and dynaudnorm logic are unchanged — they operate on the mixed streams regardless of source type.

Backward compatibility: if `type` is missing from a source object, treat it as `"dshow"` (existing behavior).

## LocalProvider Changes

### `_startFFmpeg(outputPath)`

Updated flow:
1. Separate enabled sources into `dshowSources` and `wasapiSources`
2. For each WASAPI source, start a `WasapiCapture` instance — get pipe path and PCM format
3. Build FFmpeg args with both source types
4. Spawn FFmpeg (it connects to the named pipes and dshow devices)
5. Store WasapiCapture instances for cleanup

### `stopRecording()`

After sending 'q' to FFmpeg:
1. Stop all WasapiCapture instances
2. Named pipes close automatically

### `_enumerateDevices()` (updated)

Now also calls `WasapiCapture.getOutputDevices()` and merges with dshow devices. Returns the combined list.

## Settings UI Changes

### Device Dropdowns

Output devices display with a speaker prefix to distinguish from input devices:

```
(none)
SteelSeries Alias Pro Input (...)
SteelSeries Sonar - Microphone (...)
Stereo Mix (Realtek USB Audio)
--- Output Devices ---
SteelSeries Sonar - Chat (...)
SteelSeries Sonar - Gaming (...)
SteelSeries Sonar - Media (...)
Headphones - DAC (Atom DAC 2)
```

Output devices are visually separated with an `<optgroup>` label.

### Auto-Defaults

- Slot 1: first `isMicrophone` dshow device (unchanged)
- Slot 2: first `isDefault` WASAPI output device (was: first `isLoopback` dshow device)

### Saved Config

Dropdown `value` encodes both type and device info. When saving, `type` and `deviceId` are stored alongside `device` name.

## Testing

### Unit Tests

**`buildFFmpegArgs.test.js`** — add cases:
- Mixed dshow + wasapi sources → correct args for both types
- All wasapi sources → only PCM pipe inputs, no dshow args
- Wasapi source includes `-f s16le -ar RATE -ac CH` before pipe path

**`wasapiCapture.test.js`** (new):
- Pipe path generation
- Start/stop lifecycle (mock native-recorder-nodejs)
- Error event forwarding
- `getOutputDevices` returns correct format

### Manual Verification

Must be tested with real audio hardware:
1. Select Sonar Chat as system audio source
2. Play audio through a meeting app routed to Chat channel
3. Record 3 seconds via Test Recording
4. Verify playback contains the Chat channel audio
5. Verify mic audio is also present in the mix

## Error Handling

- **native-recorder-nodejs not installed** — `audioDevices:list` returns dshow devices only. Output device options don't appear. No crash.
- **WASAPI device unavailable at record start** — AudioRecorder errors, `error` event fires, toast shown. Recording aborted.
- **WASAPI device disappears mid-recording** — AudioRecorder fires `'error'`, pipe closes, FFmpeg detects closed pipe and exits non-zero. Toast: "Recording stopped — an audio device was disconnected."
- **Named pipe creation fails** — error emitted before FFmpeg starts, recording aborted.
- **All WASAPI sources fail but dshow sources work** — recording proceeds with dshow sources only (mic-only recording).

## Files Summary

| File | Action |
|------|--------|
| `src/main/recording/WasapiCapture.js` | **Create** — wraps native-recorder-nodejs, manages named pipes |
| `src/main/recording/buildFFmpegArgs.js` | **Modify** — handle wasapi source type with PCM format args |
| `src/main/recording/LocalProvider.js` | **Modify** — start/stop WasapiCapture instances, merge device lists |
| `src/main.js` | **Modify** — update audioDevices:list IPC to include output devices |
| `src/renderer/settings.js` | **Modify** — optgroup separator, auto-default to WASAPI output, save type/deviceId |
| `src/index.html` | No changes needed |
| `src/preload.js` | No changes needed |
| `tests/unit/buildFFmpegArgs.test.js` | **Modify** — add mixed source type tests |
| `tests/unit/wasapiCapture.test.js` | **Create** — WasapiCapture unit tests |
| `package.json` | **Modify** — add native-recorder-nodejs dependency |
