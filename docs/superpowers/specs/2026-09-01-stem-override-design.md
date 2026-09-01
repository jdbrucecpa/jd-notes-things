# Stage 1.5: Per-Utterance Stem Override — Design

**Date:** 2026-09-01
**Status:** Approved-in-principle (JD asked to build "#5" after the community-1 diarization upgrade; design decisions below were made autonomously and are flagged for review)

## Problem

Diarization sometimes files an individual turn into the wrong speaker cluster
(e.g. a JD turn labeled as the remote participant during rapid back-and-forth).
The existing track anchor (Stage 1, `trackAnchorService.js`) identifies which
*cluster* is the user and which are remote, but cannot repair a single
misfiled turn. The recorder already captures the evidence needed to catch
this: a raw mic stem and a system/loopback stem. The user's voice only exists
on the mic stem; remote voices only *originate* on the system stem.

## Solution

A new Stage 1.5 in the speaker waterfall: after Stage 1 computes the anchor,
re-examine each transcript utterance against per-100ms RMS windows of the two
stems and flip the utterance's speaker label when the acoustic evidence
*strongly* contradicts it.

### Decision rules (conservative by design)

For each utterance with word timings (span = first word start → last word end):

- **Skip** unless BOTH stems decoded, the anchor found a `userLabel`, and the
  utterance is ≥ 0.5s long. Windows are classified per-stem as active when
  RMS > 10% of that stem's p95 (same floor as Stage 1).
- **micOnlyFrac** = fraction of the utterance's windows where mic is active and
  app is not; **appOnlyFrac** = the reverse. Double-talk windows (both active
  — including echo bleed) and silent windows count toward the denominator
  only, diluting both fractions. This is the echo-bleed safety: bleed turns
  windows into double-talk, which *blocks* flips rather than causing them.
- **Flip remote→user** when the utterance is not labeled `userLabel`,
  micOnlyFrac ≥ 0.8, and appOnlyFrac ≤ 0.05.
- **Flip user→remote** when the utterance is labeled `userLabel`,
  appOnlyFrac ≥ 0.8, micOnlyFrac ≤ 0.05, AND the remote target is
  unambiguous: exactly one anchor remote label, or failing that exactly one
  non-user label in the transcript. With 2+ remote speakers the true target
  is unknowable from stems — leave the label alone.

### Components

- `computeUtteranceOverrides(transcript, anchor, micWindows, appWindows)` —
  pure function in `trackAnchorService.js`, returns `[{index, from, to}]`.
  Word times are seconds (local-provider format); anything malformed simply
  produces no flip.
- `computeTrackAnchorWithOverrides(trackPaths, segments, transcript)` —
  orchestrator that decodes each stem ONCE, computes the Stage 1 anchor and
  the Stage 1.5 overrides, returns `{anchor, overrides}`.
  `computeTrackAnchor` remains exported and unchanged for compatibility.
- Both waterfall call sites in `main.js` (recording pipeline and
  transcription re-run) switch to the combined function and apply the flips
  to the transcript before `matchSpeakers` runs, with one log line per flip.

### Deliberate non-goals

- `meeting.segments` is left untouched — it remains the diarizer's raw
  output. Voice-profile sampling reads segments, so a wrong flip can never
  pollute a stored voice profile.
- Cloud transcription providers (AssemblyAI/Deepgram) are unaffected: the
  stage runs only inside the existing `transcriptionProvider === 'local'`
  guard, and only local entries carry word timings.
- Recall.ai recordings have no stems; `computeTrackAnchorWithOverrides`
  degrades exactly like Stage 1 (returns null anchor, no overrides).

## Known downsides (accepted)

1. **False flips are possible** if a stem is mislabeled or thresholds prove
   too loose in practice. Mitigated by the 0.8/0.05 fractions, double-talk
   dilution, and per-flip logging so bad flips are diagnosable. Thresholds
   are exported constants, tunable like Stage 1's.
2. Adds one more stage to the waterfall (complexity). Mitigated by keeping
   the decision logic pure and unit-tested.
3. Utterance labels can diverge from raw segment labels post-flip. Accepted:
   the transcript is the user-facing artifact; segments are acoustic ground
   truth.

## Testing

Vitest unit tests over the pure function using the existing `windows()`
helper pattern from `trackAnchorService.test.js`: clean flip both directions,
no-flip on echo bleed/double-talk, no-flip on short/ambiguous/multi-remote
cases, missing-stem and missing-anchor skips.
