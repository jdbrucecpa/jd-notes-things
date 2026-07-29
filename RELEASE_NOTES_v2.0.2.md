# v2.0.2 Release Notes

## Highlights

Fixes the chronic **"Unknown Speaker (SPEAKER_01)" meeting titles**: speaker identification was correctly pairing the remote speaker with an attendee, but a fallback stage overwrote the name before the title was composed. Also hardens YouTube imports against stale PATH and local recording against malformed window-poll output.

---

## Speaker Naming (fixes "Unknown Speaker" meeting titles)

- **Root cause:** when the voice-profile stage auto-enrolled a speaker (exactly one unmatched speaker paired with exactly one unmatched attendee), the result carried confidence `'enrolled'` — which the matcher never counted as "matched." The heuristic fallback then saw the label as unmatched, found the enrollee's email already assigned (so its participant pool was empty), and stamped `Unknown Speaker (SPEAKER_01)` over the correct name. The Stage 3 content pass then picked that placeholder as the most-talkative participant and baked it into the meeting title. Nearly every 2-person meeting since the speaker waterfall shipped was affected.
- **Fix:** auto-enrolled results now count as matched — later stages can no longer clobber them. Titles now read e.g. `Paul Shepherd - M&A Integration And Leadership Succession`.
- **Defense in depth:** the content pass now refuses to use placeholder names (`Unknown Speaker (...)` or raw `SPEAKER_NN` labels) as the title's main participant. A meeting whose remote speaker is genuinely unidentified falls back to the legacy content-based title suggestion instead of baking the placeholder into the title and vault filename.
- **Cosmetic:** topic title-casing preserves short all-caps acronyms — "M&A" and "RIA" no longer become "M&a" / "Ria".

## YouTube Import (fixes yt-dlp not found)

- **WinGet path resolution:** packaged GUI apps often inherit a stale PATH without per-user WinGet shims. `yt-dlp` is now resolved via known WinGet install locations (Links shims and Packages directories) before falling back to bare PATH lookup.

## Local Recording

- **Window-poll robustness:** the window-monitor poll now tolerates raw control characters embedded in the PowerShell JSON output (e.g. window titles containing control chars) instead of failing the parse and dropping the poll cycle.

## Docs

- Added design spec for the local audio service setup wizard (`docs/superpowers/specs/2026-07-22-audio-service-installer-design.md`).

---

## Files Changed

- `src/main/integrations/SpeakerMatcher.js` — auto-enrolled results counted as matched
- `src/main/services/contentAwarePass.js` — placeholder-name guard; acronym-preserving title case
- `src/main/services/youtubeImport.js`, `src/main.js` — yt-dlp WinGet path resolution
- `src/main/recording/LocalProvider.js` — control-char-tolerant window-poll JSON parsing
- Tests: 4 suites extended (SpeakerMatcher, contentAwarePass, youtubeImport, LocalProvider)

10 files changed, ~496 additions, ~24 deletions (net +472 lines)

---

## Upgrade Notes

- Installed clients auto-update from GitHub Releases.
- Already-processed meetings keep their existing titles; the fix applies when a meeting's summary is generated. Rename affected meetings manually via the meeting detail pencil icon.
