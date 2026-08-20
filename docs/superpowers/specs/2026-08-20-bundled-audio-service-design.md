# Bundled JD Audio Service — Design

**Date:** 2026-08-20
**Status:** Approved
**Goal:** JD Audio Service becomes fully part of JD Notes Things — one repo, one installer, zero manual setup. No separate clone, no `.bat` scripts, no settings path field to configure.

## Background

Today the service lives in a separate repo (`C:\Users\brigh\Documents\code\jd-audio-service`), set up by hand: clone, run `setup-jd-audio-service.bat` (venv + pip installs + nightly CUDA PyTorch), set `HF_TOKEN`, then point the app at the folder via Settings → AI Services. The app launches it via `run-jd-audio-service.bat`.

Constraints that shape the design:

- The installed environment is ~5.2 GB (nightly cu128 PyTorch for the RTX 5090 dominates). It cannot ship inside the installer without making every auto-update a multi-GB download.
- PyAnnote models are HuggingFace-gated and need an HF token on first download; they land in the shared HF cache (`%USERPROFILE%\.cache\huggingface`).
- Electron auto-updates replace the whole `app-X.Y.Z` folder, so anything that must survive updates lives outside it.

## Decisions (approved 2026-08-20)

| Decision | Choice |
|---|---|
| Dependency/model delivery | First-run self-provisioning; installer stays small |
| Repo merge | Snapshot import into `audio-service/`; old repo archived |
| Environment location | `%LOCALAPPDATA%\JDNotesThings\audio-service\` |
| HF token | In-app prompt once → Windows Credential Manager → `HF_TOKEN` env var for the service |
| Existing dev checkout | Untouched; app provisions fresh (models reuse the shared HF cache) |

## Architecture

### 1. Repo merge (snapshot)

- Copy the service source into the app repo as top-level `audio-service/`: `src/`, `tests/`, `docs/`, `fixtures/` (small ones only), `pyproject.toml`, `README.md`. One commit; the old repo is archived, history stays there.
- Delete `setup-jd-audio-service.bat` and `run-jd-audio-service.bat` — their jobs move into the app's provisioner and service manager.
- Do **not** import the service's `ffmpeg.exe`/`ffprobe.exe`; the service uses the app's ffmpeg resource (path passed via env var or CLI flag — implementation detail for the plan).
- Dependencies move from loose `requirements.txt` to a uv-native `pyproject.toml` with a committed **`uv.lock`** pinning everything, including the exact nightly cu128 PyTorch build verified on the RTX 5090. `torchcodec` is excluded via a uv dependency override (replaces the old post-install uninstall hack).

### 2. Packaging

- Electron Forge `extraResource` ships: `audio-service/src`, `pyproject.toml`, `uv.lock`, and a bundled **`uv.exe`** (~15 MB, single binary).
- Installer size impact: ~20 MB. No Python, no torch, no models inside the installer.

### 3. Provisioner — new `src/main/services/audioServiceProvisioner.js`

Owns the self-contained environment at `%LOCALAPPDATA%\JDNotesThings\audio-service\`:

- **Freshness marker:** a file recording the hash of (`uv.lock` + bundled service source version). On launch: marker matches → env is ready, start the service. Marker missing/mismatched → provision.
- **Provisioning:** run bundled `uv sync` against the shipped `pyproject.toml`/`uv.lock`. uv downloads its own CPython 3.11 — no system Python required. Progress (download/install phases) streams to the renderer.
- **Model warm-up:** after env sync, models download on first service use into the shared HF cache; the provisioner surfaces this as a distinct progress phase. Machines that already have the models (this one) skip the download.
- **Failure handling:** provisioning errors set a clear status surfaced in Settings → AI Services, with a **Repair** button that wipes the env and re-syncs. Cloud transcription providers remain fully usable while local setup is broken or in progress.

### 4. AIServiceManager changes

- Resolves the service location automatically: provisioned env + bundled source (packaged) or repo checkout `audio-service/` (dev). The `aiServicePath` settings field becomes an advanced override only — empty for normal use.
- Launches `<env>\Scripts\python.exe src\main.py --no-tray` directly (no `cmd.exe`/`.bat`), with `HF_TOKEN` injected from Credential Manager when present.
- Keeps existing behavior added 2026-08-20: auto-start at app launch, kill on quit, lazy `ensureRunning()` as backstop.

### 5. First-run UX

- Setup runs as a background task via the existing `backgroundTaskManager` progress UI: "Setting up local AI…" with phases (Python download → dependency install (~5 GB) → model download).
- HF token: if Credential Manager has none and the gated models aren't already cached, prompt once in the AI Services tab (with a link to create a token). Stored alongside the other API keys.
- App remains fully usable during setup; only local transcription waits on it.

### 6. Dev mode

Dev builds (`npm start`) use the same provisioner pointed at the repo's `audio-service/` source, with the same `%LOCALAPPDATA%` env (env is keyed by lock hash, so dev and packaged share it when their locks match). The old `Documents\code\jd-audio-service` checkout is no longer referenced by anything.

### 7. Testing

- Unit tests (Vitest, mocked spawn/fs): provisioner marker hashing, path resolution (dev vs packaged), uv command construction, failure states; AIServiceManager's new direct-python launch path.
- The service's pytest suite moves with it (`audio-service/tests`) and runs without GPU via the existing `-m "not gpu"` marker.
- Manual verification on this machine: fresh provision end-to-end, then a real recording → local transcription round trip.

## Risks

- **Nightly PyTorch via uv:** pinning a nightly cu128 wheel through uv's index configuration is the fiddliest part; once locked it is reproducible. Fallback: pin to the newest *stable* cu12x torch if it now supports Blackwell (verify during implementation).
- **uv binary updates:** bundled `uv.exe` is versioned with the app; a broken uv release only enters via an app release, and Repair re-syncs.
- **Disk:** ~5.2 GB under `%LOCALAPPDATA%` plus ~2 GB HF cache (already present here).

## Out of scope

- macOS/Linux support, multi-GPU/CPU-only fallback profiles, service auto-update independent of app releases, removing the `aiServiceUrl` override (kept for pointing at a remote service).
