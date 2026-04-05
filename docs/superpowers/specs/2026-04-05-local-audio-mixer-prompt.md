# Session Prompt: Local Audio Mixer for Recording

## Problem

The LocalProvider (`src/main/recording/LocalProvider.js`) records meeting audio via FFmpeg WASAPI loopback (Stereo Mix). This only captures **system audio output** — what comes through speakers/headphones. It does NOT capture the user's microphone. This means in a meeting, only remote participants are recorded. The user's own voice is missing from the transcript. This is a critical gap in the v2.0 local recording feature.

## What Needs to Be Built

A configurable multi-source audio mixer built into the app. Instead of relying on a single "Stereo Mix" device, the user should be able to:

1. **Select a microphone source** — their primary mic input
2. **Select a system audio source** — Stereo Mix, WASAPI loopback, or any audio device
3. **Optionally add more sources** — e.g., OBS Virtual Audio, a second mic, a virtual cable (up to 4 total sources)
4. **Set volume/gain for each source independently** — so the mic isn't drowned out by system audio or vice versa
5. **FFmpeg mixes all sources into a single output file** — using `-filter_complex amix` or similar

The output is still a single MP3 file that gets sent to the transcription service (AssemblyAI, Deepgram, or JD Audio Service).

## Technical Context

### Current LocalProvider architecture

- `LocalProvider` extends `RecordingProvider` (base class with event contract)
- `_findLoopbackDevice()` — probes FFmpeg dshow for Stereo Mix / loopback devices
- `_startFFmpeg(outputPath)` — spawns FFmpeg with a single dshow audio input
- `stopRecording()` — sends 'q' to FFmpeg stdin, returns promise resolving on close
- Managed by `RecordingManager` which orchestrates providers

### Current FFmpeg command (single source)

```
ffmpeg -y -f dshow -i "audio=Stereo Mix (Realtek USB Audio)" -acodec libmp3lame -ab 128k -ar 44100 output.mp3
```

### What multi-source FFmpeg looks like

```
ffmpeg -y \
  -f dshow -i "audio=Stereo Mix (Realtek USB Audio)" \
  -f dshow -i "audio=SteelSeries Sonar - Microphone (SteelSeries Sonar Virtual Audio Device)" \
  -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=longest[out]" \
  -map "[out]" -acodec libmp3lame -ab 128k -ar 44100 output.mp3
```

For 3+ sources, extend the filter chain:
```
-filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[2:a]volume=0.6[a2];[a0][a1][a2]amix=inputs=3:duration=longest[out]"
```

### Available audio devices on this system (for reference)

```
"SteelSeries Sonar - Microphone (SteelSeries Sonar Virtual Audio Device)" (audio)
"Stereo Mix (Realtek USB Audio)" (audio)
"SteelSeries Alias Pro Input (2- SteelSeries Alias Pro 1)" (audio)
```

Device enumeration: `ffmpeg -list_devices true -f dshow -i dummy 2>&1`

## What Needs to Change

### Settings UI (new section in General settings)

A "Local Recording Sources" section that appears when recording provider is "local":

- **Device list** — enumerate available dshow audio devices via FFmpeg
- **Source slots** — at least 2 (mic + system), up to 4 total
  - Each slot: device dropdown + volume slider (0-200%, default 100%) + enable/disable toggle
  - Slot 1 default: first microphone device found
  - Slot 2 default: Stereo Mix / loopback device (existing `_findLoopbackDevice` logic)
- **Test button** — record 3 seconds, play back, so user can verify levels before a real meeting
- **Device refresh button** — re-enumerate devices without restarting app

### LocalProvider changes

- `_startFFmpeg` must accept an array of audio sources with volumes
- Build the FFmpeg command dynamically based on configured sources
- If only one source configured, skip the amix filter (simpler command)
- Store audio source config in `app-settings.json` (not localStorage)

### IPC

- `audioDevices:list` — enumerate dshow audio devices (call FFmpeg, parse output)
- `audioDevices:test` — record 3 seconds from configured sources, return the file path for playback
- Source config stored in appSettings, read by LocalProvider at recording start

### Files to modify/create

- `src/main/recording/LocalProvider.js` — multi-source FFmpeg spawning
- `src/main.js` — new IPC handlers for device enumeration and test recording
- `src/preload.js` — IPC bridges
- `src/index.html` — audio source configuration UI section
- `src/renderer/settings.js` — wire audio source UI, device dropdowns, volume sliders
- Tests for the FFmpeg command builder (pure function, no Electron deps)

### Things to preserve

- Single-source mode must still work (backward compat for users with no mic)
- `_findLoopbackDevice()` logic is still useful as the default for slot 2
- The `RecordingProvider` interface doesn't change — `startRecording`/`stopRecording` contract stays the same
- Output format stays MP3 (128kbps, 44100Hz) for transcription service compatibility

## Key Design Decisions to Make

1. **Where to build the FFmpeg command** — pure function that takes `[{device, volume}]` and returns the args array? Easy to test.
2. **Device enumeration caching** — devices don't change often, cache for the session with a refresh button
3. **Auto-balancing / normalization** — The user wants automatic volume balancing across sources so a loud system audio doesn't drown out a quiet mic. FFmpeg has several options:
   - `dynaudnorm` — dynamic audio normalizer, adjusts volume in real-time per-frame. Good for leveling out sources that vary in loudness. Can sound "pumpy" if parameters aren't tuned.
   - `loudnorm` — EBU R128 loudness normalization. Better quality but designed for post-processing (two-pass). Single-pass mode exists but is less accurate.
   - `compand` — compressor/expander, can boost quiet signals and limit loud ones. Most flexible but hardest to configure.
   - Per-source `volume` filter + `amix` with `normalize=1` (default) — amix already normalizes by dividing by the number of inputs. Combined with per-source volume sliders, this may be sufficient.
   - **Recommended approach:** Start with `amix normalize=1` + per-source volume sliders as the baseline. Add a "Auto-balance" toggle that applies `dynaudnorm` to the mixed output with sensible defaults (e.g., `dynaudnorm=f=150:g=15:p=0.95`). Let the user disable it if it sounds bad. This keeps the FFmpeg command manageable and gives users control.
4. **Error handling** — if a device disappears mid-recording (USB mic unplugged), FFmpeg crashes. The recording-ended handler already handles this, but we should surface a clear error.

## Codebase Reference

- **CLAUDE.md** — full project overview, architecture, tech stack
- **LocalProvider** — `src/main/recording/LocalProvider.js` (353 lines)
- **RecordingManager** — `src/main/recording/RecordingManager.js` (orchestrator)
- **RecordingProvider** — `src/main/recording/RecordingProvider.js` (base class)
- **Settings UI pattern** — `src/renderer/settings.js` + `src/index.html` (Service Endpoints section is a good template)
- **IPC pattern** — `src/preload.js` bridges, `src/main.js` handlers, Zod validation in `src/main/validation/ipcSchemas.js`
- **v2.0 design spec** — `docs/superpowers/specs/2026-04-05-jd-audio-service-autolaunch.md` (recent example of spec format)

## Session Instructions

1. Use the brainstorming skill to finalize the design (UI layout, settings schema, FFmpeg filter chain specifics)
2. Write the implementation plan
3. Implement via subagent-driven development
4. Test with actual audio devices — this feature MUST be manually verified with real hardware, not just unit tests
