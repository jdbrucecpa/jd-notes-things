# v2.0.1 Release Notes

## Highlights

Hotfix for the shipped v2.0.0 installer: the packaged app could not find FFmpeg, leaving the **Local Recording Sources device dropdowns empty** and local recording unusable. FFmpeg is now **bundled with the app** — no system install or PATH configuration required.

---

## FFmpeg Bundling (fixes empty device dropdowns)

- **Root cause:** the app invoked `ffmpeg` by bare name, relying on it being on the process PATH. A packaged GUI app launched from the Start menu often inherits a stale/limited PATH without per-user installs (e.g. WinGet's `%LOCALAPPDATA%\...\WinGet\Packages\...\bin`), so `spawn('ffmpeg')` failed with ENOENT — device enumeration returned nothing and the settings panel showed `(none)` for every source. Dev builds masked the bug because terminals do have ffmpeg on PATH.
- **Fix:** the Windows installer now ships `ffmpeg.exe` (from `ffmpeg-static`, FFmpeg 6.1.1 with dshow + libmp3lame + the amix/asplit/dynaudnorm/volume filters the mixer uses — all verified). A new `ffmpegPath` resolver picks the right binary: `resources/ffmpeg.exe` when packaged, the `ffmpeg-static` binary in dev, bare `ffmpeg` from PATH as a last-resort fallback.
- **All four FFmpeg call sites** now use the resolver: device enumeration, recording capture, the settings test-recording, and the track-anchor RMS decoder (speaker waterfall Stage 1).

## System Audio Decoupled from FFmpeg

- **Robustness fix:** WASAPI output-device (System Audio) enumeration was nested inside FFmpeg's process-close handler, so a missing FFmpeg silently emptied the System Audio list too — even though WASAPI enumeration uses the native recorder module and doesn't need FFmpeg at all. Enumeration of dshow (mic) and WASAPI (system) devices is now independent; each degrades on its own.

---

## Files Changed

- `src/main/recording/ffmpegPath.js` — new bundled-ffmpeg path resolver
- `src/main/recording/LocalProvider.js` — resolver wiring; WASAPI enumeration decoupled from FFmpeg lifecycle
- `src/main.js` — test-recording uses resolver
- `src/main/services/trackAnchorService.js` — RMS decoder uses resolver
- `forge.config.js` — ffmpeg binary added to `extraResource`
- `webpack.main.config.js` — `ffmpeg-static` kept external
- `.github/workflows/release.yml` — ffmpeg-static binary download added to CI postinstall step
- `package.json` — new dependency `ffmpeg-static`

## Dependency Changes

| Package | Version | Purpose |
|---------|---------|---------|
| `ffmpeg-static` | ^5.3.0 | Bundled FFmpeg 6.1.1 binary (dshow + libmp3lame) |

---

## Upgrade Notes

- Installed clients auto-update from GitHub Releases. After updating, open **Settings → Local Recording Sources** — the Microphone and System Audio dropdowns should now list your devices.
- The installer grows by ~80 MB (the bundled FFmpeg binary).
