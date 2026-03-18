# v2.0 Design Spec: Local-First Recording, Transcription & Speaker Identification

**Date:** 2026-03-18
**Branch:** v2.0
**Status:** Draft

## Goal

Add a fully local alternative to every cloud dependency in the recording → transcription → summarization pipeline, while keeping all existing cloud providers functional. Any layer can independently use local or cloud providers. The local stack should be **equal or better** than the current Recall.ai + AssemblyAI + Claude stack — no significant downgrades accepted.

## Non-Goals

- Real-time streaming transcription (future feature — design for extensibility but don't build it)
- Managing Ollama/LM Studio from within this app (just connect to them)
- Removing any existing cloud providers (that's a future version)
- Redesigning the Obsidian vault structure, routing engine, or template system
- Multi-platform support (Windows-first, same as today)

## Architecture Overview

### Layer Model

Each layer in the pipeline has independent provider selection:

```
Recording           Transcription         Summarization
├─ Recall.ai SDK    ├─ AssemblyAI         ├─ Claude
├─ Local (v2.0)     ├─ Deepgram           ├─ Gemini
                    ├─ Local (v2.0)        ├─ Local LLM (v2.0)
```

Any combination works. A "Fully Local" preset sets all layers to local at once.

### What Stays the Same

- Obsidian vault structure, two-file architecture
- Routing engine (email → organization → folder)
- Template system
- Google Calendar + Contacts integration
- Database schema (extended with new tables, existing tables unchanged)
- IPC communication patterns
- Build system (Webpack + Electron Forge)
- All cloud provider credentials and functionality

---

## Component 1: JD Audio Service (New Standalone App)

### Identity

A standalone installable Python service, separate from the Electron app. Runs as a Windows system tray application with start/stop behavior identical to Ollama on Windows.

### Runtime Model

- Windows system tray app (start/stop manually from tray icon)
- FastAPI server on configurable port (default `localhost:8374`)
- Models load on demand on first request
- Models auto-unload after configurable idle timeout (default 5 minutes)
- Zero GPU usage when idle (~50MB system RAM for the Python process)
- Manual unload available via tray icon or API endpoint

### GPU Memory Budget

| Model | VRAM | When Loaded |
|-------|------|-------------|
| Parakeet TDT 0.6B | ~1.5 GB | During transcription |
| PyAnnote diarization 3.1 | ~0.5 GB | During diarization |
| PyAnnote embedding | ~0.3 GB | During speaker embedding |
| **Total peak** | **~2.3 GB** | |

Models load sequentially during processing and auto-unload after idle timeout. Cold load penalty is ~10-15 seconds (still faster than current cloud round-trip of 30-60 seconds).

### API Surface

```
POST /process
  Body: { audioPath, options: { speakerNames?, minSpeakers?, maxSpeakers?, vocabulary? } }
  Returns: {
    text: string,
    entries: [{ speaker, text, timestamp, words }],
    segments: [{ speaker, start, end }],
    duration: number
  }
  Notes: Full pipeline — transcribe + diarize + merge in one call.
         This is what the Electron app calls for normal meeting processing.

POST /transcribe
  Body: { audioPath, options: { vocabulary? } }
  Returns: { text, entries: [{ text, timestamp, words }], duration }
  Notes: Transcription only, no diarization. For debugging or future streaming.

POST /diarize
  Body: { audioPath, numSpeakers?, minSpeakers?, maxSpeakers? }
  Returns: { segments: [{ speaker, start, end }] }
  Notes: Diarization only. For debugging or future separate processing.

POST /embed-speakers
  Body: { audioPath, segments: [{ speaker, start, end }] }
  Returns: { embeddings: [{ speaker, vector: float[], duration }] }
  Notes: Extract voice fingerprint per speaker cluster.

POST /identify-speakers
  Body: { embeddings: [{ speaker, vector }], profiles: [{ name, vector }] }
  Returns: { matches: [{ speaker, name, confidence, distance }] }
  Notes: Compare embeddings against stored profiles. Stateless — profiles
         sent from Electron app, not stored in service.

POST /unload
  Returns: { status: "unloaded", vramFreed }
  Notes: Manually free GPU memory.

GET /health
  Returns: { status, modelsLoaded, vramUsed, engineVersion }

GET /models
  Returns: { transcription: ["parakeet-tdt-0.6b-v2"], diarization: ["pyannote-3.1"], embedding: ["pyannote-embedding"] }
```

### Technology Stack

- Python 3.11+
- FastAPI + uvicorn
- NVIDIA NeMo (Parakeet TDT 0.6B V2)
- PyAnnote audio 3.1 (diarization pipeline)
- PyAnnote embedding (speaker voice fingerprints)
- pystray (Windows system tray)
- CUDA for GPU acceleration

### Packaging

For v2.0 (personal use), the AI service runs from a Python virtual environment with a batch file launcher (similar to ComfyUI). This avoids the significant complexity of PyInstaller bundling with CUDA/PyTorch dependencies. A future version could use PyInstaller or conda-pack for a more polished installer if distribution to others is needed.

Setup: `pip install -r requirements.txt` in a venv, then `run-jd-audio-service.bat` creates the system tray icon and starts the FastAPI server.

### Design Principles

- **Stateless** — processes audio and returns results. Does not store profiles, meetings, or any persistent data. The Electron app owns all state.
- **Generic** — no knowledge of Obsidian, routing, or JD Notes concepts. Could be reused by other apps.
- **Lazy loading** — models only load when needed, unload when idle.

### Model Management

- Models downloaded on first run (one-time setup, ~3GB total)
- Stored in `%APPDATA%/JDAudioService/models/`
- `/models` endpoint reports what's available

---

## Component 2: Recording Layer Abstraction

### RecordingProvider Interface

Both Recall and Local implement the same contract:

```javascript
class RecordingProvider extends EventEmitter {
  async initialize(config)
  async startRecording(options)       // → recordingId
  async stopRecording(recordingId)    // → audioFilePath (resolved after file finalized)
  async shutdown()
  getState()                          // → { recording: bool, meetingDetected: bool, activeRecordings: Map }
}

// Events (all providers):
'meeting-detected'   { windowId, platform, title }
'meeting-closed'     { windowId }
'recording-started'  { recordingId, windowId }
'recording-ended'    { recordingId, audioFilePath }
'error'              { type, message }

// Events (RecallProvider only — LocalProvider does not emit these):
'participant-joined' { windowId, participant }
'speech-activity'    { windowId, participantId, speaking, timestamp }
```

### Orchestration Boundary

The **RecordingProvider** owns: meeting detection, audio capture, recording lifecycle, and provider-specific state (SDK handles, FFmpeg processes, etc.).

The **orchestrator** (new `RecordingManager` class extracted from main.js) owns: active recording tracking (`activeRecordings` map), meeting-to-note association, widget/tray UI updates, calendar integration, and deciding when to auto-start recording. The orchestrator listens to provider events and coordinates the rest of the app.

This separation means the orchestrator code is shared between RecallProvider and LocalProvider — only the recording mechanics differ.

### RecallProvider

Extracts the existing Recall.ai SDK event handlers from `main.js` into a dedicated class. Wraps `RecallAiSdk.init()`, `startRecording()`, `stopRecording()`, and all `addEventListener()` calls. Recall-specific concerns like `prepareDesktopAudioRecording()`, upload tokens, and the SDK restart workaround stay inside this class. Same behavior as today, just behind the interface. Emits all events including `participant-joined` and `speech-activity`.

### LocalProvider

**Meeting Detection** — Window title monitoring via PowerShell (poll every 2 seconds):
- **Zoom:** Detect windows matching `Zoom Meeting` or `Zoom Webinar` in title (substring match). Zoom desktop client changes window title from "Zoom Workplace" to include meeting name when in a call.
- **Teams:** Detect Microsoft Teams windows in call state. Teams 2.0 (new Teams) shows titles like `"Meeting with Tim | Microsoft Teams"` or contact name for 1:1 calls. Match on `" | Microsoft Teams"` suffix combined with process name `ms-teams.exe`.
- **Google Meet:** Not supported in v2.0 local recording. Google Meet runs in browser tabs, making reliable window-title detection impractical (active tab title changes, multiple tabs). Users who need Google Meet should use RecallProvider. This is acceptable given <10% usage and declining.
- Meeting close detected when monitored window title reverts or window disappears.
- Patterns borrowed from OpenWhispr's detection approach.

**Audio Capture** — WASAPI loopback via FFmpeg:
- Windows 10+ WASAPI loopback allows capturing system audio output without third-party drivers.
- FFmpeg invocation: `ffmpeg -f dshow -i audio="<loopback-device>" -codec:a libmp3lame -q:a 2 output.mp3`
- The loopback device is enumerated at startup via `ffmpeg -list_devices true -f dshow -i dummy`.
- If no loopback device is available, fall back to virtual audio cable (document in setup guide).
- Writes MP3 to `%APPDATA%/jd-notes-things/recordings/local-{timestamp}.mp3`
- FFmpeg spawned as child process; recording stops by sending `q` to stdin (graceful shutdown, ensures file is flushed and finalized).

**Recording Lifecycle:**
1. Meeting detected → FFmpeg subprocess spawned, begins writing MP3
2. User stops recording OR meeting window closes → `q` sent to FFmpeg stdin
3. FFmpeg exits (flush + finalize MP3) — Electron waits for exit event
4. Electron verifies file exists and size > 0
5. Electron calls AI service `POST /process` with absolute file path
6. Recording file retained in recordings directory (user can configure cleanup)

**Participants:** NOT available in real-time — no `participant-joined` or `speech-activity` events emitted. Participants resolved post-meeting from calendar + voice profiles.

### Capability Comparison

| Capability | RecallProvider | LocalProvider |
|-----------|---------------|--------------|
| Meeting detection | Yes | Yes |
| Audio recording (MP3) | Yes | Yes |
| Meeting close detection | Yes | Yes |
| Real-time participants | Yes | No (calendar attendees shown instead) |
| Real-time speech timeline | Yes | No |
| Post-meeting speaker ID | Via SpeakerMatcher SM-1 | Via voice profiles (better over time) |

### Provider Selection

Setting in UI: `Recording Provider: [Recall.ai SDK | Local]`. Stored in settings, read at app startup. **Switching recording provider requires app restart** (provider initializes once with OS-level resources). Transcription and LLM providers can be hot-swapped at any time without restart (same as today).

---

## Component 3: Local Transcription Provider

### Integration

New `'local'` provider added to transcription service strategy map:

```javascript
this.providers = {
  assemblyai: (audioPath, options) => this._transcribeAssemblyAI(audioPath, options),
  deepgram:   (audioPath, options) => this._transcribeDeepgram(audioPath, options),
  local:      (audioPath, options) => this._transcribeLocal(audioPath, options),      // new
  // recallai provider removed — was already broken (uploadRecording() non-functional)
}
```

### `_transcribeLocal()` Flow

1. Call `POST /process` on JD Audio Service with audio file path and options
2. Receive merged transcript + diarization result
3. Normalize to the same `{ text, entries[], provider, confidence, audio_duration }` shape that all consumers expect

### Options Passed

```javascript
{
  speakerNames: ['Tim', 'Sarah'],  // from calendar participants (hint for diarization)
  minSpeakers: 2,
  maxSpeakers: 6,
  vocabulary: ['Obsidian', 'YAML'] // custom terms for accuracy
}
```

### Transcription Engine

v2.0 ships with Parakeet TDT 0.6B V2 only. The API abstraction allows adding Whisper or other engines later without Electron app changes — just a new model in the AI service.

---

## Component 4: Voice Profile System

### Database Schema (new tables — schema version 4)

```sql
CREATE TABLE voice_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  google_contact_id  TEXT,           -- links to Google Contact resource
  contact_name    TEXT NOT NULL,      -- display name
  contact_email   TEXT,               -- primary email
  embedding       BLOB NOT NULL,      -- averaged embedding vector (see Embedding Format below)
  sample_count    INTEGER DEFAULT 1,  -- number of meetings contributing to profile
  total_duration  REAL DEFAULT 0,     -- total seconds of speech used to build profile
  confidence      REAL DEFAULT 0.5,   -- profile quality score (more samples = higher)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE voice_samples (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  meeting_id      TEXT REFERENCES meetings(id),  -- TEXT to match meetings table PK type
  embedding       BLOB NOT NULL,      -- per-meeting embedding for this speaker
  duration        REAL DEFAULT 0,     -- seconds of speech in this meeting
  created_at      TEXT NOT NULL
);
```

Added as schema version 4 migration in `databaseService.js` (current is version 3).

### Embedding Format

- **Model:** `pyannote/wespeaker-voxceleb-resnet34-LM` (or whichever model `pyannote/embedding` resolves to at implementation time — pin in AI service config)
- **Dimension:** 256-d float vector (verify against chosen model at implementation)
- **Serialization:** Little-endian Float32Array buffer stored as BLOB. Read/write in Node.js via `Buffer.from(float32Array.buffer)` and `new Float32Array(buffer.buffer)`.
- **Distance metric:** Cosine distance (0 = identical, 2 = opposite). Thresholds:
  - `< 0.25` — high confidence match (auto-apply)
  - `0.25 - 0.45` — medium confidence (suggest to user)
  - `> 0.45` — no match
- **Profile averaging:** When adding a new sample, recompute profile embedding as weighted average of all samples by duration. Longer speech segments contribute more to the profile.
- Thresholds are initial estimates — calibrate during testing and store as configurable constants.

### Why Separate voice_samples

- Profile embedding is the *average* of all samples — accuracy improves with each meeting
- Individual samples allow re-computation if a misidentification is corrected
- Provides audit trail: which meetings contributed to a profile

### Post-Meeting Speaker Identification Flow

```
Recording ends → MP3 file ready
  ↓
POST /process → transcript with "Speaker 1", "Speaker 2" labels + segments
  ↓
POST /embed-speakers → voice fingerprint per speaker cluster
  ↓
Load stored voice_profiles from SQLite
  ↓
POST /identify-speakers → matches: [{speaker, name, confidence, distance}]
  ↓
Apply matches to transcript entries
  ↓
Hybrid enrollment for unmatched speakers (see below)
```

### Hybrid Enrollment

- **High-confidence voice match** (distance < 0.25): Auto-apply name, silently add new sample to profile. No user action.
- **High-confidence calendar match** (one unambiguous candidate for unmatched speaker): Auto-enroll — create voice profile linked to Google Contact. Show in participant list as "Tim Peyser (new voice profile)".
- **Low-confidence or ambiguous**: Show in participant list with prompt: "Speaker 3 — could be Sarah Chen or Dave Wilson. Which?" User picks, profile created/updated.
- **Completely unknown**: Show as "Unknown Speaker" with option to manually assign a contact.

### Integration with Existing UI

Enrollment lives in the existing participant list / Fix Speakers modal — not a new screen. The participant list gains:
- Voice profile confidence indicator per speaker
- "New voice profile" badge for auto-enrolled speakers
- Manual assignment option links to Google Contacts

### SpeakerMatcher Changes

New Stage 0 added before existing stages:

```
Stage 0: Voice Profile Match (LOCAL MODE ONLY) — highest confidence
Stage 1: SDK Speech Timeline (RECALL MODE ONLY)
Stage 2: AssemblyAI Speaker Identification (cloud transcription only)
Stage 3: Calendar + Contacts Heuristics (both modes)
```

### Comparison: Voice Profiles vs SDK Speech Timeline

| Signal | Current (Recall SM-1) | Local (Voice Profiles) |
|--------|----------------------|----------------------|
| Primary method | Temporal correlation (2s window) | Biometric voice matching |
| First meeting accuracy | Medium | Medium (calendar fallback) |
| Recurring speaker accuracy | Same as first | **High — voice recognized** |
| Works without calendar | Poorly | **Yes — recognizes known voices** |
| Improves over time | No | **Yes** |

---

## Component 5: Local LLM Adapter

### Changes

Rename existing `OllamaAdapter` → `LocalLLMAdapter`. Make it endpoint-agnostic:

- Takes a configurable base URL (default `http://localhost:11434`)
- Auto-discovers available models via `GET /api/tags` (Ollama format) or `GET /v1/models` (OpenAI-compatible format)
- Tries both discovery endpoints, uses whichever responds
- Works transparently with Ollama, LM Studio, or any OpenAI-compatible server
- User switches between servers by changing the URL in settings

### No Other LLM Changes

- Anthropic, Gemini adapters unchanged
- Factory pattern (`createLLMServiceFromPreference`) extended to handle local LLM preferences
- Per-task provider selection (auto-summary, templates, patterns) works the same

---

## Component 6: Settings UI

### New "Providers" Section

```
┌─ Recording ──────────────────────────────────────┐
│  Provider:  [Local ▼]  [Recall.ai SDK ▼]        │
│  (requires app restart to switch)                │
└──────────────────────────────────────────────────┘

┌─ Transcription ──────────────────────────────────┐
│  Provider:  [Local ▼]  [AssemblyAI ▼]            │
│  Engine:    [Parakeet TDT 0.6B ▼]  (if Local)   │
└──────────────────────────────────────────────────┘

┌─ Summarization ──────────────────────────────────┐
│  Auto-summary:  [Claude Sonnet ▼]                │
│  Templates:     [Local LLM ▼]                    │
│  Patterns:      [Gemini Flash Lite ▼]            │
└──────────────────────────────────────────────────┘

┌─ Service Endpoints ──────────────────────────────┐
│  AI Service:  [http://localhost:8374         ]   │
│  Local LLM:   [http://localhost:11434        ]   │
│  Status: ● Connected  (Parakeet ready)           │
│  Status: ● Connected  (llama3.3:latest)          │
└──────────────────────────────────────────────────┘

[ ★ Apply "Fully Local" Preset ]
```

### Behavior

- Each layer independently selectable
- Status indicators ping `/health` and `/v1/models` endpoints
- "Fully Local" preset sets all layers to local at once
- Settings stored in localStorage (same pattern as existing LLM preferences)
- Cloud API keys remain in Security settings panel (unchanged)

---

## What Changes in v2.0

### Added
- JD Audio Service (new standalone Python app)
- `LocalProvider` recording class (window monitoring + FFmpeg)
- `local` transcription provider (calls AI service)
- Voice profile system (DB tables + enrollment + identification)
- `LocalLLMAdapter` (endpoint-agnostic, replaces `OllamaAdapter`)
- Provider selection Settings UI with "Fully Local" preset

### Refactored (Still Works)
- Recall.ai SDK code extracted from `main.js` into `RecallProvider` class
- `SpeakerMatcher` gains Stage 0 (voice profiles), existing stages untouched

### Kept As-Is
- Recall.ai SDK dependency and all credentials
- AssemblyAI provider and credentials
- Deepgram provider and credentials
- All cloud LLM providers (Claude, Gemini)
- All API key management (Windows Credential Manager)
- Obsidian vault structure, routing, templates, calendar, contacts

### Refactored (server.js split)
- `server.js` currently hosts BOTH the webhook server AND Stream Deck WebSocket support. Split into:
  - **Removed:** Webhook routes, localtunnel tunnel, Svix signature verification, Recall.ai upload endpoints
  - **Kept:** Stream Deck WebSocket handling — moved to new `src/main/services/streamDeckService.js`. Express kept solely as WebSocket upgrade host for Stream Deck (or replaced with bare `ws` module if Express is no longer needed).

### Removed (dead code / unused)
- Webhook routes and handlers from `server.js`
- localtunnel integration
- Svix signature verification
- Recall.ai transcription provider (`recallai` entry in transcription providers map) — `uploadRecording()` has been broken, never used in practice.
- Upload token creation flow (`createDesktopSdkUpload()` and associated Recall.ai API calls)
- `RECALL_WEBHOOK_SECRET` credential — no longer needed without webhook server
- Dependencies: `localtunnel`, `svix` (Express may be kept for Stream Deck or replaced with `ws`)

### Future Removal (NOT in v2.0)
- Recall.ai SDK dependency (after local recording is validated)
- `RECALLAI_API_KEY`, `RECALLAI_API_URL` credentials

---

## Failure Modes & Error Handling

### AI Service Unavailable
- Before calling `/process`, Electron pings `GET /health`. If unreachable, show user-facing error: "JD Audio Service is not running. Start it from the system tray, or switch to cloud transcription in Settings."
- Recording files are ALWAYS preserved regardless of transcription outcome. The user can retry transcription later or switch providers.

### AI Service Crashes Mid-Processing
- HTTP request to `/process` will timeout or return error.
- Electron retries once. If still failing, saves the recording with status `transcription_failed` and notifies the user.
- User can retry from the meeting list (existing "Re-transcribe" functionality).

### GPU Unavailable (VRAM exhausted, driver crash)
- AI service catches CUDA errors and returns HTTP 503 with descriptive error.
- Electron shows: "GPU unavailable — close other GPU applications and retry, or switch to cloud transcription."
- AI service does NOT attempt CPU fallback automatically (too slow to be useful for meetings). User must resolve GPU issue or switch providers.

### Fallback Strategy
- If local transcription fails for any reason, the recording file still exists. User can switch transcription provider to AssemblyAI in settings and re-transcribe from the meeting page. No data is ever lost.
- The mix-and-match architecture means a failure in one layer doesn't cascade — a local recording can be sent to cloud transcription if needed.

### Timeouts
- `/process` endpoint: timeout set to `duration_seconds * 0.5 + 60` seconds. A 60-minute meeting should process in ~30-45 seconds on a 5090, but allow generous margin.
- `/embed-speakers`: 30 second timeout (lightweight operation).
- `/identify-speakers`: 5 second timeout (pure math, no GPU).

## Processing Time Estimates

| Meeting Duration | Transcription (Parakeet) | Diarization (PyAnnote) | Total (warm) | Total (cold start) |
|-----------------|-------------------------|----------------------|-------------|-------------------|
| 15 min | ~3-5s | ~2-3s | ~8s | ~20s |
| 30 min | ~5-8s | ~3-5s | ~15s | ~27s |
| 60 min | ~10-15s | ~5-8s | ~30s | ~42s |
| 90 min | ~15-20s | ~8-12s | ~40s | ~52s |

Estimates based on 5090 GPU. 4070 laptop: multiply by ~1.5-2x.
Cold start adds ~12s for model loading (one-time per session).
All estimates significantly faster than current AssemblyAI cloud round-trip (30-90s depending on duration + upload time).

## Upgrade Path: v1.4 → v2.0

- Existing meetings, participants, transcripts, and speaker mappings are untouched.
- New `voice_profiles` and `voice_samples` tables added (schema version 4 migration).
- Recall-specific fields in meetings table (`upload_token`, `sdk_upload_id`, `recall_recording_id`) are left in place — they're just unused for new local recordings.
- Voice profiles start empty — the system begins learning voices from the first meeting after upgrade. No retroactive processing of old recordings (audio files may have been deleted).
- All existing settings preserved. New provider settings default to current cloud providers (no behavior change on upgrade).

---

## Quality Scorecard: Local vs Cloud

| Capability | Current (Cloud) | v2.0 (Local) | Verdict |
|-----------|----------------|--------------|---------|
| Meeting detection | Recall SDK | Window monitoring | Equivalent |
| Audio quality | SDK capture (MP3) | System audio loopback (MP3) | Equivalent |
| Transcription accuracy | AssemblyAI ~5% WER | Parakeet ~6% WER | Near-equivalent |
| Transcription speed | 30-60s (upload + process) | 10-15s cold / instant warm | **Better** |
| Speaker diarization | AssemblyAI + SDK timeline | PyAnnote 3.1 | Equivalent |
| Speaker ID (first meeting) | SDK participants + calendar | Calendar + heuristics | Slight downgrade |
| Speaker ID (recurring) | Same as first meeting | Voice profile recognition | **Better** |
| Summarization quality | Claude/Gemini | Depends on local model | Depends on model |
| Privacy | Audio sent to cloud | Everything local | **Better** |
| Cost | Per-minute API fees | Zero marginal cost | **Better** |
| Real-time participants | Yes (SDK events) | No (calendar shown instead) | Downgrade (mitigated) |

---

## Design Influences

- **OpenWhispr** (MIT) — Electron meeting detection via process monitoring (same tech stack)
- **OpenTranscribe** (OSS) — Voice profile architecture with cross-file speaker matching
- **WhisperX** (BSD-2) — Whisper + PyAnnote diarization pipeline pattern
- **Ollama** — Service deployment model (system tray, start/stop, lazy model loading)
