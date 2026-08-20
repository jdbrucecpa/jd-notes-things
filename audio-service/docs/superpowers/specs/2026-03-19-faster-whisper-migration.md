# Faster-Whisper Migration + Pipeline Hardening

**Date:** 2026-03-19
**Status:** Approved
**Scope:** Replace onnx-asr (Parakeet) with faster-whisper (Whisper large-v3-turbo), add wav2vec2 forced alignment, fix critical issues from code review, harden pipeline.

## Background

JD Audio Service v0.1.0 uses onnx-asr (Parakeet TDT 0.6B) for transcription. A code review and competitive analysis against WhisperX, faster-whisper, and other open-source pipelines identified several gaps:

1. **Timestamp precision:** Parakeet's BPE subword timestamps drift 50-200ms from actual word boundaries. This degrades diarization merge quality at speaker turn boundaries.
2. **No forced alignment:** WhisperX's key innovation is wav2vec2-based forced alignment that produces character-level timestamps. We have nothing equivalent.
3. **WAV-only input:** onnx-asr's sherpa-onnx backend uses Python's `wave` module, requiring ffmpeg pre-conversion for MP3/FLAC input.
4. **No hallucination detection:** No output quality validation. Whisper has built-in compression ratio and logprob thresholds.
5. **Critical code issues:** GPU memory leak in idle collector, narrow exception handling, global state leaking between tests.

## Decision

Replace onnx-asr with faster-whisper (CTranslate2-optimized Whisper large-v3-turbo). Add wav2vec2 forced alignment. Fix critical and important issues from code review.

### Why faster-whisper over Parakeet

- **Timestamp quality:** Native word timestamps + forced alignment = gold standard for diarized transcription.
- **Format support:** Handles MP3/FLAC/OGG natively via internal FFmpeg — no conversion step needed.
- **Hallucination filtering:** Built-in compression ratio, logprob thresholds, temperature fallback.
- **Ecosystem:** Most widely used local transcription engine. Battle-tested on diverse meeting audio.
- **Comparable speed:** Sequential mode ~10-15x realtime, batched mode up to 70x. For a 64-min meeting, expect ~90-180s with large-v3-turbo on RTX 5090.
- **VRAM is not a constraint:** RTX 5090 has 32GB. Whisper large-v3-turbo uses ~1.2GB.

### What doesn't change

- PyAnnote for diarization and speaker embeddings (still requires nightly PyTorch for RTX 5090)
- The `audio.py` soundfile workaround for PyAnnote (torchcodec still incompatible with nightly torch)
- ModelManager lazy-load/auto-unload pattern
- System tray app, launcher scripts
- All existing unit tests that mock the transcriber

### API changes (backward-compatible extensions)

- `WordTiming.confidence` field populated (was always `None`)
- New optional `quality` field added to `ProcessResponse`
- `/models` endpoint updated to reflect new model names

## Architecture

### Pipeline Flow (updated)

```
Audio File (WAV/MP3/FLAC)
    |
    v
[1. Transcribe] faster-whisper large-v3-turbo
    |             - VAD filter (Silero, built-in)
    |             - Sequential inference on GPU (CTranslate2)
    |             - Returns segments with word timestamps + confidence
    |             - Per-segment compression_ratio + avg_logprob
    v
[2. Align] wav2vec2 forced alignment (optional)
    |        - Per-segment alignment (not whole-file, avoids OOM)
    |        - Refines word timestamps to character-level
    |        - Falls back to faster-whisper native timestamps on failure
    v
[3. Diarize] PyAnnote speaker-diarization-3.1
    |          - Speaker segments via GPU (nightly PyTorch)
    v
[4. Merge] Word-speaker alignment
    |        - Binary search on sorted segments
    |        - Nearest-speaker fallback for gap words
    v
[5. Return] ProcessResponse {text, entries, segments, duration, quality?}
```

### VRAM Budget

| Model | VRAM | Load Time |
|-------|------|-----------|
| Whisper large-v3-turbo (CTranslate2) | ~1.2 GB | ~3s |
| wav2vec2-base (alignment) | ~400 MB | ~1s |
| PyAnnote diarization 3.1 | ~600 MB | ~3s |
| PyAnnote embedding | ~200 MB | ~2s |
| **Peak (all loaded)** | **~2.4 GB** | — |

Well within RTX 5090's 32GB. Models are lazy-loaded and auto-unloaded after idle timeout.

## Changes

### 1. Transcriber Rewrite (`src/models/transcriber.py`)

Replace onnx-asr with faster-whisper. The class keeps the same public API.

```python
class Transcriber:
    def __init__(self):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(
            TRANSCRIPTION_MODEL,          # "large-v3-turbo"
            device=TRANSCRIPTION_DEVICE,  # "cuda"
            compute_type=TRANSCRIPTION_COMPUTE_TYPE,  # "float16"
            download_root=str(MODEL_CACHE_DIR),
        )

    def transcribe(self, audio_path: str) -> dict:
        segments_iter, info = self.model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )

        # Consume the generator (faster-whisper segments are lazy)
        segments = list(segments_iter)

        # Extract words from all segments
        words = []
        for seg in segments:
            for w in (seg.words or []):
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "confidence": round(w.probability, 3),
                })

        # Build text and segment list
        text = " ".join(seg.text.strip() for seg in segments)
        seg_list = [{
            "text": seg.text.strip(),
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
        } for seg in segments]

        # Quality metrics for hallucination detection
        quality = {
            "flagged_segments": [
                i for i, seg in enumerate(segments)
                if seg.compression_ratio > 2.4 or seg.avg_logprob < -1.0
            ],
            "avg_confidence": (
                sum(w["confidence"] for w in words) / len(words)
                if words else 0.0
            ),
        }

        return {
            "text": text,
            "words": words,
            "segments": seg_list,
            "duration": round(info.duration, 3),
            "quality": quality,
        }
```

**Key differences from current implementation:**
- No BPE token merging — faster-whisper returns `Word` objects with `start`, `end`, `word`, `probability`.
- No manual VAD setup — built into `model.transcribe()`.
- No WAV-only limitation — accepts any audio format.
- `info.duration` gives accurate audio duration from metadata.
- Each word has `probability` (0.0-1.0) exposed as `confidence`.
- Quality metrics computed per-segment for hallucination detection.
- Must consume the segment generator immediately (`list(segments_iter)`) — failing to iterate causes silent data loss.
- **Sequential mode** (not batched). `BatchedInferencePipeline` has different VAD behavior and API. Start with sequential; switch to batched later if speed is insufficient.

**Model download:** First call to `WhisperModel("large-v3-turbo")` downloads ~1.6GB from HuggingFace. The `download_root` parameter directs this to `MODEL_CACHE_DIR` from config.py.

### 2. New Aligner (`src/models/aligner.py`)

Wraps wav2vec2 for post-hoc forced alignment using torchaudio's `forced_align()` function. Processes one segment at a time (not the whole file) to avoid OOM on long audio.

```python
import torch
import torchaudio
from torchaudio.pipelines import WAV2VEC2_ASR_BASE_960H

class Aligner:
    def __init__(self):
        bundle = WAV2VEC2_ASR_BASE_960H
        self.model = bundle.get_model().to("cuda")
        self.labels = bundle.get_labels()
        self.sample_rate = bundle.sample_rate  # 16000

    def align(self, audio_path: str, transcription: dict) -> dict:
        """Refine word timestamps via forced alignment.

        Args:
            audio_path: Path to audio file.
            transcription: Dict with keys {text, words, segments, duration, quality}.

        Returns:
            Same dict with refined word timestamps. Original timestamps
            preserved for any segment where alignment fails.
        """
        waveform, sr = torchaudio.load(audio_path, backend="soundfile")
        if sr != self.sample_rate:
            waveform = torchaudio.functional.resample(waveform, sr, self.sample_rate)
        waveform = waveform.to("cuda")

        refined_words = []
        for seg in transcription["segments"]:
            seg_words = [
                w for w in transcription["words"]
                if w["start"] >= seg["start"] and w["end"] <= seg["end"]
            ]
            if not seg_words:
                continue

            try:
                aligned = self._align_segment(waveform, seg, seg_words)
                refined_words.extend(aligned)
            except Exception:
                # Fallback: keep original timestamps for this segment
                refined_words.extend(seg_words)

        transcription["words"] = refined_words
        return transcription

    def _align_segment(self, waveform, seg, words):
        """Align a single segment's words using Viterbi forced alignment."""
        # Extract segment audio
        start_frame = int(seg["start"] * self.sample_rate)
        end_frame = int(seg["end"] * self.sample_rate)
        segment_waveform = waveform[:, start_frame:end_frame]

        # Get emission probabilities from wav2vec2
        with torch.inference_mode():
            emissions, _ = self.model(segment_waveform)
        emissions = torch.log_softmax(emissions, dim=-1)

        # Tokenize the transcript text for this segment
        transcript_text = " ".join(w["word"] for w in words)
        tokens = [self.labels.index(c) for c in transcript_text.upper()
                  if c in self.labels]

        # Run Viterbi forced alignment
        aligned_tokens, scores = torchaudio.functional.forced_align(
            emissions, torch.tensor([tokens], device=emissions.device),
            blank=0,
        )

        # Convert token-level alignment back to word timestamps
        # (aggregate character timestamps per word)
        ratio = segment_waveform.shape[1] / emissions.shape[1]
        refined = []
        token_idx = 0
        for word in words:
            word_chars = [c for c in word["word"].upper() if c in self.labels]
            if not word_chars:
                refined.append(word)  # keep original
                continue

            char_starts = []
            char_ends = []
            for _ in word_chars:
                if token_idx < len(aligned_tokens[0]):
                    frame = aligned_tokens[0][token_idx].item()
                    t = seg["start"] + (frame * ratio / self.sample_rate)
                    char_starts.append(t)
                    char_ends.append(t)
                    token_idx += 1
            # Skip spaces between words
            while (token_idx < len(aligned_tokens[0])
                   and aligned_tokens[0][token_idx].item() == 0):
                token_idx += 1

            if char_starts:
                refined.append({
                    **word,
                    "start": round(min(char_starts), 3),
                    "end": round(max(char_ends), 3),
                })
            else:
                refined.append(word)

        return refined
```

**Key design decisions:**
- **Per-segment alignment:** Processes one transcription segment at a time, not the whole file. WhisperX does this too. A 64-minute meeting would OOM if aligned as a single tensor (~61M samples).
- **Fallback per segment:** If alignment fails for one segment (e.g., unusual characters, empty tokens), that segment keeps its original faster-whisper timestamps. The rest of the transcript is still improved.
- **GPU inference:** wav2vec2 runs on CUDA via nightly PyTorch.
- **`torchaudio.functional.forced_align()`:** The correct API for Viterbi-based forced alignment. Available since torchaudio 2.1. Note: the nightly torchaudio API may differ slightly — verify during implementation.

**Fallback behavior:** If alignment fails entirely (model not loaded, torchaudio incompatibility, etc.), the pipeline returns the original faster-whisper timestamps unchanged. The pipeline never fails because alignment failed.

**ModelManager integration:** Loaded via `manager.get_or_load("aligner", ...)` like all other models. Auto-unloads after idle timeout.

### 3. Pipeline Update (`src/pipeline/processor.py`)

Add alignment step between transcription and diarization:

```python
def process(self, audio_path, ...):
    # Step 1: Transcribe
    transcription = transcriber.transcribe(audio_path)

    # Step 2: Align (optional, improves word timestamps)
    try:
        aligner = self.manager.get_or_load("aligner", self._load_aligner)
        transcription = aligner.align(audio_path, transcription)
    except Exception:
        logger.warning("Alignment failed, using native timestamps")

    # Step 3: Diarize
    segments = diarizer.diarize(audio_path, ...)

    # Step 4: Merge
    entries = merge_transcript_with_diarization(transcription["words"], segments)

    return {
        "text": transcription["text"],
        "entries": entries,
        "segments": segments,  # diarization segments
        "duration": transcription["duration"],
        "quality": transcription.get("quality"),
    }
```

Note: `transcription` is a dict. `aligner.align()` takes and returns the same dict with refined `words`. The pipeline code and aligner signature are consistent.

### 4. Critical Fixes

**C-1: GPU memory leak in `collect_idle()`**
Add `self._free_gpu_memory()` after the unload loop in `ModelManager.collect_idle()`.

**C-2: Narrow GPU error handler**
Change `_handle_gpu_errors` to catch `Exception` (not just `RuntimeError`) and check for CUDA/OOM/GPU strings in the message. This covers both PyTorch `RuntimeError` subclasses and CTranslate2's own exception types.

**C-3: Module-level globals in routes.py**
Refactor `_model_manager` and `_processor` globals to use FastAPI's `app.state` pattern:

```python
# server.py — store on app.state
def create_app(model_manager=None, processor=None):
    app = FastAPI(...)
    app.state.model_manager = model_manager or ModelManager()
    app.state.processor = processor or Processor(app.state.model_manager)
    app.include_router(router)
    return app

# routes.py — access via Request dependency
from fastapi import Request

def get_model_manager(request: Request) -> ModelManager:
    return request.app.state.model_manager

def get_processor(request: Request) -> Processor:
    return request.app.state.processor

@router.post("/process")
def process(req: ProcessRequest, processor: Processor = Depends(get_processor)):
    ...
```

Test fixtures continue to work by passing mocked objects to `create_app()`.

### 5. Important Fixes

**I-1: Embedder loads audio per speaker**
Move `load_audio()` call outside the speaker loop in `embedder.py`.

**I-2: Merger O(n*m) performance**
Replace linear scan in `_find_speaker_for_word()` with `bisect`-based binary search on sorted segment start times.

**I-3: Request concurrency**
Add a `threading.Lock()` on GPU-intensive operations. The current route handlers are synchronous (`def`, not `async def`), so `asyncio.Lock()` would not work. Two options:

- **Option A (simpler):** Add a module-level `threading.Lock()` in routes.py that wraps each GPU endpoint's processing block. FastAPI runs sync handlers in a threadpool, so `threading.Lock()` correctly serializes across concurrent requests.
- **Option B:** The existing `ModelManager._lock` already serializes model loading. Extend it to also cover the full processing operation, not just load/unload.

Recommend Option A for clarity — a single `_gpu_lock = threading.Lock()` at the route level.

**I-4: Hallucination detection**
The transcriber now returns a `quality` dict (see Section 1). Add to the API schema:

```python
class QualityInfo(BaseModel):
    flagged_segments: list[int] = []  # indices of suspicious segments
    avg_confidence: float = 0.0      # mean word probability

class ProcessResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    segments: list[DiarizationSegment]
    duration: float
    quality: QualityInfo | None = None  # new, optional
```

Thresholds: `compression_ratio > 2.4` or `avg_logprob < -1.0` flag a segment. These match OpenAI Whisper's defaults.

### 6. Dependency Changes

**Remove:**
- `onnx-asr`
- `sherpa-onnx` (transitive)
- `onnxruntime-gpu` (check if PyAnnote needs it first; if not, remove to eliminate TensorRT/cuDNN warning noise)

**Add:**
- `faster-whisper>=1.1`
- `ctranslate2>=4.5` (transitive via faster-whisper)

**Keep:**
- `pyannote.audio>=3.1`
- `soundfile>=0.13`
- `librosa>=0.11`
- `torch` (nightly, for PyAnnote + wav2vec2 alignment)
- All API/utility deps unchanged

**Install order unchanged:** pyannote first → CUDA nightly torch override.

### 7. Config Changes

```python
# config.py
TRANSCRIPTION_MODEL = "large-v3-turbo"       # was "nemo-parakeet-tdt-0.6b-v2"
TRANSCRIPTION_DEVICE = "cuda"                 # CTranslate2 device
TRANSCRIPTION_COMPUTE_TYPE = "float16"        # or "int8_float16" for lower VRAM
ALIGNMENT_MODEL = "WAV2VEC2_ASR_BASE_960H"   # new

VERSION = "0.2.0"  # bump from 0.1.0
```

### 8. Other Updates

- **`/models` endpoint:** Update hardcoded model names to reflect `large-v3-turbo`, `wav2vec2-base`, `pyannote-3.1`, `pyannote-embedding`.
- **Integration tests:** Remove WAV-preference comment (faster-whisper handles MP3). Can test with either format.
- **`fixtures/meeting.wav`:** Keep for integration tests. Also test with the original MP3 to verify format support.

### 9. Test Changes

- **Integration tests:** Same 4 tests, same structural assertions. Transcription engine change is internal.
- **New unit tests:**
  - `test_transcriber.py`: Test word/segment extraction from faster-whisper mock objects, quality metric computation
  - `test_aligner.py`: Test per-segment alignment, fallback behavior when alignment fails, fallback when model not loaded
  - `test_hallucination.py`: Test compression ratio / logprob threshold flagging
- **Updated unit tests:**
  - `test_processor.py`: Add test for alignment step in pipeline, including fallback on alignment failure
  - `test_merger.py`: Verify binary search produces same results as linear scan on existing test cases

## Risks

1. **CTranslate2 + RTX 5090:** CTranslate2 may not have pre-built CUDA kernels for Blackwell (sm_120). If the pip package doesn't support it, transcription falls back to CPU (still works, just slower — ~10x realtime instead of ~15x). Mitigation: test immediately after install. If CPU-only, consider building CTranslate2 from source with CUDA 12.8.
2. **torchaudio forced_align() API stability:** The `forced_align()` function was added in torchaudio 2.1. The nightly torchaudio may have API changes. Mitigation: pin torchaudio version, verify API at install time, fallback to native timestamps if alignment is unavailable.
3. **faster-whisper API stability:** The library is actively developed and API may change between versions. Mitigation: pin version in requirements.txt.
4. **Rollback:** This migration removes onnx-asr entirely. If faster-whisper has unforeseen issues, rollback means reverting the commit. The onnx-asr code is preserved in git history.

## Success Criteria

1. All 47 existing tests pass (43 unit + 4 GPU integration)
2. New unit tests for transcriber, aligner, and hallucination detection pass
3. Real meeting transcript (64-min fixture) produces properly timestamped, speaker-labeled output
4. Word timestamps are within 50ms of actual word boundaries (verified by spot-checking against audio)
5. No "Unknown" speaker labels in output
6. GPU memory is properly freed after idle timeout
7. Concurrent `/process` requests are serialized, not OOM
8. MP3 input works without manual ffmpeg conversion
