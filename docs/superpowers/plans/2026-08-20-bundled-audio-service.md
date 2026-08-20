# Bundled JD Audio Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge JD Audio Service into this repo and make the app self-provision its Python/CUDA environment on first run — one repo, one installer, zero manual setup.

**Architecture:** The service source snapshot-imports to `audio-service/`. A bundled `uv.exe` (fetched at build time, shipped as an Electron Forge extra resource) provisions a locked Python environment into `%LOCALAPPDATA%\JDNotesThings\audio-service\` keyed by a lock-file hash. `AIServiceManager` launches the service directly with the provisioned `python.exe` (no `.bat`), injecting `HF_TOKEN` from Windows Credential Manager.

**Tech Stack:** Electron 43 / Node, Vitest, uv (Python package manager), Python 3.13, FastAPI, faster-whisper, pyannote.audio, PyTorch cu128.

**Spec:** `docs/superpowers/specs/2026-08-20-bundled-audio-service-design.md`

## Global Constraints

- Environment root: `%LOCALAPPDATA%\JDNotesThings\audio-service\` (venv at `venv\`, uv-managed Pythons at `python\`, marker at `provision-marker.json`).
- Service source in repo: top-level `audio-service/` (packaged copy at `process.resourcesPath/audio-service`).
- Python version: pin **3.13** (the working venv runs 3.13.3).
- Working GPU baseline that MUST keep working: RTX 5090 (Blackwell sm_120), current torch `2.12.0.dev20260318+cu128`. Prefer newest **stable** cu12x torch if it passes GPU verification; otherwise pin the nightly.
- HF token env vars the service reads: `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` (see `audio-service/src/models/diarizer.py:62`).
- Service model cache is `%APPDATA%\JDAudioService\models` (`JD_AUDIO_MODEL_DIR` in `audio-service/src/config.py`) — do NOT change it; existing machines keep their models.
- Do NOT import from the old repo: `.venv/`, `__pycache__/`, `ffmpeg.exe`, `ffprobe.exe` (unreferenced by `src/`), `run-jd-audio-service.bat`, `setup-jd-audio-service.bat`.
- Zero ESLint warnings (`npm run lint`); all Vitest tests pass (`npm test`).
- The old checkout `C:\Users\brigh\Documents\code\jd-audio-service` is read-only reference — never modify it.
- 2.0.4 release happens only when the user says so — no version bumps or tags in this plan.

---

### Task 1: Snapshot-import the service source

**Files:**
- Create: `audio-service/` (from `C:\Users\brigh\Documents\code\jd-audio-service`: `src/`, `tests/`, `docs/`, `scripts/`, `pyproject.toml`, `README.md`, small `fixtures/` only)
- Modify: `docs/superpowers/specs/2026-08-20-bundled-audio-service-design.md` (one wording fix)

**Interfaces:**
- Produces: `audio-service/src/main.py` (entry point, `--no-tray` flag), `audio-service/pyproject.toml` — consumed by every later task.

- [ ] **Step 1: Copy the source (excluding env/caches/binaries)**

```bash
cd "C:\Users\brigh\Documents\code\jd-notes-things"
mkdir -p audio-service
cp -r "C:\Users\brigh\Documents\code\jd-audio-service/src" \
      "C:\Users\brigh\Documents\code\jd-audio-service/tests" \
      "C:\Users\brigh\Documents\code\jd-audio-service/docs" \
      "C:\Users\brigh\Documents\code\jd-audio-service/scripts" \
      "C:\Users\brigh\Documents\code\jd-audio-service/pyproject.toml" \
      "C:\Users\brigh\Documents\code\jd-audio-service/README.md" \
      audio-service/
find audio-service -type d -name "__pycache__" -exec rm -rf {} +
```

Check `fixtures/` size first with `du -sh`; copy only if < 20 MB total, else skip it (tests that need it stay runnable from the old checkout until the user deletes it).

- [ ] **Step 2: Verify layout and that nothing excluded slipped in**

Run: `ls audio-service; find audio-service -name "*.exe" -o -name "*.bat" -o -name "__pycache__" | wc -l`
Expected: `src tests docs scripts pyproject.toml README.md` (± fixtures); count `0`.

- [ ] **Step 3: Fix the spec's CI wording**

In the spec's Testing section, replace the sentence claiming the pytest suite "keeps running in CI without the GPU marker" with: "The service's pytest suite moves to `audio-service/tests` and runs locally via `uv run pytest -m "not gpu"` (this repo has no unit-test CI; release.yml only builds)."

Also correct the spec's model-cache claims (two spots: Background bullet, provisioner "Model warm-up"): models live in the service's own cache `%APPDATA%\JDAudioService\models` (`JD_AUDIO_MODEL_DIR`), not the shared HuggingFace cache — the existing machine still skips re-downloading because that directory survives.

- [ ] **Step 4: Commit**

```bash
git add audio-service docs/superpowers/specs/2026-08-20-bundled-audio-service-design.md
git commit -m "feat(audio-service): snapshot-import JD Audio Service source"
```

---

### Task 2: uv fetch script + vendored binary

**Files:**
- Create: `scripts/fetch-uv.mjs`
- Create: `vendor/` entry in `.gitignore`
- Modify: `package.json` (add `fetch:uv` script; make `package`/`make` depend on it)
- Test: manual run (network download; no unit test)

**Interfaces:**
- Produces: `vendor/uv/uv.exe` on disk; npm script `npm run fetch:uv`. Consumed by Task 3 (lock generation), Task 4 (provisioner `uvPath`), Task 9 (packaging).

- [ ] **Step 1: Pin the uv version**

Run: `curl -s https://api.github.com/repos/astral-sh/uv/releases/latest | grep tag_name`
Write the returned version (e.g. `"0.9.7"`) into the `UV_VERSION` constant in the next step.

- [ ] **Step 2: Write the fetch script**

```js
// scripts/fetch-uv.mjs
// Downloads a pinned uv.exe into vendor/uv/ for bundling as an Electron
// extra resource. Idempotent: skips when the pinned version is present.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const UV_VERSION = 'SET_ME'; // pinned in Step 1
const DIR = path.resolve('vendor/uv');
const EXE = path.join(DIR, 'uv.exe');
const STAMP = path.join(DIR, 'VERSION');
const URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;

if (existsSync(EXE) && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === UV_VERSION) {
  console.log(`uv ${UV_VERSION} already present`);
  process.exit(0);
}
mkdirSync(DIR, { recursive: true });
const res = await fetch(URL, { redirect: 'follow' });
if (!res.ok) throw new Error(`uv download failed: ${res.status} ${URL}`);
const zipPath = path.join(DIR, 'uv.zip');
await pipeline(res.body, createWriteStream(zipPath));
// Extract with PowerShell (no unzip dep on Windows)
const { execSync } = await import('node:child_process');
execSync(`powershell -NoProfile -Command "Expand-Archive -Force '${zipPath}' '${DIR}'"`);
writeFileSync(STAMP, UV_VERSION);
console.log(`Fetched uv ${UV_VERSION} -> ${EXE}`);
```

- [ ] **Step 3: Wire package.json and .gitignore**

Add to `.gitignore`: `vendor/`. Add scripts: `"fetch:uv": "node scripts/fetch-uv.mjs"` and prepend it to packaging: change `"package"` to `"npm run fetch:uv && electron-forge package"` and `"make"` likewise (check existing script bodies first and keep their current flags).

- [ ] **Step 4: Verify**

Run: `npm run fetch:uv && vendor/uv/uv.exe --version`
Expected: prints the pinned version.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-uv.mjs package.json .gitignore
git commit -m "build: fetch pinned uv binary for audio-service provisioning"
```

---

### Task 3: uv project config + lock file (GPU-verified)

**Files:**
- Modify: `audio-service/pyproject.toml`
- Create: `audio-service/uv.lock`
- Create: `audio-service/.python-version` (content: `3.13`)

**Interfaces:**
- Produces: committed `uv.lock` + `pyproject.toml` such that `uv sync --frozen --no-dev` reproduces a working GPU environment. Consumed by the provisioner (Task 4).

- [ ] **Step 1: Capture the known-good pins from the working venv**

Run: `"C:\Users\brigh\Documents\code\jd-audio-service\.venv\Scripts\pip" freeze | grep -iE "^(torch|torchaudio|pyannote|faster-whisper|ctranslate2|numpy|scipy)"`
Record these versions — they are the compatibility baseline.

- [ ] **Step 2: Rewrite pyproject.toml as a uv project**

Keep the existing `[project]` metadata and dependency floors, then add (floors updated to the majors captured in Step 1):

```toml
[project]
# ...existing name/version/description...
requires-python = "==3.13.*"
dependencies = [
    "faster-whisper>=1.1",
    "pyannote.audio>=4",        # match the major from Step 1
    "soundfile>=0.13",
    "librosa>=0.11",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "numpy>=1.26",
    "scipy>=1.14",
    "pystray>=0.19",
    "Pillow>=10.0",
    "omegaconf>=2.3",
    "torch",
    "torchaudio",
]

[dependency-groups]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "httpx>=0.27"]

[tool.uv]
package = false
override-dependencies = ["torchcodec ; sys_platform == 'never'"]  # replaces the old post-install uninstall hack

[tool.uv.sources]
torch = { index = "pytorch-cu128" }
torchaudio = { index = "pytorch-cu128" }

[[tool.uv.index]]
name = "pytorch-cu128"
url = "https://download.pytorch.org/whl/cu128"
explicit = true
```

- [ ] **Step 3: Lock and sync into a scratch env (stable torch attempt)**

```bash
cd audio-service
../vendor/uv/uv.exe lock
UV_PROJECT_ENVIRONMENT="$LOCALAPPDATA/JDNotesThings/audio-service/venv" \
UV_PYTHON_INSTALL_DIR="$LOCALAPPDATA/JDNotesThings/audio-service/python" \
../vendor/uv/uv.exe sync --frozen --no-dev
```

(This is a ~5 GB download; it also IS the env the app will use — not wasted work.)

- [ ] **Step 4: GPU verification on the 5090**

Run (with the same `UV_PROJECT_ENVIRONMENT`): `../vendor/uv/uv.exe run python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_capability(0))"`
Expected: `True` and capability `(12, 0)`. Then a real smoke: `../vendor/uv/uv.exe run python scripts/smoke_test.py` (check its usage first; it lives in `audio-service/scripts/`).
**If stable torch fails on sm_120:** switch the index URL to `https://download.pytorch.org/whl/nightly/cu128`, pin `torch==2.12.0.dev20260318+cu128` (the exact working nightly from Step 1) in `[project]` dependencies, re-lock, re-sync, re-verify. Note in pyproject a comment that nightly wheels can be pruned upstream — if a future re-lock fails, move to the then-current stable.

- [ ] **Step 5: Run the service test suite through uv**

Run: `../vendor/uv/uv.exe run --group dev pytest -m "not gpu" -q` (from `audio-service/`)
Expected: all non-GPU tests pass.

- [ ] **Step 6: Commit**

```bash
git add audio-service/pyproject.toml audio-service/uv.lock audio-service/.python-version
git commit -m "feat(audio-service): uv-locked environment (Python 3.13, cu128 torch)"
```

---

### Task 4: audioServiceProvisioner.js (TDD)

**Files:**
- Create: `src/main/services/audioServiceProvisioner.js`
- Test: `tests/unit/audioServiceProvisioner.test.js`

**Interfaces:**
- Consumes: `vendor/uv/uv.exe` path (dev) / `process.resourcesPath` uv (packaged) — paths are injected, the class never touches Electron APIs.
- Produces (consumed by Tasks 6–7):

```js
class AudioServiceProvisioner {
  constructor({ serviceRoot, envDir, uvPath })   // all absolute paths
  computeLockHash()                              // sha256 hex of uv.lock + pyproject.toml bytes
  isProvisioned()                                // boolean — marker exists and hash matches
  async provision(onProgress)                    // uv sync; onProgress(line: string); throws on failure
  async ensureProvisioned(onProgress)            // no-op if isProvisioned(), else provision()
  async repair(onProgress)                       // rm -rf envDir/venv + marker, then provision()
  getPythonExe()                                 // `${envDir}\venv\Scripts\python.exe`
  getServiceRoot()                               // serviceRoot passed in
}
module.exports = { AudioServiceProvisioner };
```

Marker file `${envDir}\provision-marker.json`: `{ "lockHash": "<hex>", "provisionedAt": "<ISO>" }`.

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/audioServiceProvisioner.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AudioServiceProvisioner } from '../../src/main/services/audioServiceProvisioner.js';

let tmp, serviceRoot, envDir, prov;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-test-'));
  serviceRoot = path.join(tmp, 'audio-service');
  envDir = path.join(tmp, 'env');
  fs.mkdirSync(serviceRoot, { recursive: true });
  fs.writeFileSync(path.join(serviceRoot, 'uv.lock'), 'lock-v1');
  fs.writeFileSync(path.join(serviceRoot, 'pyproject.toml'), 'proj-v1');
  prov = new AudioServiceProvisioner({ serviceRoot, envDir, uvPath: path.join(tmp, 'uv.exe') });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('AudioServiceProvisioner', () => {
  it('computeLockHash changes when uv.lock changes', () => {
    const h1 = prov.computeLockHash();
    fs.writeFileSync(path.join(serviceRoot, 'uv.lock'), 'lock-v2');
    expect(prov.computeLockHash()).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isProvisioned is false with no marker, true after a matching marker', () => {
    expect(prov.isProvisioned()).toBe(false);
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'provision-marker.json'),
      JSON.stringify({ lockHash: prov.computeLockHash() })
    );
    expect(prov.isProvisioned()).toBe(true);
  });

  it('isProvisioned is false when the lock hash no longer matches', () => {
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'provision-marker.json'), JSON.stringify({ lockHash: 'stale' }));
    expect(prov.isProvisioned()).toBe(false);
  });

  it('provision spawns uv sync with frozen/no-dev and env overrides, then writes the marker', async () => {
    const calls = [];
    prov._spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => {
        p.stderr.emit('data', Buffer.from('Resolved 42 packages\n'));
        p.emit('close', 0);
      });
      return p;
    };
    const lines = [];
    await prov.provision((l) => lines.push(l));

    expect(calls[0].cmd).toContain('uv.exe');
    expect(calls[0].args).toEqual(['sync', '--frozen', '--no-dev']);
    expect(calls[0].opts.cwd).toBe(serviceRoot);
    expect(calls[0].opts.env.UV_PROJECT_ENVIRONMENT).toBe(path.join(envDir, 'venv'));
    expect(calls[0].opts.env.UV_PYTHON_INSTALL_DIR).toBe(path.join(envDir, 'python'));
    expect(lines.join('')).toContain('Resolved 42 packages');
    expect(prov.isProvisioned()).toBe(true);
  });

  it('provision rejects on non-zero exit and leaves no marker', async () => {
    prov._spawn = () => {
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => {
        p.stderr.emit('data', Buffer.from('error: no such package\n'));
        p.emit('close', 1);
      });
      return p;
    };
    await expect(prov.provision(() => {})).rejects.toThrow(/uv sync failed \(exit 1\)/);
    expect(prov.isProvisioned()).toBe(false);
  });

  it('ensureProvisioned skips provisioning when the marker matches', async () => {
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'provision-marker.json'),
      JSON.stringify({ lockHash: prov.computeLockHash() })
    );
    prov._spawn = vi.fn();
    await prov.ensureProvisioned(() => {});
    expect(prov._spawn).not.toHaveBeenCalled();
  });

  it('repair wipes the venv and marker before re-provisioning', async () => {
    const venv = path.join(envDir, 'venv');
    fs.mkdirSync(venv, { recursive: true });
    fs.writeFileSync(path.join(venv, 'stale.txt'), 'x');
    fs.writeFileSync(path.join(envDir, 'provision-marker.json'), JSON.stringify({ lockHash: 'x' }));
    let sawCleanDir = null;
    prov._spawn = () => {
      sawCleanDir = !fs.existsSync(venv);
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => p.emit('close', 0));
      return p;
    };
    await prov.repair(() => {});
    expect(sawCleanDir).toBe(true);
    expect(prov.isProvisioned()).toBe(true);
  });

  it('getPythonExe points into the env venv', () => {
    expect(prov.getPythonExe()).toBe(path.join(envDir, 'venv', 'Scripts', 'python.exe'));
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `npx vitest run tests/unit/audioServiceProvisioner.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/main/services/audioServiceProvisioner.js
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let log;
try {
  log = require('electron-log');
} catch {
  log = console;
}

const MARKER_FILE = 'provision-marker.json';

/**
 * Provisions and maintains the self-contained Python environment for the
 * bundled JD Audio Service under %LOCALAPPDATA%\JDNotesThings\audio-service.
 * All paths are injected so the class is testable outside Electron. uv does
 * the heavy lifting: it downloads CPython itself, so no system Python is
 * required. The env is keyed by a hash of uv.lock + pyproject.toml — any
 * dependency change in a new app version re-provisions automatically.
 */
class AudioServiceProvisioner {
  constructor({ serviceRoot, envDir, uvPath }) {
    this.serviceRoot = serviceRoot;
    this.envDir = envDir;
    this.uvPath = uvPath;
    this._spawn = spawn; // test seam
  }

  computeLockHash() {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(path.join(this.serviceRoot, 'uv.lock')));
    h.update(fs.readFileSync(path.join(this.serviceRoot, 'pyproject.toml')));
    return h.digest('hex');
  }

  isProvisioned() {
    try {
      const marker = JSON.parse(
        fs.readFileSync(path.join(this.envDir, MARKER_FILE), 'utf8')
      );
      return marker.lockHash === this.computeLockHash();
    } catch {
      return false;
    }
  }

  async provision(onProgress = () => {}) {
    fs.mkdirSync(this.envDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const proc = this._spawn(this.uvPath, ['sync', '--frozen', '--no-dev'], {
        cwd: this.serviceRoot,
        windowsHide: true,
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: path.join(this.envDir, 'venv'),
          UV_PYTHON_INSTALL_DIR: path.join(this.envDir, 'python'),
        },
      });
      let tail = '';
      proc.stderr?.on('data', (chunk) => {
        const line = chunk.toString();
        tail = (tail + line).slice(-2000);
        onProgress(line);
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`uv sync failed (exit ${code}): ${tail.trim()}`));
      });
    });
    fs.writeFileSync(
      path.join(this.envDir, MARKER_FILE),
      JSON.stringify({ lockHash: this.computeLockHash(), provisionedAt: new Date().toISOString() })
    );
    log.info('[AIService] Environment provisioned');
  }

  async ensureProvisioned(onProgress) {
    if (this.isProvisioned()) return;
    await this.provision(onProgress);
  }

  async repair(onProgress) {
    fs.rmSync(path.join(this.envDir, 'venv'), { recursive: true, force: true });
    fs.rmSync(path.join(this.envDir, MARKER_FILE), { force: true });
    await this.provision(onProgress);
  }

  getPythonExe() {
    return path.join(this.envDir, 'venv', 'Scripts', 'python.exe');
  }

  getServiceRoot() {
    return this.serviceRoot;
  }
}

module.exports = { AudioServiceProvisioner };
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run tests/unit/audioServiceProvisioner.test.js` → PASS. Then `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/audioServiceProvisioner.js tests/unit/audioServiceProvisioner.test.js
git commit -m "feat(audio-service): environment provisioner (uv sync, lock-hash marker)"
```

---

### Task 5: Service /warmup endpoint (TDD, Python)

**Files:**
- Modify: `audio-service/src/api/routes.py`, `audio-service/src/api/schemas.py`
- Test: `audio-service/tests/test_warmup.py`

**Interfaces:**
- Produces: `POST /warmup` → `{"loading": ["transcriber", ...]}` — kicks off model loads in a background thread so first real transcription doesn't pay minutes of load time. Consumed by main.js (Task 7) after provisioning/start.

- [ ] **Step 1: Write the failing test**

```python
# audio-service/tests/test_warmup.py
from fastapi.testclient import TestClient
from server import create_app
from models.manager import ModelManager


def test_warmup_reports_models_and_returns_immediately(monkeypatch):
    mgr = ModelManager()
    loaded = []
    # get_or_load is called from a background thread; stub it to record names
    monkeypatch.setattr(
        mgr, "get_or_load", lambda name, loader: loaded.append(name)
    )
    app = create_app(mgr)
    client = TestClient(app)

    resp = client.post("/warmup")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["loading"]) == {"transcriber", "diarizer", "embedder"}
    # background thread runs promptly under TestClient
    import time
    for _ in range(50):
        if len(loaded) == 3:
            break
        time.sleep(0.05)
    assert set(loaded) == {"transcriber", "diarizer", "embedder"}
```

- [ ] **Step 2: Run to verify it fails** — from `audio-service/`: `../vendor/uv/uv.exe run --group dev pytest tests/test_warmup.py -q` → FAIL (404).

- [ ] **Step 3: Implement**

In `schemas.py` add:

```python
class WarmupResponse(BaseModel):
    loading: list[str]
```

In `routes.py` (loader functions follow the exact pattern of the existing endpoints, e.g. `transcribe` at line ~110):

```python
@router.post("/warmup", response_model=WarmupResponse)
def warmup(request: Request):
    """Kick off model loading in the background so the first real request
    doesn't pay the multi-minute load/download cost."""
    mgr = get_model_manager(request)

    def _load_all():
        from models.transcriber import Transcriber
        from models.diarizer import Diarizer
        from models.embedder import Embedder
        with _gpu_lock:
            mgr.get_or_load("transcriber", lambda: Transcriber())
            mgr.get_or_load("diarizer", lambda: Diarizer())
            mgr.get_or_load("embedder", lambda: Embedder())

    threading.Thread(target=_load_all, daemon=True).start()
    return WarmupResponse(loading=["transcriber", "diarizer", "embedder"])
```

Add `import threading` to routes.py imports if missing, and `WarmupResponse` to the schema imports.

- [ ] **Step 4: Run all non-GPU service tests** — `../vendor/uv/uv.exe run --group dev pytest -m "not gpu" -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add audio-service/src/api/routes.py audio-service/src/api/schemas.py audio-service/tests/test_warmup.py
git commit -m "feat(audio-service): POST /warmup preloads models in background"
```

---

### Task 6: AIServiceManager — provisioned launch path (TDD)

**Files:**
- Modify: `src/main/services/aiServiceManager.js`
- Test: `tests/unit/aiServiceManager.test.js` (extend)

**Interfaces:**
- Consumes: `AudioServiceProvisioner` instance (Task 4 signatures).
- Produces (consumed by Task 7):

```js
aiServiceManager.setProvisioner(provisioner)      // enables bundled mode
aiServiceManager.setHfTokenGetter(async () => t)  // token injected as HF_TOKEN at spawn
// ensureRunning(onProvisionProgress?) —
//   servicePath set (advanced override): legacy .bat launch, unchanged
//   provisioner set: ensureProvisioned() then spawn pythonExe src\main.py --no-tray
```

- [ ] **Step 1: Read the existing tests** (`tests/unit/aiServiceManager.test.js`) to match their mocking style — they stub `fetch` for health checks and inspect spawn args.

- [ ] **Step 2: Write failing tests** (append; adapt mock style to what Step 1 found — the assertions below are the contract):

```js
describe('bundled provisioner launch', () => {
  it('provisions then spawns the provisioned python with --no-tray and HF_TOKEN', async () => {
    const mgr = new AIServiceManager();
    const provisioner = {
      ensureProvisioned: vi.fn(async () => {}),
      getPythonExe: () => 'C:\\env\\venv\\Scripts\\python.exe',
      getServiceRoot: () => 'C:\\res\\audio-service',
    };
    mgr.setProvisioner(provisioner);
    mgr.setHfTokenGetter(async () => 'hf_secret');
    // health: down before spawn, up after (mock fetch: first call fails, then ok)
    // spawn: capture cmd/args/opts via the suite's existing spawn mock
    const result = await mgr.ensureRunning();

    expect(provisioner.ensureProvisioned).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(spawnCalls[0].cmd).toBe('C:\\env\\venv\\Scripts\\python.exe');
    expect(spawnCalls[0].args).toEqual([path.join('src', 'main.py'), '--no-tray']);
    expect(spawnCalls[0].opts.cwd).toBe('C:\\res\\audio-service');
    expect(spawnCalls[0].opts.env.HF_TOKEN).toBe('hf_secret');
  });

  it('a configured servicePath (advanced override) wins over the provisioner', async () => {
    // servicePath set AND provisioner set -> legacy bat launch, provisioner untouched
  });

  it('surfaces provisioning failure via lastError and returns false', async () => {
    // ensureProvisioned rejects -> ensureRunning() === false, lastError contains message
  });
});
```

- [ ] **Step 3: Run to verify they fail**, then implement in `aiServiceManager.js`:
  - Add `this.provisioner = null; this._getHfToken = null;` in the constructor, plus `setProvisioner()` / `setHfTokenGetter()`.
  - In `ensureRunning(onProvisionProgress)` replace the hard `if (!this.servicePath)` failure branch: when `servicePath` is set keep the existing `.bat` flow verbatim; else if `this.provisioner` is set, `await this.provisioner.ensureProvisioned(onProvisionProgress)` (wrap in try/catch → `this.lastError = err.message; return false`), then spawn `this.provisioner.getPythonExe()` with args `[path.join('src', 'main.py'), '--no-tray']`, `cwd: this.provisioner.getServiceRoot()`, `windowsHide: true`, `stdio: ['ignore','pipe','pipe']`, env extended with `HF_TOKEN` when `this._getHfToken` returns one (also set `HUGGING_FACE_HUB_TOKEN` to the same value); keep the existing exit/error/stderr handlers and `_pollHealth()` return.
  - Only when neither is available: keep the current "No service path configured" error.

- [ ] **Step 4: Run tests + lint** — `npx vitest run tests/unit/aiServiceManager.test.js && npm run lint` → PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/aiServiceManager.js tests/unit/aiServiceManager.test.js
git commit -m "feat(ai-service): launch bundled service via provisioned python"
```

---

### Task 7: main.js wiring — provisioner, first-run task, IPC, migration

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`

**Interfaces:**
- Consumes: `AudioServiceProvisioner` (Task 4), `setProvisioner`/`setHfTokenGetter` (Task 6), `POST /warmup` (Task 5), existing `backgroundTaskManager`, `keyManagementService` (`getKey`), `keys:set` IPC (already generic — reused for the HF token, key name `HF_TOKEN`).
- Produces (consumed by Task 8 UI):
  - IPC `aiService:status` → `{ mode: 'bundled'|'override', provisioned: boolean, healthy: boolean, provisioning: boolean, lastError: string|null }`
  - IPC `aiService:repair` → `{ success: boolean, error?: string }` (runs as a background task)
  - preload: `aiServiceStatus: () => ipcRenderer.invoke('aiService:status')`, `aiServiceRepair: () => ipcRenderer.invoke('aiService:repair')`

- [ ] **Step 1: Instantiate the provisioner** near the `aiServiceManager` config block (currently at `src/main.js:1782`, "Configure AI service manager from settings"):

```js
const { AudioServiceProvisioner } = require('./main/services/audioServiceProvisioner');
const bundledServiceRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'audio-service')
  : path.join(app.getAppPath(), 'audio-service');
const bundledUvPath = app.isPackaged
  ? path.join(process.resourcesPath, 'uv', 'uv.exe')
  : path.join(app.getAppPath(), 'vendor', 'uv', 'uv.exe');
let audioServiceProvisioner = null;
if (fs.existsSync(path.join(bundledServiceRoot, 'uv.lock')) && fs.existsSync(bundledUvPath)) {
  audioServiceProvisioner = new AudioServiceProvisioner({
    serviceRoot: bundledServiceRoot,
    envDir: path.join(process.env.LOCALAPPDATA, 'JDNotesThings', 'audio-service'),
    uvPath: bundledUvPath,
  });
  aiServiceManager.setProvisioner(audioServiceProvisioner);
  aiServiceManager.setHfTokenGetter(() => keyManagementService.getKey('HF_TOKEN'));
}
```

(`vendor/uv/uv.exe` in dev requires `npm run fetch:uv` once; the `existsSync` guard keeps dev working without it — the manager then behaves exactly as today via `aiServicePath`.)

- [ ] **Step 2: One-time settings migration.** In the same block: if `appSettings.aiServicePath` is set, `audioServiceProvisioner` exists, and `appSettings.aiServicePathMigratedToBundled` is not `true` → log it, set `appSettings.aiServicePath = ''`, set `appSettings.aiServicePathMigratedToBundled = true`, `saveAppSettings()`, and do NOT call `aiServiceManager.setServicePath()`. A user re-entering a path later re-activates the override (Task 8 keeps the field).

- [ ] **Step 3: Rework the launch auto-start** (added 2026-08-20, same area): replace the plain `ensureRunning()` fire-and-forget with a provisioning-aware version:

```js
if (appSettings.aiServiceAutoStart !== false &&
    (audioServiceProvisioner || appSettings.aiServicePath)) {
  const needsProvision = audioServiceProvisioner && !audioServiceProvisioner.isProvisioned();
  const taskId = needsProvision
    ? backgroundTaskManager.addTask({
        type: 'ai-service-setup',
        description: 'Setting up local AI (first run, ~5 GB download)',
      })
    : null;
  aiServiceManager
    .ensureRunning((line) => {
      if (taskId) backgroundTaskManager.updateTask(taskId, null, line.trim().slice(0, 120));
    })
    .then(async (healthy) => {
      if (taskId) {
        if (healthy) backgroundTaskManager.completeTask(taskId);
        else backgroundTaskManager.failTask(taskId, aiServiceManager.lastError || 'setup failed');
      }
      if (healthy) {
        // Preload models so the first transcription is instant.
        try {
          await fetch(`${aiServiceManager.serviceUrl}/warmup`, { method: 'POST' });
        } catch { /* warmup is best-effort */ }
      } else {
        logger.main.warn(`[AIService] Launch auto-start failed: ${aiServiceManager.lastError || 'unknown'}`);
      }
    });
}
```

Check `backgroundTaskManager`'s real method names first (`addTask`/`updateTask`/`completeTask`/`failTask` are used at `src/main.js:7173-7181`; mirror exactly what exists).

- [ ] **Step 4: Add the two IPC handlers** next to the existing `aiService:health` / `aiService:start` handlers (`src/main.js:~7263`):

```js
ipcMain.handle('aiService:status', async () => {
  return {
    mode: appSettings.aiServicePath ? 'override' : 'bundled',
    provisioned: audioServiceProvisioner ? audioServiceProvisioner.isProvisioned() : null,
    healthy: await aiServiceManager.checkHealth(),
    provisioning: aiServiceProvisionInFlight,
    lastError: aiServiceManager.lastError || null,
  };
});

let aiServiceProvisionInFlight = false;
ipcMain.handle('aiService:repair', async () => {
  if (!audioServiceProvisioner) {
    return { success: false, error: 'Bundled service not available in this build' };
  }
  if (aiServiceProvisionInFlight) return { success: false, error: 'Setup already running' };
  aiServiceProvisionInFlight = true;
  const taskId = backgroundTaskManager.addTask({
    type: 'ai-service-repair',
    description: 'Repairing local AI environment',
  });
  try {
    aiServiceManager.shutdown();
    await audioServiceProvisioner.repair((line) =>
      backgroundTaskManager.updateTask(taskId, null, line.trim().slice(0, 120))
    );
    const healthy = await aiServiceManager.ensureRunning();
    backgroundTaskManager.completeTask(taskId);
    return { success: healthy, error: healthy ? undefined : aiServiceManager.lastError };
  } catch (err) {
    backgroundTaskManager.failTask(taskId, err.message);
    return { success: false, error: err.message };
  } finally {
    aiServiceProvisionInFlight = false;
  }
});
```

(Declare `aiServiceProvisionInFlight` before both handlers; set it around the launch auto-start provisioning too.)

- [ ] **Step 5: Preload bridge** — add to `src/preload.js` next to the existing `aiService*` methods:

```js
aiServiceStatus: () => ipcRenderer.invoke('aiService:status'),
aiServiceRepair: () => ipcRenderer.invoke('aiService:repair'),
```

- [ ] **Step 6: Verify** — `npm test && npm run lint` (all green), then `npm start`: log shows either "Environment provisioned"/setup task on a clean `%LOCALAPPDATA%`, or immediate healthy start on this machine (env already built in Task 3). Confirm `/warmup` hits the service log.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat(ai-service): bundled provisioning wiring, status/repair IPC, launch warmup"
```

---

### Task 8: Settings UI — AI Services tab

**Files:**
- Modify: `src/index.html` (AI Services tab markup)
- Modify: `src/renderer/settings.js` (status/repair/token handlers; path field relabel)

**Interfaces:**
- Consumes: `window.electronAPI.aiServiceStatus()`, `aiServiceRepair()`, `keysSet('HF_TOKEN', v)` / `keysGet('HF_TOKEN')` (existing generic bridge, `src/preload.js:246-249`), existing elements `aiServicePathInput`, `aiServiceStartBtn` (`src/renderer/settings.js:155-157`).

- [ ] **Step 1: Markup.** In the AI Services tab in `src/index.html`:
  - Add a status line above the existing controls: `<div id="aiServiceStatusLine" class="setting-description">Checking…</div>`
  - Add `<button id="aiServiceRepairBtn" class="btn-secondary">Repair local AI</button>` beside the Start button.
  - Add an HF token row (same pattern as other password-style inputs in the security tab): `<input type="password" id="hfTokenInput" placeholder="hf_…">` with a description linking to `https://huggingface.co/settings/tokens` and a Save button `<button id="hfTokenSaveBtn">Save</button>`.
  - Change the service-path field's label/description to "Advanced: service path override — leave empty to use the built-in service."

- [ ] **Step 2: Renderer logic.** In `settings.js` (follow the existing patterns at lines 449-490 — plain `getElementById` + listeners inside the same init function):

```js
async function refreshAiServiceStatus() {
  const line = document.getElementById('aiServiceStatusLine');
  if (!line) return;
  try {
    const s = await window.electronAPI.aiServiceStatus();
    if (s.provisioning) line.textContent = 'Local AI: setting up… (see background tasks)';
    else if (s.healthy) line.textContent = `Local AI: running (${s.mode === 'override' ? 'custom path' : 'built-in'})`;
    else if (s.mode === 'bundled' && s.provisioned === false) line.textContent = 'Local AI: not set up yet — starts on first launch or Repair';
    else line.textContent = `Local AI: stopped${s.lastError ? ' — ' + s.lastError : ''}`;
  } catch {
    line.textContent = 'Local AI: status unavailable';
  }
}
```

Wire: call `refreshAiServiceStatus()` when the AI tab opens and after Start/Repair complete. Repair button: confirm via the existing dialog pattern (`confirm('Rebuild the local AI environment? This re-downloads ~5 GB.')`), then `await window.electronAPI.aiServiceRepair()`, toast the result with `showToast`, refresh status. HF token: on save, `await window.electronAPI.keysSet('HF_TOKEN', hfTokenInput.value.trim())`, clear the input, toast success; on tab open, `keysGet('HF_TOKEN')` and show a "configured" hint (never the value).

- [ ] **Step 3: Verify manually** — `npm start`, open Settings → AI Services: status line reflects reality; Repair runs with a background task and toasts; HF token save/read round-trips (check with `keysListAll` in devtools or the security tab list).

- [ ] **Step 4: Lint + tests, commit**

```bash
npm run lint && npm test
git add src/index.html src/renderer/settings.js
git commit -m "feat(settings): AI service status, repair, and HF token UI"
```

---

### Task 9: Electron Forge packaging

**Files:**
- Create: `scripts/stage-audio-service.mjs`
- Modify: `forge.config.js`
- Modify: `package.json` (hook staging into `package`/`make` alongside `fetch:uv`)

**Interfaces:**
- Consumes: `audio-service/` sources, `vendor/uv/uv.exe`.
- Produces: packaged app with `resources/audio-service/{src,pyproject.toml,uv.lock,.python-version}` and `resources/uv/uv.exe` — the exact paths Task 7 resolves via `process.resourcesPath`.

- [ ] **Step 1: Staging script.** `extraResource` copies whole directories, so stage a filtered copy to keep tests/docs/fixtures out of the installer:

```js
// scripts/stage-audio-service.mjs
// Stages the shippable subset of audio-service/ into vendor/stage/ for
// forge's extraResource (which copies directories wholesale).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const stage = path.resolve('vendor/stage/audio-service');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync('audio-service/src', path.join(stage, 'src'), {
  recursive: true,
  filter: (src) => !src.includes('__pycache__'),
});
for (const f of ['pyproject.toml', 'uv.lock', '.python-version']) {
  cpSync(path.join('audio-service', f), path.join(stage, f));
}
console.log(`Staged audio-service -> ${stage}`);
```

- [ ] **Step 2: Forge config.** In `forge.config.js` `packagerConfig.extraResource`, append `'./vendor/stage/audio-service'` and `'./vendor/uv'` (the array currently holds `'./config'` and `ffmpegStatic`).

- [ ] **Step 3: package.json.** Add `"stage:audio": "node scripts/stage-audio-service.mjs"`; make `package` and `make` run `npm run fetch:uv && npm run stage:audio && electron-forge …`.

- [ ] **Step 4: Verify the package** — `npm run package`, then:

```bash
ls out/*/resources/audio-service out/*/resources/uv
```

Expected: `src pyproject.toml uv.lock .python-version` and `uv.exe`. No `tests/`, no `__pycache__`.

- [ ] **Step 5: Commit**

```bash
git add scripts/stage-audio-service.mjs forge.config.js package.json
git commit -m "build: ship audio-service source and uv binary as extra resources"
```

---

### Task 10: End-to-end verification on this machine

**Files:** none (manual gate before the 2.0.4 release work starts)

- [ ] **Step 1: Fresh-provision test.** Rename `%LOCALAPPDATA%\JDNotesThings\audio-service` to `audio-service.keep`. Quit the installed 2.0.3 app (tray → quit). Run the **packaged** build from `out/`: first launch must show the "Setting up local AI" background task, complete the ~5 GB sync, start the service, and hit `/warmup`. Watch `%APPDATA%\jd-notes-things\logs\main.log`.
- [ ] **Step 2: Round trip.** With the packaged build: record a short test meeting (or use Import) with transcription provider `local` → verify transcript + speakers come back from the bundled service.
- [ ] **Step 3: Marker no-op.** Relaunch the packaged app → log shows no re-provisioning, service healthy within seconds.
- [ ] **Step 4: Repair path.** Settings → AI Services → Repair → completes and service returns healthy.
- [ ] **Step 5: Cleanup.** Delete `audio-service.keep`. Report results to the user — 2.0.4 release (version bump, tag, push-release skill) happens on their go.
