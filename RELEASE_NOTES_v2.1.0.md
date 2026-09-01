# v2.1.0 Release Notes

## Highlights

Major speaker-attribution accuracy release: upgraded diarization (PyAnnote community-1 with exclusive turns), a new per-utterance stem-override stage that repairs misattributed turns using the mic/system isolation tracks, and a better voice-embedding model — plus provider currency updates including an urgent AssemblyAI model retirement fix.

---

## Speaker Attribution Overhaul

- **Diarization upgraded to `pyannote/speaker-diarization-community-1`** (JD Audio Service v0.3.0): substantially better handling of rapid turn-taking, short turns, and overlapping speech than the previous 3.1 model — the failure mode behind mid-conversation speaker swaps. The transcript merge now uses the pipeline's **exclusive (non-overlapping) annotation**, built specifically for word-level alignment, so backchannel interjections ("oh for sure") get their own turns instead of being absorbed into the other speaker's.
- **New Stage 1.5: per-utterance stem overrides.** The recorder already captures the mic and system audio as separate solo tracks; a new waterfall stage compares each transcript utterance against per-100ms RMS energy on both stems and flips turns whose diarization label strongly contradicts the acoustic evidence (your voice only exists on the mic stem; remote voices only originate on the system stem). Deliberately conservative: flips require ≥80% exclusive single-stem activity, and double-talk/echo bleed blocks a flip rather than causing one. Runs in both the recording pipeline and transcription re-runs, with per-flip logging.
- **Voice embeddings upgraded to `wespeaker-voxceleb-resnet34-LM`** (~1% EER vs ~2.8% for the 2020-era `pyannote/embedding`). Embeddings from different models are not comparable, so dimension guards ensure old 512-d profiles can never garbage-match new 256-d embeddings — and existing profiles **re-enroll themselves automatically**: on the first new sample (Fix Speakers correction, backfill, or auto-enroll), the profile is re-founded in the new embedding space. Expect voice-profile matching to be weaker for a few meetings while profiles rebuild, then better than before.

---

## Transcription Providers

- **AssemblyAI model pin updated to `universal-3-5-pro`** — universal-3-pro is retired as of 2026-09-02 and pinned requests would return errors. Price label updated to $0.21/hr.
- **Deepgram now explicitly requests `nova-3`** — the request previously omitted the model parameter, silently serving Deepgram's oldest `base-general` tier. Vocabulary boosts migrated from the legacy `keywords=word:boost` syntax (unsupported on nova-3) to keyterm prompting. Price label updated to $0.26/hr.

---

## LLM Providers

- **Gemini SDK migrated to `@google/genai`** — the old `@google/generative-ai` package reached end-of-life 2025-11-30. Model lineup moved to **Gemini 3.5 Flash Lite** ($0.30/$2.50 per MTok, budget) and **Gemini 3.7 Flash** ($0.75/$3.75 intro pricing through 2026, balanced). Old model strings stored in settings or meetings map forward automatically.
- **Claude Opus 5 added** ($5.00/$25.00 per MTok) as a premium option for template summaries and regeneration.
- **Price labels corrected:** Claude Sonnet 5 is $2.00/$10.00 (labels said $3/$15), Claude Haiku 4.5 is $1.00/$5.00 (labels said $0.80/$4.00). Cost estimator tables updated to match.

---

## Dependencies

| Package | Change |
| --- | --- |
| `@google/genai` | Added (^2.20.0) |
| `@google/generative-ai` | Removed (EOL 2025-11-30) |

JD Audio Service bumped to v0.3.0 (model changes only — no Python dependency changes, no re-provisioning needed; new models download on first use).

---

## Files Changed

25 files changed, ~1,025 additions, ~173 deletions (net +852 lines)
