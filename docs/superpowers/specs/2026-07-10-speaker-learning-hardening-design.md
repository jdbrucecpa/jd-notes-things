# Speaker-Learning Hardening — Design

**Date:** 2026-07-10
**Status:** Approved by JD (chat), pending spec review
**Branch:** v2.0

## Problem

Three deliberate deferrals from the speaker-waterfall Phase 2/3 work, now due
before the v2.0 release:

1. **F1 correction gap.** When JD fixes a speaker via Fix Speakers, the
   learning hook enrolls a voice sample only if the corrected label still has
   a persisted embedding. Labels matched by track-anchor, auto-match, or left
   pending often carry no embedding, so the correction teaches nothing. Worse,
   `voiceProfileBackfill` skips any meeting that already has samples — so a
   meeting whose samples came only from OTHER speakers never contributes the
   corrected voice.
2. **No sample cap.** Profiles average all samples forever (JD's profile: 143
   samples). Past some count the centroid barely moves, so drift (new mic, new
   room) takes too long to absorb.
3. **No uniqueness constraint.** `voice_samples` deduplication per meeting is
   by convention (`countVoiceSamplesForMeeting`), not enforced by the schema.

## Design

### 1. F1 fix — re-embed on embedding-less corrections

In the Fix Speakers learning hook (main.js, `speakerMapping:applyToMeeting`):
when a correction's label has no usable embedding AND the meeting's audio file
is resolvable, run a one-meeting re-embed for the corrected speaker instead of
silently skipping:
- Build segments for the corrected label from the meeting transcript (reuse
  `voiceProfileBackfill.synthesizeSegments` — it already handles legacy
  missing end-timestamps and the 90s/speaker cap).
- Call the existing JD Audio Service embed endpoint (same dependency the
  backfill uses) for just those segments, then feed the result through
  `upsertProfileSample` with the correction's contact identity and real
  duration. Poisoning guard applies as usual.
- Async and non-blocking: failures log a warning; the correction itself is
  never blocked by embedding work. Skip silently when the local audio service
  is unreachable or audio is missing (cloud-only meetings).

Backfill change: replace the meeting-level skip (`countVoiceSamplesForMeeting
> 0`) with a per-identity skip — a meeting is only skipped for identities that
already contributed a sample from it (requires the per-profile lookup below).
Meetings whose samples came from other speakers are revisited for the missing
ones.

### 2. Sample cap — recency window for the centroid

`voiceProfileService.recomputeProfile` (or equivalent centroid computation)
uses only the **most recent 50 samples** per profile (`MAX_CENTROID_SAMPLES =
50`, ordered by created_at). Older samples stay in the table (history/audit)
but stop influencing the centroid. No deletion. Confidence display keeps using
total sample count.

### 3. Schema v5 — uniqueness + lookup support

Migration to schema v5 in `databaseService.js`:
- `CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_samples_profile_meeting ON
  voice_samples(profile_id, meeting_id)` — enforces one sample per profile per
  meeting.
- Pre-migration cleanup: delete duplicate rows (keep the newest per
  profile+meeting pair) before creating the index, so the migration cannot
  fail on existing data.
- `upsertProfileSample` switches to `INSERT ... ON CONFLICT(profile_id,
  meeting_id) DO UPDATE` (replace the embedding/duration with the newer one),
  making re-corrections idempotent at the DB layer.
- New query `getSampledProfileIdsForMeeting(meetingId)` to support the
  backfill per-identity skip in §1.

NOTE (global rule): verify the actual current `voice_samples` schema from the
database before writing the migration — column names/nullable-ness in this
spec must be confirmed against `PRAGMA table_info(voice_samples)` at
implementation time.

## Non-Goals

- Margin tuning (`DISTANCE_MATCH_MARGIN`): stays data-driven — watch
  correction telemetry after release; JD's own margin-demotion already
  resolved itself after backfill.
- Threading `googleContactResource` through the Fix Speakers schema: dropped
  for now (cosmetic enrichment, not learning-critical).
- No UI changes beyond existing Voice Profiles panel counts.

## Testing

- Unit: F1 hook — correction without embedding triggers re-embed path with
  synthesized segments and upserts with real duration; unreachable service →
  warning, correction still applied. Backfill per-identity skip: meeting with
  samples for A only gets embedded again for B, not A.
- Unit: centroid uses newest 50 of 60 samples (verify oldest excluded).
- Unit: migration dedupes then enforces uniqueness; upsert-on-conflict
  replaces rather than duplicates; `countVoiceSamplesForMeeting` still
  correct.
- Manual: run backfill again after migration — expect additional samples from
  previously-skipped meetings (per-identity revisit), zero constraint errors.
