# JD Audio Service

Local audio transcription + speaker diarization service.

A standalone Python service that provides local (on-device) audio processing using faster-whisper (Whisper large-v3-turbo) for transcription, PyAnnote community-1 for speaker diarization, and FastAPI for the HTTP interface. Designed to run as a Windows system tray application alongside an Electron desktop meeting note-taker.

## Prerequisites

- **Python 3.11+** (tested with 3.13)
- **NVIDIA GPU** with CUDA support
- **CUDA Toolkit 12.8** -- install with:
  ```
  winget install Nvidia.CUDA --version 12.8
  ```
- **HuggingFace account** with an access token ([create one here](https://huggingface.co/settings/tokens))

## Quick Start

1. Run the setup script:
   ```
   setup-jd-audio-service.bat
   ```

2. Set your HuggingFace token:
   ```
   setx HF_TOKEN "hf_your_token_here"
   ```

3. Accept access to all four gated PyAnnote models (click "Agree" on each page):
   - <https://huggingface.co/pyannote/speaker-diarization-3.1>
   - <https://huggingface.co/pyannote/segmentation-3.0>
   - <https://huggingface.co/pyannote/speaker-diarization-community-1>
   - <https://huggingface.co/pyannote/embedding>

4. Start the service:
   ```
   run-jd-audio-service.bat
   ```

## Manual Installation

The install order matters. PyAnnote depends on PyTorch and will pull in the CPU-only version automatically. The CUDA-enabled PyTorch must be force-installed afterward to override it. Additionally, RTX 5090 (Blackwell architecture) requires the nightly PyTorch build. Finally, the nightly torch build is incompatible with torchcodec, which PyAnnote may pull in as a transitive dependency.

**Step 1.** Create and activate a virtual environment:
```
python -m venv .venv
.venv\Scripts\activate
```

**Step 2.** Install core dependencies (this pulls CPU-only PyTorch via PyAnnote):
```
pip install faster-whisper "pyannote.audio>=4" soundfile librosa fastapi "uvicorn[standard]" pydantic numpy scipy pystray Pillow omegaconf
```

**Step 3.** Override with CUDA nightly PyTorch:
```
pip install --force-reinstall --pre torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
```

**Step 4.** Remove incompatible torchcodec:
```
pip uninstall torchcodec -y
```

## Running

**System tray mode** (default -- shows icon in Windows system tray):
```
run-jd-audio-service.bat
```
or:
```
python src/main.py
```

**Headless mode** (no tray icon, for development/testing):
```
python src/main.py --no-tray
```

**Default port:** 8374

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JD_AUDIO_HOST` | `127.0.0.1` | Bind address |
| `JD_AUDIO_PORT` | `8374` | HTTP port |
| `JD_AUDIO_IDLE_TIMEOUT` | `300` | Seconds of inactivity before models are unloaded from GPU |
| `JD_AUDIO_DEVICE` | `cuda` | Compute device (`cuda` or `cpu`) |
| `JD_AUDIO_COMPUTE_TYPE` | `float16` | Model precision (`float16`, `int8_float16`, `int8`) |
| `JD_AUDIO_MODEL_DIR` | `%APPDATA%\JDAudioService\models` | Model cache directory |
| `HF_TOKEN` | (none) | HuggingFace access token for gated PyAnnote models |

## API Reference

Base URL: `http://127.0.0.1:8374`

All audio endpoints accept an absolute file path to a local audio file. The service reads the file directly from disk.

---

### GET /health

Service status, loaded models, and GPU device info.

**Response:**
```json
{
  "status": "idle",
  "modelsLoaded": [],
  "device": "cuda:0 (NVIDIA GeForce RTX 5090)",
  "engineVersion": "0.2.0"
}
```

`status` is `"idle"` when no models are loaded, `"ready"` when models are in GPU memory.

**Example:**
```bash
curl http://127.0.0.1:8374/health
```

---

### GET /models

Lists available model names by category.

**Response:**
```json
{
  "transcription": ["large-v3-turbo"],
  "diarization": ["pyannote-community-1"],
  "embedding": ["wespeaker-voxceleb-resnet34-LM"]
}
```

**Example:**
```bash
curl http://127.0.0.1:8374/models
```

---

### POST /process

Full pipeline: transcribe + diarize + merge speaker labels into transcript entries. This is the primary endpoint for complete meeting processing.

**Request body:**
```json
{
  "audioPath": "C:/Users/me/recordings/meeting.wav",
  "options": {
    "minSpeakers": 2,
    "maxSpeakers": 5,
    "speakerNames": ["Alice", "Bob"],
    "vocabulary": ["JD Notes", "PyAnnote"]
  }
}
```

All fields in `options` are optional. `speakerNames` and `vocabulary` are reserved for future use.

**Response:**
```json
{
  "text": "Full transcript text...",
  "entries": [
    {
      "speaker": "SPEAKER_00",
      "text": "Hello everyone.",
      "timestamp": 0.0,
      "words": [
        {"word": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.95},
        {"word": "everyone.", "start": 0.5, "end": 1.1, "confidence": 0.92}
      ]
    }
  ],
  "segments": [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 3.5},
    {"speaker": "SPEAKER_01", "start": 3.5, "end": 8.2}
  ],
  "duration": 120.5,
  "quality": {
    "flagged_segments": [],
    "avg_confidence": 0.93
  }
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/process \
  -H "Content-Type: application/json" \
  -d "{\"audioPath\": \"C:/recordings/meeting.wav\", \"options\": {\"maxSpeakers\": 4}}"
```

---

### POST /transcribe

Transcription only (no speaker diarization). Faster than `/process` when you only need the text.

**Request body:**
```json
{
  "audioPath": "C:/Users/me/recordings/meeting.wav",
  "options": {
    "vocabulary": ["JD Notes"]
  }
}
```

**Response:**
```json
{
  "text": "Full transcript text...",
  "entries": [
    {
      "speaker": null,
      "text": "Hello everyone.",
      "timestamp": 0.0,
      "words": [
        {"word": "Hello", "start": 0.0, "end": 0.4, "confidence": 0.95}
      ]
    }
  ],
  "duration": 120.5
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audioPath\": \"C:/recordings/meeting.wav\"}"
```

---

### POST /diarize

Speaker diarization only (no transcription). Returns time segments labeled by speaker.

**Request body:**
```json
{
  "audioPath": "C:/Users/me/recordings/meeting.wav",
  "numSpeakers": 3,
  "minSpeakers": null,
  "maxSpeakers": null
}
```

All fields except `audioPath` are optional. Use `numSpeakers` when you know the exact count, or `minSpeakers`/`maxSpeakers` for a range.

**Response:**
```json
{
  "segments": [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 3.5},
    {"speaker": "SPEAKER_01", "start": 3.5, "end": 8.2},
    {"speaker": "SPEAKER_00", "start": 8.2, "end": 15.0}
  ]
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/diarize \
  -H "Content-Type: application/json" \
  -d "{\"audioPath\": \"C:/recordings/meeting.wav\", \"numSpeakers\": 3}"
```

---

### POST /embed-speakers

Extract voice embeddings for each speaker from an audio file and pre-computed diarization segments. These embeddings are 512-dimensional vectors that serve as speaker fingerprints.

**Request body:**
```json
{
  "audioPath": "C:/Users/me/recordings/meeting.wav",
  "segments": [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 3.5},
    {"speaker": "SPEAKER_01", "start": 3.5, "end": 8.2}
  ]
}
```

**Response:**
```json
{
  "embeddings": [
    {
      "speaker": "SPEAKER_00",
      "vector": [0.012, -0.034, 0.056, "... (512 floats)"],
      "duration": 3.5
    },
    {
      "speaker": "SPEAKER_01",
      "vector": [-0.023, 0.045, 0.011, "... (512 floats)"],
      "duration": 4.7
    }
  ]
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/embed-speakers \
  -H "Content-Type: application/json" \
  -d "{\"audioPath\": \"C:/recordings/meeting.wav\", \"segments\": [{\"speaker\": \"SPEAKER_00\", \"start\": 0.0, \"end\": 3.5}]}"
```

---

### POST /identify-speakers

Match speaker embeddings against known speaker profiles using cosine distance. This is a pure computation endpoint -- it does not require audio or GPU.

**Request body:**
```json
{
  "embeddings": [
    {
      "speaker": "SPEAKER_00",
      "vector": [0.012, -0.034, "... (512 floats)"]
    }
  ],
  "profiles": [
    {
      "name": "Alice",
      "vector": [0.015, -0.031, "... (512 floats)"]
    },
    {
      "name": "Bob",
      "vector": [-0.022, 0.048, "... (512 floats)"]
    }
  ]
}
```

**Response:**
```json
{
  "matches": [
    {
      "speaker": "SPEAKER_00",
      "name": "Alice",
      "confidence": 0.87,
      "distance": 0.13
    }
  ]
}
```

`confidence` is `1.0 - distance`. A higher confidence means a better match. `name` is `null` if no profile is close enough.

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/identify-speakers \
  -H "Content-Type: application/json" \
  -d "{\"embeddings\": [{\"speaker\": \"SPEAKER_00\", \"vector\": [0.01, -0.03]}], \"profiles\": [{\"name\": \"Alice\", \"vector\": [0.01, -0.03]}]}"
```

---

### POST /unload

Unload all models from GPU memory. Use this to free VRAM without stopping the service.

**Response:**
```json
{
  "status": "unloaded",
  "vramFreed": 0.0
}
```

**Example:**
```bash
curl -X POST http://127.0.0.1:8374/unload
```

---

### Error Responses

All endpoints return standard HTTP error codes:

- **400** -- Invalid request (e.g., audio file not found at the given path)
- **503** -- GPU unavailable (CUDA out of memory or device error). Close other GPU applications and retry, or switch to cloud transcription.

## Architecture

```
                     HTTP (localhost:8374)
                            |
                        FastAPI + uvicorn
                            |
                       API Routes (8 endpoints)
                            |
                +-----------+-----------+
                |           |           |
          Transcriber   Diarizer    Embedder
         (faster-whisper) (PyAnnote comm-1) (wespeaker resnet34)
                |           |           |
                +-----+-----+-----------+
                      |
                 ModelManager
              (lazy load, auto-unload)
                      |
                  CUDA / GPU
```

- **FastAPI + uvicorn** serves the HTTP API on localhost:8374.
- **ModelManager** handles lazy loading (models load on first request, not at startup) and automatic unloading after 5 minutes of inactivity. This keeps GPU memory at zero when idle.
- **Models:**
  - faster-whisper large-v3-turbo for transcription (via CTranslate2)
  - PyAnnote speaker-diarization-community-1 for speaker segmentation (exclusive, non-overlapping turns used for the transcript merge)
  - wespeaker-voxceleb-resnet34-LM (256-d, via pyannote) for speaker voice fingerprints — replaced pyannote/embedding 2026-09; old profiles re-enroll automatically on their next sample
- **GPU memory:** approximately 2.4 GB at peak (all models loaded), zero when idle.
- **System tray app** (pystray) manages the Windows lifecycle -- start, stop, and unload from the tray icon.
- **Stateless design:** the service processes audio files and returns JSON. No database, no persistent storage, no session state.
- **GPU lock:** a threading lock serializes all GPU operations to prevent CUDA conflicts.

## Development

### Install test dependencies

Test dependencies are included in the setup script. To install them manually:
```
pip install pytest pytest-asyncio httpx
```

### Run unit tests (no GPU required)

```
.venv\Scripts\python -m pytest tests/ -v -m "not gpu"
```

### Run GPU integration tests

Requires `HF_TOKEN` set and CUDA available:
```
.venv\Scripts\python -m pytest tests/ -v -m gpu
```

### Run all tests

```
.venv\Scripts\python -m pytest tests/ -v
```

## Troubleshooting

**torchcodec warnings** -- Expected and harmless. The service uses soundfile as a workaround for audio loading. torchcodec is removed during setup because it is incompatible with nightly PyTorch builds.

**TensorRT/CUDA EP errors in ONNX Runtime** -- Harmless warnings. ONNX Runtime falls back to CPU for its operations. Transcription uses CTranslate2 which has its own separate CUDA path, so GPU acceleration still works where it matters.

**401 Unauthorized from HuggingFace** -- Your `HF_TOKEN` environment variable is not set or the token has expired. Generate a new token at <https://huggingface.co/settings/tokens> and set it with `setx HF_TOKEN "hf_your_token_here"`.

**403 Forbidden from HuggingFace** -- You have not accepted the license for one or more gated models. Visit each model page and click "Agree":
- <https://huggingface.co/pyannote/speaker-diarization-3.1>
- <https://huggingface.co/pyannote/segmentation-3.0>
- <https://huggingface.co/pyannote/speaker-diarization-community-1>
- <https://huggingface.co/pyannote/embedding>

**"CUDA out of memory"** -- Close other GPU-intensive applications (games, other ML models, etc.). Alternatively, set `JD_AUDIO_COMPUTE_TYPE=int8_float16` for lower VRAM usage at a slight accuracy cost.

**First run is slow** -- The Whisper large-v3-turbo model (~1.6 GB) downloads on first use. Subsequent runs use the cached model from `%APPDATA%\JDAudioService\models`.

**Server won't start** -- Check if port 8374 is already in use by another process. Change the port with the `JD_AUDIO_PORT` environment variable.
