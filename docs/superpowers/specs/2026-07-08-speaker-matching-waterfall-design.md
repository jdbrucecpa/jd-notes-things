# Speaker Matching Waterfall — Design

**Date:** 2026-07-08 (rev 2 — robustness review + per-app capture adopted)
**Status:** Approved (JD), pending implementation
**Scope:** Local-provider recordings (v2.0 local-first stack). Recall-provider meetings keep their existing SDK-timeline path and are unaffected except where noted.

## 1. Problem

In local mode there is no Recall SDK speech timeline. Speaker matching falls
through to a positional heuristic (`SpeakerMatcher.createSpeakerMapping`) that,
lacking a host signal, assigns the earliest-appearing diarized speaker to the
user. In a 2-person meeting where the other party speaks first, the two
identities are swapped — a coin-flip presented as a `medium`-confidence match
(observed 2026-07-08: Stacie ↔ J.D. swapped).

Additionally, the already-built voice-profile stage
(`voiceProfileService.identifySpeakers`) is starved in the local flow: the
observed meeting ran with **0 calendar attendees**, so auto-enrollment could
not trigger.

## 2. Goals

- The user's own speech is identified deterministically, not guessed.
- Frequent contacts (clients) are identified automatically over time with zero
  manual enrollment effort.
- Every speaker always ends with a best-guess name (per JD's explicit
  preference — no "Unidentified" placeholders), with per-label
  `confidence` + `method` recorded so the UI and learning loop know what to
  trust.
- Manual corrections in the Fix Speakers UI make the system smarter.
- Google Contacts remains the identity-resolution layer throughout: stages
  produce person *hypotheses*; Contacts resolves them to canonical identities
  (name, email, organization, `googleContactResource`).
- Every stage degrades gracefully; worst case equals today's behavior.

## 3. Architecture

Four stages ordered by signal reliability. Each stage only touches speakers
that earlier stages have not confidently resolved. Later stages never override
earlier high-confidence results.

```
Recording (LocalProvider)
  └─ FFmpeg writes MULTIPLE outputs from one process:
     • recording-<ts>.mp3        (mixed — unchanged, feeds transcription)
     • recording-<ts>-mic.mp3    (mic-only — new, feeds Stage 1)
     • recording-<ts>-app.mp3    (meeting-app or system-only — new, feeds Stage 1)

Transcription completes (JD Audio Service: diarized segments per label,
                         diarization constrained by maxSpeakers hint)
  │
  ├─ Stage 0 · LABEL MERGE       collapse diarization labels that are the
  │                              same voice (embedding near-duplicates)
  ├─ Stage 1 · TRACK ANCHOR      which diarized speaker is the user;
  │                              which are provably remote
  ├─ Stage 2 · VOICE PROFILES    which speakers match enrolled voices (existing)
  ├─ Stage 4 · POSITIONAL        best-guess fill for anything left (existing)
  │      → transcript fully labeled immediately; confidence recorded
  │
  └─ Auto-summary step (same LLM/model as auto-summary):
     Stage 3 · CONTENT-AWARE PASS  reviews low-confidence labels against the
                                   enriched attendee roster + transcript
                                   content; reassigns where content contradicts
                                   the guess. Summary generates AFTER this pass,
                                   from corrected labels.
```

The waterfall intentionally spans two locations: Stages 0–1–2–4 run inside the
post-transcription flow (`SpeakerMatcher.matchSpeakers` and its callers), so
notes are never left with bare `Speaker 1/2` labels. Stage 3 runs later inside
the auto-summary step, per JD's instruction, using the auto-summary's
configured LLM provider/model.

**Precedence (strict):**
`track-anchor` > `voice-profile (high)` > `content-llm` > `voice-profile (medium)` > `positional`.

## 4. Recording layer: per-track capture

### 4.1 Track fallback chain

The recorder produces the mixed file (always) plus isolation tracks, best
available first:

1. **Meeting-app track (preferred).** Per-process WASAPI loopback of the
   detected meeting app, via the `application-loopback` npm package
   (per-PID `PROCESS_LOOPBACK`, Windows 10 2004+; prebuilt binaries; verified
   current at v1.2.7). The PID comes free from LocalProvider window detection
   (`windowId: "zoom-27736"` → PID 27736; capture uses
   include-process-tree mode since Zoom/Teams are multi-process). The
   existing `WasapiCapture` named-pipe + silence-pacing architecture is
   reused — process loopback emits nothing while the app is silent, the
   exact starvation problem silence pacing already solves. A new
   `AppLoopbackCapture` implements the same pipe contract.
2. **System-only submix (fallback).** When no meeting app is detected at
   record start (in-person, quick record, detection failure) or process
   capture errors: add an FFmpeg filtergraph label that mixes only the
   WASAPI loopback inputs (excluding the mic) and `-map` it to the app-track
   file. Weaker than per-app (contains system sounds) but still a valid
   remote-side reference.
3. **Mixed-only (skip Stage 1).** No isolation tracks → the waterfall starts
   at Stage 2. Never worse than today.

### 4.2 Mic track

- Second FFmpeg output: `-map <micIndex>:a` encoded to
  `recording-<ts>-mic.mp3`. `micIndex` is derived from the enabled-sources
  array (the dshow microphone source's position), NOT assumed to be 0 —
  input order follows user-configurable `audioSources`.
- Same FFmpeg process + same inputs → same timebase; diarization timestamps
  from the mixed file line up on all tracks.
- Meeting record stores `micAudioFilePath` and `appAudioFilePath` (nullable).
- If no enabled mic source exists, skip the mic output (remote-anchor still
  works from the app track).

## 5. Stage specifications

### Stage 0 — Intra-meeting label merge (new)

Diarization routinely over-splits one person into multiple labels. Before any
matching: compute per-label embeddings (already produced for Stage 2), and
merge labels whose embedding cosine distance is below a near-duplicate
threshold (tunable constant, stricter than the profile-match threshold).
Merging rewrites the segment/transcript labels so all downstream stages see
one label per voice. The `maxSpeakers` diarization hint (§7) reduces how often
this fires; Stage 0 catches the rest.

### Stage 1 — Track anchor (new: `trackAnchorService.js` in main)

**Attribution math:** decode available tracks once each to low-rate PCM
(8 kHz mono s16le) via streamed FFmpeg decode; accumulate per-segment RMS —
never hold whole files in memory. Per diarized segment compute:

- `micRMS`, `appRMS` (app = meeting-app or system-only track)
- **user dominance** = `micRMS / (micRMS + appRMS)`

Per label, aggregate over its segments **excluding double-talk segments**
(segments where BOTH tracks show high energy — overlap is where diarization
errors cluster, so those windows are noise for anchoring).

**Decision rules:**

- **User anchor:** the label with the highest mean dominance is the user only
  if it clears an absolute threshold AND a margin over the runner-up (tunable
  constants, unit-tested). Muted mic / user never spoke / ambiguous → no user
  anchor.
- **Remote anchor:** with a per-app track (not the system fallback), the
  user's voice never appears on it — Zoom/Teams render only remote audio. Any
  label with substantial app-track energy is therefore provably NOT the user,
  even when the mic anchor fails (e.g. muted mic). Remote-anchored labels are
  excluded from user assignment in all later stages.

**Output:** `{ userLabel|null, userDominance, remoteLabels[] }` passed to
`matchSpeakers` as `options.trackAnchor`. The user label maps to the user
profile identity with `confidence: 'high'`, `method: 'track-anchor'`.

### Stage 2 — Voice profiles (existing service, three fixes)

- **Plumbing fix:** ensure `calendarAttendees` (enriched via Google Contacts)
  plus the user (from user profile) always reach the local-mode
  `matchSpeakers` call. The observed `identifySpeakers: 1200 segments,
  0 attendees` starvation is a bug to fix in the transcription-complete flow
  in `main.js`.
- **Margin rule:** `findBestMatch` currently uses absolute distance
  thresholds only. Add a best-vs-second-best margin requirement: a match is
  only `high` confidence if it also beats the runner-up profile by a minimum
  separation. Prevents confident false matches between similar voices as the
  profile roster grows.
- **Anchor synergy:** the user-anchored label is excluded from client
  matching; its embedding instead enrolls/updates the *user's own* voice
  profile (create on first meeting, `addSample` + `recomputeProfile` after).
  In a 2-person meeting this leaves exactly 1 unmatched speaker + 1 unmatched
  attendee, which triggers the existing auto-enroll rule — the client roster
  builds itself.
- Matching thresholds and sample weighting are otherwise unchanged
  (`DISTANCE_HIGH_CONFIDENCE = 0.25`, `DISTANCE_MEDIUM_CONFIDENCE = 0.45`).

### Stage 3 — Content-aware pass (new, inside auto-summary)

- Runs immediately before summary generation, using the auto-summary LLM
  provider/model (inherits prompt caching).
- **Input:** labeled transcript; enriched attendee roster (names,
  organizations, emails from Google Contacts); per-label
  `{name, confidence, method}`.
- **Prompt uses an explicit cue taxonomy** (LLMs perform better with named
  evidence categories): self-identification ("this is J.D."), direct address
  ("Stacie, what do you think?" → the *next* speaker is likely Stacie), role
  asymmetry (advisor vs. client language), and organizational references
  matched against contact organizations.
- **Output contract:** structured JSON, per label → `keep` or
  `reassign(name, rationale)`. Names must come from the provided roster (the
  prompt forbids inventing identities).
- **Permissions:** may reassign `low`/`none` labels; may confirm-or-flag
  `medium`; must not touch `high`/anchored; must not assign the user identity
  to a remote-anchored label. Rule-violating reassignments are discarded at
  merge time (enforced in code, not just the prompt).
- Reassigned names resolve through Google Contacts before applying.
- On LLM error, timeout, or malformed JSON: keep existing labels, log,
  proceed to summary.

### Stage 4 — Positional heuristic (existing, unchanged logic)

- Runs right after Stages 1–2 so every label has a name immediately.
- With the anchor consuming the user (and remote-anchored labels excluded
  from user assignment), its job reduces to pairing leftover speakers with
  leftover (contact-enriched) attendees.
- Its assignments carry `confidence: 'low'`, `needsVerification: true` —
  eligible for Stage 3 review.

## 6. Google Contacts integration (cross-cutting)

- Attendee roster is enriched via `findContactsByEmails` /
  `findContactByName` **before** Stages 2–4 consume it.
- Voice profiles link to contacts via `googleContactId` (existing schema);
  auto-enrollment records the link.
- Stage 3 receives contact organizations as disambiguation evidence.
- All final assignments resolve to contact identities, driving existing
  People-page links in Obsidian.

## 7. Diarization speaker-count hint (DONE — shipped 2026-07-08)

The JD Audio Service already threads `maxSpeakers` end-to-end
(`schemas.py` → `routes.py` → `processor.py` → PyAnnote `max_speakers`), and
`transcribeWithLocal` already forwards it. The only gap was the recording
call site in `main.js`, which now passes
`maxSpeakers = max(zoomParticipants.length, calendarAttendees.length)` when
≥ 2. Constraining diarization is one of the highest-leverage accuracy
improvements available; no service API change was needed.

## 8. Learning loop

- **User profile:** anchored segments maintain the user's voice profile
  automatically (create → add samples → recompute).
- **High-confidence matches:** add sample + recompute centroid (existing
  behavior).
- **Manual corrections as training data:** when the user reassigns a speaker
  in Fix Speakers and that label has an embedding from the current meeting
  (embeddings already ride along in `speakerMapping` entries), save the
  embedding as a sample on the corrected contact's profile, creating the
  profile if new. Uses the existing voice-profile assignment IPC (requires a
  non-empty embedding array).
- **Correction telemetry:** each correction records which stage produced the
  wrong guess (`method` is already on the mapping entry; persist
  `correctedFrom: {name, method, confidence}` alongside). This turns
  corrections into threshold-tuning evidence ("track-anchor wrong twice →
  margin too loose") rather than only profile samples.
- **Historical backfill (one-time job):** existing corrected meetings are
  audio files + human-verified `speakerMapping`s. A batch job embeds
  diarized segments from those recordings and builds voice profiles for the
  user and regular clients before the waterfall ships — collapsing the
  cold-start problem so Stage 2 is effective on day one. Runs manually from
  a settings/dev entry point; idempotent (skips meetings already sampled).

## 9. Failure handling

Every stage is independently skippable; the pipeline never produces a worse
result than today's:

| Failure | Behavior |
|---|---|
| Meeting app not detected / process capture error | App track falls back to system-only submix |
| No isolation tracks at all (old recording, Recall provider) | Skip Stages 0–1 |
| Mic silent / ambiguous dominance | No user anchor; remote anchor may still apply |
| JD Audio Service down | Skip Stages 0 and 2 (as today) |
| LLM error / malformed JSON / rule violation | Skip/partially discard Stage 3 |
| Everything fails | Stage 4 labels everything (status quo) |

## 10. Phasing

1. **Phase 1 — Tracks + anchor + plumbing:** per-track recording (app-track
   chain §4.1, mic track §4.2), `trackAnchorService` with user + remote
   anchors, Stage 0 label merge, calendar-attendee/contacts plumbing fix.
   (The `maxSpeakers` hint already shipped.) Kills the swap bug at the root.
2. **Phase 2 — Learning loop:** user auto-profile from anchor,
   correction-driven enrollment, correction telemetry, historical backfill
   job, margin rule in `findBestMatch`, confidence/method badges in Fix
   Speakers.
3. **Phase 3 — Content-aware pass:** LLM review stage with cue taxonomy in
   the auto-summary step.

Each phase ships independently useful behavior and is validated by JD in real
meetings before the next begins (project convention).

## 11. Testing

- **Pure units:** dominance computation, double-talk exclusion, anchor
  decision rules (threshold + margin, remote anchor), label-merge threshold,
  precedence merge, Stage 3 permission enforcement, `findBestMatch` margin
  rule.
- **TrackAnchorService:** synthetic PCM fixtures with known loud/quiet windows;
  verify per-label dominance, double-talk exclusion, and the no-anchor cases
  (muted mic, ambiguous).
- **AppLoopbackCapture:** pipe-contract tests mirroring the existing
  WasapiCapture suite (silence pacing, stop behavior), with the native module
  mocked.
- **Stage 3:** mocked `llmService` — valid response, malformed JSON,
  rule-violating reassignment (must be discarded), user-identity-on-remote
  label (must be discarded).
- **Backfill:** fixture meetings with verified mappings → profiles created,
  idempotent on re-run.
- **Regression:** existing SpeakerMatcher (27) and VoiceProfileService (29)
  suites keep passing; positional behavior unchanged when no anchor/profiles
  exist.
- **E2E:** real two-person Zoom meeting in local mode; verify correct user
  attribution regardless of who speaks first, with both headphones and
  speaker audio.

## 12. Out of scope

- Changes to the JD Audio Service API (none needed — `maxSpeakers` was
  already supported; the mic/app tracks are analyzed Electron-side).
- Recall-provider matching pipeline (keeps SDK timeline path).
- Multi-user / multi-mic scenarios; one local user is assumed.
- Live/streaming speaker identification during the meeting (post-processing
  only).
