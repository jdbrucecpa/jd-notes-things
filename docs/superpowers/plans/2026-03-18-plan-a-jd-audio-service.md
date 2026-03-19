# Plan A: JD Audio Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Python service that transcribes audio with speaker diarization and voice identification, exposed via a FastAPI HTTP API with system tray lifecycle management.

**Architecture:** Stateless HTTP service with lazy-loaded GPU models. FastAPI handles requests, a ModelManager controls GPU memory (load on demand, auto-unload after idle timeout), and pystray provides Windows system tray start/stop UX. The service processes audio files at a given path and returns JSON results — it stores no state.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, NVIDIA NeMo (Parakeet TDT 0.6B V2), PyAnnote audio 3.1, PyAnnote embedding, pystray, pytest

**Spec:** `docs/superpowers/specs/2026-03-18-v2-local-first-design.md` — Component 1

---

## File Structure

```
services/jd-audio-service/
├── pyproject.toml                    # Project metadata + dependencies
├── requirements.txt                  # Pinned dependencies for venv install
├── run-jd-audio-service.bat          # Windows launcher (activates venv, starts service)
├── setup-jd-audio-service.bat        # One-time setup (create venv, install deps, download models)
├── src/
│   ├── __init__.py
│   ├── main.py                       # Entry point: parse args, start tray + server
│   ├── config.py                     # Configuration constants (port, timeouts, model paths)
│   ├── server.py                     # FastAPI app definition + lifespan
│   ├── models/
│   │   ├── __init__.py
│   │   ├── manager.py                # ModelManager: lazy load, auto-unload, GPU tracking
│   │   ├── transcriber.py            # Parakeet wrapper: load model, transcribe audio
│   │   ├── diarizer.py               # PyAnnote diarization wrapper
│   │   └── embedder.py               # PyAnnote embedding wrapper
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── processor.py              # Full /process pipeline orchestration
│   │   └── merger.py                 # Align transcription words with diarization segments
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py                 # All FastAPI route definitions
│   │   └── schemas.py                # Pydantic request/response models
│   └── tray/
│       ├── __init__.py
│       └── app.py                    # System tray icon, menu, server lifecycle
├── tests/
│   ├── conftest.py                   # Shared fixtures (mock models, test audio, FastAPI TestClient)
│   ├── test_schemas.py               # Pydantic model validation tests
│   ├── test_merger.py                # Transcript-diarization alignment tests
│   ├── test_manager.py               # ModelManager lifecycle tests
│   ├── test_routes.py                # API endpoint tests (mocked models)
│   ├── test_processor.py             # Pipeline orchestration tests (mocked models)
│   ├── test_identify.py              # Speaker identification cosine distance tests
│   └── test_integration.py           # Full pipeline with real models (requires GPU, optional)
└── fixtures/
    └── two_speakers_short.wav        # ~10s test audio with 2 speakers (for integration tests)
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `services/jd-audio-service/.gitignore`
- Create: `services/jd-audio-service/pyproject.toml`
- Create: `services/jd-audio-service/requirements.txt`
- Create: `services/jd-audio-service/src/__init__.py`
- Create: `services/jd-audio-service/src/config.py`
- Create: `services/jd-audio-service/tests/conftest.py`

- [ ] **Step 1: Create directory structure**

```bash
cd /c/Users/brigh/Documents/code/jd-notes-things
mkdir -p services/jd-audio-service/{src/{models,pipeline,api,tray},tests,fixtures}
```

- [ ] **Step 2: Create .gitignore**

```gitignore
# services/jd-audio-service/.gitignore
venv/
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
dist/
build/
```

- [ ] **Step 3: Create pyproject.toml**

```toml
# services/jd-audio-service/pyproject.toml
[project]
name = "jd-audio-service"
version = "0.1.0"
description = "Local audio transcription + diarization + speaker identification service"
requires-python = ">=3.11"

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
asyncio_mode = "auto"
markers = [
    "gpu: requires GPU and real models (deselect with '-m not gpu')",
]
```

- [ ] **Step 4: Create requirements.txt**

```txt
# services/jd-audio-service/requirements.txt
fastapi>=0.115
uvicorn[standard]>=0.32
pydantic>=2.9
nemo_toolkit[asr]>=2.2
pyannote.audio>=3.1
torch>=2.4
pystray>=0.19
Pillow>=10.0
numpy>=1.26
scipy>=1.14

# Dev
pytest>=8.0
pytest-asyncio>=0.23
httpx>=0.27
```

- [ ] **Step 5: Create config.py**

```python
# services/jd-audio-service/src/config.py
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

# Parakeet model identifier
TRANSCRIPTION_MODEL = "nvidia/parakeet-tdt-0.6b-v2"

# PyAnnote model identifiers
DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"
EMBEDDING_MODEL = "pyannote/embedding"

# Version
VERSION = "0.1.0"
```

- [ ] **Step 6: Create __init__.py files and conftest.py**

```python
# services/jd-audio-service/src/__init__.py
# (empty)
```

```python
# services/jd-audio-service/src/models/__init__.py
# (empty)
```

```python
# services/jd-audio-service/src/pipeline/__init__.py
# (empty)
```

```python
# services/jd-audio-service/src/api/__init__.py
# (empty)
```

```python
# services/jd-audio-service/src/tray/__init__.py
# (empty)
```

```python
# services/jd-audio-service/tests/conftest.py
# pythonpath configured in pyproject.toml — no sys.path manipulation needed
```

- [ ] **Step 7: Verify pytest discovers tests**

```bash
cd services/jd-audio-service
python -m pytest --collect-only 2>&1 | head -5
```
Expected: `no tests ran` (empty collection, no errors)

- [ ] **Step 8: Commit**

```bash
git add -f services/jd-audio-service/
git commit -m "feat(audio-service): scaffold project structure and config"
```

---

## Task 2: Pydantic Schemas (Request/Response Models)

**Files:**
- Create: `services/jd-audio-service/src/api/schemas.py`
- Create: `services/jd-audio-service/tests/test_schemas.py`

- [ ] **Step 1: Write schema validation tests**

```python
# services/jd-audio-service/tests/test_schemas.py
import pytest
from api.schemas import (
    ProcessRequest, ProcessResponse, TranscribeRequest, TranscribeResponse,
    DiarizeRequest, DiarizeResponse, EmbedSpeakersRequest, EmbedSpeakersResponse,
    IdentifySpeakersRequest, IdentifySpeakersResponse,
    HealthResponse, ModelsResponse, UnloadResponse,
    TranscriptEntry, DiarizationSegment, SpeakerEmbedding, SpeakerProfile, SpeakerMatch,
    ProcessingOptions,
)


class TestProcessRequest:
    def test_valid_request(self):
        req = ProcessRequest(audioPath="C:/recordings/test.mp3")
        assert req.audioPath == "C:/recordings/test.mp3"
        assert req.options is None

    def test_with_options(self):
        req = ProcessRequest(
            audioPath="/path/to/file.wav",
            options=ProcessingOptions(
                speakerNames=["Tim", "Sarah"],
                minSpeakers=2,
                maxSpeakers=5,
                vocabulary=["Obsidian"],
            ),
        )
        assert req.options.speakerNames == ["Tim", "Sarah"]
        assert req.options.minSpeakers == 2

    def test_missing_audio_path_fails(self):
        with pytest.raises(Exception):
            ProcessRequest()


class TestProcessResponse:
    def test_valid_response(self):
        resp = ProcessResponse(
            text="Hello world",
            entries=[
                TranscriptEntry(speaker="Speaker 1", text="Hello", timestamp=0.0, words=[]),
                TranscriptEntry(speaker="Speaker 2", text="World", timestamp=1.5, words=[]),
            ],
            segments=[
                DiarizationSegment(speaker="Speaker 1", start=0.0, end=1.2),
                DiarizationSegment(speaker="Speaker 2", start=1.3, end=2.5),
            ],
            duration=2.5,
        )
        assert len(resp.entries) == 2
        assert resp.duration == 2.5


class TestIdentifySpeakers:
    def test_valid_request(self):
        req = IdentifySpeakersRequest(
            embeddings=[SpeakerEmbedding(speaker="Speaker 1", vector=[0.1] * 256, duration=30.0)],
            profiles=[SpeakerEmbedding(speaker="Tim", vector=[0.1] * 256, duration=120.0)],
        )
        assert len(req.embeddings) == 1

    def test_valid_response(self):
        resp = IdentifySpeakersResponse(
            matches=[SpeakerMatch(speaker="Speaker 1", name="Tim", confidence=0.94, distance=0.12)]
        )
        assert resp.matches[0].confidence == 0.94


class TestHealthResponse:
    def test_valid_response(self):
        resp = HealthResponse(
            status="idle",
            modelsLoaded=["parakeet-tdt-0.6b-v2"],
            vramUsed=1500.0,
            engineVersion="0.1.0",
        )
        assert resp.status == "idle"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_schemas.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'api.schemas'`

- [ ] **Step 3: Implement schemas**

```python
# services/jd-audio-service/src/api/schemas.py
from pydantic import BaseModel


class ProcessingOptions(BaseModel):
    speakerNames: list[str] | None = None
    minSpeakers: int | None = None
    maxSpeakers: int | None = None
    vocabulary: list[str] | None = None


# --- Shared types ---

class WordTiming(BaseModel):
    word: str
    start: float
    end: float
    confidence: float | None = None


class TranscriptEntry(BaseModel):
    speaker: str | None = None
    text: str
    timestamp: float
    words: list[WordTiming] = []


class DiarizationSegment(BaseModel):
    speaker: str
    start: float
    end: float


class SpeakerEmbedding(BaseModel):
    speaker: str
    vector: list[float]
    duration: float = 0.0


class SpeakerMatch(BaseModel):
    speaker: str
    name: str | None = None
    confidence: float
    distance: float | None = None


class SpeakerProfile(BaseModel):
    name: str
    vector: list[float]
    duration: float = 0.0


# --- Request/Response pairs ---

class ProcessRequest(BaseModel):
    audioPath: str
    options: ProcessingOptions | None = None


class ProcessResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    segments: list[DiarizationSegment]
    duration: float


class TranscribeRequest(BaseModel):
    audioPath: str
    options: ProcessingOptions | None = None


class TranscribeResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    duration: float


class DiarizeRequest(BaseModel):
    audioPath: str
    numSpeakers: int | None = None
    minSpeakers: int | None = None
    maxSpeakers: int | None = None


class DiarizeResponse(BaseModel):
    segments: list[DiarizationSegment]


class EmbedSpeakersRequest(BaseModel):
    audioPath: str
    segments: list[DiarizationSegment]


class EmbedSpeakersResponse(BaseModel):
    embeddings: list[SpeakerEmbedding]


class IdentifySpeakersRequest(BaseModel):
    embeddings: list[SpeakerEmbedding]
    profiles: list[SpeakerProfile]


class IdentifySpeakersResponse(BaseModel):
    matches: list[SpeakerMatch]


class HealthResponse(BaseModel):
    status: str
    modelsLoaded: list[str]
    vramUsed: float
    engineVersion: str


class ModelsResponse(BaseModel):
    transcription: list[str]
    diarization: list[str]
    embedding: list[str]


class UnloadResponse(BaseModel):
    status: str
    vramFreed: float
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_schemas.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/api/schemas.py services/jd-audio-service/tests/test_schemas.py
git commit -m "feat(audio-service): add Pydantic request/response schemas with tests"
```

---

## Task 3: ModelManager (Lazy Load / Auto-Unload)

**Files:**
- Create: `services/jd-audio-service/src/models/manager.py`
- Create: `services/jd-audio-service/tests/test_manager.py`

- [ ] **Step 1: Write ModelManager tests**

```python
# services/jd-audio-service/tests/test_manager.py
import time
import pytest
from unittest.mock import MagicMock, patch
from models.manager import ModelManager


class TestModelManager:
    def setup_method(self):
        self.manager = ModelManager(idle_timeout_seconds=2)

    def test_initial_state_nothing_loaded(self):
        assert self.manager.loaded_models == {}
        assert self.manager.is_loaded("transcriber") is False

    def test_get_or_load_calls_loader_once(self):
        mock_model = MagicMock()
        loader = MagicMock(return_value=mock_model)

        result1 = self.manager.get_or_load("transcriber", loader)
        result2 = self.manager.get_or_load("transcriber", loader)

        assert result1 is mock_model
        assert result2 is mock_model
        loader.assert_called_once()  # Only loaded once

    def test_get_or_load_updates_last_used(self):
        loader = MagicMock(return_value=MagicMock())
        self.manager.get_or_load("transcriber", loader)

        assert "transcriber" in self.manager.last_used
        assert self.manager.last_used["transcriber"] > 0

    def test_unload_specific_model(self):
        mock_model = MagicMock()
        loader = MagicMock(return_value=mock_model)
        self.manager.get_or_load("transcriber", loader)

        self.manager.unload("transcriber")

        assert self.manager.is_loaded("transcriber") is False

    def test_unload_all(self):
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        self.manager.get_or_load("diarizer", MagicMock(return_value=MagicMock()))

        freed = self.manager.unload_all()

        assert self.manager.loaded_models == {}
        assert freed == 2

    def test_unload_nonexistent_is_safe(self):
        self.manager.unload("nonexistent")  # Should not raise

    def test_collect_idle_unloads_expired(self):
        self.manager = ModelManager(idle_timeout_seconds=0)  # Immediate expiry
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        time.sleep(0.05)

        unloaded = self.manager.collect_idle()

        assert "transcriber" not in self.manager.loaded_models
        assert unloaded == ["transcriber"]

    def test_collect_idle_keeps_recent(self):
        self.manager = ModelManager(idle_timeout_seconds=300)
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))

        unloaded = self.manager.collect_idle()

        assert "transcriber" in self.manager.loaded_models
        assert unloaded == []

    def test_loaded_model_names(self):
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        self.manager.get_or_load("diarizer", MagicMock(return_value=MagicMock()))

        names = self.manager.loaded_model_names()
        assert set(names) == {"transcriber", "diarizer"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_manager.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'models.manager'`

- [ ] **Step 3: Implement ModelManager**

```python
# services/jd-audio-service/src/models/manager.py
import time
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages lazy loading and auto-unloading of GPU models."""

    def __init__(self, idle_timeout_seconds: int = 300):
        self.idle_timeout_seconds = idle_timeout_seconds
        self.loaded_models: dict[str, Any] = {}
        self.last_used: dict[str, float] = {}
        self._lock = threading.Lock()

    def get_or_load(self, name: str, loader: Callable[[], Any]) -> Any:
        with self._lock:
            if name not in self.loaded_models:
                logger.info(f"Loading model: {name}")
                self.loaded_models[name] = loader()
                logger.info(f"Model loaded: {name}")
            self.last_used[name] = time.monotonic()
            return self.loaded_models[name]

    def is_loaded(self, name: str) -> bool:
        return name in self.loaded_models

    def unload(self, name: str) -> None:
        with self._lock:
            if name in self.loaded_models:
                logger.info(f"Unloading model: {name}")
                del self.loaded_models[name]
                self.last_used.pop(name, None)
                self._free_gpu_memory()

    def unload_all(self) -> int:
        with self._lock:
            count = len(self.loaded_models)
            self.loaded_models.clear()
            self.last_used.clear()
            if count > 0:
                self._free_gpu_memory()
            logger.info(f"Unloaded all models ({count})")
            return count

    @staticmethod
    def _free_gpu_memory():
        import gc
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

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
        return to_unload

    def loaded_model_names(self) -> list[str]:
        return list(self.loaded_models.keys())
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_manager.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/models/manager.py services/jd-audio-service/tests/test_manager.py
git commit -m "feat(audio-service): add ModelManager with lazy load and auto-unload"
```

---

## Task 4: Transcript-Diarization Merger

**Files:**
- Create: `services/jd-audio-service/src/pipeline/merger.py`
- Create: `services/jd-audio-service/tests/test_merger.py`

This is pure logic (no GPU, no models) — aligns word-level timestamps from transcription with speaker segments from diarization.

- [ ] **Step 1: Write merger tests**

```python
# services/jd-audio-service/tests/test_merger.py
from pipeline.merger import merge_transcript_with_diarization


class TestMerger:
    def test_simple_two_speaker_merge(self):
        """Two speakers, clean non-overlapping segments."""
        words = [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "there", "start": 0.6, "end": 1.0},
            {"word": "Hi", "start": 1.5, "end": 1.8},
            {"word": "back", "start": 1.9, "end": 2.2},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.2},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert len(entries) == 2
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Hello there"
        assert entries[0]["timestamp"] == 0.0
        assert entries[1]["speaker"] == "SPEAKER_01"
        assert entries[1]["text"] == "Hi back"

    def test_single_speaker(self):
        words = [
            {"word": "Just", "start": 0.0, "end": 0.3},
            {"word": "me", "start": 0.4, "end": 0.6},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert len(entries) == 1
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Just me"

    def test_speaker_change_mid_utterance(self):
        """Word midpoint determines which segment it belongs to."""
        words = [
            {"word": "Goodbye", "start": 0.8, "end": 1.4},  # midpoint 1.1, in SPEAKER_00
            {"word": "Hello", "start": 1.5, "end": 2.0},     # midpoint 1.75, in SPEAKER_01
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.3},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert len(entries) == 2
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Goodbye"
        assert entries[1]["speaker"] == "SPEAKER_01"
        assert entries[1]["text"] == "Hello"

    def test_empty_words(self):
        entries = merge_transcript_with_diarization([], [{"speaker": "SPEAKER_00", "start": 0, "end": 1}])
        assert entries == []

    def test_empty_segments(self):
        words = [{"word": "Hello", "start": 0.0, "end": 0.5}]
        entries = merge_transcript_with_diarization(words, [])
        assert len(entries) == 1
        assert entries[0]["speaker"] == "Unknown"

    def test_words_outside_any_segment(self):
        """Words not covered by any segment get 'Unknown' speaker."""
        words = [
            {"word": "Before", "start": 0.0, "end": 0.3},
            {"word": "During", "start": 1.0, "end": 1.3},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.8, "end": 1.5},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert entries[0]["speaker"] == "Unknown"
        assert entries[0]["text"] == "Before"
        assert entries[1]["speaker"] == "SPEAKER_00"
        assert entries[1]["text"] == "During"

    def test_consecutive_words_same_speaker_grouped(self):
        """Words from the same speaker are grouped into one entry."""
        words = [
            {"word": "One", "start": 0.0, "end": 0.3},
            {"word": "two", "start": 0.4, "end": 0.6},
            {"word": "three", "start": 0.7, "end": 1.0},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 2.0},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert len(entries) == 1
        assert entries[0]["text"] == "One two three"

    def test_words_include_timing_info(self):
        words = [
            {"word": "Hello", "start": 0.5, "end": 0.9, "confidence": 0.98},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
        ]

        entries = merge_transcript_with_diarization(words, segments)

        assert entries[0]["words"][0]["word"] == "Hello"
        assert entries[0]["words"][0]["start"] == 0.5
        assert entries[0]["words"][0]["confidence"] == 0.98
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_merger.py -v
```
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement merger**

```python
# services/jd-audio-service/src/pipeline/merger.py


def _find_speaker_for_word(word: dict, segments: list[dict]) -> str:
    """Find which speaker segment a word belongs to, using word midpoint."""
    midpoint = (word["start"] + word["end"]) / 2
    for seg in segments:
        if seg["start"] <= midpoint <= seg["end"]:
            return seg["speaker"]
    return "Unknown"


def merge_transcript_with_diarization(
    words: list[dict],
    segments: list[dict],
) -> list[dict]:
    """Align word-level transcription with speaker diarization segments.

    Groups consecutive words from the same speaker into transcript entries.

    Args:
        words: List of {word, start, end, confidence?} from transcription.
        segments: List of {speaker, start, end} from diarization.

    Returns:
        List of transcript entries: {speaker, text, timestamp, words}.
    """
    if not words:
        return []

    if not segments:
        segments = []

    entries = []
    current_speaker = None
    current_words = []
    current_timestamp = 0.0

    for word in words:
        speaker = _find_speaker_for_word(word, segments)

        if speaker != current_speaker and current_words:
            entries.append({
                "speaker": current_speaker,
                "text": " ".join(w["word"] for w in current_words),
                "timestamp": current_timestamp,
                "words": [
                    {k: v for k, v in w.items()}
                    for w in current_words
                ],
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
            "words": [
                {k: v for k, v in w.items()}
                for w in current_words
            ],
        })

    return entries
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_merger.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/pipeline/merger.py services/jd-audio-service/tests/test_merger.py
git commit -m "feat(audio-service): add transcript-diarization merger with tests"
```

---

## Task 5: Speaker Identification Logic (Cosine Distance)

**Files:**
- Create: `services/jd-audio-service/tests/test_identify.py`

The identification logic will live in `routes.py` (it's a small function), but the math is testable independently.

- [ ] **Step 1: Write speaker identification tests**

```python
# services/jd-audio-service/tests/test_identify.py
import numpy as np
from pipeline.identifier import identify_speakers


class TestIdentifySpeakers:
    def test_identical_vectors_perfect_match(self):
        vec = [0.1] * 256
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": vec}],
            profiles=[{"name": "Tim", "vector": vec}],
        )
        assert len(matches) == 1
        assert matches[0]["name"] == "Tim"
        assert matches[0]["distance"] < 0.01
        assert matches[0]["confidence"] > 0.9

    def test_orthogonal_vectors_no_match(self):
        vec_a = [1.0] + [0.0] * 255
        vec_b = [0.0, 1.0] + [0.0] * 254
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": vec_a}],
            profiles=[{"name": "Tim", "vector": vec_b}],
        )
        assert matches[0]["name"] is None
        assert matches[0]["confidence"] < 0.5

    def test_close_vectors_match(self):
        rng = np.random.default_rng(42)
        base = rng.standard_normal(256).tolist()
        similar = [b + 0.05 * n for b, n in zip(base, rng.standard_normal(256))]
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": base}],
            profiles=[{"name": "Tim", "vector": similar}],
        )
        assert matches[0]["name"] == "Tim"
        assert matches[0]["confidence"] > 0.5

    def test_best_match_selected_from_multiple_profiles(self):
        target = [1.0, 0.0] + [0.0] * 254
        close = [0.95, 0.05] + [0.0] * 254
        far = [0.0, 1.0] + [0.0] * 254

        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": target}],
            profiles=[
                {"name": "Tim", "vector": close},
                {"name": "Sarah", "vector": far},
            ],
        )
        assert matches[0]["name"] == "Tim"

    def test_no_profiles_returns_no_matches(self):
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": [0.1] * 256}],
            profiles=[],
        )
        assert matches[0]["name"] is None

    def test_no_embeddings_returns_empty(self):
        matches = identify_speakers(embeddings=[], profiles=[])
        assert matches == []

    def test_multiple_speakers_matched_independently(self):
        vec_a = [1.0, 0.0] + [0.0] * 254
        vec_b = [0.0, 1.0] + [0.0] * 254

        matches = identify_speakers(
            embeddings=[
                {"speaker": "Speaker 1", "vector": vec_a},
                {"speaker": "Speaker 2", "vector": vec_b},
            ],
            profiles=[
                {"name": "Tim", "vector": vec_a},
                {"name": "Sarah", "vector": vec_b},
            ],
        )
        names = {m["speaker"]: m["name"] for m in matches}
        assert names["Speaker 1"] == "Tim"
        assert names["Speaker 2"] == "Sarah"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_identify.py -v
```
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement identifier**

```python
# services/jd-audio-service/src/pipeline/identifier.py
import numpy as np
from scipy.spatial.distance import cosine

# Cosine distance thresholds (per spec)
HIGH_CONFIDENCE_THRESHOLD = 0.25
MEDIUM_CONFIDENCE_THRESHOLD = 0.45


def identify_speakers(
    embeddings: list[dict],
    profiles: list[dict],
) -> list[dict]:
    """Match speaker embeddings against stored voice profiles using cosine distance.

    Args:
        embeddings: List of {speaker, vector} from current meeting.
        profiles: List of {name, vector} from stored voice profiles.

    Returns:
        List of {speaker, name, confidence, distance} matches.
    """
    if not embeddings:
        return []

    results = []
    for emb in embeddings:
        if not profiles:
            results.append({
                "speaker": emb["speaker"],
                "name": None,
                "confidence": 0.0,
                "distance": None,
            })
            continue

        emb_vec = np.array(emb["vector"], dtype=np.float32)
        best_distance = float("inf")
        best_name = None

        for prof in profiles:
            prof_vec = np.array(prof["vector"], dtype=np.float32)
            dist = cosine(emb_vec, prof_vec)
            if dist < best_distance:
                best_distance = dist
                best_name = prof["name"]

        if best_distance <= HIGH_CONFIDENCE_THRESHOLD:
            confidence = 1.0 - (best_distance / HIGH_CONFIDENCE_THRESHOLD)
            confidence = 0.75 + 0.25 * confidence  # Scale to 0.75-1.0
        elif best_distance <= MEDIUM_CONFIDENCE_THRESHOLD:
            confidence = 0.5 + 0.25 * (1.0 - (best_distance - HIGH_CONFIDENCE_THRESHOLD) / (MEDIUM_CONFIDENCE_THRESHOLD - HIGH_CONFIDENCE_THRESHOLD))
        else:
            confidence = 0.0
            best_name = None

        results.append({
            "speaker": emb["speaker"],
            "name": best_name,
            "confidence": round(confidence, 3),
            "distance": round(best_distance, 4),
        })

    return results
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_identify.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/pipeline/identifier.py services/jd-audio-service/tests/test_identify.py
git commit -m "feat(audio-service): add speaker identification with cosine distance matching"
```

---

## Task 6: Model Wrappers (Transcriber, Diarizer, Embedder)

**Files:**
- Create: `services/jd-audio-service/src/models/transcriber.py`
- Create: `services/jd-audio-service/src/models/diarizer.py`
- Create: `services/jd-audio-service/src/models/embedder.py`

These wrap the actual ML libraries. They are thin wrappers — the real complexity is in the libraries. Tests use `@pytest.mark.gpu` and are skipped without GPU.

- [ ] **Step 1: Implement transcriber wrapper**

```python
# services/jd-audio-service/src/models/transcriber.py
import logging
import nemo.collections.asr as nemo_asr
from config import TRANSCRIPTION_MODEL, MODEL_CACHE_DIR

logger = logging.getLogger(__name__)


class Transcriber:
    """Wrapper around NVIDIA Parakeet for speech-to-text."""

    def __init__(self):
        logger.info(f"Loading transcription model: {TRANSCRIPTION_MODEL}")
        self.model = nemo_asr.models.ASRModel.from_pretrained(
            model_name=TRANSCRIPTION_MODEL,
        )
        logger.info("Transcription model loaded")

    def transcribe(self, audio_path: str) -> dict:
        """Transcribe audio file to text with word-level timestamps.

        Args:
            audio_path: Absolute path to audio file (WAV or MP3).

        Returns:
            dict with keys: text, words (list of {word, start, end}), duration
        """
        output = self.model.transcribe([audio_path], timestamps=True)
        result = output[0]

        words = []
        if hasattr(result, "timestamp") and result.timestamp and "word" in result.timestamp:
            for w in result.timestamp["word"]:
                words.append({
                    "word": w["word"],
                    "start": round(w["start"], 3),
                    "end": round(w["end"], 3),
                })

        # Extract segment-level timestamps
        segments = []
        if hasattr(result, "timestamp") and result.timestamp and "segment" in result.timestamp:
            for seg in result.timestamp["segment"]:
                segments.append({
                    "text": seg.get("segment", ""),
                    "start": round(seg["start"], 3),
                    "end": round(seg["end"], 3),
                })

        # Estimate duration from last word end or segment timestamps
        duration = 0.0
        if words:
            duration = words[-1]["end"]
        elif segments:
            duration = segments[-1]["end"]

        return {
            "text": result.text,
            "words": words,
            "segments": segments,
            "duration": round(duration, 3),
        }
```

- [ ] **Step 2: Implement diarizer wrapper**

```python
# services/jd-audio-service/src/models/diarizer.py
import logging
import torch
from pyannote.audio import Pipeline
from config import DIARIZATION_MODEL

logger = logging.getLogger(__name__)


class Diarizer:
    """Wrapper around PyAnnote speaker diarization pipeline."""

    def __init__(self):
        logger.info(f"Loading diarization model: {DIARIZATION_MODEL}")
        self.pipeline = Pipeline.from_pretrained(
            DIARIZATION_MODEL,
            use_auth_token=self._get_hf_token(),
        )
        if torch.cuda.is_available():
            self.pipeline.to(torch.device("cuda"))
        logger.info("Diarization model loaded")

    def diarize(
        self,
        audio_path: str,
        num_speakers: int | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> list[dict]:
        """Run speaker diarization on audio file.

        Returns:
            List of {speaker, start, end} segments.
        """
        kwargs = {}
        if num_speakers is not None:
            kwargs["num_speakers"] = num_speakers
        if min_speakers is not None:
            kwargs["min_speakers"] = min_speakers
        if max_speakers is not None:
            kwargs["max_speakers"] = max_speakers

        diarization = self.pipeline(audio_path, **kwargs)

        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
            })

        return segments

    @staticmethod
    def _get_hf_token() -> str | None:
        import os
        return os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
```

- [ ] **Step 3: Implement embedder wrapper**

```python
# services/jd-audio-service/src/models/embedder.py
import logging
import numpy as np
from pyannote.audio import Model, Inference
from config import EMBEDDING_MODEL

logger = logging.getLogger(__name__)


class Embedder:
    """Wrapper around PyAnnote speaker embedding model."""

    def __init__(self):
        logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
        model = Model.from_pretrained(
            EMBEDDING_MODEL,
            use_auth_token=self._get_hf_token(),
        )
        self.inference = Inference(model, window="whole")
        logger.info("Embedding model loaded")

    def embed_segments(
        self,
        audio_path: str,
        segments: list[dict],
    ) -> list[dict]:
        """Extract speaker embeddings for each diarization segment cluster.

        Groups segments by speaker, extracts embedding from longest segment
        per speaker (best audio quality).

        Args:
            audio_path: Path to audio file.
            segments: List of {speaker, start, end} from diarization.

        Returns:
            List of {speaker, vector, duration} per unique speaker.
        """
        from pyannote.core import Segment

        # Group segments by speaker, find longest per speaker
        speaker_segments: dict[str, list[dict]] = {}
        for seg in segments:
            speaker_segments.setdefault(seg["speaker"], []).append(seg)

        results = []
        for speaker, segs in speaker_segments.items():
            total_duration = sum(s["end"] - s["start"] for s in segs)

            # Use longest segment for best embedding quality
            longest = max(segs, key=lambda s: s["end"] - s["start"])
            excerpt = Segment(longest["start"], longest["end"])

            try:
                embedding = self.inference.crop(audio_path, excerpt)
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

    @staticmethod
    def _get_hf_token() -> str | None:
        import os
        return os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
```

- [ ] **Step 4: Commit (no unit tests for model wrappers — they are thin wrappers over ML libraries tested via integration tests in Task 10)**

```bash
git add -f services/jd-audio-service/src/models/transcriber.py services/jd-audio-service/src/models/diarizer.py services/jd-audio-service/src/models/embedder.py
git commit -m "feat(audio-service): add model wrappers for Parakeet, PyAnnote diarization, and PyAnnote embedding"
```

---

## Task 7: Pipeline Processor (Orchestrates Full /process Flow)

**Files:**
- Create: `services/jd-audio-service/src/pipeline/processor.py`
- Create: `services/jd-audio-service/tests/test_processor.py`

- [ ] **Step 1: Write processor tests (mocked models)**

```python
# services/jd-audio-service/tests/test_processor.py
from unittest.mock import MagicMock, patch
from pipeline.processor import Processor


class TestProcessor:
    def setup_method(self):
        self.mock_manager = MagicMock()
        self.processor = Processor(self.mock_manager)

    def test_process_calls_transcribe_and_diarize(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello there Hi back",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "there", "start": 0.6, "end": 1.0},
                {"word": "Hi", "start": 1.5, "end": 1.8},
                {"word": "back", "start": 1.9, "end": 2.2},
            ],
            "duration": 2.2,
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.2},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")

        assert result["text"] == "Hello there Hi back"
        assert len(result["entries"]) == 2
        assert result["entries"][0]["speaker"] == "SPEAKER_00"
        assert result["entries"][0]["text"] == "Hello there"
        assert result["entries"][1]["speaker"] == "SPEAKER_01"
        assert result["entries"][1]["text"] == "Hi back"
        assert len(result["segments"]) == 2
        assert result["duration"] == 2.2

    def test_process_passes_speaker_options_to_diarizer(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Test", "words": [{"word": "Test", "start": 0.0, "end": 0.5}], "duration": 0.5,
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
        self.mock_manager.get_or_load.side_effect = get_or_load

        self.processor.process("test.mp3", min_speakers=2, max_speakers=5)

        mock_diarizer.diarize.assert_called_once_with(
            "test.mp3", num_speakers=None, min_speakers=2, max_speakers=5,
        )

    def test_process_with_no_words_returns_empty_entries(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {"text": "", "words": [], "duration": 0.0}
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = []

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")

        assert result["entries"] == []
        assert result["text"] == ""
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_processor.py -v
```
Expected: FAIL

- [ ] **Step 3: Implement processor**

```python
# services/jd-audio-service/src/pipeline/processor.py
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
        """Full pipeline: transcribe → diarize → merge.

        Returns dict matching ProcessResponse schema.
        """
        # Step 1: Transcribe
        logger.info(f"Transcribing: {audio_path}")
        transcriber = self.manager.get_or_load("transcriber", self._load_transcriber)
        transcription = transcriber.transcribe(audio_path)

        # Step 2: Diarize
        logger.info(f"Diarizing: {audio_path}")
        diarizer = self.manager.get_or_load("diarizer", self._load_diarizer)
        segments = diarizer.diarize(
            audio_path,
            num_speakers=num_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )

        # Step 3: Merge
        entries = merge_transcript_with_diarization(transcription["words"], segments)

        return {
            "text": transcription["text"],
            "entries": entries,
            "segments": segments,
            "duration": transcription["duration"],
        }

    @staticmethod
    def _load_transcriber():
        from models.transcriber import Transcriber
        return Transcriber()

    @staticmethod
    def _load_diarizer():
        from models.diarizer import Diarizer
        return Diarizer()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_processor.py -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/pipeline/processor.py services/jd-audio-service/tests/test_processor.py
git commit -m "feat(audio-service): add pipeline processor orchestrating transcription + diarization + merge"
```

---

## Task 8: FastAPI Routes & Server

**Files:**
- Create: `services/jd-audio-service/src/api/routes.py`
- Create: `services/jd-audio-service/src/server.py`
- Create: `services/jd-audio-service/tests/test_routes.py`

- [ ] **Step 1: Write API route tests**

```python
# services/jd-audio-service/tests/test_routes.py
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient


@pytest.fixture
def mock_manager():
    mgr = MagicMock()
    mgr.loaded_models = {}
    mgr.loaded_model_names.return_value = []
    return mgr


@pytest.fixture
def mock_processor():
    return MagicMock()


@pytest.fixture
def client(mock_manager, mock_processor):
    from server import create_app
    app = create_app(model_manager=mock_manager, processor=mock_processor)
    yield TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_status(self, client, mock_manager):
        mock_manager.loaded_model_names.return_value = []
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "idle"
        assert "engineVersion" in data


class TestModelsEndpoint:
    def test_models_returns_available(self, client):
        resp = client.get("/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "transcription" in data
        assert "parakeet-tdt-0.6b-v2" in data["transcription"]


class TestProcessEndpoint:
    def test_process_returns_transcript(self, client, mock_processor):
        mock_processor.process.return_value = {
            "text": "Hello world",
            "entries": [{"speaker": "SPEAKER_00", "text": "Hello world", "timestamp": 0.0, "words": []}],
            "segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}],
            "duration": 1.0,
        }

        resp = client.post("/process", json={"audioPath": "C:/test/audio.mp3"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "Hello world"
        assert len(data["entries"]) == 1

    def test_process_validates_audio_path_required(self, client):
        resp = client.post("/process", json={})
        assert resp.status_code == 422


class TestUnloadEndpoint:
    def test_unload_frees_models(self, client, mock_manager):
        mock_manager.unload_all.return_value = 2
        resp = client.post("/unload")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "unloaded"


class TestTranscribeEndpoint:
    def test_transcribe_calls_model(self, client, mock_manager):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}], "duration": 0.5,
        }
        mock_manager.get_or_load.return_value = mock_transcriber

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/transcribe", json={"audioPath": "C:/test/audio.mp3"})

        assert resp.status_code == 200
        assert resp.json()["text"] == "Hello"


class TestDiarizeEndpoint:
    def test_diarize_calls_model(self, client, mock_manager):
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
        ]
        mock_manager.get_or_load.return_value = mock_diarizer

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/diarize", json={"audioPath": "C:/test/audio.mp3", "minSpeakers": 2})

        assert resp.status_code == 200
        assert len(resp.json()["segments"]) == 1


class TestEmbedSpeakersEndpoint:
    def test_embed_calls_model(self, client, mock_manager):
        mock_embedder = MagicMock()
        mock_embedder.embed_segments.return_value = [
            {"speaker": "SPEAKER_00", "vector": [0.1] * 256, "duration": 10.0},
        ]
        mock_manager.get_or_load.return_value = mock_embedder

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/embed-speakers", json={
                "audioPath": "C:/test/audio.mp3",
                "segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}],
            })

        assert resp.status_code == 200
        assert len(resp.json()["embeddings"]) == 1


class TestIdentifySpeakersEndpoint:
    def test_identify_returns_matches(self, client):
        resp = client.post("/identify-speakers", json={
            "embeddings": [{"speaker": "Speaker 1", "vector": [0.1] * 256, "duration": 30.0}],
            "profiles": [{"name": "Tim", "vector": [0.1] * 256, "duration": 120.0}],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["matches"]) == 1
        assert data["matches"][0]["name"] == "Tim"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd services/jd-audio-service
python -m pytest tests/test_routes.py -v
```
Expected: FAIL

- [ ] **Step 3: Implement routes**

```python
# services/jd-audio-service/src/api/routes.py
import os
import logging
from fastapi import APIRouter, HTTPException
from api.schemas import (
    ProcessRequest, ProcessResponse, TranscribeRequest, TranscribeResponse,
    DiarizeRequest, DiarizeResponse, EmbedSpeakersRequest, EmbedSpeakersResponse,
    IdentifySpeakersRequest, IdentifySpeakersResponse,
    HealthResponse, ModelsResponse, UnloadResponse,
    TranscriptEntry, DiarizationSegment, SpeakerEmbedding,
)
from config import VERSION
from pipeline.identifier import identify_speakers

logger = logging.getLogger(__name__)

router = APIRouter()

# These are set by the server at startup
_model_manager = None
_processor = None


def set_dependencies(model_manager, processor):
    global _model_manager, _processor
    _model_manager = model_manager
    _processor = processor


def get_model_manager():
    return _model_manager


def get_processor():
    return _processor


def _validate_audio_path(path: str) -> None:
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Audio file not found: {path}")


def _handle_gpu_errors(func):
    """Decorator that catches CUDA errors and returns 503."""
    from functools import wraps

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except RuntimeError as e:
            if "CUDA" in str(e) or "out of memory" in str(e).lower():
                raise HTTPException(
                    status_code=503,
                    detail="GPU unavailable — close other GPU applications and retry, or switch to cloud transcription.",
                )
            raise
    return wrapper


@router.get("/health", response_model=HealthResponse)
def health():
    mgr = get_model_manager()
    return HealthResponse(
        status="idle" if not mgr.loaded_models else "ready",
        modelsLoaded=mgr.loaded_model_names(),
        vramUsed=0.0,  # TODO: actual VRAM tracking via torch.cuda.memory_allocated
        engineVersion=VERSION,
    )


@router.get("/models", response_model=ModelsResponse)
def models():
    return ModelsResponse(
        transcription=["parakeet-tdt-0.6b-v2"],
        diarization=["pyannote-3.1"],
        embedding=["pyannote-embedding"],
    )


@router.post("/process", response_model=ProcessResponse)
@_handle_gpu_errors
def process(req: ProcessRequest):
    _validate_audio_path(req.audioPath)
    proc = get_processor()

    opts = req.options or ProcessingOptions()
    # TODO: pass opts.vocabulary to transcriber when Parakeet supports custom vocabulary
    # TODO: pass opts.speakerNames to diarizer for speaker-aware clustering
    result = proc.process(
        audio_path=req.audioPath,
        min_speakers=opts.minSpeakers,
        max_speakers=opts.maxSpeakers,
    )

    return ProcessResponse(
        text=result["text"],
        entries=[TranscriptEntry(**e) for e in result["entries"]],
        segments=[DiarizationSegment(**s) for s in result["segments"]],
        duration=result["duration"],
    )


@router.post("/transcribe", response_model=TranscribeResponse)
@_handle_gpu_errors
def transcribe(req: TranscribeRequest):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager()

    from models.transcriber import Transcriber
    transcriber = mgr.get_or_load("transcriber", Transcriber)
    result = transcriber.transcribe(req.audioPath)

    # Build entries from Parakeet's segment-level output
    # Note: without diarization, all entries have speaker=None
    entries = []
    for seg in result.get("segments", []):
        seg_words = [w for w in result["words"] if w["start"] >= seg["start"] and w["end"] <= seg["end"]]
        entries.append(TranscriptEntry(
            text=seg["text"] if "text" in seg else " ".join(w["word"] for w in seg_words),
            timestamp=seg["start"],
            words=seg_words,
        ))
    # Fallback: if no segments, return single entry with all text
    if not entries:
        entries = [TranscriptEntry(text=result["text"], timestamp=0.0, words=result["words"])]

    return TranscribeResponse(text=result["text"], entries=entries, duration=result["duration"])


@router.post("/diarize", response_model=DiarizeResponse)
@_handle_gpu_errors
def diarize(req: DiarizeRequest):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager()

    from models.diarizer import Diarizer
    diarizer = mgr.get_or_load("diarizer", Diarizer)
    segments = diarizer.diarize(
        req.audioPath,
        num_speakers=req.numSpeakers,
        min_speakers=req.minSpeakers,
        max_speakers=req.maxSpeakers,
    )

    return DiarizeResponse(segments=[DiarizationSegment(**s) for s in segments])


@router.post("/embed-speakers", response_model=EmbedSpeakersResponse)
@_handle_gpu_errors
def embed_speakers(req: EmbedSpeakersRequest):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager()

    from models.embedder import Embedder
    embedder = mgr.get_or_load("embedder", Embedder)
    segments_raw = [{"speaker": s.speaker, "start": s.start, "end": s.end} for s in req.segments]
    results = embedder.embed_segments(req.audioPath, segments_raw)

    return EmbedSpeakersResponse(
        embeddings=[SpeakerEmbedding(**e) for e in results]
    )


@router.post("/identify-speakers", response_model=IdentifySpeakersResponse)
def identify(req: IdentifySpeakersRequest):
    emb_dicts = [{"speaker": e.speaker, "vector": e.vector} for e in req.embeddings]
    prof_dicts = [{"name": p.name, "vector": p.vector} for p in req.profiles]

    matches = identify_speakers(emb_dicts, prof_dicts)

    return IdentifySpeakersResponse(
        matches=[
            {"speaker": m["speaker"], "name": m["name"], "confidence": m["confidence"], "distance": m["distance"]}
            for m in matches
        ]
    )


@router.post("/unload", response_model=UnloadResponse)
def unload():
    mgr = get_model_manager()
    count = mgr.unload_all()
    return UnloadResponse(status="unloaded", vramFreed=0.0)
```

- [ ] **Step 4: Implement server.py**

```python
# services/jd-audio-service/src/server.py
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from models.manager import ModelManager
from pipeline.processor import Processor
from api.routes import router, set_dependencies
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

    set_dependencies(model_manager, processor)

    app = FastAPI(
        title="JD Audio Service",
        version=VERSION,
        description="Local audio transcription, diarization, and speaker identification",
    )
    app.include_router(router)

    return app
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd services/jd-audio-service
python -m pytest tests/test_routes.py -v
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add -f services/jd-audio-service/src/api/routes.py services/jd-audio-service/src/server.py services/jd-audio-service/tests/test_routes.py
git commit -m "feat(audio-service): add FastAPI routes and server with all endpoints"
```

---

## Task 9: System Tray App & Entry Point

**Files:**
- Create: `services/jd-audio-service/src/tray/app.py`
- Create: `services/jd-audio-service/src/main.py`
- Create: `services/jd-audio-service/run-jd-audio-service.bat`
- Create: `services/jd-audio-service/setup-jd-audio-service.bat`

No automated tests for tray app (GUI component). Test manually.

- [ ] **Step 1: Implement tray app**

```python
# services/jd-audio-service/src/tray/app.py
import threading
import logging
from PIL import Image, ImageDraw
import pystray

logger = logging.getLogger(__name__)


def _create_icon_image(color="green"):
    """Create a simple colored circle icon."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    colors = {"green": "#4CAF50", "yellow": "#FFC107", "red": "#F44336", "gray": "#9E9E9E"}
    fill = colors.get(color, colors["gray"])
    draw.ellipse([8, 8, 56, 56], fill=fill)
    return img


class TrayApp:
    """System tray icon with server lifecycle management."""

    def __init__(self, server_starter, server_stopper, unloader):
        self.server_starter = server_starter
        self.server_stopper = server_stopper
        self.unloader = unloader
        self.icon = None
        self._running = False

    def _build_menu(self):
        return pystray.Menu(
            pystray.MenuItem("JD Audio Service", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Unload Models", self._on_unload),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._on_quit),
        )

    def _on_unload(self, icon, item):
        logger.info("Manual model unload requested")
        self.unloader()
        icon.icon = _create_icon_image("gray")

    def _on_quit(self, icon, item):
        logger.info("Quit requested from tray")
        self._running = False
        self.server_stopper()
        icon.stop()

    def run(self):
        """Start tray icon and server. Blocks until quit."""
        self._running = True
        self.icon = pystray.Icon(
            "jd-audio-service",
            _create_icon_image("green"),
            "JD Audio Service",
            menu=self._build_menu(),
        )

        # Start server in background thread
        server_thread = threading.Thread(target=self.server_starter, daemon=True)
        server_thread.start()

        # Blocks until icon.stop() is called
        self.icon.run()
```

- [ ] **Step 2: Implement main entry point**

```python
# services/jd-audio-service/src/main.py
import sys
import logging
import threading
import time
import uvicorn
from config import HOST, PORT, IDLE_TIMEOUT_SECONDS
from models.manager import ModelManager
from server import create_app
from tray.app import TrayApp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_uvicorn_server = None
_model_manager = None


def start_server():
    global _uvicorn_server
    app = create_app(_model_manager)
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="info")
    _uvicorn_server = uvicorn.Server(config)
    _uvicorn_server.run()


def stop_server():
    if _uvicorn_server:
        _uvicorn_server.should_exit = True


def unload_models():
    if _model_manager:
        _model_manager.unload_all()


def idle_collector_loop():
    """Background thread that periodically unloads idle models."""
    while True:
        time.sleep(60)  # Check every minute
        if _model_manager:
            _model_manager.collect_idle()


def main():
    global _model_manager

    _model_manager = ModelManager(idle_timeout_seconds=IDLE_TIMEOUT_SECONDS)

    # Start idle collector
    collector = threading.Thread(target=idle_collector_loop, daemon=True)
    collector.start()

    if "--no-tray" in sys.argv:
        # Headless mode (for development/testing)
        logger.info(f"Starting JD Audio Service on {HOST}:{PORT} (headless)")
        start_server()
    else:
        logger.info(f"Starting JD Audio Service on {HOST}:{PORT}")
        tray = TrayApp(start_server, stop_server, unload_models)
        tray.run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Create launcher scripts**

```batch
@echo off
REM services/jd-audio-service/run-jd-audio-service.bat
REM Starts the JD Audio Service with system tray icon

cd /d "%~dp0"
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo ERROR: Virtual environment not found. Run setup-jd-audio-service.bat first.
    pause
    exit /b 1
)
python src\main.py %*
```

```batch
@echo off
REM services/jd-audio-service/setup-jd-audio-service.bat
REM One-time setup: create venv, install dependencies

cd /d "%~dp0"
echo Creating virtual environment...
python -m venv venv
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Setup complete! Run 'run-jd-audio-service.bat' to start the service.
echo.
echo NOTE: You need a Hugging Face token for PyAnnote models.
echo Set the HF_TOKEN environment variable before running.
pause
```

- [ ] **Step 4: Test headless mode starts and responds to /health**

```bash
cd services/jd-audio-service
# In one terminal:
python src/main.py --no-tray &
sleep 3
# In another:
curl http://localhost:8374/health
# Expected: {"status":"idle","modelsLoaded":[],...}
# Then kill the server
```

- [ ] **Step 5: Commit**

```bash
git add -f services/jd-audio-service/src/main.py services/jd-audio-service/src/tray/app.py services/jd-audio-service/run-jd-audio-service.bat services/jd-audio-service/setup-jd-audio-service.bat
git commit -m "feat(audio-service): add system tray app, entry point, and launcher scripts"
```

---

## Task 10: Integration Test (Full Pipeline with Real Models)

**Files:**
- Create: `services/jd-audio-service/tests/test_integration.py`
- Create: `services/jd-audio-service/fixtures/two_speakers_short.wav` (generate or download)

This test requires GPU and real models. Marked with `@pytest.mark.gpu`.

- [ ] **Step 1: Create or download a test audio fixture**

Use a public-domain two-speaker audio clip, or generate one with TTS. Needs to be ~10 seconds with 2 distinct speakers.

```bash
# Option: download a sample from LibriSpeech or generate with edge-tts
# This step is manual — place a suitable .wav file in fixtures/
```

- [ ] **Step 2: Write integration test**

```python
# services/jd-audio-service/tests/test_integration.py
import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from server import create_app
from models.manager import ModelManager

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures"
TEST_AUDIO = FIXTURE_DIR / "two_speakers_short.wav"


@pytest.mark.gpu
@pytest.mark.skipif(not TEST_AUDIO.exists(), reason="Test audio fixture not found")
class TestFullPipeline:
    @pytest.fixture(autouse=True)
    def setup(self):
        manager = ModelManager(idle_timeout_seconds=300)
        app = create_app(manager)
        self.client = TestClient(app)
        self.manager = manager
        yield
        manager.unload_all()

    def test_process_returns_diarized_transcript(self):
        resp = self.client.post("/process", json={
            "audioPath": str(TEST_AUDIO),
            "options": {"minSpeakers": 2, "maxSpeakers": 2},
        })
        assert resp.status_code == 200
        data = resp.json()

        assert len(data["text"]) > 0
        assert len(data["entries"]) > 0
        assert len(data["segments"]) > 0
        assert data["duration"] > 0

        # Should have found 2 speakers
        speakers = set(e["speaker"] for e in data["entries"])
        assert len(speakers) >= 2

    def test_embed_speakers_returns_vectors(self):
        # First diarize to get segments
        diarize_resp = self.client.post("/diarize", json={
            "audioPath": str(TEST_AUDIO),
            "minSpeakers": 2,
            "maxSpeakers": 2,
        })
        segments = diarize_resp.json()["segments"]

        # Then embed
        embed_resp = self.client.post("/embed-speakers", json={
            "audioPath": str(TEST_AUDIO),
            "segments": segments,
        })
        assert embed_resp.status_code == 200
        data = embed_resp.json()

        assert len(data["embeddings"]) >= 2
        for emb in data["embeddings"]:
            assert len(emb["vector"]) > 0  # Should be 256-d
            assert emb["duration"] > 0

    def test_full_identify_pipeline(self):
        # Process to get segments
        proc_resp = self.client.post("/process", json={"audioPath": str(TEST_AUDIO)})
        segments = proc_resp.json()["segments"]

        # Embed speakers
        embed_resp = self.client.post("/embed-speakers", json={
            "audioPath": str(TEST_AUDIO),
            "segments": segments,
        })
        embeddings = embed_resp.json()["embeddings"]

        # Identify against same embeddings (should match perfectly)
        id_resp = self.client.post("/identify-speakers", json={
            "embeddings": embeddings,
            "profiles": embeddings,  # Same vectors = perfect match
        })
        assert id_resp.status_code == 200
        matches = id_resp.json()["matches"]
        for match in matches:
            assert match["name"] is not None
            assert match["distance"] < 0.01  # Near-zero for identical vectors

    def test_unload_frees_models(self):
        # Load models via process
        self.client.post("/process", json={"audioPath": str(TEST_AUDIO)})
        assert len(self.manager.loaded_model_names()) > 0

        # Unload
        resp = self.client.post("/unload")
        assert resp.status_code == 200
        assert self.manager.loaded_model_names() == []
```

- [ ] **Step 3: Run integration tests (requires GPU)**

```bash
cd services/jd-audio-service
python -m pytest tests/test_integration.py -v -m gpu
```
Expected: all tests PASS (on a machine with GPU and models downloaded)

- [ ] **Step 4: Commit**

```bash
git add -f services/jd-audio-service/tests/test_integration.py
git commit -m "feat(audio-service): add GPU integration tests for full pipeline"
```

---

## Task 11: Final Verification & Documentation

- [ ] **Step 1: Run all non-GPU tests**

```bash
cd services/jd-audio-service
python -m pytest tests/ -v -m "not gpu"
```
Expected: all tests PASS

- [ ] **Step 2: Verify headless server starts and all endpoints respond**

```bash
cd services/jd-audio-service
python src/main.py --no-tray &
sleep 3
curl http://localhost:8374/health
curl http://localhost:8374/models
# Kill server after verification
```

- [ ] **Step 3: Commit final state**

```bash
git add -f services/jd-audio-service/
git commit -m "feat(audio-service): complete Plan A — JD Audio Service ready for integration"
```
