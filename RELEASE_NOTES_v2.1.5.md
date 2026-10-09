# v2.1.5 Release Notes

## Highlights

Local transcription now runs to completion however long it takes, finishes about 3× faster on GPUs with 12 GB of memory or less, and sets itself up on a new machine as soon as you save a Hugging Face token.

---

## Local Transcription Reliability

- **No more time limit on local transcription**: Long meetings used to fail with "fetch failed" whenever processing took more than 5 minutes (a built-in limit in Node's `fetch`), and the app also gave up after its own estimate of about half the meeting's length. Local jobs now run until they finish. They fail only if the JD Audio Service crashes or stops answering health checks for about 2 minutes.
- **Elapsed time in the task panel**: While a meeting is transcribing, the background task updates every 30 seconds with how long it has been running.
- **Clearer errors**: When the audio service reports a problem, the task panel shows its actual message (for example "GPU unavailable") rather than a bare "500".

## Faster on Laptop and Low-Memory GPUs

- **One model on the GPU at a time on cards with ≤ 12 GB**: The service used to keep the transcription, alignment, diarization and voice-profile models loaded together. On an 8 GB laptop GPU that ran out of GPU memory during diarization, and Windows quietly moved the overflow into much slower system RAM. An hour-long meeting that took over 20 minutes now finishes in about 6½. GPUs with more memory keep the old behavior. Set `JD_AUDIO_GPU_MEMORY_MODE` to `low` or `high` to override the automatic choice.
- **Alignment memory released before diarization**: Word alignment loads the whole meeting's audio onto the GPU. That memory is now released as soon as alignment finishes, on any GPU.
- **Lighter warmup on low-memory GPUs**: At launch, only the transcription model is preloaded, since the first stage would unload the others anyway.

## Setting Up a New Machine

- **Hugging Face token on the Security tab**: The token now appears in the API key list with the other keys, in addition to the AI Services tab. Values that don't start with `hf_` are rejected.
- **Speaker models download when you save the token**: Saving the token, from either tab, downloads the speaker-detection and voice-profile models right away instead of partway through your first transcription. They also download at launch if a token is saved and they're missing. Once downloaded, they load without the token.
- **Readiness status in Settings**: The AI Services tab shows whether the speaker models are ready, not downloaded yet (and whether a token is needed), or downloading. It also has a **Download models** button.
- **Specific download errors**: A missing token, a rejected token, and model terms not yet accepted on Hugging Face each get their own message, with a link to the model page.

---

## Files Changed

25 files changed, ~1,100 additions, ~100 deletions (net +1,000 lines) since v2.1.4 (529 unit tests and 88 audio-service tests passing).
