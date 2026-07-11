'use strict';

const path = require('path');

let cached = null;

/**
 * Resolve the ffmpeg executable path.
 *
 * The app must NOT depend on a system-installed `ffmpeg` on PATH — a packaged
 * GUI app launched from the Start menu often inherits a stale/limited PATH and
 * won't find a per-user (e.g. WinGet) ffmpeg, which silently breaks device
 * enumeration and recording. We ship ffmpeg with the app instead:
 *
 * - Packaged: the ffmpeg binary is copied beside the app via forge
 *   `extraResource`, landing directly in `process.resourcesPath`.
 * - Dev: use the `ffmpeg-static` npm binary. It is kept a webpack external so
 *   its `__dirname`-relative path resolves to the real node_modules copy rather
 *   than the bundled `.webpack/main` output.
 * - Fallback: bare `ffmpeg` from PATH (last resort; preserves old behavior).
 *
 * @returns {string} Absolute path to the ffmpeg executable, or 'ffmpeg'.
 */
function getFfmpegPath() {
  if (cached) return cached;

  // Lazy-require electron so this module stays importable in unit tests.
  let app = null;
  try {
    ({ app } = require('electron'));
  } catch {
    app = null;
  }

  if (app && app.isPackaged) {
    cached = path.join(process.resourcesPath, 'ffmpeg.exe');
    return cached;
  }

  try {
    // ffmpeg-static is a webpack external → real node_modules path in dev.
    cached = require('ffmpeg-static') || 'ffmpeg';
  } catch {
    cached = 'ffmpeg';
  }
  return cached;
}

/** Reset the memoized path. Test-only. */
function _resetForTests() {
  cached = null;
}

module.exports = { getFfmpegPath, _resetForTests };
