# Local Audio Mixer Design Spec

## Problem

The LocalProvider (`src/main/recording/LocalProvider.js`) records meeting audio via FFmpeg WASAPI loopback (Stereo Mix). This only captures system audio output — what comes through speakers/headphones. The user's microphone is not recorded. In a meeting, only remote participants' audio appears in the transcript. The user's own voice is missing.

## Solution

A configurable multi-source audio mixer built into the app. Three fixed audio source slots (mic + system audio + optional third source) with per-source volume control, an auto-balance toggle, and a test recording feature. All mixing happens inside a single FFmpeg process using `filter_complex amix`. Output is still a single MP3 file for the transcription pipeline.

## Approach

**Approach A: Pure FFmpeg amix** — all mixing in a single FFmpeg process. Multiple `-f dshow -i` inputs, a `filter_complex` with per-source `volume` filters feeding into `amix`, optional `dynaudnorm` on the output.

Alternatives considered and deferred:
- **Per-process audio capture** (Windows AudioClient API with process ID filtering) — would isolate just the meeting app's audio from all system sounds. Better quality but requires a native C++ addon. Deferred to v2.1 if system audio noise proves to be a transcription quality problem.
- **Separate FFmpeg per source** — resilient to one source failing, but doubles complexity and delays recording-ended events. Not worth it.

## Settings Schema

New fields in `app-settings.json`:

```json
{
  "audioSources": [
    { "label": "Microphone", "device": "SteelSeries Sonar - Microphone (...)", "volume": 100, "enabled": true },
    { "label": "System Audio", "device": "Stereo Mix (Realtek USB Audio)", "volume": 100, "enabled": true },
    { "label": "Source 3", "device": null, "volume": 100, "enabled": false }
  ],
  "audioMixer": {
    "autoBalance": true
  }
}
```

- **3 fixed slots.** Slot 1 defaults to first mic device found. Slot 2 defaults to loopback device (reusing `_findLoopbackDevice` keyword matching). Slot 3 starts disabled with no device.
- `device` — exact dshow device name string (what FFmpeg needs). `null` means not configured.
- `volume` — integer 0–200 (percentage). Maps to FFmpeg volume filter: `volume=1.0` at 100%, `volume=2.0` at 200%.
- `audioMixer.autoBalance` — toggles `dynaudnorm` filter on the mixed output.
- When `audioSources` is absent or empty, LocalProvider falls back to single-source behavior (backward compat).

## FFmpeg Command Builder

New file: `src/main/recording/buildFFmpegArgs.js`

A pure function: `buildFFmpegArgs(enabledSources, mixerSettings, outputPath) → string[]`

### Single enabled source (no filter_complex)

```
ffmpeg -y -f dshow -i "audio=Stereo Mix (Realtek USB Audio)" -acodec libmp3lame -ab 128k -ar 44100 output.mp3
```

### Two enabled sources

```
ffmpeg -y
  -f dshow -i "audio=SteelSeries Sonar - Microphone (...)"
  -f dshow -i "audio=Stereo Mix (Realtek USB Audio)"
  -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=longest[out]"
  -map "[out]" -acodec libmp3lame -ab 128k -ar 44100 output.mp3
```

### Three enabled sources

```
ffmpeg -y
  -f dshow -i "audio=Device1"
  -f dshow -i "audio=Device2"
  -f dshow -i "audio=Device3"
  -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[2:a]volume=0.6[a2];[a0][a1][a2]amix=inputs=3:duration=longest[out]"
  -map "[out]" -acodec libmp3lame -ab 128k -ar 44100 output.mp3
```

### With auto-balance enabled

Append `dynaudnorm=f=150:g=15:p=0.95` after the amix:

```
-filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=longest[mix];[mix]dynaudnorm=f=150:g=15:p=0.95[out]"
```

- `amix` with `normalize=1` (default) divides by number of inputs, preventing clipping.
- `dynaudnorm` parameters: `f=150` (150ms analysis frame), `g=15` (Gaussian filter window), `p=0.95` (target peak, 5% headroom).
- `duration=longest` keeps recording until all sources stop.

### Error case

If no enabled sources with a non-null device exist, the function throws an error. LocalProvider surfaces this via the `error` event.

## LocalProvider Changes

### `_startFFmpeg(outputPath)`

Currently hardcodes a single dshow input. Changes to:
1. Read enabled sources from `this._audioSources` and `this._audioMixer` (set at `initialize()` or updated via `setAudioConfig()`)
2. Filter to only enabled sources with a non-null device
3. Call `buildFFmpegArgs(enabledSources, mixerSettings, outputPath)` to get args array
4. Spawn FFmpeg with those args — close handler, error handler, stderr suppression unchanged

### `_enumerateDevices()` (new)

Extracted from `_findLoopbackDevice`'s FFmpeg parsing logic. Runs `ffmpeg -list_devices true -f dshow -i dummy`, parses stderr, returns `[{ name: string, type: 'audio' | 'video' }]`.

### `_findLoopbackDevice()`

Refactored to call `_enumerateDevices()` internally and filter for loopback keyword matches. Same return value (device name string or null), but delegates parsing to the shared method.

### `setAudioConfig(sources, mixer)` (new)

Sets `this._audioSources` and `this._audioMixer` on the instance. Called from main.js when `app:updateSettings` receives audio config changes. This allows settings changes to take effect on the next recording without reinitializing the provider.

### `initialize(config)`

Accepts optional `config.audioSources` and `config.audioMixer`, stores them via `setAudioConfig`. If absent, falls back to single-source mode (current behavior).

## IPC Channels

### `audioDevices:list`

Calls `_enumerateDevices()`, returns:

```json
{
  "devices": [
    { "name": "SteelSeries Sonar - Microphone (...)", "isLoopback": false, "isMicrophone": true },
    { "name": "Stereo Mix (Realtek USB Audio)", "isLoopback": true, "isMicrophone": false }
  ]
}
```

`isLoopback` uses existing keyword matching (stereo mix, loopback, virtual cable, vb-audio). `isMicrophone` matches "microphone" or "mic" in the device name.

### `audioDevices:test`

Records 3 seconds from the currently configured sources. Uses the same `buildFFmpegArgs` function with `-t 3` appended. Writes to a temp file in the recordings directory. Returns `{ filePath }`. Renderer plays back via an `<audio>` element.

### Settings read/write

Audio source config is part of appSettings — flows through existing `app:getSettings` and `app:updateSettings` IPC channels. No new persistence channels needed.

### Preload additions

```javascript
audioDevicesList: () => ipcRenderer.invoke('audioDevices:list'),
audioDevicesTest: () => ipcRenderer.invoke('audioDevices:test'),
```

## Settings UI

New section in `src/index.html` General settings panel, inserted between "Recording Provider" and "Transcription Provider" sections. Only visible when `recordingProvider === 'local'`.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Local Recording Sources                                 │
│ Configure audio inputs for local recording.     [Refresh]│
│                                                         │
│ [x] Microphone                                          │
│   Device: [SteelSeries Sonar - Microphone (...) v]     │
│   Volume: [====o===========] 100%                       │
│                                                         │
│ [x] System Audio                                        │
│   Device: [Stereo Mix (Realtek USB Audio)       v]     │
│   Volume: [====o===========] 100%                       │
│                                                         │
│ [ ] Source 3                                            │
│   Device: [(none)                               v]     │
│   Volume: [====o===========] 100%                       │
│                                                         │
│ [x] Auto-balance audio levels                           │
│                                                         │
│ [Test Recording]  (playback controls appear here)       │
└─────────────────────────────────────────────────────────┘
```

### Behavior

- **Refresh button** — calls `audioDevices:list`, repopulates all three device dropdowns. Device list is cached for the session; refresh is the manual override.
- **Checkbox per slot** — toggles `enabled`. Disabled slot greys out dropdown and slider.
- **Device dropdown** — populated from `audioDevices:list`. First option is "(none)". On first load with no saved config, Slot 1 auto-selects first `isMicrophone` device, Slot 2 auto-selects first `isLoopback` device.
- **Volume slider** — HTML `<input type="range">`, min 0, max 200, step 5. Label shows percentage.
- **Auto-balance checkbox** — toggles `audioMixer.autoBalance`.
- **Test Recording button** — calls `audioDevices:test`, shows spinner for 3 seconds, then renders `<audio>` element with play/pause controls. File path uses `file://` protocol.
- **Visibility** — entire section hidden when `recordingProvider !== 'local'`. Toggled by recording provider dropdown change handler.
- **Save** — each change immediately calls `appUpdateSettings({ audioSources: [...], audioMixer: {...} })`. No separate save button.

### Files modified

- `src/index.html` — new HTML section
- `src/renderer/settings.js` — wire dropdowns, sliders, checkboxes, test button, visibility toggle

## Testing

### Unit tests (`tests/unit/buildFFmpegArgs.test.js`)

- Single source: no filter_complex, plain dshow args
- Two sources: correct filter_complex with volume and amix
- Three sources: extended filter chain with 3 inputs
- Volume mapping: 0% -> 0.0, 100% -> 1.0, 200% -> 2.0
- Auto-balance on: dynaudnorm appended
- Auto-balance off: no dynaudnorm
- No enabled sources: throws error
- Disabled sources skipped in args

~10-12 test cases. Pure function, no mocks.

### Device enumeration tests

- Parse real FFmpeg dshow output: correct device list
- Identify loopback devices by keyword
- Identify microphone devices by keyword
- Empty/malformed output: empty array, no crash

### Manual verification required

This feature requires testing with real audio hardware. Unit tests validate the command builder; actual audio mixing must be verified by ear.

## Error Handling

- **No devices found** — settings UI shows "No audio devices detected. Is FFmpeg installed?" Test button disabled.
- **Selected device gone at record start** — FFmpeg fails to start, `error` event fires with `ffmpeg-error` type, toast shown.
- **Device disappears mid-recording** — FFmpeg exits non-zero, `close` handler fires `recording-ended` with exit code. Toast: "Recording stopped — an audio device was disconnected."
- **FFmpeg not installed** — `_enumerateDevices` spawn fails, caught, settings shows "FFmpeg not found."

## Files Summary

| File | Action |
|------|--------|
| `src/main/recording/buildFFmpegArgs.js` | **Create** — pure FFmpeg args builder |
| `src/main/recording/LocalProvider.js` | **Modify** — use builder, extract `_enumerateDevices` |
| `src/main.js` | **Modify** — new IPC handlers, pass audioSources config to LocalProvider |
| `src/preload.js` | **Modify** — two new IPC bridges |
| `src/index.html` | **Modify** — new audio sources UI section |
| `src/renderer/settings.js` | **Modify** — wire UI, device dropdowns, sliders, test button |
| `tests/unit/buildFFmpegArgs.test.js` | **Create** — command builder tests |
