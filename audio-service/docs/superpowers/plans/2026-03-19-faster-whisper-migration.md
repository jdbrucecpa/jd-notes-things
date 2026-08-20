# Faster-Whisper Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace onnx-asr (Parakeet) with faster-whisper (large-v3-turbo), add wav2vec2 forced alignment, fix critical/important issues from code review.

**Architecture:** FastAPI service with lazy-loaded GPU models. Transcription via faster-whisper (CTranslate2), alignment via wav2vec2 (torchaudio), diarization via PyAnnote. All models managed by ModelManager with idle auto-unload.

**Tech Stack:** Python 3.13, faster-whisper, torchaudio, pyannote.audio, FastAPI, nightly PyTorch (RTX 5090)

**Spec:** `docs/superpowers/specs/2026-03-19-faster-whisper-migration.md`

**Repository:** `C:\Users\brigh\Documents\code\jd-audio-service`

**Test command:** `python -m pytest tests/ -v -m "not gpu" --tb=short` (unit), add `-m gpu` for integration

**Environment setup for GPU tests:**
```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
```

---

### Task 1: Critical Fix — GPU memory leak in collect_idle

**Files:**
- Modify: `src/models/manager.py:59-70`
- Test: `tests/test_manager.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_manager.py`:

```python
def test_collect_idle_frees_gpu_memory(self):
    """collect_idle should call _free_gpu_memory after unloading."""
    mgr = ModelManager(idle_timeout_seconds=0)
    mgr.loaded_models["test"] = "dummy"
    mgr.last_used["test"] = 0  # expired

    with patch.object(mgr, '_free_gpu_memory') as mock_free:
        unloaded = mgr.collect_idle()
        assert unloaded == ["test"]
        mock_free.assert_called_once()
```

Add `from unittest.mock import patch` to imports at top of file.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_manager.py::TestModelManager::test_collect_idle_frees_gpu_memory -v`
Expected: FAIL — `_free_gpu_memory` not called

- [ ] **Step 3: Fix collect_idle in manager.py**

In `src/models/manager.py`, replace `collect_idle` method (lines 59-70):

```python
def collect_idle(self) -> list[str]:
    now = time.monotonic()
    to_unload = []
    with self._lock:
        for name, last in list(self.last_used.items()):
            if now - last > self.idle_timeout_seconds:
                to_unload.append(name)
        for name in to_unload:
            logger.info(f"Auto-unloading idle model: {name}")
            del self.loaded_models[name]
            del self.last_used[name]
        if to_unload:
            self._free_gpu_memory()
    return to_unload
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_manager.py -v`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/manager.py tests/test_manager.py
git commit -m "fix(manager): call _free_gpu_memory in collect_idle"
```

---

### Task 2: Critical Fix — Broaden GPU error handler

**Files:**
- Modify: `src/api/routes.py:44-57`
- Test: `tests/test_routes.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_routes.py`:

```python
class TestGpuErrorHandler:
    def test_cuda_runtime_error_returns_503(self, client, mock_processor):
        mock_processor.process.side_effect = RuntimeError("CUDA out of memory")
        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 503

    def test_generic_cuda_exception_returns_503(self, client, mock_processor):
        mock_processor.process.side_effect = Exception("CUDA error: device-side assert triggered")
        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 503

    def test_non_gpu_exception_propagates(self, client, mock_processor):
        mock_processor.process.side_effect = ValueError("bad input")
        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 500
```

- [ ] **Step 2: Run tests to verify the second test fails**

Run: `python -m pytest tests/test_routes.py::TestGpuErrorHandler -v`
Expected: `test_generic_cuda_exception_returns_503` FAILS (generic `Exception` not caught)

- [ ] **Step 3: Broaden the error handler**

In `src/api/routes.py`, replace `_handle_gpu_errors` (lines 44-57):

```python
def _handle_gpu_errors(func):
    """Decorator that catches GPU errors and returns 503."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_str = str(e).lower()
            if "cuda" in err_str or "out of memory" in err_str or "gpu" in err_str:
                raise HTTPException(
                    status_code=503,
                    detail="GPU unavailable — close other GPU applications and retry, or switch to cloud transcription.",
                )
            raise
    return wrapper
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_routes.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes.py tests/test_routes.py
git commit -m "fix(routes): catch all GPU exceptions, not just RuntimeError"
```

---

### Task 3: Critical Fix — Dependency injection refactor

**Files:**
- Modify: `src/server.py`
- Modify: `src/api/routes.py:21-36` (remove globals)
- Modify: `tests/test_routes.py:20-23` (update client fixture)

- [ ] **Step 1: Update server.py to use app.state**

Replace `src/server.py` entirely:

```python
import logging
from fastapi import FastAPI
from models.manager import ModelManager
from pipeline.processor import Processor
from api.routes import router
from config import VERSION

logger = logging.getLogger(__name__)


def create_app(
    model_manager: ModelManager | None = None,
    processor: Processor | None = None,
) -> FastAPI:
    if model_manager is None:
        model_manager = ModelManager()
    if processor is None:
        processor = Processor(model_manager)

    app = FastAPI(
        title="JD Audio Service",
        version=VERSION,
        description="Local audio transcription, diarization, and speaker identification",
    )
    app.state.model_manager = model_manager
    app.state.processor = processor
    app.include_router(router)

    return app
```

- [ ] **Step 2: Update routes.py to use Request dependency**

In `src/api/routes.py`:

Remove the globals block (lines 21-36: `_model_manager`, `_processor`, `set_dependencies`, `get_model_manager`, `get_processor`).

Add `Request` import and dependency functions:

```python
from fastapi import APIRouter, HTTPException, Request

def get_model_manager(request: Request):
    return request.app.state.model_manager

def get_processor(request: Request):
    return request.app.state.processor
```

Update every route handler that calls `get_model_manager()` or `get_processor()` to accept `request: Request` as a parameter and pass it:

```python
@router.get("/health", response_model=HealthResponse)
def health(request: Request):
    mgr = get_model_manager(request)
    ...

@router.post("/process", response_model=ProcessResponse)
@_handle_gpu_errors
def process(req: ProcessRequest, request: Request):
    _validate_audio_path(req.audioPath)
    proc = get_processor(request)
    ...
```

Here are ALL the handler signatures that need `request: Request` added:

```python
@router.get("/health", response_model=HealthResponse)
def health(request: Request):
    mgr = get_model_manager(request)
    ...

@router.post("/process", response_model=ProcessResponse)
@_handle_gpu_errors
def process(req: ProcessRequest, request: Request):
    proc = get_processor(request)
    ...

@router.post("/transcribe", response_model=TranscribeResponse)
@_handle_gpu_errors
def transcribe(req: TranscribeRequest, request: Request):
    mgr = get_model_manager(request)
    ...

@router.post("/diarize", response_model=DiarizeResponse)
@_handle_gpu_errors
def diarize(req: DiarizeRequest, request: Request):
    mgr = get_model_manager(request)
    ...

@router.post("/embed-speakers", response_model=EmbedSpeakersResponse)
@_handle_gpu_errors
def embed_speakers(req: EmbedSpeakersRequest, request: Request):
    mgr = get_model_manager(request)
    ...

@router.post("/unload", response_model=UnloadResponse)
def unload(request: Request):
    mgr = get_model_manager(request)
    ...
```

The `models` and `identify` endpoints do NOT use the manager/processor, so they stay unchanged.

**Note:** The spec mentions using `Depends()` but we use direct `Request` parameter access instead. Both achieve DI — `Request` is simpler and doesn't require additional import/setup. FastAPI injects `Request` automatically when it appears as a parameter.

- [ ] **Step 3: Update test_routes.py client fixture**

The `client` fixture no longer needs to worry about `set_dependencies` since `create_app` now stores on `app.state`. The existing fixture already calls `create_app(model_manager=..., processor=...)`, so it should work as-is. Verify by running tests.

- [ ] **Step 4: Run all unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All 43 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.py src/api/routes.py
git commit -m "refactor(routes): replace module globals with FastAPI app.state DI"
```

---

### Task 4: Schema updates — QualityInfo + ProcessResponse

**Files:**
- Modify: `src/api/schemas.py`
- Test: `tests/test_schemas.py`

- [ ] **Step 1: Write failing test**

Add to `tests/test_schemas.py`:

```python
class TestQualityInfo:
    def test_quality_info_defaults(self):
        from api.schemas import QualityInfo
        q = QualityInfo()
        assert q.flagged_segments == []
        assert q.avg_confidence == 0.0

    def test_process_response_with_quality(self):
        from api.schemas import ProcessResponse, QualityInfo
        resp = ProcessResponse(
            text="Hello",
            entries=[],
            segments=[],
            duration=1.0,
            quality=QualityInfo(flagged_segments=[2], avg_confidence=0.85),
        )
        assert resp.quality.flagged_segments == [2]

    def test_process_response_quality_optional(self):
        from api.schemas import ProcessResponse
        resp = ProcessResponse(text="Hello", entries=[], segments=[], duration=1.0)
        assert resp.quality is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_schemas.py::TestQualityInfo -v`
Expected: FAIL — `QualityInfo` not found

- [ ] **Step 3: Add QualityInfo and update ProcessResponse**

In `src/api/schemas.py`, add before `ProcessResponse`:

```python
class QualityInfo(BaseModel):
    flagged_segments: list[int] = []
    avg_confidence: float = 0.0
```

Update `ProcessResponse`:

```python
class ProcessResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    segments: list[DiarizationSegment]
    duration: float
    quality: QualityInfo | None = None
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_schemas.py -v`
Expected: All PASS (including 3 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.py tests/test_schemas.py
git commit -m "feat(schemas): add QualityInfo for hallucination detection"
```

---

### Task 5: Config + dependency swap

**Files:**
- Modify: `src/config.py`
- Modify: `requirements.txt`
- Modify: `pyproject.toml`

- [ ] **Step 1: Update config.py**

Replace `src/config.py`:

```python
import os
from pathlib import Path

HOST = os.getenv("JD_AUDIO_HOST", "127.0.0.1")
PORT = int(os.getenv("JD_AUDIO_PORT", "8374"))

MODEL_CACHE_DIR = Path(os.getenv(
    "JD_AUDIO_MODEL_DIR",
    os.path.join(os.getenv("APPDATA", ""), "JDAudioService", "models")
))

# Auto-unload models after this many seconds of inactivity
IDLE_TIMEOUT_SECONDS = int(os.getenv("JD_AUDIO_IDLE_TIMEOUT", "300"))

# Whisper model config (CTranslate2)
TRANSCRIPTION_MODEL = "large-v3-turbo"
TRANSCRIPTION_DEVICE = os.getenv("JD_AUDIO_DEVICE", "cuda")
TRANSCRIPTION_COMPUTE_TYPE = os.getenv("JD_AUDIO_COMPUTE_TYPE", "float16")

# Alignment model
ALIGNMENT_MODEL = "WAV2VEC2_ASR_BASE_960H"

# PyAnnote model identifiers
DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"
EMBEDDING_MODEL = "pyannote/embedding"

# Version
VERSION = "0.2.0"
```

- [ ] **Step 2: Update requirements.txt**

Replace `requirements.txt`:

```
# Core
faster-whisper>=1.1            # Whisper large-v3-turbo via CTranslate2
pyannote.audio>=3.1            # Diarization + speaker embedding
soundfile>=0.13                # Audio I/O (PyAnnote workaround)
librosa>=0.11                  # Audio resampling

# PyTorch with CUDA (install AFTER pyannote to override CPU version)
# RTX 5090 (Blackwell sm_120) requires nightly PyTorch:
# pip install --pre torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# API
fastapi>=0.115
uvicorn[standard]>=0.32
pydantic>=2.9

# Utilities
numpy>=1.26
scipy>=1.14
pystray>=0.19
Pillow>=10.0
omegaconf>=2.3

# Dev
pytest>=8.0
pytest-asyncio>=0.23
httpx>=0.27
```

- [ ] **Step 3: Update pyproject.toml version**

Change `version = "0.1.0"` to `version = "0.2.0"` in `pyproject.toml`.

- [ ] **Step 4: Nuke venv and reinstall**

```bash
rm -rf .venv
python -m venv .venv
.venv/Scripts/pip install --upgrade pip
.venv/Scripts/pip install faster-whisper "pyannote.audio>=3.1" "soundfile>=0.13" "librosa>=0.11" "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" "numpy>=1.26" "scipy>=1.14" "pystray>=0.19" "Pillow>=10.0" "omegaconf>=2.3" "pytest>=8.0" "pytest-asyncio>=0.23" "httpx>=0.27"
.venv/Scripts/pip install --force-reinstall --pre torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
```

- [ ] **Step 5: Verify installs**

```bash
.venv/Scripts/python -c "from faster_whisper import WhisperModel; print('faster-whisper OK')"
.venv/Scripts/python -c "import torch; print(f'torch={torch.__version__}, cuda={torch.cuda.is_available()}')"
.venv/Scripts/python -c "import pyannote.audio; print('pyannote OK')"
```

- [ ] **Step 6: Run unit tests (transcriber tests will fail — expected)**

Run: `python -m pytest tests/ -v -m "not gpu" --ignore=tests/test_integration.py`
Expected: Most pass. Tests that import the transcriber module directly will fail (import error for `onnx_asr`). Integration tests skipped. This is expected — we fix the transcriber next.

- [ ] **Step 7: Commit**

```bash
git add src/config.py requirements.txt pyproject.toml
git commit -m "chore(deps): swap onnx-asr for faster-whisper, bump to v0.2.0"
```

---

### Task 6: Transcriber rewrite — faster-whisper

**Files:**
- Rewrite: `src/models/transcriber.py`
- Create: `tests/test_transcriber.py`

- [ ] **Step 1: Write unit tests for the new transcriber**

Create `tests/test_transcriber.py`:

```python
from unittest.mock import MagicMock, patch, PropertyMock
from models.transcriber import Transcriber


def _make_segment(text, start, end, words=None, compression_ratio=1.5, avg_logprob=-0.3):
    """Create a mock faster-whisper Segment."""
    seg = MagicMock()
    seg.text = text
    seg.start = start
    seg.end = end
    seg.words = words or []
    seg.compression_ratio = compression_ratio
    seg.avg_logprob = avg_logprob
    return seg


def _make_word(word, start, end, probability=0.95):
    """Create a mock faster-whisper Word."""
    w = MagicMock()
    w.word = word
    w.start = start
    w.end = end
    w.probability = probability
    return w


def _make_info(duration=10.0):
    """Create a mock faster-whisper TranscriptionInfo."""
    info = MagicMock()
    info.duration = duration
    return info


class TestTranscriber:
    @patch("models.transcriber.WhisperModel")
    def test_transcribe_extracts_words(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        words = [
            _make_word(" Hello", 0.0, 0.5, 0.99),
            _make_word(" world", 0.6, 1.0, 0.95),
        ]
        seg = _make_segment("Hello world", 0.0, 1.0, words)
        mock_model.transcribe.return_value = (iter([seg]), _make_info(1.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["text"] == "Hello world"
        assert len(result["words"]) == 2
        assert result["words"][0]["word"] == "Hello"
        assert result["words"][0]["start"] == 0.0
        assert result["words"][0]["end"] == 0.5
        assert result["words"][0]["confidence"] == 0.99
        assert result["duration"] == 1.0

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_returns_segments(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        seg1 = _make_segment("Hello.", 0.0, 0.5)
        seg2 = _make_segment("Goodbye.", 1.0, 1.5)
        mock_model.transcribe.return_value = (iter([seg1, seg2]), _make_info(1.5))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert len(result["segments"]) == 2
        assert result["segments"][0]["text"] == "Hello."
        assert result["segments"][1]["start"] == 1.0

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_flags_hallucinated_segments(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        good_seg = _make_segment("Normal text", 0.0, 1.0, compression_ratio=1.2, avg_logprob=-0.3)
        bad_seg = _make_segment("Repeated repeated repeated", 1.0, 2.0, compression_ratio=3.0, avg_logprob=-1.5)
        mock_model.transcribe.return_value = (iter([good_seg, bad_seg]), _make_info(2.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["quality"]["flagged_segments"] == [1]

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_empty_audio(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model
        mock_model.transcribe.return_value = (iter([]), _make_info(0.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["text"] == ""
        assert result["words"] == []
        assert result["duration"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_transcriber.py -v`
Expected: FAIL — `Transcriber` still imports `onnx_asr`

- [ ] **Step 3: Rewrite transcriber.py**

Replace `src/models/transcriber.py` entirely:

```python
import logging
from faster_whisper import WhisperModel
from config import (
    TRANSCRIPTION_MODEL,
    TRANSCRIPTION_DEVICE,
    TRANSCRIPTION_COMPUTE_TYPE,
    MODEL_CACHE_DIR,
)

logger = logging.getLogger(__name__)


class Transcriber:
    """Wrapper around faster-whisper for speech-to-text."""

    def __init__(self):
        logger.info(f"Loading transcription model: {TRANSCRIPTION_MODEL}")
        self.model = WhisperModel(
            TRANSCRIPTION_MODEL,
            device=TRANSCRIPTION_DEVICE,
            compute_type=TRANSCRIPTION_COMPUTE_TYPE,
            download_root=str(MODEL_CACHE_DIR),
        )
        logger.info("Transcription model loaded")

    def transcribe(self, audio_path: str) -> dict:
        """Transcribe audio file to text with word-level timestamps.

        Args:
            audio_path: Path to audio file (WAV, MP3, FLAC, etc.).

        Returns:
            dict with keys: text, words, segments, duration, quality
        """
        segments_iter, info = self.model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )

        # Must consume the generator immediately
        segments = list(segments_iter)

        words = []
        for seg in segments:
            for w in (seg.words or []):
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "confidence": round(w.probability, 3),
                })

        text = " ".join(seg.text.strip() for seg in segments)
        seg_list = [{
            "text": seg.text.strip(),
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
        } for seg in segments]

        quality = {
            "flagged_segments": [
                i for i, seg in enumerate(segments)
                if seg.compression_ratio > 2.4 or seg.avg_logprob < -1.0
            ],
            "avg_confidence": round(
                sum(w["confidence"] for w in words) / len(words), 3
            ) if words else 0.0,
        }

        return {
            "text": text,
            "words": words,
            "segments": seg_list,
            "duration": round(info.duration, 3),
            "quality": quality,
        }
```

- [ ] **Step 4: Run transcriber unit tests**

Run: `python -m pytest tests/test_transcriber.py -v`
Expected: All 4 PASS

- [ ] **Step 5: Run all unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS. The mock-based tests in `test_processor.py` and `test_routes.py` don't import the transcriber directly — they mock it.

- [ ] **Step 6: Commit**

```bash
git add src/models/transcriber.py tests/test_transcriber.py
git commit -m "feat(transcriber): rewrite with faster-whisper large-v3-turbo"
```

---

### Task 7: Important Fix — Embedder loads audio once

**Files:**
- Modify: `src/models/embedder.py:40-65`

- [ ] **Step 1: Fix the embedder**

In `src/models/embedder.py`, move `load_audio` outside the speaker loop. Replace the `embed_segments` method body (lines 40-64):

```python
    def embed_segments(
        self,
        audio_path: str,
        segments: list[dict],
    ) -> list[dict]:
        from pyannote.core import Segment
        from models.audio import load_audio

        speaker_segments: dict[str, list[dict]] = {}
        for seg in segments:
            speaker_segments.setdefault(seg["speaker"], []).append(seg)

        audio = load_audio(audio_path)

        results = []
        for speaker, segs in speaker_segments.items():
            total_duration = sum(s["end"] - s["start"] for s in segs)
            longest = max(segs, key=lambda s: s["end"] - s["start"])
            excerpt = Segment(longest["start"], longest["end"])

            try:
                embedding = self.inference.crop(audio, excerpt)
                vector = embedding.flatten().tolist()
            except Exception as e:
                logger.warning(f"Failed to embed speaker {speaker}: {e}")
                continue

            results.append({
                "speaker": speaker,
                "vector": vector,
                "duration": round(total_duration, 3),
            })

        return results
```

- [ ] **Step 2: Run unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/models/embedder.py
git commit -m "fix(embedder): load audio once instead of per-speaker"
```

---

### Task 8: Important Fix — Merger binary search

**Files:**
- Modify: `src/pipeline/merger.py:1-27`
- Test: `tests/test_merger.py`

- [ ] **Step 1: Write test that validates identical results**

Add to `tests/test_merger.py`:

```python
    def test_many_words_many_segments_performance(self):
        """Binary search should produce same results as linear scan."""
        import time
        words = [{"word": f"w{i}", "start": i * 0.1, "end": i * 0.1 + 0.08}
                 for i in range(1000)]
        segments = [{"speaker": f"S{i % 3}", "start": i * 3.0, "end": i * 3.0 + 2.9}
                    for i in range(35)]

        t0 = time.monotonic()
        entries = merge_transcript_with_diarization(words, segments)
        elapsed = time.monotonic() - t0

        assert len(entries) > 0
        assert elapsed < 1.0  # should be well under 1s with bisect
```

- [ ] **Step 2: Run test (should pass with current code too, just slower)**

Run: `python -m pytest tests/test_merger.py::TestMerger::test_many_words_many_segments_performance -v`
Expected: PASS (linear scan still fast enough for 1000 words)

- [ ] **Step 3: Implement binary search**

Replace `_find_speaker_for_word` in `src/pipeline/merger.py`:

```python
from bisect import bisect_right


def _find_speaker_for_word(word: dict, segments: list[dict],
                           starts: list[float] | None = None) -> str:
    """Find which speaker segment a word belongs to, using word midpoint.

    Uses binary search when a pre-built starts index is provided.
    Falls back to nearest segment for words in gaps.
    """
    midpoint = (word["start"] + word["end"]) / 2

    if starts is not None:
        # Binary search: find the rightmost segment starting before midpoint
        idx = bisect_right(starts, midpoint) - 1
        if idx >= 0 and segments[idx]["start"] <= midpoint <= segments[idx]["end"]:
            return segments[idx]["speaker"]
        # Check the next segment too (midpoint might be in it)
        if idx + 1 < len(segments) and segments[idx + 1]["start"] <= midpoint <= segments[idx + 1]["end"]:
            return segments[idx + 1]["speaker"]
    else:
        for seg in segments:
            if seg["start"] <= midpoint <= seg["end"]:
                return seg["speaker"]

    # No exact match — find nearest segment
    if not segments:
        return "Unknown"

    best_speaker = segments[0]["speaker"]
    best_distance = float("inf")
    for seg in segments:
        dist = min(abs(midpoint - seg["start"]), abs(midpoint - seg["end"]))
        if dist < best_distance:
            best_distance = dist
            best_speaker = seg["speaker"]

    return best_speaker
```

Update `merge_transcript_with_diarization` to build the index once:

```python
def merge_transcript_with_diarization(
    words: list[dict],
    segments: list[dict],
) -> list[dict]:
    if not words:
        return []
    if not segments:
        segments = []

    starts = [seg["start"] for seg in segments] if segments else None

    entries = []
    current_speaker = None
    current_words = []
    current_timestamp = 0.0

    for word in words:
        speaker = _find_speaker_for_word(word, segments, starts)

        if speaker != current_speaker and current_words:
            entries.append({
                "speaker": current_speaker,
                "text": " ".join(w["word"] for w in current_words),
                "timestamp": current_timestamp,
                "words": [{k: v for k, v in w.items()} for w in current_words],
            })
            current_words = []

        if not current_words:
            current_timestamp = word["start"]
            current_speaker = speaker

        current_words.append(word)

    if current_words:
        entries.append({
            "speaker": current_speaker,
            "text": " ".join(w["word"] for w in current_words),
            "timestamp": current_timestamp,
            "words": [{k: v for k, v in w.items()} for w in current_words],
        })

    return entries
```

- [ ] **Step 4: Run all merger tests**

Run: `python -m pytest tests/test_merger.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/merger.py tests/test_merger.py
git commit -m "perf(merger): use binary search for word-speaker assignment"
```

---

### Task 9: Important Fix — Request concurrency lock

**Files:**
- Modify: `src/api/routes.py`

- [ ] **Step 1: Add threading lock to routes.py**

At the top of `src/api/routes.py`, after imports:

```python
import threading
_gpu_lock = threading.Lock()
```

Wrap the processing blocks in `process`, `transcribe`, `diarize`, and `embed_speakers` with the lock. For example, in the `process` handler:

```python
@router.post("/process", response_model=ProcessResponse)
@_handle_gpu_errors
def process(req: ProcessRequest, request: Request):
    _validate_audio_path(req.audioPath)
    proc = get_processor(request)
    opts = req.options or ProcessingOptions()

    with _gpu_lock:
        result = proc.process(
            audio_path=req.audioPath,
            min_speakers=opts.minSpeakers,
            max_speakers=opts.maxSpeakers,
        )

    return ProcessResponse(...)
```

Apply the same `with _gpu_lock:` pattern to `transcribe`, `diarize`, and `embed_speakers` — wrap the model-calling code, not the response construction.

- [ ] **Step 2: Run unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/api/routes.py
git commit -m "fix(routes): add threading lock to prevent concurrent GPU OOM"
```

---

### Task 10: Pipeline update — Add alignment step + quality passthrough

**Files:**
- Modify: `src/pipeline/processor.py`
- Test: `tests/test_processor.py`

- [ ] **Step 1: Write test for alignment in pipeline**

Add to `tests/test_processor.py`:

```python
    def test_process_runs_alignment_when_available(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]
        mock_aligner = MagicMock()
        mock_aligner.align.return_value = mock_transcriber.transcribe.return_value

        def get_or_load(name, loader):
            return {"transcriber": mock_transcriber, "diarizer": mock_diarizer,
                    "aligner": mock_aligner}.get(name)
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")
        mock_aligner.align.assert_called_once()
        assert result["quality"]["avg_confidence"] == 0.95

    def test_process_continues_if_alignment_fails(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]

        def get_or_load(name, loader):
            if name == "aligner":
                raise Exception("Alignment model not available")
            return {"transcriber": mock_transcriber, "diarizer": mock_diarizer}.get(name)
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")
        assert result["text"] == "Hello"  # still works without alignment
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_processor.py -v`
Expected: New tests FAIL — processor doesn't have alignment step yet

- [ ] **Step 3: Update processor.py**

Replace `src/pipeline/processor.py`:

```python
import logging
from models.manager import ModelManager
from pipeline.merger import merge_transcript_with_diarization

logger = logging.getLogger(__name__)


class Processor:
    """Orchestrates the full transcription + diarization pipeline."""

    def __init__(self, model_manager: ModelManager):
        self.manager = model_manager

    def process(
        self,
        audio_path: str,
        num_speakers: int | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> dict:
        """Full pipeline: transcribe → align → diarize → merge."""
        # Step 1: Transcribe
        logger.info(f"Transcribing: {audio_path}")
        transcriber = self.manager.get_or_load("transcriber", self._load_transcriber)
        transcription = transcriber.transcribe(audio_path)

        # Step 2: Align (optional)
        try:
            aligner = self.manager.get_or_load("aligner", self._load_aligner)
            transcription = aligner.align(audio_path, transcription)
        except Exception:
            logger.warning("Alignment unavailable, using native timestamps")

        # Step 3: Diarize
        logger.info(f"Diarizing: {audio_path}")
        diarizer = self.manager.get_or_load("diarizer", self._load_diarizer)
        segments = diarizer.diarize(
            audio_path,
            num_speakers=num_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )

        # Step 4: Merge
        entries = merge_transcript_with_diarization(transcription["words"], segments)

        return {
            "text": transcription["text"],
            "entries": entries,
            "segments": segments,
            "duration": transcription["duration"],
            "quality": transcription.get("quality"),
        }

    @staticmethod
    def _load_transcriber():
        from models.transcriber import Transcriber
        return Transcriber()

    @staticmethod
    def _load_diarizer():
        from models.diarizer import Diarizer
        return Diarizer()

    @staticmethod
    def _load_aligner():
        from models.aligner import Aligner
        return Aligner()
```

- [ ] **Step 4: Also update `/process` route to pass quality through**

In `src/api/routes.py`, update the `process` handler's return to include quality:

```python
    from api.schemas import QualityInfo
    quality_data = result.get("quality")
    quality = QualityInfo(**quality_data) if quality_data else None

    return ProcessResponse(
        text=result["text"],
        entries=[TranscriptEntry(**e) for e in result["entries"]],
        segments=[DiarizationSegment(**s) for s in result["segments"]],
        duration=result["duration"],
        quality=quality,
    )
```

Add `QualityInfo` to the imports from `api.schemas`.

- [ ] **Step 5: Update existing processor tests**

The existing `test_process_calls_transcribe_and_diarize` test mocks `get_or_load` for transcriber and diarizer only. The new processor will also call `get_or_load("aligner", ...)` which will raise `KeyError` or return `None` from the side_effect. Update the existing `get_or_load` side effects to raise `Exception` for unknown model names (simulating aligner not available):

```python
def get_or_load(name, loader):
    if name == "transcriber":
        return mock_transcriber
    elif name == "diarizer":
        return mock_diarizer
    raise Exception(f"Model {name} not available")
```

Apply this pattern to all three existing test methods. Also add `"quality": None` to the transcriber mock return values where missing.

- [ ] **Step 6: Run all tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/processor.py src/api/routes.py tests/test_processor.py
git commit -m "feat(pipeline): add alignment step with graceful fallback"
```

---

### Task 11: New Aligner — wav2vec2 forced alignment

**Files:**
- Create: `src/models/aligner.py`
- Create: `tests/test_aligner.py`

- [ ] **Step 1: Write unit tests**

Create `tests/test_aligner.py`:

```python
from unittest.mock import MagicMock, patch
from models.aligner import Aligner


class TestAligner:
    @patch("models.aligner.WAV2VEC2_ASR_BASE_960H")
    @patch("models.aligner.sf")
    def test_align_refines_timestamps(self, mock_sf, mock_bundle):
        """Alignment should return a dict with the same keys."""
        mock_sf.read.return_value = (__import__("numpy").zeros(16000, dtype="float32"), 16000)
        mock_model = MagicMock()
        mock_bundle.get_model.return_value = mock_model
        mock_bundle.get_labels.return_value = list(" ABCDEFGHIJKLMNOPQRSTUVWXYZ'")
        mock_bundle.sample_rate = 16000

        transcription = {
            "text": "Hello",
            "words": [{"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.95}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5,
            "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }

        aligner = Aligner()
        result = aligner.align("test.wav", transcription)

        assert "words" in result
        assert "text" in result
        assert result["text"] == "Hello"

    @patch("models.aligner.WAV2VEC2_ASR_BASE_960H")
    @patch("models.aligner.sf")
    def test_align_preserves_on_failure(self, mock_sf, mock_bundle):
        """If alignment fails for a segment, keep original timestamps."""
        mock_sf.read.side_effect = Exception("Audio load failed")
        mock_bundle.get_model.return_value = MagicMock()
        mock_bundle.get_labels.return_value = list(" ABCDEFGHIJKLMNOPQRSTUVWXYZ'")
        mock_bundle.sample_rate = 16000

        original_words = [{"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.95}]
        transcription = {
            "text": "Hello", "words": original_words,
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }

        aligner = Aligner()
        result = aligner.align("test.wav", transcription)

        # Should return original words unchanged
        assert result["words"] == original_words
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_aligner.py -v`
Expected: FAIL — `aligner.py` doesn't exist yet

- [ ] **Step 3: Create aligner.py**

Create `src/models/aligner.py` with the full implementation from the spec (Section 2). Key requirements:

- Load `WAV2VEC2_ASR_BASE_960H` bundle from `torchaudio.pipelines` (NOT `torch.hub.load`)
- Use `soundfile` for audio loading (NOT `torchaudio.load` — avoids torchcodec incompatibility)
- Call `torchaudio.functional.forced_align()` for Viterbi alignment
- Process one transcription segment at a time (NOT whole file — prevents OOM on 64-min audio)
- Fall back to original timestamps per-segment on any failure
- The `align()` method takes `(audio_path: str, transcription: dict)` and returns the same dict with refined `words`
- Include uncovered words (words not in any segment) in the output
- Sort refined words by start time after processing
- If `forced_align` is unavailable in nightly torchaudio, the import will fail and `Processor` catches it gracefully

The test mocks `sf` (soundfile) and `WAV2VEC2_ASR_BASE_960H` to avoid loading real models in unit tests.

- [ ] **Step 4: Run aligner tests**

Run: `python -m pytest tests/test_aligner.py -v`
Expected: All PASS

- [ ] **Step 5: Run all unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/models/aligner.py tests/test_aligner.py
git commit -m "feat(aligner): add wav2vec2 forced alignment with per-segment fallback"
```

---

### Task 12: Update /models endpoint + integration tests

**Files:**
- Modify: `src/api/routes.py` (`/models` handler)
- Modify: `tests/test_routes.py` (models test)
- Modify: `tests/test_integration.py` (remove WAV-only comment)

- [ ] **Step 1: Add `alignment` field to `ModelsResponse` schema**

In `src/api/schemas.py`, update `ModelsResponse`:

```python
class ModelsResponse(BaseModel):
    transcription: list[str]
    diarization: list[str]
    embedding: list[str]
    alignment: list[str] = []
```

- [ ] **Step 2: Update /models endpoint**

In `src/api/routes.py`, update the `models()` handler:

```python
@router.get("/models", response_model=ModelsResponse)
def models():
    return ModelsResponse(
        transcription=["large-v3-turbo"],
        diarization=["pyannote-3.1"],
        embedding=["pyannote-embedding"],
        alignment=["wav2vec2-base"],
    )
```

- [ ] **Step 3: Update models test**

In `tests/test_routes.py`, update `TestModelsEndpoint`:

```python
class TestModelsEndpoint:
    def test_models_returns_available(self, client):
        resp = client.get("/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "transcription" in data
        assert "large-v3-turbo" in data["transcription"]
        assert "alignment" in data
        assert "wav2vec2-base" in data["alignment"]
```

- [ ] **Step 4: Update integration test comments**

In `tests/test_integration.py`, update the fixture selection comment:

```python
FIXTURE_DIR = Path(__file__).parent.parent / "fixtures"
TEST_AUDIO_WAV = FIXTURE_DIR / "two_speakers_short.wav"
TEST_AUDIO_MP3 = FIXTURE_DIR / "two_speakers_short.mp3"
TEST_AUDIO = TEST_AUDIO_WAV if TEST_AUDIO_WAV.exists() else TEST_AUDIO_MP3
```

(Remove the `# Prefer WAV (onnx-asr uses wave module which only reads WAV/RIFF)` comment since faster-whisper handles both formats.)

- [ ] **Step 5: Run unit tests**

Run: `python -m pytest tests/ -v -m "not gpu"`
Expected: All PASS

- [ ] **Step 6: Run GPU integration tests**

```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
python -m pytest tests/test_integration.py -v -m gpu --tb=short
```

Expected: All 4 PASS. If CTranslate2 doesn't support RTX 5090 GPU, transcription falls back to CPU — tests should still pass, just slower.

- [ ] **Step 7: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS (unit + GPU integration)

- [ ] **Step 8: Commit**

```bash
git add src/api/schemas.py src/api/routes.py tests/test_routes.py tests/test_integration.py
git commit -m "chore: update /models endpoint and integration tests for faster-whisper"
```

---

### Task 13: End-to-end validation on real meeting

**Files:** None — validation only

- [ ] **Step 1: Run the full pipeline on the 64-minute meeting**

```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"

python -c "
import sys, json, time
sys.path.insert(0, 'src')
from models.transcriber import Transcriber
from models.diarizer import Diarizer
from pipeline.merger import merge_transcript_with_diarization

AUDIO = 'C:/Users/brigh/AppData/Roaming/jd-notes-things/recordings/windows-desktop-6ea5ab11-c451-42fc-931b-20093982c28f.mp3'

transcriber = Transcriber()
t0 = time.time()
transcript = transcriber.transcribe(AUDIO)
print(f'Transcribed in {time.time()-t0:.0f}s — {len(transcript[\"words\"])} words')
print(f'Quality: {transcript[\"quality\"]}')
print(f'Duration: {transcript[\"duration\"]:.1f}s')

diarizer = Diarizer()
t0 = time.time()
segments = diarizer.diarize(AUDIO, min_speakers=2, max_speakers=6)
print(f'Diarized in {time.time()-t0:.0f}s — {len(segments)} segments')

entries = merge_transcript_with_diarization(transcript['words'], segments)

with open('fixtures/meeting_transcript_v2.txt', 'w', encoding='utf-8') as f:
    f.write(f'Duration: {transcript[\"duration\"]:.1f}s ({transcript[\"duration\"]/60:.1f} min)\n')
    f.write(f'Quality: avg_confidence={transcript[\"quality\"][\"avg_confidence\"]:.3f}, flagged={len(transcript[\"quality\"][\"flagged_segments\"])}\n')
    f.write(f'Speakers: {len(set(s[\"speaker\"] for s in segments))}\n')
    f.write(f'Words: {len(transcript[\"words\"])}\n\n')
    for entry in entries:
        mins = int(entry['timestamp'] // 60)
        secs = int(entry['timestamp'] % 60)
        f.write(f'[{mins:02d}:{secs:02d}] {entry[\"speaker\"]}: {entry[\"text\"]}\n\n')

print('Saved to fixtures/meeting_transcript_v2.txt')
"
```

- [ ] **Step 2: Verify transcript quality**

Open `fixtures/meeting_transcript_v2.txt` and check:
- Timestamps are accurate and increase monotonically
- Speaker labels are consistent (no "Unknown")
- Word-level timestamps are precise (spot-check a few against audio)
- No hallucinated/repeated text (check quality.flagged_segments count)
- MP3 input worked directly (no ffmpeg conversion needed)

- [ ] **Step 3: Compare against v1 transcript**

Compare `fixtures/meeting_transcript_v2.txt` against `fixtures/meeting_transcript.txt` (the Parakeet version). Look for:
- Better speaker boundary accuracy
- More precise timestamps
- Cleaner text (fewer filler artifacts)

- [ ] **Step 4: Final commit**

```bash
git add fixtures/meeting_transcript_v2.txt
git commit -m "feat: complete faster-whisper migration — v0.2.0"
```
