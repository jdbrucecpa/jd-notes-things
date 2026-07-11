/**
 * YouTube import service (spec docs/superpowers/specs/2026-07-10-youtube-import-design.md).
 *
 * Dependency-injected + unit-testable (same pattern as correctionReembed.js).
 * Shells out to `yt-dlp` from PATH (same convention as ffmpeg — no bundling).
 *
 * SECURITY: the raw user URL is NEVER handed to yt-dlp. parseVideoId extracts an
 * 11-char id; every yt-dlp invocation is built from a canonical
 * `https://www.youtube.com/watch?v=<id>` string and an args ARRAY (no shell:true,
 * no string interpolation into a command line) so a hostile URL cannot inject
 * extra flags or shell metacharacters.
 */

// YouTube ids are exactly 11 chars of [A-Za-z0-9_-].
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a canonical 11-char video id from any accepted URL shape, else null.
 * Accepts: youtube.com/watch?v=<id>, youtu.be/<id>, youtube.com/shorts/<id>
 * (query params tolerated).
 * @param {string} url
 * @returns {string|null}
 */
function parseVideoId(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  let candidate = null;
  const watch = url.match(/[?&]v=([^&#]+)/);
  if (watch) {
    candidate = watch[1];
  } else {
    const pathMatch = url.match(/(?:youtu\.be\/|\/shorts\/)([^/?&#]+)/);
    if (pathMatch) candidate = pathMatch[1];
  }
  if (!candidate) return null;
  return VIDEO_ID_RE.test(candidate) ? candidate : null;
}

/** Build the canonical watch URL we actually pass to yt-dlp. */
function canonicalUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Argv for `yt-dlp --dump-json --no-download` against the canonical URL.
 * @param {string} videoId
 * @returns {string[]}
 */
function buildMetadataArgs(videoId) {
  return ['--dump-json', '--no-download', '--no-playlist', canonicalUrl(videoId)];
}

/**
 * Argv for mp3 extraction. `outPath` is the FINAL `.mp3` path; we pass an
 * `%(ext)s` output template so the post-processor names the file deterministically.
 * @param {string} videoId
 * @param {string} outPath - absolute path ending in `.mp3`
 * @returns {string[]}
 */
function buildDownloadArgs(videoId, outPath) {
  const template = outPath.replace(/\.mp3$/i, '.%(ext)s');
  return ['-x', '--audio-format', 'mp3', '--no-playlist', '-o', template, canonicalUrl(videoId)];
}

const DOWNLOAD_PROGRESS_RE = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/;

/**
 * Parse a `[download]  NN.N% ...` yt-dlp stdout line.
 * @param {string} line
 * @returns {{percent:number}|null}
 */
function parseDownloadProgress(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(DOWNLOAD_PROGRESS_RE);
  return m ? { percent: parseFloat(m[1]) } : null;
}

module.exports = {
  parseVideoId,
  canonicalUrl,
  buildMetadataArgs,
  buildDownloadArgs,
  parseDownloadProgress,
};
