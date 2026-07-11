# YouTube URL Import & Transcription — Design

**Date:** 2026-07-10
**Status:** Design approved by JD (chat); spec pending his review
**Branch:** v2.0

## Problem

JD wants to paste a YouTube URL from his own channel and get the same
deliverables a recorded meeting gets: diarized transcript with speaker names,
exec auto-summary, optional template summaries, vault export. Today the only
audio entry points are live recordings and the transcript-file Import Wizard
(text only — `ImportManager` parses transcript files, it has no audio branch).

## Decisions (JD)

- URL-paste only. Channel-name browsing/video picker is explicitly out of
  scope (revisit only if pasting URLs proves annoying).
- Vault destination: a dedicated `content/youtube/` folder under the vault
  root — channel transcripts live together, outside the client tree.
- Own-channel content only (personal use; no rights issue).

## Design

### 1. UI

- "Import from YouTube" action: a menu entry plus a button alongside the
  existing Import Wizard entry point.
- A small modal: URL text field + Import button. Accepted URL shapes:
  `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>`
  (query params tolerated). Invalid input → inline error, no IPC call.
- Renderer rule: dynamic DOM via createElement/textContent only.

### 2. Download module — `src/main/services/youtubeImport.js` (new)

Dependency-injected and unit-testable (same pattern as `correctionReembed`).
Responsibilities:
- **Binary check:** spawn `yt-dlp --version` (PATH convention, same as
  ffmpeg). Missing → structured error; UI shows "yt-dlp not found — install
  with `winget install yt-dlp`".
- **Metadata:** `yt-dlp --dump-json --no-download <url>` → title, upload_date,
  duration, id, channel. Parse failures → structured error.
- **Download:** `yt-dlp -x --audio-format mp3 -o
  <recordingsDir>/youtube-<videoId>.mp3 <url>`, progress parsed from stdout
  and reported via the injected progress callback → BackgroundTaskManager
  task ("Downloading: <title>").
- Pure helpers exported for tests: `parseVideoId(url)`,
  `buildMetadataArgs`/`buildDownloadArgs`, `mapMetadataToMeetingFields`.

### 3. IPC + pipeline handoff (main.js)

- Zod-validated handler `youtube:import { url }`.
- Flow: binary check → metadata → download → ONLY THEN create the meeting
  record: `platform: 'youtube'`, `title` = video title, `date` = upload date,
  `videoFile`/`recordingId` = the MP3 path, `type: 'document'` (the schema's
  imported-content type; 'past' is the save-list argument, not a meeting
  type), empty participants. Failures before this point persist nothing.
- Then invoke the existing rerun-transcription flow for the new meeting id —
  local transcription + diarization, waterfall speaker ID (single speaker
  auto-labels as the user and strengthens his voice profile; guests go
  through voice profiles / content pass), exec auto-summary. No new
  transcription code.

### 4. Title protection

Stage 3 (content-aware pass) must NOT rename `platform === 'youtube'`
meetings — the YouTube title is authoritative, and a guest on a video must
not convert it to the "Company - Person - Topic" meeting format. Gate BOTH
title-mutation paths on platform: the Stage 3 rename branch AND the legacy
generic-title suggestion (`needsTitleSuggestion`) — otherwise a video title
containing a generic word (e.g. "My recording of Q3") would still be
clobbered by the suggested-title extraction. Speaker reassignment verdicts
still apply to youtube meetings.

### 5. Routing

`exportMeetingToObsidian`: meetings with `platform === 'youtube'` route to
`<vaultRoot>/content/youtube/` (fixed constant, sibling mechanism to the
`_unfiled` fallback; folder slug/date naming identical to other meetings via
the shared slugify). Not user-configurable for now (YAGNI; constant can move
to settings later).

### 6. Errors

- yt-dlp missing → actionable install message.
- Invalid URL → inline validation, no task.
- Private/unavailable video, network failure, disk error → background task
  fails with the yt-dlp stderr tail surfaced in the toast; no meeting record.
- yt-dlp is externally maintained; YouTube breakage manifests as download
  errors → the error message includes "try `yt-dlp -U` to update".

## Non-Goals

- Channel browsing/picker, playlists, batch import.
- Bundling yt-dlp with the app (PATH + install hint, like ffmpeg).
- Cloud transcription cost handling beyond what providers already do (JD
  defaults to local).
- Phone-initiated imports (separate future design).

## Testing

- Unit (`tests/unit/youtubeImport.test.js`): parseVideoId across the three
  URL shapes + garbage; arg building (exact yt-dlp argv); metadata→meeting
  field mapping (upload_date YYYYMMDD → ISO date, title passthrough); missing
  binary and failing-download error shapes; meeting created only after
  successful download (mock deps).
- Stage 3 gate: unit test that a youtube-platform meeting is never renamed.
- Routing: unit test (or source-guard consistent with existing patterns) that
  youtube platform maps to content/youtube/.
- Manual E2E (JD): import one real video from his channel → transcript with
  his name via voice profile, exec summary, meeting listed with the video's
  title/date, exported under content/youtube/ with matching folder/file
  slugs.
