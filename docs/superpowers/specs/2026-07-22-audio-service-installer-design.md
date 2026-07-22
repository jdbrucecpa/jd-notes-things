# Local Audio Service Setup Wizard — Design

**Date:** 2026-07-22
**Status:** Approved

## Problem

JD Notes Things v2.0 supports fully local transcription via JD Audio Service, but installing that service today requires cloning a repo, running a batch script, creating a HuggingFace token, accepting four gated model pages, and installing the CUDA Toolkit by hand. The goal: any user who installs the app should be able to get local transcription working through a guided, in-app experience.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Audience | Anyone who installs the app (product-grade) |
| No NVIDIA GPU | Hard stop; point user to cloud providers (AssemblyAI/Deepgram) |
| HuggingFace steps | All-or-nothing guided: wizard requires token + all 4 gated models accepted before finishing |
| Delivery mechanism | In-app wizard (Approach A) — NOT installer bundling; Squirrel is silent and the HF/CUDA steps cannot be automated |
| Service lifecycle after install | App auto-starts/stops the service when the Local provider is active |

## Non-goals

- Bundling the Python service or its models into the Squirrel installer.
- CPU-only transcription mode.
- A standalone compiled installer for jd-audio-service (possible future evolution).
- macOS/Linux support (Windows-first, consistent with the rest of the app).

## Entry points

1. **Settings → Transcription → Local provider card:** status-aware button — "Set up local transcription…", "Installing…", "Installed vX.Y.Z ✓", or "Update available".
2. **Selecting the Local provider** while the service is not installed opens the wizard.
3. **First-launch nudge:** on app start, if `nvidia-smi` succeeds and the service is not installed, show a one-time dismissible banner offering setup. (This delivers the "auto install" feel while keeping the install user-initiated.)

## Wizard flow (renderer)

Modal wizard with a step rail. Steps:

1. **System check** — rows with pass/fail:
   - NVIDIA GPU (`nvidia-smi` exit code + parsed GPU name)
   - Free disk space ≥ 10 GB on the target drive
   - Python 3.11+ (via `py -3 --version`, falling back to `python --version`)
   - CUDA Toolkit presence
   - winget availability
   - **No NVIDIA GPU → hard stop screen** explaining local transcription needs an NVIDIA GPU and linking to the cloud provider settings.
2. **Prerequisites** — one-click winget installs for anything missing:
   - Python (user scope, no elevation)
   - CUDA Toolkit 12.8 (`winget install Nvidia.CUDA --version 12.8`, UAC elevation)
   - Streamed console output in the wizard. If winget itself is missing, show manual download links instead.
3. **Download service** — fetch the latest GitHub Release zip of `jdbrucecpa/jd-audio-service` (public repo) and extract to `%LOCALAPPDATA%\JDAudioService\app`. Until the first tagged release exists, fall back to the main-branch zipball.
4. **Python environment** — in `%LOCALAPPDATA%\JDAudioService`:
   - `python -m venv .venv`
   - Install core deps (same list as `setup-jd-audio-service.bat` step 3)
   - Override with **stable** CUDA torch: `pip install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu128` (stable ≥2.7 supports Blackwell; replaces the nightly used in the dev setup script for reproducibility)
   - `pip uninstall torchcodec -y`
   - pip output streamed; parsed into a coarse progress bar.
5. **HuggingFace (all-or-nothing)** —
   - Instructions + buttons that open (external browser): token creation page and the 4 gated model pages (`pyannote/speaker-diarization-3.1`, `pyannote/segmentation-3.0`, `pyannote/speaker-diarization-community-1`, `pyannote/embedding`).
   - Token input field + **Verify** button: calls the HF API for each gated repo with the token; all 4 must return accessible before Next enables.
   - Token stored in Windows Credential Manager via existing `keyManagementService`; injected as `HF_TOKEN` into the service child-process environment. Never written to disk.
6. **Finish** — spawn the service headless, poll `GET /health` until it responds, show device string (e.g. "cuda:0 (NVIDIA GeForce RTX 5090)"), and offer a "Use local transcription now" checkbox that sets `transcriptionProvider` to `local`.

### Idempotency & resume

`%LOCALAPPDATA%\JDAudioService\install-state.json` records `{ serviceVersion, completedSteps, timestamps }`. Re-opening the wizard skips completed steps (each step also re-verifies its own postcondition, so the manifest is a hint, not the source of truth). This makes the wizard double as a repair tool and means a failed 20-minute pip step resumes rather than restarts.

## Main-process components

### `src/main/services/audioServiceInstaller.js`

- Step orchestration state machine; one method per step, each: verify-postcondition → run → re-verify.
- Spawns `winget` / `python` / `pip` via `child_process.spawn`, streaming stdout/stderr to the renderer over an `audio-service-install-progress` IPC event.
- All IPC handlers Zod-validated per app convention; renderer accesses via `window.electronAPI` preload bridge additions.
- Writes/reads the install-state manifest.

### `src/main/services/audioServiceManager.js`

- Post-install lifecycle: when the Local provider is active (app start or provider switch), spawn `%LOCALAPPDATA%\JDAudioService\.venv\Scripts\python.exe app\src\main.py --no-tray` with env `HF_TOKEN` (from Credential Manager), default port 8374.
- Before spawning, probe `GET /health` — if something already healthy is on the port (e.g. the dev machine's manually-run tray app), adopt it instead of spawning. This keeps the existing manual workflow working.
- Health polling, crash restart with capped retries (e.g. 3), child termination on app quit and on provider switch away from Local.
- Exposes status to the renderer (not installed / stopped / starting / ready / error) for the Settings card and wizard.

## jd-audio-service repo changes

- Add a CI workflow that, on tag push, zips the source (excluding `fixtures/`, `tests/`, `.venv`) and publishes a GitHub Release.
- App compares the latest release tag against the installed version (manifest + `/health` `engineVersion`) to surface "Update available"; update = re-download step 3 + re-run pip step 4 into the existing venv.
- Verify graceful headless operation when spawned by Electron (`--no-tray` exists; confirm clean shutdown on SIGTERM/parent exit).

## Error handling

- Step failure → show last ~20 lines of stderr with a **Retry** button; retry re-runs only that step.
- Network failures during download/pip: retryable without losing prior progress.
- winget absent: manual-install links for Python and CUDA Toolkit.
- Torch install failure is a hard step failure (no CPU fallback — consistent with the no-GPU decision).
- Service fails health check at Finish: surface the service's stderr tail and keep the wizard on the Finish step.

## Testing

- **Vitest units:** installer state machine with mocked `spawn`; pip-argument builder; HF gated-model verification (mocked fetch); manager spawn/adopt/health/restart logic; manifest read/write.
- **Playwright E2E:** wizard opens from the Settings button; system-check step renders pass/fail rows against mocked IPC responses.
- **Manual validation:** full run on a clean Windows VM or second machine (real winget + pip + HF flow) before release.

## Open items deferred to implementation planning

- Exact HF API endpoint/shape for gated-access verification (verify current API during implementation).
- Whether the wizard lives in a new renderer entry point or inside the existing settings view (follow existing settings-panel patterns).
- Release tagging/versioning convention for jd-audio-service (suggest matching its `engineVersion`).
