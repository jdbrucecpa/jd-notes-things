# v2.1.3 Release Notes

## Highlights

You can now start recording while the previous meeting is still being transcribed or summarized. Before this release, a recording started during another meeting's processing could lose its link to the meeting note and never get transcribed. **Re-run Transcription** also handles the new mic/system track files for you.

---

## Recording While Another Meeting Is Processing

- **Recordings no longer lose their meeting note**: After a recording ends, the app transcribes it, matches speakers, and writes a summary. These steps used to read a copy of _every_ meeting, wait on the slow work, then write every meeting back from that copy. If you started a new recording meanwhile, the write-back erased the new note's link to its recording file. When that recording ended, the app couldn't find a note for it and silently skipped transcription. Saves now write back only the fields they actually changed, merged onto the latest copy of each meeting, so work on one meeting can't undo changes to another.
- **Safety net for unlinked recordings**: When a recording ends, the app now checks that it's linked to the note it was started for. If the link is missing, the app restores it and logs a warning.
- **Editing notes during processing is safe**: Saving a note used to send the note window's copy of every meeting, which could be out of date for a meeting still being processed. That could overwrite a newly finished transcript or drop the mic/system track paths. A save now sends only the meeting you're editing, and where possible only the fields you changed.
- **Archived meetings stay archived**: A background save no longer quietly moves archived meetings back to the regular meeting list, and a meeting you delete while it's processing no longer reappears.

## Summaries

- **Overlapping summaries use the right model**: Generating a summary used to switch the app-wide AI model for as long as the summary ran. Two summaries at the same time (for example, an auto-summary for one meeting while you generate a template summary for another) could each run on the wrong model and leave your default changed afterward. Each summary now uses its own model without affecting the others.
- **A custom model is used when you pick one**: Choosing a specific model when generating template summaries was being overridden by your default template model. The model you pick is now the one used.

## Local Transcription

- **Jobs on the local audio service take turns**: The local audio service runs one GPU job at a time. When two meetings were processed together, one meeting's request could wait behind the other's transcription and hit its 30-second timeout, so that meeting lost voice-profile speaker matching. The app now queues these jobs itself, and each timeout starts only when the job is actually sent.

## Re-run Transcription

- **Finds the recording on its own**: For local recordings, Re-run no longer asks you to pick a file when the recording is already known.
- **Uses the mic and system tracks automatically**: Each local recording is saved as a mixed file plus `-mic` and `-sys` tracks. Re-run transcribes the mixed file and uses the other tracks to work out which speaker is you, just like the original processing. If you pick a `-mic` or `-sys` file by mistake, it switches to the mixed file.
- **Keeps your other edits**: Re-run now saves only what it produced, so changes made to the meeting during a re-run are kept.

## Diagnostics

- **Failures show up in the log**: "Meeting not found" and transcription errors now go to the app log (`main.log`). Before, these messages never reached the log file, which made failures hard to trace.

---

## Files Changed

21 files changed, ~1,170 additions, ~210 deletions (net +960 lines) across 1 commit since v2.1.2, plus 5 new unit test files (508 tests passing).
