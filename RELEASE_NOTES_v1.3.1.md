# v1.3.1 Release Notes

## Highlights

Patch release fixing the Google OAuth flow broken by overly aggressive Content Security Policy headers, improving speaker stats matching reliability in Meeting Detail, and adding v1.3.0 release documentation.

---

## OAuth / Content Security Policy Fix

- **CSP scoped to local content only**: The production CSP headers were being applied to ALL HTTP responses, including external sites like Google's OAuth consent screen. Google's own scripts were blocked by the app's restrictive policy, causing a blank white page during sign-in. CSP is now only applied to `file://` and `http://localhost` responses — external responses pass through unmodified.

## Speaker Stats Matching

- **Robust participant-to-speaker lookup**: `findParticipantSpeakerStats()` in Meeting Detail was rewritten to handle name mismatches more gracefully. Previously it only tried `participant.name`, which can be corrupted by contact matching. Now it:
  - Tries both `name` and `originalName` fields
  - Performs bidirectional first-name matching across all name candidates
  - Does a reverse lookup via `appliedSpeakerMappings` — if a speaker was reassigned via Fix Speakers, the function finds their stats through the mapping chain (email or original name)

## Documentation

- **v1.3.0 release notes added**: `RELEASE_NOTES_v1.3.0.md` created with full documentation of the SQLite migration, Gmail integration, transcript export, OAuth upgrades, Reports view, SafeStorage migration, and testing infrastructure.
- **Release notes naming convention**: Renamed `RELEASE_NOTES_v1.2.md` → `RELEASE_NOTES_v1.2.0.md` for consistency.

---

## Files Changed

10 files changed, ~249 additions, ~39 deletions (net +210 lines)
