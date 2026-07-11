# v2.0.0 Release Notes

## Highlights

**v2.0 makes JD Notes Things fully local-first.** Every cloud dependency — recording, transcription, and summarization — now has a completely local alternative, while all cloud providers remain fully functional. Any layer can independently use local or cloud, and an **"Apply Fully Local"** preset flips the entire stack with one click. This release adds local FFmpeg/WASAPI recording (Zoom, Teams, **and Google Meet**), local transcription via the new JD Audio Service (Whisper large-v3-turbo), local LLM summarization (Ollama/LM Studio), a full **voice-profile speaker-identification** system with a learning loop, **YouTube URL import**, and a refactor that cleanly separates vault export from the old Obsidian-CRM extras.

Because the local stack replaces the areas the v1.4.x hotfixes touched, v2.0 supersedes and becomes the new `main`.

---

## Local-First Architecture

- **Every layer switchable**: Recording, transcription, and summarization each independently choose a local or cloud provider. Mix and match freely (e.g. local recording + cloud summary).
- **"Apply Fully Local" preset**: One button in Settings sets recording → Local (FFmpeg/WASAPI), transcription → Local (JD Audio Service), and summarization → Local (Ollama/LM Studio).
- **Local-first defaults**: Fresh installs default recording and transcription to the local providers.
- **Provider settings consolidated**: `recordingProvider` is stored in the main process `app-settings.json` (single source of truth); `transcriptionProvider` persists in renderer `localStorage`.

## Local Recording (FFmpeg + WASAPI)

- **Recording provider abstraction**: New `RecordingProvider` base class, `RecordingManager` orchestrator, and two implementations — `RecallProvider` (Recall.ai SDK) and `LocalProvider` (local capture). Providers **hot-swap without an app restart**.
- **WASAPI output-loopback capture**: `WasapiCapture` streams system-audio output devices into FFmpeg over blocking named pipes via `native-recorder-nodejs`.
- **Silence-pacing (critical reliability fix)**: A silent WASAPI source used to starve FFmpeg on its blocking pipe read, producing a 0-byte, unplayable recording *and* a stuck stop. `WasapiCapture` now keeps each pipe fed at the device's real-time byte rate (real PCM when present, zero-filled silence for the deficit), so recordings are never empty and stop is reliable. `LocalProvider.stopRecording` force-kills FFmpeg as a safety net if the `q` quit doesn't land in ~2.5s.
- **Multi-source mixing**: `buildFFmpegArgs` is a pure, unit-tested function that mixes mic + one or more system/WASAPI sources, with null-device and mixer guards.
- **Local Recording Sources UI**: Device dropdowns, per-source volume sliders, WASAPI output-device selection, and a "test recording" button, all in Settings.
- **Isolation tracks**: `LocalProvider` can emit separate **app**, **mic**, and **system** submix tracks, plus **per-process app audio capture** (`application-loopback`) to a paced WAV — feeding cleaner audio to diarization while isolating app-loopback failures from the main recording.

## Google Meet Local Recording

- **Meet detection**: The local recorder detects Google Meet running in a Chrome/Edge tab and captures it like a native meeting window.
- **Meet lifecycle**: Resolver rules give Meet a proper start/stop lifecycle; Meet now stops like Zoom/Teams (see the stop-confirmation dialog below), with a **browser-exit backstop** so closing the browser reliably ends the recording. An app-capture verification probe confirms the Chrome window tree is being captured.

## Recording Lifecycle & Stop Confirmation

- **Window-absent auto-stop, gated by a countdown dialog**: When a meeting window disappears, instead of immediately stopping, the app shows a **stop-confirmation countdown dialog** so a brief window flicker (screen-share transitions, tab switches) no longer kills a live recording. A dedicated confirmation window with its own assets was added.
- **Race hardening**: Immediate re-probe before emitting `meeting-closed`, hardened stop-confirm window races, graceful quit mid-recording, a Zoom screen-share hold, and recording-state resync between main and renderer.

## Local Transcription (JD Audio Service)

- **New local provider**: `TranscriptionService` gains a Local provider backed by the **JD Audio Service** — a separate Python FastAPI app running Whisper large-v3-turbo (faster-whisper / CTranslate2) + wav2vec2 alignment + PyAnnote diarization + speaker embeddings. Default endpoint `http://localhost:8374`.
- **Speaker-embedding handoff**: The local provider returns diarization labels and PyAnnote speaker embeddings, wired straight into the speaker-identification waterfall.
- **`recallai` transcription provider removed**: The broken Recall.ai transcription path was deleted; recording via Recall.ai is unaffected.
- **Re-run & import**: The local provider is selectable in the re-run and transcript-import UIs.

## JD Audio Service Auto-Launch

- **Lifecycle manager**: New `AIServiceManager` auto-launches the JD Audio Service when local transcription is selected and shuts it down on app quit.
- **Settings controls**: A Start button and a service-path input let you point at and launch the service from within the app.

## Local LLM Summarization

- **`LocalLLMAdapter`** (renamed from `OllamaAdapter`): Dual endpoint discovery auto-detects models from **either** Ollama (`/api/tags`) or LM Studio (`/v1/models`). Default endpoint `http://localhost:11434`.
- **Unified model listing**: All model discovery goes through `local:listModels`; Ollama-specific backward-compat aliases were removed.

## Voice Profiles & Speaker Identification

- **Database schema v4**: New `voice_profiles` and `voice_samples` tables. Storage is **dimension-agnostic** (embedding length derived from the incoming vector, not hardcoded).
- **`VoiceProfileService`**: Embedding math (cosine distance, centroid), CRUD, and a `findBestMatch` identification flow with a **margin rule** that suppresses confident near-tie matches.
- **Voice-profile settings panel**: Manage profiles, see a **mic-verified badge**, manually assign speakers, and run a **historical backfill** that mines corrected transcripts to enroll voices retroactively (with per-identity skip and separate rejected-sample accounting).
- **Learning loop**: "Fix Speakers" corrections record telemetry (**which waterfall stage the user overrode**), enroll the corrected voice, and persist the corrected mapping. Correction samples are weighted by actual speech duration, with a sample-poisoning guard and an auto-enroll duration floor.
- **Anchor synergy**: A user enrolling from an anchored label unblocks 1+1 auto-enrollment; anchor results thread into voice matching and resolve email-as-name displays.
- **Dedup funnel**: `upsertProfileSample` funnels all sample writes through one path (case-insensitive email identity) so assignment no longer duplicates profiles.
- **Schema v5**: De-dupes `voice_samples` with a unique `(profile_id, meeting_id)` index and upsert; centroids use a recency window (newest 50 samples); F1 re-embeds on embedding-less corrections. Speaker-mapping extras (embeddings) now survive DB rehydration.

## Speaker-Matching Waterfall

A multi-stage pipeline in `SpeakerMatcher`, run on both first transcription and re-runs:

- **Stage 0 — Voice profiles + diarization merge**: Match PyAnnote embeddings against stored profiles; chain-merge diarization labels through multi-hop resolution.
- **Stage 1 — Track anchors**: A track-anchor service establishes user + remote anchors from isolation tracks and **outranks** voice-profile results; remote-label exclusion holds through positional pairing.
- **Stage 2 — AssemblyAI supplementary** and **Stage 3 — Heuristics** (count-based, first speaker, most talkative), as before.
- **Stage 3 — Content-aware pass + intelligent titling**: A content pass can rename mislabeled speakers and suggest a meeting title from the transcript (model-supplied topic is sanitized and length-capped). Stage 3 reassignments persist on the auto-summary path, and fresh names flow into the regenerated summary.

## YouTube URL Import

- **Import a YouTube video as a meeting**: Paste a URL and the app downloads the audio via **yt-dlp**, maps video metadata to meeting fields, transcribes, and routes it to `content/youtube`.
- **Robust, tested pipeline**: Strict `parseVideoId`, exact yt-dlp arg builders, a download-progress line parser, `checkBinary` + `fetchMetadata` (via injected `spawn` for testability), and `downloadAudio` + `importFromUrl` orchestration behind a `youtube:import` IPC handler.
- **UI**: An Import-from-YouTube menu item, toolbar button, and modal; imported meetings show a **YouTube platform icon** in the meeting list.
- **Title protection**: A `contentPassGate` protects user/metadata-supplied titles from the Stage 3 rename + title-suggestion pass for YouTube content.
- **Timecoded transcripts for templates**: Transcript segments fed to the LLM are now prefixed with a real `[HH:MM:SS]` timecode (`formatSegmentTimecode`), so timestamp-oriented templates cite real moments instead of hallucinating times.
- **Template split**: The Content Mining template is now long-form only; a new **YouTube Shorts Clips** template owns short-form clip timestamps.

## Vault Export Refactor (Obsidian-CRM Divorce)

- **Removed the Obsidian-CRM plugin integration** and the OCRM dual-path system.
- **No more auto-created contact/company pages**: The manual contact/company page-creation UI, IPC, methods, and templates were removed. Meeting markdown now uses **plain names and relative links** instead of CRM-style page links.
- **Unified slug generation**: A single shared `slugify` helper powers meeting filenames and transcript downloads.
- **Vault vocabulary**: "Export / Publish to Obsidian" is renamed **"→ to Vault"**, and dead vault-path helpers were dropped.

## Routing

- **Fully DB-driven**: `addOrganization`, `addEmailsToOrganization`, and mapped-domain lookups were rewired from `routing.yaml` to the database; dead `routing.yaml` artifacts were removed.
- **Local-recording routing**: Local recordings route via speaker-mapping emails; manual-override paths no longer inject a stray `/meetings/` segment.

## Security & Fixes

- **Dev/prod key isolation**: Fixed `SafeStorageKeyManager` reading production keys while in dev mode (path must resolve lazily, after `app.setPath` switches userData).
- **Auto-updater restored**: `update-electron-app` re-added; the About page shows a **dynamic** version (read from `app.getVersion()` at runtime), and SDK logs persist.
- **v1.4.7–v1.4.9 hotfixes backported** into the v2.0 restructure so no earlier fix regressed.

---

## Dependency Changes

### New
| Package | Version | Purpose |
|---------|---------|---------|
| `native-recorder-nodejs` | ^1.2.0 | WASAPI output-loopback capture via named pipes |
| `application-loopback` | ^1.2.7 | Per-process app audio capture (isolation tracks) |
| `update-electron-app` | ^3.1.2 | Auto-update from GitHub Releases |

### Updated
| Package | From | To |
|---------|------|-----|
| `electron` (dev) | ^40.6.1 | ^43.1.0 (Node 24 runtime, native ABI 148) |
| `@anthropic-ai/sdk` | ^0.78.0 | ^0.110.0 |
| `archiver` | ^7.0.1 | ^8.0.0 (ESM-only; factory shim in backup/export services) |
| `googleapis` | ^171.4.0 | ^173.0.0 |
| `marked` | ^17.0.3 | ^18.0.5 |
| `js-yaml` | ^4.1.0 | ^5.2.1 |
| `copy-webpack-plugin` (dev) | ^13.0.1 | ^14.0.0 |
| `eslint-plugin-security` (dev) | ^3.0.1 | ^4.0.1 |
| `globals` (dev) | ^16.5.0 | ^17.7.0 |
| `@rolldown/binding-win32-x64-msvc` (dev) | — | ^1.1.4 (added; Vitest 4.1+ rolldown binding on Windows) |

### Removed (code-level, not packages)
- **`recallai` transcription provider** — deleted from `TranscriptionService`.
- **Obsidian-CRM plugin integration** — removed along with the contact/company page-creation system.

---

## Files Changed

126 files changed, ~32,719 additions, ~6,417 deletions (net +26,302 lines) since v1.4.9.

### Notable New Files
| File | Purpose |
|------|---------|
| `src/main/recording/RecordingProvider.js`, `RecordingManager.js`, `RecallProvider.js`, `LocalProvider.js` | Recording provider abstraction + local capture |
| `src/main/recording/WasapiCapture.js` | WASAPI loopback capture via named pipes |
| `src/main/services/voiceProfileService.js` | Voice profile CRUD, embedding math, speaker ID |
| `src/main/services/aiServiceManager.js` | JD Audio Service lifecycle (auto-launch/kill) |
| `src/main/integrations/SpeakerMatcher.js` (waterfall) | Multi-stage speaker identification |
| `src/main/services/youtube*` + import UI | YouTube URL import pipeline |
| `config/templates/youtube-shorts-clips.txt` | New short-form clip template |

### Notable Removed Files
| File | Reason |
|------|--------|
| Obsidian-CRM integration + contact/company page templates | Vault-export divorce |
| `recallai` transcription path | Provider removed |

---

## Upgrade Notes

- **Auto-update**: Installed clients update automatically from the GitHub Release built by the `v2.0.0` tag.
- **Fully local usage** requires the separate [JD Audio Service](https://github.com/jdbrucecpa/jd-audio-service) (NVIDIA GPU + CUDA) for transcription and an Ollama/LM Studio server for summarization. Cloud providers continue to work with no local setup.
- **Database migrates automatically** to schema v5 on first launch (v4 voice tables → v5 sample de-dupe).
