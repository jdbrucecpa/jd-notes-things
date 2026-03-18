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
- PyInstaller (bundle into standalone .exe)
- CUDA for GPU acceleration

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
  async stopRecording(recordingId)    // → audioFilePath
  async shutdown()
}

// Events:
'meeting-detected'   { windowId, platform, title }
'meeting-closed'     { windowId }
'recording-started'  { recordingId, windowId }
'recording-ended'    { recordingId, audioFilePath }
'participant-joined' { windowId, participant }       // RecallProvider only
'speech-activity'    { windowId, participantId, speaking, timestamp }  // RecallProvider only
'error'              { type, message }
```

### RecallProvider

Extracts the existing ~800 lines of Recall.ai SDK event handlers from `main.js` into a dedicated class. Same behavior as today, just behind the interface. Emits all events including `participant-joined` and `speech-activity`.

### LocalProvider

- **Meeting detection:** Window title monitoring via PowerShell (poll every 2 seconds)
  - Zoom: detect `Zoom Meeting` / `Zoom Webinar` window titles
  - Teams: detect Microsoft Teams call window state
  - Patterns borrowed from OpenWhispr's detection approach
- **Audio capture:** FFmpeg subprocess capturing system audio loopback
  - Writes MP3 to `%APPDATA%/jd-notes-things/recordings/`
  - Same output path pattern as Recall SDK
- **Meeting close:** Window monitoring detects meeting window disappearing
- **Participants:** NOT available in real-time — no `participant-joined` or `speech-activity` events emitted. Participants resolved post-meeting from calendar + voice profiles.

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

Setting in UI: `Recording Provider: [Recall.ai SDK | Local]`. Stored in settings, read at app startup. Switching requires app restart.

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

### Database Schema (new tables)

```sql
CREATE TABLE voice_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  google_contact_id  TEXT,           -- links to Google Contact resource
  contact_name    TEXT NOT NULL,      -- display name
  contact_email   TEXT,               -- primary email
  embedding       BLOB NOT NULL,      -- averaged voice embedding vector (float32 array)
  sample_count    INTEGER DEFAULT 1,  -- number of meetings contributing to profile
  total_duration  REAL DEFAULT 0,     -- total seconds of speech used to build profile
  confidence      REAL DEFAULT 0.5,   -- profile quality score (more samples = higher)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE voice_samples (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  meeting_id      INTEGER REFERENCES meetings(id),
  embedding       BLOB NOT NULL,      -- per-meeting embedding for this speaker
  duration        REAL DEFAULT 0,     -- seconds of speech in this meeting
  created_at      TEXT NOT NULL
);
```

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

### Removed (dead code / unused)
- Webhook server (`server.js`) — Express on port 13373, localtunnel, Svix signature verification. Only consumer was Recall.ai async transcription which is already broken.
- Recall.ai transcription provider (`recallai` entry in transcription providers map) — `uploadRecording()` has been broken, never used in practice.
- Upload token creation flow (`createDesktopSdkUpload()` and associated Recall.ai API calls)
- `RECALL_WEBHOOK_SECRET` credential — no longer needed without webhook server
- Dependencies: `express`, `localtunnel`, `svix` (if no other consumers)

### Future Removal (NOT in v2.0)
- Recall.ai SDK dependency (after local recording is validated)
- `RECALLAI_API_KEY`, `RECALLAI_API_URL` credentials

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
