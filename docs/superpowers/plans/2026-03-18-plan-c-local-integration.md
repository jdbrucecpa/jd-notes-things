# Plan C: Local Integration — Decision Document

> **Status:** Not yet implemented. Detailed task plan to be written when Plans A and B are complete.
> **Depends on:** Plan A (JD Audio Service running) + Plan B (recording abstraction in place).
> **Spec:** `docs/superpowers/specs/2026-03-18-v2-local-first-design.md` — Components 3, 4, 5, 6

**Goal:** Wire the JD Audio Service into the Electron app — local transcription provider, voice profile system, LocalLLMAdapter, and settings UI for mix-and-match provider selection.

---

## Scope

This plan connects everything together. It depends on the AI service being runnable (Plan A) and the recording abstraction being in place (Plan B). It covers 4 components from the spec.

## Key Decisions Made During Design

### 1. Local Transcription Provider

- New `'local'` entry in the transcription service strategy map.
- Calls `POST /process` on the JD Audio Service (configurable URL, default `localhost:8374`).
- Returns the same `{ text, entries[], provider, confidence, audio_duration }` shape as AssemblyAI/Deepgram.
- Health check before transcription — if service is down, show user-facing error with guidance.
- Recording files always preserved regardless of transcription outcome.
- Timeout: `duration_seconds * 0.5 + 60` seconds.

### 2. Voice Profile System

**Database (schema version 4):**
- `voice_profiles` table — id, google_contact_id, contact_name, contact_email, embedding (BLOB), sample_count, total_duration, confidence, timestamps.
- `voice_samples` table — id, profile_id, meeting_id (TEXT FK), embedding (BLOB), duration, timestamp.
- Embedding format: 256-d float vector, little-endian Float32Array buffer, cosine distance metric.

**Post-meeting identification flow:**
1. `POST /process` returns transcript with Speaker 1/2/3 labels.
2. `POST /embed-speakers` extracts voice fingerprint per speaker cluster.
3. `POST /identify-speakers` compares against stored profiles (profiles sent from Electron, service is stateless).
4. Apply matches → hybrid enrollment.

**Hybrid enrollment:**
- High-confidence voice match (distance < 0.25): auto-apply, silently update profile.
- High-confidence calendar match (one candidate): auto-enroll, show "new voice profile" badge.
- Low confidence / ambiguous: prompt user in participant list.
- Unknown: show as "Unknown Speaker" with manual assignment option.

**Integration with existing UI:**
- Lives in participant list / Fix Speakers modal — not a new screen.
- Adds voice profile confidence indicator, "new voice profile" badge, manual contact assignment.
- Profiles linked to Google Contacts for portability.

**SpeakerMatcher changes:**
- New Stage 0 (voice profiles) added before existing stages.
- Existing stages 1-3 untouched.

### 3. LocalLLMAdapter

- Rename `OllamaAdapter` → `LocalLLMAdapter`.
- Endpoint-agnostic: configurable base URL (default `localhost:11434`).
- Auto-discovers models via `GET /api/tags` (Ollama) or `GET /v1/models` (OpenAI-compatible).
- Tries both endpoints, uses whichever responds.
- Works transparently with Ollama, LM Studio, or any OpenAI-compatible server.

### 4. Settings UI

New "Providers" section in settings:
- Recording provider dropdown (requires restart).
- Transcription provider dropdown (hot-swap).
- Per-task summarization dropdowns (auto-summary, templates, patterns — hot-swap, same as existing).
- Service endpoint URL fields with live connection status indicators.
- "Fully Local" preset button — sets all layers to local at once.

### 5. Upgrade Path v1.4 → v2.0

- New tables added via schema version 4 migration.
- Recall-specific fields in meetings table left in place (just unused for local recordings).
- Voice profiles start empty — system learns voices from first meeting after upgrade.
- All settings default to current cloud providers (no behavior change on upgrade).

## Tasks (to be detailed in full plan)

1. Add schema version 4 migration (voice_profiles + voice_samples tables)
2. Create VoiceProfileService — CRUD for profiles, embedding averaging, confidence scoring
3. Add `'local'` transcription provider to transcriptionService.js
4. Implement post-meeting voice identification flow (embed → identify → enroll)
5. Integrate voice profiles into SpeakerMatcher as Stage 0
6. Update participant list UI — voice profile indicators, enrollment prompts
7. Rename OllamaAdapter → LocalLLMAdapter, add endpoint auto-discovery
8. Add provider selection UI to settings panel
9. Add service endpoint URL fields with live status indicators
10. Add "Fully Local" preset button
11. Test: local transcription with mocked AI service
12. Test: voice profile enrollment and identification flow
13. Test: LocalLLMAdapter with Ollama and LM Studio endpoints
14. Test: settings UI provider switching
15. E2E: full local pipeline (record → transcribe → identify speakers → summarize → Obsidian)

## Open Questions for Implementation

- **Embedding model pinning:** The spec says `pyannote/wespeaker-voxceleb-resnet34-LM` (256-d). Verify this is the actual model returned by `pyannote/embedding` at implementation time. If dimensions differ, update thresholds.
- **Profile re-computation performance:** When correcting a misidentification, all samples must be re-averaged. For a contact with 50+ meetings, this could be slow. Consider caching or incremental averaging.
- **Voice profile backup/restore:** The existing backup/restore system handles SQLite. Voice profile BLOBs will be included automatically, but verify the backup file size impact.
