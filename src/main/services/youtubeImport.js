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

/**
 * Convert a yt-dlp --dump-json object into the subset of meeting fields we use.
 * upload_date is `YYYYMMDD` (no time) → midnight-UTC ISO string, matching the
 * ISO-string convention meeting.date uses elsewhere.
 * @param {object} json
 * @returns {{title:string, date:string, durationSec:number|null, videoId:string, channel:string|null}}
 */
function mapMetadataToMeetingFields(json = {}) {
  let date;
  const ud = typeof json.upload_date === 'string' ? json.upload_date : null;
  if (ud && /^\d{8}$/.test(ud)) {
    const y = Number(ud.slice(0, 4));
    const m = Number(ud.slice(4, 6));
    const d = Number(ud.slice(6, 8));
    date = new Date(Date.UTC(y, m - 1, d)).toISOString();
  } else {
    date = new Date().toISOString();
  }
  return {
    title: json.title || 'YouTube Video',
    date,
    durationSec: typeof json.duration === 'number' ? json.duration : null,
    videoId: json.id,
    channel: json.channel || json.uploader || null,
  };
}

/**
 * Run yt-dlp with the injected spawn, buffering stdout/stderr.
 * Resolves { stdout, stderr, code }; rejects on spawn 'error' (ENOENT etc).
 * onLine (optional) is called per stdout line for progress parsing.
 */
function runYtDlp(spawn, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('yt-dlp', args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let buffer = '';
    child.on('error', reject); // ENOENT → binary missing
    child.stdout.on('data', chunk => {
      const s = chunk.toString();
      stdout += s;
      if (onLine) {
        buffer += s;
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          onLine(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
        }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', code => resolve({ stdout, stderr, code }));
  });
}

/** Keep the last ~500 chars of stderr for a readable toast. */
function stderrTail(stderr) {
  const t = (stderr || '').trim();
  return t.length > 500 ? t.slice(-500) : t;
}

/**
 * @param {Object} deps
 * @param {Function} deps.spawn - child_process.spawn
 * @param {Function} deps.fileExists - (path) => boolean
 * @param {string} deps.recordingsDir
 * @param {Function} [deps.log] - (msg) => void
 * @param {Function} [deps.onProgress] - (percent:number, message:string) => void
 */
function createYoutubeImporter(deps) {
  const spawn = deps.spawn;

  async function checkBinary() {
    try {
      const { code } = await runYtDlp(spawn, ['--version']);
      return code === 0;
    } catch {
      return false; // ENOENT — not installed / not on PATH
    }
  }

  async function fetchMetadata(videoId) {
    const { stdout, stderr, code } = await runYtDlp(spawn, buildMetadataArgs(videoId));
    if (code !== 0) {
      throw new Error(`yt-dlp metadata failed: ${stderrTail(stderr) || 'unknown error'}`);
    }
    let json;
    try {
      json = JSON.parse(stdout.trim().split('\n')[0]);
    } catch {
      throw new Error('yt-dlp returned unparseable metadata JSON');
    }
    return mapMetadataToMeetingFields(json);
  }

  return { checkBinary, fetchMetadata };
}

module.exports = {
  parseVideoId,
  canonicalUrl,
  buildMetadataArgs,
  buildDownloadArgs,
  parseDownloadProgress,
  mapMetadataToMeetingFields,
  createYoutubeImporter,
};
