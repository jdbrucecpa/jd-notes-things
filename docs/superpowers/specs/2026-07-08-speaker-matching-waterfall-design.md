# Speaker Matching Waterfall — Design

**Date:** 2026-07-08
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
  └─ FFmpeg writes TWO outputs from one process:
     • recording-<ts>.mp3        (mixed — unchanged, feeds transcription)
     • recording-<ts>-mic.mp3    (mic-only — new, feeds Stage 1)

Transcription completes (JD Audio Service: diarized segments per label)
  │
  ├─ Stage 1 · MIC ANCHOR        which diarized speaker is the user
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

The waterfall intentionally spans two locations: Stages 1–2–4 run inside
`SpeakerMatcher.matchSpeakers` immediately after transcription (as today), so
notes are never left with bare `Speaker 1/2` labels. Stage 3 runs later inside
the auto-summary step, per JD's instruction, using the auto-summary's
configured LLM provider/model.

**Precedence (strict):**
`mic-anchor` > `voice-profile (high)` > `content-llm` > `voice-profile (medium)` > `positional`.

## 4. Stage specifications

### Stage 1 — Mic anchor (new)

**Recording change** (`buildFFmpegArgs.js`, `LocalProvider.js`):
- Add a second FFmpeg output in the same process: `-map <micIndex>:a` encoded
  to `recording-<ts>-mic.mp3` alongside the mixed file. `micIndex` is derived
  from the enabled-sources array (the dshow microphone source's position), NOT
  assumed to be 0 — input order follows user-configurable `audioSources`.
  Same process + same inputs → same timebase; diarization timestamps from the
  mixed file line up on the mic file.
- Store `micAudioFilePath` on the meeting record.
- If no enabled mic source exists (loopback-only fallback config), skip the
  second output and the stage.

**Attribution** (new `src/main/services/micAnchorService.js`):
- Decode mic and mixed tracks once each to low-rate PCM (8 kHz mono s16le) via
  streamed FFmpeg decode; accumulate per-segment sums — do not hold whole
  files in memory.
- Per diarized segment: RMS on both tracks. Per speaker label: mean
  **mic dominance** = `micRMS / (micRMS + mixedRMS)` across its segments.
- Rationale: when the user speaks, the mic carries the signal (ratio high).
  When the remote party speaks — including through speakers with acoustic
  bleed — their voice is attenuated on the mic but full-strength in the mix
  (ratio low). Works for headphones, speakers, and mixed setups.
- **Decision rule:** the top label is anchored as the user only if it clears an
  absolute dominance threshold AND a margin over the runner-up (both tunable
  constants, unit-tested). Muted mic / user never spoke / ambiguous → no
  anchor; fall through.
- Output `{ speakerLabel, dominance }` is passed to
  `SpeakerMatcher.matchSpeakers` as `options.micAnchor`; that label maps to the
  user profile identity with `confidence: 'high'`, `method: 'mic-anchor'`.

### Stage 2 — Voice profiles (existing service, two fixes)

- **Plumbing fix:** ensure `calendarAttendees` (enriched via Google Contacts)
  plus the user (from user profile) always reach the local-mode
  `matchSpeakers` call. The observed `identifySpeakers: 1200 segments,
  0 attendees` starvation is a bug to fix in the transcription-complete flow
  in `main.js`.
- **Anchor synergy:** the mic-anchored label is excluded from client matching;
  its embedding instead enrolls/updates the *user's own* voice profile
  (create on first meeting, `addSample` + `recomputeProfile` after). In a
  2-person meeting this leaves exactly 1 unmatched speaker + 1 unmatched
  attendee, which triggers the existing auto-enroll rule — the client roster
  builds itself.
- Matching thresholds, sample weighting, and auto-enroll logic are unchanged
  (`DISTANCE_HIGH_CONFIDENCE = 0.25`, `DISTANCE_MEDIUM_CONFIDENCE = 0.45`).

### Stage 3 — Content-aware pass (new, inside auto-summary)

- Runs immediately before summary generation, using the auto-summary LLM
  provider/model (inherits prompt caching).
- **Input:** labeled transcript; enriched attendee roster (names,
  organizations, emails from Google Contacts); per-label
  `{name, confidence, method}`.
- **Output contract:** structured JSON, per label → `keep` or
  `reassign(name, rationale)`. Names must come from the provided roster (the
  prompt forbids inventing identities).
- **Permissions:** may reassign `low`/`none` labels; may confirm-or-flag
  `medium`; must not touch `high`/`mic-anchor`. Rule-violating reassignments
  are discarded at merge time (enforced in code, not just the prompt).
- Reassigned names resolve through Google Contacts before applying, so the
  final mapping carries canonical email/identity.
- On LLM error, timeout, or malformed JSON: keep existing labels, log,
  proceed to summary.

### Stage 4 — Positional heuristic (existing, unchanged logic)

- Runs right after Stages 1–2 so every label has a name immediately.
- With the anchor consuming the user, its job reduces to pairing leftover
  speakers with leftover (contact-enriched) attendees.
- Its assignments carry `confidence: 'low'`, `needsVerification: true` —
  eligible for Stage 3 review.

## 5. Google Contacts integration (cross-cutting)

- Attendee roster is enriched via `findContactsByEmails` /
  `findContactByName` **before** Stages 2–4 consume it.
- Voice profiles link to contacts via `googleContactId` (existing schema);
  auto-enrollment records the link.
- Stage 3 receives contact organizations as disambiguation evidence.
- All final assignments resolve to contact identities, driving existing
  People-page links in Obsidian.

## 6. Learning loop

- **User profile:** mic-anchored segments maintain the user's voice profile
  automatically (create → add samples → recompute).
- **High-confidence matches:** add sample + recompute centroid (existing
  behavior).
- **Manual corrections as training data:** when the user reassigns a speaker
  in Fix Speakers and that label has an embedding from the current meeting
  (embeddings already ride along in `speakerMapping` entries), save the
  embedding as a sample on the corrected contact's profile, creating the
  profile if new. Uses the existing voice-profile assignment IPC (requires a
  non-empty embedding array).

## 7. Failure handling

Every stage is independently skippable; the pipeline never produces a worse
result than today's:

| Failure | Behavior |
|---|---|
| No mic file (old recording, Recall provider, loopback-only config) | Skip Stage 1 |
| Mic silent / ambiguous dominance | No anchor; fall through |
| JD Audio Service down | Skip Stage 2 (as today) |
| LLM error / malformed JSON / rule violation | Skip/partially discard Stage 3 |
| Everything fails | Stage 4 labels everything (status quo) |

## 8. Phasing

1. **Phase 1 — Anchor + plumbing:** two-track recording, `micAnchorService`,
   mic-anchor stage in `SpeakerMatcher`, calendar-attendee/contacts plumbing
   fix. Kills the swap bug at the root.
2. **Phase 2 — Learning loop:** user auto-profile from anchor,
   correction-driven enrollment, confidence/method badges in Fix Speakers.
3. **Phase 3 — Content-aware pass:** LLM review stage in the auto-summary
   step.

Each phase ships independently useful behavior and is validated by JD in real
meetings before the next begins (project convention).

## 9. Testing

- **Pure units:** dominance computation, anchor decision rule (threshold +
  margin), precedence merge, Stage 3 permission enforcement.
- **MicAnchorService:** synthetic PCM fixtures with known loud/quiet windows;
  verify per-label dominance and the no-anchor cases (muted mic, ambiguous).
- **Stage 3:** mocked `llmService` — valid response, malformed JSON,
  rule-violating reassignment (must be discarded).
- **Regression:** existing SpeakerMatcher (27) and VoiceProfileService (29)
  suites keep passing; positional behavior unchanged when no anchor/profiles
  exist.
- **E2E:** real two-person Zoom meeting in local mode; verify correct user
  attribution regardless of who speaks first.

## 10. Out of scope

- Per-application audio capture (separate future project; see memory note
  `project_per_app_audio_capture`).
- Changes to the JD Audio Service API (mic track is analyzed Electron-side).
- Recall-provider matching pipeline (keeps SDK timeline path).
- Multi-user / multi-mic scenarios; one local user is assumed.
