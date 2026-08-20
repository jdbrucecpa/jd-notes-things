# Plan A Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the wav2vec2 aligner works on real audio, update setup scripts, write README, smoke test the HTTP server, add device reporting, and clean up generated files.

**Architecture:** All changes are to the existing JD Audio Service at `C:\Users\brigh\Documents\code\jd-audio-service`. No new modules — just verification, documentation, and polish.

**Tech Stack:** Python 3.13, faster-whisper, torchaudio (nightly), PyAnnote, FastAPI

**Spec:** `docs/superpowers/specs/2026-03-19-plan-a-completion.md`

**Environment setup for GPU tests:**
```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
```

---

### Task 1: Verify wav2vec2 aligner on real audio

**Files:**
- Possibly modify: `src/models/aligner.py` (if API differs from expected)
- Possibly remove: `src/models/aligner.py`, `tests/test_aligner.py` (if fundamentally broken)

This is a diagnostic task. The outcome determines whether we fix, adapt, or remove the aligner.

- [ ] **Step 1: Check if forced_align exists in nightly torchaudio**

```bash
cd C:/Users/brigh/Documents/code/jd-audio-service
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
.venv/Scripts/python -c "
from torchaudio.functional import forced_align
print('forced_align available:', forced_align)
"
```

If this errors with `ImportError`, check alternatives:
```bash
.venv/Scripts/python -c "
import torchaudio.functional as F
print([x for x in dir(F) if 'align' in x.lower()])
"
```

- [ ] **Step 2: Run the aligner on real audio**

```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
cd C:/Users/brigh/Documents/code/jd-audio-service

.venv/Scripts/python -c "
import sys, time
sys.path.insert(0, 'src')
from models.transcriber import Transcriber
from models.aligner import Aligner

AUDIO = 'fixtures/two_speakers_short.wav'

print('Transcribing...', flush=True)
transcriber = Transcriber()
transcript = transcriber.transcribe(AUDIO)
print(f'Words before alignment: {[(w[\"word\"], w[\"start\"], w[\"end\"]) for w in transcript[\"words\"][:5]]}')

print('Aligning...', flush=True)
aligner = Aligner()
aligned = aligner.align(AUDIO, transcript)
print(f'Words after alignment:  {[(w[\"word\"], w[\"start\"], w[\"end\"]) for w in aligned[\"words\"][:5]]}')

# Check if timestamps actually changed
changed = sum(1 for a, b in zip(transcript[\"words\"], aligned[\"words\"]) if a[\"start\"] != b[\"start\"])
print(f'Timestamps changed: {changed}/{len(transcript[\"words\"])} words')
" 2>/dev/null
```

- [ ] **Step 3: Act on results**

**If alignment works (timestamps changed):**
- Commit a note in the spec confirming it works
- Proceed to Task 2

**If `forced_align` doesn't exist or API changed:**
- Check the nightly torchaudio docs/source for the correct function name
- Adapt `aligner.py` to use the correct API
- Re-run Step 2
- If no equivalent function exists, proceed to removal

**If fundamentally broken (crashes, produces garbage):**
- Remove `src/models/aligner.py`
- Remove `tests/test_aligner.py`
- In `src/pipeline/processor.py`, remove the alignment step (lines 27-32) and `_load_aligner` method (lines 65-67)
- In `tests/test_processor.py`, remove `test_process_runs_alignment_when_available` and `test_process_continues_if_alignment_fails`
- Run all tests: `.venv/Scripts/python -m pytest tests/ -v -m "not gpu"`
- Commit: `git commit -m "remove(aligner): wav2vec2 forced_align unavailable in nightly torchaudio"`

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "verify(aligner): <result description>"
```

---

### Task 2: Update setup script

**Files:**
- Rewrite: `setup-jd-audio-service.bat`

- [ ] **Step 1: Replace `setup-jd-audio-service.bat`**

```batch
@echo off
REM One-time setup: create venv, install dependencies in correct order

cd /d "%~dp0"

echo ============================================
echo  JD Audio Service - Setup
echo ============================================
echo.

REM Check HF_TOKEN
if "%HF_TOKEN%"=="" (
    echo WARNING: HF_TOKEN environment variable is not set.
    echo You need a HuggingFace token for PyAnnote models.
    echo Get one at: https://huggingface.co/settings/tokens
    echo Then set it: setx HF_TOKEN "hf_your_token_here"
    echo.
)

echo [1/5] Creating virtual environment...
python -m venv .venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment. Is Python 3.11+ installed?
    pause
    exit /b 1
)
call .venv\Scripts\activate.bat

echo [2/5] Upgrading pip...
python -m pip install --upgrade pip

echo [3/5] Installing dependencies...
pip install faster-whisper "pyannote.audio>=3.1" "soundfile>=0.13" "librosa>=0.11" "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" "numpy>=1.26" "scipy>=1.14" "pystray>=0.19" "Pillow>=10.0" "omegaconf>=2.3" "pytest>=8.0" "pytest-asyncio>=0.23" "httpx>=0.27"
if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
)

echo [4/5] Installing CUDA PyTorch nightly (RTX 5090 Blackwell support)...
pip install --force-reinstall --pre torch torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
if errorlevel 1 (
    echo WARNING: CUDA PyTorch install failed. PyAnnote will not use GPU.
)

echo [5/5] Removing incompatible torchcodec...
pip uninstall torchcodec -y 2>nul

echo.
echo ============================================
echo  Setup complete!
echo ============================================
echo.
echo Next steps:
echo   1. Set HF_TOKEN if not already set
echo   2. Accept PyAnnote gated models at:
echo      - https://huggingface.co/pyannote/speaker-diarization-3.1
echo      - https://huggingface.co/pyannote/segmentation-3.0
echo      - https://huggingface.co/pyannote/speaker-diarization-community-1
echo      - https://huggingface.co/pyannote/embedding
echo   3. Run: run-jd-audio-service.bat
echo.
pause
```

- [ ] **Step 2: Commit**

```bash
git add setup-jd-audio-service.bat
git commit -m "fix(setup): update setup script for faster-whisper + CUDA nightly"
```

---

### Task 3: `/health` device reporting

**Files:**
- Modify: `src/api/schemas.py`
- Modify: `src/api/routes.py`
- Modify: `tests/test_routes.py`

- [ ] **Step 1: Write failing test**

In `tests/test_routes.py`, update `TestHealthEndpoint`:

```python
class TestHealthEndpoint:
    def test_health_returns_status(self, client, mock_manager):
        mock_manager.loaded_model_names.return_value = []
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "idle"
        assert "engineVersion" in data
        assert "device" in data
```

- [ ] **Step 2: Run test, verify it fails**

```bash
.venv/Scripts/python -m pytest tests/test_routes.py::TestHealthEndpoint -v
```
Expected: FAIL — `device` not in response

- [ ] **Step 3: Update schema and route**

In `src/api/schemas.py`, replace `HealthResponse`:

```python
class HealthResponse(BaseModel):
    status: str
    modelsLoaded: list[str]
    device: str
    engineVersion: str
```

In `src/api/routes.py`, update the `health` handler:

```python
@router.get("/health", response_model=HealthResponse)
def health(request: Request):
    mgr = get_model_manager(request)

    import torch
    if torch.cuda.is_available():
        device = f"cuda:0 ({torch.cuda.get_device_name(0)})"
    else:
        device = "cpu"

    return HealthResponse(
        status="idle" if not mgr.loaded_models else "ready",
        modelsLoaded=mgr.loaded_model_names(),
        device=device,
        engineVersion=VERSION,
    )
```

- [ ] **Step 4: Run tests**

```bash
.venv/Scripts/python -m pytest tests/ -v -m "not gpu"
```
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.py src/api/routes.py tests/test_routes.py
git commit -m "feat(health): report GPU device name instead of vramUsed"
```

---

### Task 4: Cleanup generated files

**Files:**
- Delete: `fixtures/meeting.wav`
- Delete: `fixtures/meeting_transcript.txt`
- Delete: `fixtures/meeting_transcript_v2.txt`
- Modify: `.gitignore`

- [ ] **Step 1: Remove large/sensitive files**

```bash
cd C:/Users/brigh/Documents/code/jd-audio-service
rm -f fixtures/meeting.wav fixtures/meeting_transcript.txt fixtures/meeting_transcript_v2.txt
```

- [ ] **Step 2: Update .gitignore**

Add to `.gitignore`:
```
fixtures/meeting*.wav
fixtures/meeting_transcript*.txt
```

- [ ] **Step 3: Remove from git tracking**

```bash
git rm --cached fixtures/meeting.wav fixtures/meeting_transcript.txt fixtures/meeting_transcript_v2.txt 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git add -u fixtures/
git commit -m "chore: remove generated meeting files, update gitignore"
```

---

### Task 5: Write README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

The README should include these sections (see spec for full content requirements):

1. **Header** — Project name, one-line description
2. **Prerequisites** — Python 3.11+, CUDA Toolkit 12.8 (with winget command), NVIDIA GPU, HuggingFace token
3. **Quick Start** — `setup-jd-audio-service.bat` then `run-jd-audio-service.bat`
4. **Manual Installation** — Step-by-step with exact pip commands, explaining install order and why
5. **HuggingFace Model Access** — List all 4 gated models with URLs, explain they must be accepted
6. **Running** — Tray mode vs headless mode, default port, environment variables
7. **API Reference** — All 8 endpoints with method, path, body, response, and a curl example each
8. **Architecture** — Brief overview: FastAPI + ModelManager + lazy loading + auto-unload
9. **Development** — How to run tests (`pytest` commands for unit vs GPU), project structure
10. **Troubleshooting** — CUDA warnings, torchcodec warnings, HF 401/403, OOM, first-run download

For the API reference section, use this format per endpoint:

```markdown
### POST /process

Full pipeline: transcribe + align + diarize + merge.

**Request:**
```json
{
  "audioPath": "C:/path/to/meeting.mp3",
  "options": { "minSpeakers": 2, "maxSpeakers": 6 }
}
```

**Response:**
```json
{
  "text": "Hello, thanks for joining...",
  "entries": [{ "speaker": "SPEAKER_00", "text": "Hello", "timestamp": 60.1, "words": [...] }],
  "segments": [{ "speaker": "SPEAKER_00", "start": 60.0, "end": 65.0 }],
  "duration": 3855.7,
  "quality": { "flagged_segments": [], "avg_confidence": 0.939 }
}
```

**curl:**
```bash
curl -X POST http://localhost:8374/process \
  -H "Content-Type: application/json" \
  -d '{"audioPath": "C:/path/to/meeting.mp3"}'
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with install, API reference, troubleshooting"
```

---

### Task 6: HTTP server smoke test

**Files:**
- Create: `scripts/smoke_test.py`

- [ ] **Step 1: Create smoke test script**

Create `scripts/smoke_test.py`:

```python
"""Smoke test: start real HTTP server and verify all endpoints."""
import subprocess
import sys
import time
import httpx

BASE = "http://127.0.0.1:8374"
AUDIO = "fixtures/two_speakers_short.wav"


def wait_for_server(timeout=30):
    for _ in range(timeout):
        try:
            resp = httpx.get(f"{BASE}/health", timeout=2)
            if resp.status_code == 200:
                return True
        except httpx.ConnectError:
            time.sleep(1)
    return False


def main():
    print("Starting server...", flush=True)
    proc = subprocess.Popen(
        [sys.executable, "src/main.py", "--no-tray"],
        cwd=".",
    )

    try:
        if not wait_for_server():
            print("FAIL: Server did not start within 30s")
            return 1

        print("Server is up. Running smoke tests...\n", flush=True)
        failures = 0

        # GET /health
        print("[1/5] GET /health")
        resp = httpx.get(f"{BASE}/health", timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "device" in data, "Missing device field"
        print(f"  OK — status={data['status']}, device={data['device']}\n")

        # GET /models
        print("[2/5] GET /models")
        resp = httpx.get(f"{BASE}/models", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "large-v3-turbo" in data["transcription"]
        print(f"  OK — {data}\n")

        # POST /process (short fixture)
        print("[3/5] POST /process (this loads models, may take 30-60s)...")
        resp = httpx.post(f"{BASE}/process", json={
            "audioPath": str(__import__("pathlib").Path(AUDIO).resolve()),
            "options": {"minSpeakers": 2, "maxSpeakers": 2},
        }, timeout=300)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        assert len(data["text"]) > 0, "Empty transcript"
        assert len(data["entries"]) > 0, "No entries"
        assert data["duration"] > 0, "Zero duration"
        speakers = set(e["speaker"] for e in data["entries"])
        print(f"  OK — {len(data['entries'])} entries, {len(speakers)} speakers, {data['duration']:.1f}s\n")

        # POST /unload
        print("[4/5] POST /unload")
        resp = httpx.post(f"{BASE}/unload", timeout=30)
        assert resp.status_code == 200
        print(f"  OK — {resp.json()}\n")

        # GET /health (verify idle after unload)
        print("[5/5] GET /health (after unload)")
        resp = httpx.get(f"{BASE}/health", timeout=10)
        data = resp.json()
        assert data["status"] == "idle"
        assert data["modelsLoaded"] == []
        print(f"  OK — status={data['status']}, models={data['modelsLoaded']}\n")

        print("=" * 50)
        print("ALL SMOKE TESTS PASSED")
        print("=" * 50)
        return 0

    except Exception as e:
        print(f"\nFAIL: {e}")
        import traceback
        traceback.print_exc()
        return 1

    finally:
        print("\nStopping server...")
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run the smoke test**

```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
cd C:/Users/brigh/Documents/code/jd-audio-service
.venv/Scripts/python scripts/smoke_test.py
```

Expected: All 5 checks pass. If any fail, fix the underlying issue before committing.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke_test.py
git commit -m "test: add HTTP smoke test script for real server verification"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
export HF_TOKEN=$(powershell -Command "[System.Environment]::GetEnvironmentVariable('HF_TOKEN', 'User')")
export PATH="/c/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin:$PATH"
cd C:/Users/brigh/Documents/code/jd-audio-service
.venv/Scripts/python -m pytest tests/ -v --tb=short
```

Expected: All tests pass (64+ unit + integration)

- [ ] **Step 2: Verify git is clean**

```bash
git status
git log --oneline -10
```

Expected: Clean working tree, all Plan A completion commits visible.
