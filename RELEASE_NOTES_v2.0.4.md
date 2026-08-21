# v2.0.4 Release Notes

## Highlights

JD Audio Service is now fully bundled into JD Notes Things: one installer, zero manual setup. The app self-provisions its local AI environment (Python, CUDA PyTorch, Whisper/PyAnnote stack) on first run and manages the service lifecycle automatically. This release also fixes recording breakage caused by audio-driver updates and makes the local AI service start with the app.

---

## Bundled Local AI Service

- **One repo, one installer**: The JD Audio Service source now ships inside the app (`audio-service/` + a bundled `uv` binary, ~50 MB installer growth). The separate `jd-audio-service` checkout, its setup/run `.bat` scripts, and the Settings path requirement are gone.
- **First-run self-provisioning**: On first launch the app builds its own Python 3.13 environment at `%LOCALAPPDATA%\JDNotesThings\audio-service` from a committed `uv.lock` — no system Python needed. Progress shows as a background task; cloud transcription keeps working during setup. The environment survives auto-updates and re-provisions automatically when a future release changes dependencies.
- **Stable CUDA PyTorch**: The locked environment uses stable torch 2.11.0+cu128 (verified on RTX 5090 / Blackwell) — the nightly-build requirement is retired.
- **Automatic lifecycle**: The service starts with the app, pre-loads its models via a new `/warmup` endpoint (first transcription no longer pays minutes of model-load time), and shuts down with the app.
- **Settings → AI Services overhaul**: live status line, a **Repair** button that rebuilds the local AI environment, and a HuggingFace token field (stored in Windows Credential Manager, injected into the service for gated model downloads). The service path field is now an advanced override only — leave it empty to use the built-in service.
- **Migration**: existing installs are migrated off the old external service path automatically; the local model cache is reused, so no model re-downloads.

## Recording Fixes

- **Self-healing audio device IDs**: Windows regenerates WASAPI endpoint GUIDs when audio drivers update (e.g. SteelSeries Sonar), which previously broke recording entirely with "Failed to get device format". The app now re-resolves configured devices by name at every record start, persists the corrected IDs, and only errors if the device is genuinely gone.

## Service Reliability

- **AI service auto-start at launch**: previously the service only started lazily on first use (and was killed on every app quit), leaving it down after each restart. It now starts at launch whenever configured (disable with `"aiServiceAutoStart": false`).
- **Repair race fixed**: repairing the environment while the service is running no longer fails with a file-lock error — shutdown is awaited before the environment is rebuilt.
- **Clearable override**: emptying the advanced service-path field now actually returns the app to the built-in service (previously the old path silently came back).
- **Robust startup errors**: service path desync self-heals, real start-failure reasons surface in the UI, and auto-updater errors show a friendly message instead of a raw Squirrel error.

## Build & Test Infrastructure

- **Packaging**: `npm run package`/`make` now fetch the pinned `uv` binary and stage the service source as extra resources automatically.
- **Line-ending-stable provisioning**: `.gitattributes` + hash normalization prevent CI-built releases from triggering a spurious full environment rebuild on user machines.
- **Test suite grew from 424 to 446 Vitest tests**, plus the service's own 62-test pytest suite now lives in-repo.

---

## Files Changed

69 files changed, ~10,237 additions, ~52 deletions (net +10,185 lines) across 22 commits since v2.0.3.
