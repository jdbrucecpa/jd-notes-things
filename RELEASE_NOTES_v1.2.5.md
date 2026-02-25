# v1.2.5 Release Notes

## Highlights

This release upgrades the transcription pipeline to AssemblyAI Universal-3 Pro with keyterms prompting and speaker identification hints, adds current user detection via Google OAuth `userinfo.email` scope, introduces fuzzy name matching in `SpeakerMatcher`, and revamps vocabulary management to global-only terms. Transcription progress is now tracked through the background task system with real-time UI updates.

---

## AssemblyAI Universal-3 Pro Support

- **Speech model upgrade**: `requestAssemblyAITranscription()` now sends `speech_models: ['universal-3-pro', 'universal-2']` with `language_detection: true` for higher accuracy with automatic fallback.
- **Keyterms prompting**: Vocabulary terms are passed as `keyterms_prompt` (up to 1,000 terms, max 6 words per phrase) instead of legacy `custom_spelling`. Falls back to converting `custom_spelling` entries to keyterms for backwards compatibility.
- **Speaker identification hints**: When `options.speakerNames` is provided (from calendar participants), names are sent via `speech_understanding.request` for AssemblyAI's speaker identification feature. Max 10 names, 35 chars each.
- **Verbatim mode**: Backend supports `options.verbatim = true` to preserve filler words (um, uh, etc.) in transcripts. No Settings UI toggle exists yet — must be enabled programmatically.
- **API constraint handling**: AssemblyAI only allows `prompt` OR `keyterms_prompt` (not both). The service prioritizes `keyterms_prompt` for better vocabulary accuracy.

## User Identity Integration

- **Google `userinfo.email` scope**: `GoogleAuth.js` now requests the `userinfo.email` scope alongside `calendar.readonly` and `contacts.readonly`, enabling reliable identification of the authenticated user.
- **`getAuthenticatedUserInfo()`**: New method in `GoogleAuth` that retrieves the current user's profile (name, email) via the Google People API `people/me` endpoint.
- **Current user speaker matching**: `SpeakerMatcher.identifyCurrentUserSpeaker()` matches transcript speakers to the authenticated user using email and name, enabling automatic "me" detection in transcripts.

## Speaker Identification Enhancements

- **`fuzzyNameMatch()`**: New method in `SpeakerMatcher` that handles name variations — case-insensitive comparison, substring containment ("John" matches "John Smith"), and first-name matching for names longer than 2 characters.
- **`identifyCurrentUserSpeaker()`**: Two-method approach: first checks all participants for email/name match against current user, then falls back to checking if the host matches the current user. Returns `{speakerLabel, confidence, method}`.
- **Email source tracking**: Speaker confidence is scored based on email resolution method — direct match yields `high` confidence, name-based match yields `medium`.

## Vocabulary Management Revamp

- **Global terms only**: Removed client-specific vocabulary handling from `vocabularyService.js`, simplifying to a single global terms list. Eliminates the complexity of per-client vocabulary that wasn't providing sufficient benefit.
- **`formatForUniversal()`**: New method that formats vocabulary terms specifically for AssemblyAI's Universal-3 Pro `keyterms_prompt` parameter, with proper term length validation.
- **Improved UI**: Updated vocabulary management interface in `settings.js` with better add/delete UX, enhanced error handling, and user notifications during term operations. Settings UI simplified from ~440 lines to ~170 lines.

## Background Task Integration

- **Transcription progress tracking**: `transcribeWithAssemblyAI()` now creates a background task via `backgroundTaskManager.addTask()` and reports progress through the upload (10%), transcription request (20%), polling (30-90%), and processing (95%) stages.
- **`setBackgroundTaskManager()`**: New method on `TranscriptionService` for dependency injection of the task manager.
- **Polling progress**: `pollAssemblyAITranscript()` now accepts a `taskId` parameter and reports incremental progress during the polling loop.

---

## Files Changed

13 files changed, +919 insertions, -559 deletions
