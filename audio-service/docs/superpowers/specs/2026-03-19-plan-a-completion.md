# Plan A Completion — Final Polish + Verification

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Verify wav2vec2 aligner works on real audio, update setup scripts, write README, smoke test HTTP server, add device reporting to /health, cleanup generated files.

## Background

Plan A (JD Audio Service) core implementation is complete: faster-whisper transcription, PyAnnote diarization, wav2vec2 alignment, speaker identification, all exposed via FastAPI REST API. 64 tests pass, real 64-min meeting transcribed successfully.

However, several items remain before Plan A is truly "done":
1. wav2vec2 aligner has only been tested with mocks — never run on real audio
2. Setup scripts reference the old onnx-asr stack
3. No README or install documentation
4. Server never tested as actual HTTP service (only TestClient)
5. `/health` doesn't report GPU device info
6. Large generated files (WAV, transcripts) need cleanup from git

## Changes

### 1. Verify wav2vec2 Aligner on Real Audio

Run the full pipeline WITH alignment on the 64-min meeting recording. Verify `torchaudio.functional.forced_align()` works with nightly torchaudio 2.11.0.dev.

**If it works:** Confirm timestamps improve (compare aligned vs. non-aligned output).

**If it fails (likely scenarios):**
- `forced_align` doesn't exist in nightly torchaudio → check `torchaudio.functional` for the correct function name, adapt import
- API signature changed → adapt `_align_segment()` to match nightly API
- Model incompatibility → try alternative wav2vec2 bundles from `torchaudio.pipelines`
- Fundamentally broken → remove `aligner.py`, remove `_load_aligner` from processor, remove aligner tests. Don't ship dead code. Update spec to note alignment deferred until torchaudio stabilizes.

The pipeline already falls back gracefully, so this is about verifying the feature works, not about preventing crashes.

### 2. Update Setup Scripts

**`setup-jd-audio-service.bat`:**
```
1. Create .venv
2. Upgrade pip
3. pip install faster-whisper pyannote.audio soundfile librosa fastapi uvicorn pydantic numpy scipy pystray Pillow omegaconf pytest pytest-asyncio httpx
4. pip install --force-reinstall --pre torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
5. pip uninstall torchcodec -y
6. Validate HF_TOKEN is set (warn if not)
7. Print success message with next steps
```

**`run-jd-audio-service.bat`:** Already works. No changes needed.

### 3. Write README.md

Full documentation covering:

**Prerequisites:**
- Python 3.11+ (tested with 3.13)
- NVIDIA GPU with CUDA support
- CUDA Toolkit 12.8 (`winget install Nvidia.CUDA --version 12.8`)
- HuggingFace account + token (HF_TOKEN env var)
- Gated model access accepted for 4 PyAnnote models

**Installation:**
- Step-by-step with exact commands
- Install order explanation (why pyannote first, then CUDA torch override)
- torchcodec removal explanation

**Running:**
- `run-jd-audio-service.bat` (system tray mode)
- `python src/main.py --no-tray` (headless mode for development)
- Default port 8374

**API Reference:**
- All 8 endpoints with request/response examples
- curl examples for each

**Troubleshooting:**
- CUDA/cuDNN/TensorRT warnings (harmless, falls back to CPU for ONNX)
- torchcodec warnings (expected, using soundfile workaround)
- 401/403 from HuggingFace (token missing or model access not accepted)
- "CUDA out of memory" (close other GPU apps, or reduce model)
- First-run model download (large, takes a few minutes)

**Architecture:**
- Brief overview matching the v2.0 spec
- Link to spec document

### 4. HTTP Server Smoke Test

Start the actual uvicorn server and make real HTTP requests:
1. Start server: `python src/main.py --no-tray` (background)
2. `GET /health` — verify response
3. `POST /process` with the test fixture audio — verify full pipeline
4. `POST /unload` — verify models freed
5. Stop server

This catches ASGI lifespan issues, port binding, JSON serialization edge cases, and anything else that TestClient masks. Implement as an integration test (`tests/test_smoke.py`) or manual verification script.

**Decision:** Manual verification script (`scripts/smoke_test.py`), not a pytest test. Reason: it requires starting a real server process, which is fragile in CI. Run it manually after install to validate the setup.

### 5. `/health` Device Reporting

Add `device` field to `HealthResponse` schema:

```python
class HealthResponse(BaseModel):
    status: str
    modelsLoaded: list[str]
    device: str          # e.g. "cuda:0 (NVIDIA GeForce RTX 5090)" or "cpu"
    engineVersion: str
```

Implementation: `torch.cuda.get_device_name(0)` if CUDA available, else `"cpu"`. No nvidia-smi subprocess.

**Breaking change:** Removes `vramUsed` field (always 0.0, never implemented) and replaces with `device`. The Electron app (Plan C) hasn't been built yet, so this is safe.

### 6. Cleanup

- Delete `fixtures/meeting.wav` (118MB WAV generated for Parakeet testing — faster-whisper reads MP3 directly, not needed)
- Delete `fixtures/meeting_transcript.txt` (v1 Parakeet transcript — contains real meeting content, shouldn't be in git)
- Delete `fixtures/meeting_transcript_v2.txt` (v2 faster-whisper transcript — same reason)
- Add to `.gitignore`: `fixtures/meeting*.wav`, `fixtures/meeting_transcript*.txt`
- Keep `fixtures/two_speakers_short.wav` and `fixtures/two_speakers_short.mp3` (test fixtures, small)
- Keep `fixtures/speaker1.mp3` and `fixtures/speaker2.mp3` (test fixtures, small)

## Success Criteria

1. wav2vec2 aligner either works on real audio or is cleanly removed
2. `setup-jd-audio-service.bat` works from scratch on a fresh venv
3. README.md covers full install-to-run path
4. Server starts via uvicorn, responds to real HTTP requests
5. `/health` reports actual GPU device name
6. No large generated files or real meeting content in git
7. All tests still pass (64+)
