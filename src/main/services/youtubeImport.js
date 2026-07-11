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

module.exports = {
  parseVideoId,
  canonicalUrl,
};
