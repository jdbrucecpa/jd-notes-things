# YouTube URL Import & Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let JD paste a YouTube URL and get the same deliverables a recorded meeting gets — diarized transcript with speaker names, exec auto-summary, and a vault export under `content/youtube/`.

**Architecture:** A new dependency-injected `youtubeImport.js` service shells out to `yt-dlp` (PATH convention, same as ffmpeg) to fetch metadata and download audio to the recordings dir. A Zod-validated `youtube:import` IPC handler downloads first, then creates a `platform: 'youtube'` meeting record, then hands off to the **existing** transcription+speaker-ID+summary pipeline (extracted from the `transcription:rerun` handler into a shared `rerunTranscriptionForMeeting` helper — no duplicated transcription code). Two small pure modules (`contentPassGate.js`, `youtubeRoute.js`) hold the title-protection and routing decisions so they are unit-testable outside `main.js`.

**Tech Stack:** Electron main process (Node), `child_process.spawn`, Zod (`ipcSchemas.js`), Vitest, vanilla renderer (createElement/textContent), existing `BackgroundTaskManager`, `databaseService`, `RoutingEngine`/`VaultStructure`.

---

## Baseline (verify before starting)

- `npx vitest run` → **341 passing** (a `wasapiCapture.test.js` EADDRINUSE failure is environmental — a stray port bind — and is NOT counted against you; everything else must pass).
- `npx eslint src/ tests/` → **zero** warnings/errors.
- **NEVER** kill running `electron`/`ffmpeg` processes. The installed app + dev build may both be running; do not touch them.
- `docs/` is gitignored — commit this plan and every new spec-adjacent doc with `git add -f`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## File Structure

**New files:**
- `src/main/services/youtubeImport.js` — DI download/metadata module (pure helpers + async orchestration).
- `src/main/services/contentPassGate.js` — pure title-protection predicates (Stage 3 rename gate + generic-title suggestion gate), shared by `generateMeetingSummary`.
- `src/main/routing/youtubeRoute.js` — pure `buildYoutubeRoute(meeting)` returning a vault-relative `content/youtube/<date>-<slug>` route.
- `tests/unit/youtubeImport.test.js`
- `tests/unit/contentPassGate.test.js`
- `tests/unit/youtubeRoute.test.js`

**Modified files:**
- `src/main/validation/ipcSchemas.js` — add `youtubeImportSchema` + export.
- `src/main.js` — extract `rerunTranscriptionForMeeting`; add `youtube:import` handler; wire the Stage 3 gate module; add the `content/youtube` routing branch.
- `src/preload.js` — expose `youtubeImport(url)`.
- `src/index.html` — File-menu item, toolbar button, and the import modal markup.
- `src/renderer.js` — menu/toolbar handlers + modal wiring.

---

## Task 1: `parseVideoId` — extract & validate the video id

**Files:**
- Create: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

**Why this first:** The id is the security boundary. We NEVER pass the raw user string to `yt-dlp`; we extract an 11-char id and rebuild a canonical `https://www.youtube.com/watch?v=<id>` URL, so a hostile string cannot smuggle extra args or shell metacharacters.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/youtubeImport.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  parseVideoId,
} from '../../src/main/services/youtubeImport.js';

describe('parseVideoId', () => {
  it('parses watch?v= URLs', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('parses watch URLs with extra query params', () => {
    expect(parseVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&list=RD&t=42s')).toBe('dQw4w9WgXcQ');
  });
  it('parses youtu.be short URLs', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
  });
  it('parses shorts URLs', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('returns null for a non-YouTube URL', () => {
    expect(parseVideoId('https://vimeo.com/12345')).toBeNull();
  });
  it('returns null for garbage', () => {
    expect(parseVideoId('not a url at all')).toBeNull();
  });
  it('returns null for empty / non-string input', () => {
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId(null)).toBeNull();
    expect(parseVideoId(undefined)).toBeNull();
  });
  it('rejects an id of the wrong length (no over-capture)', () => {
    expect(parseVideoId('https://youtu.be/short')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `Failed to resolve import` / `parseVideoId is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/main/services/youtubeImport.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): add parseVideoId with strict id validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `buildMetadataArgs` / `buildDownloadArgs` — exact yt-dlp argv

**Files:**
- Modify: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

**Note on the `-o` template:** `-x --audio-format mp3` runs a post-processor that writes the final `.mp3`. To avoid the double-extension pitfall we pass an `-o` **template** ending in `.%(ext)s`, derived from the caller's final `.mp3` path. `downloadAudio` (Task 6) returns/asserts the final `.mp3`. `--no-playlist` guards against a `&list=` URL pulling a whole playlist.

- [ ] **Step 1: Write the failing test** (append to the existing describe block file)

```js
import {
  parseVideoId,
  canonicalUrl,
  buildMetadataArgs,
  buildDownloadArgs,
} from '../../src/main/services/youtubeImport.js';

describe('buildMetadataArgs', () => {
  it('builds dump-json argv against the canonical URL', () => {
    expect(buildMetadataArgs('dQw4w9WgXcQ')).toEqual([
      '--dump-json',
      '--no-download',
      '--no-playlist',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]);
  });
});

describe('buildDownloadArgs', () => {
  it('builds mp3 extraction argv with an %(ext)s output template', () => {
    const out = 'C:/rec/youtube-dQw4w9WgXcQ.mp3';
    expect(buildDownloadArgs('dQw4w9WgXcQ', out)).toEqual([
      '-x',
      '--audio-format',
      'mp3',
      '--no-playlist',
      '-o',
      'C:/rec/youtube-dQw4w9WgXcQ.%(ext)s',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `buildMetadataArgs is not a function`.

- [ ] **Step 3: Write minimal implementation** (add functions + exports)

```js
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
```

Add to `module.exports`: `buildMetadataArgs`, `buildDownloadArgs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): add exact yt-dlp arg builders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `parseDownloadProgress` — pure stdout-line parser

**Files:**
- Modify: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { parseDownloadProgress } from '../../src/main/services/youtubeImport.js';

describe('parseDownloadProgress', () => {
  it('parses a fractional percentage', () => {
    expect(parseDownloadProgress('[download]  42.3% of  10.50MiB at 1.20MiB/s ETA 00:05'))
      .toEqual({ percent: 42.3 });
  });
  it('parses 100%', () => {
    expect(parseDownloadProgress('[download] 100% of 10.50MiB in 00:08')).toEqual({ percent: 100 });
  });
  it('parses an integer percentage', () => {
    expect(parseDownloadProgress('[download]   0.0% of ~5.00MiB')).toEqual({ percent: 0 });
  });
  it('returns null for a non-progress line', () => {
    expect(parseDownloadProgress('[youtube] Extracting URL')).toBeNull();
    expect(parseDownloadProgress('')).toBeNull();
    expect(parseDownloadProgress(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `parseDownloadProgress is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

Add `parseDownloadProgress` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): add parseDownloadProgress line parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `mapMetadataToMeetingFields` — yt-dlp JSON → meeting fields

**Files:**
- Modify: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { mapMetadataToMeetingFields } from '../../src/main/services/youtubeImport.js';

describe('mapMetadataToMeetingFields', () => {
  it('maps upload_date YYYYMMDD to an ISO date and passes title through', () => {
    const out = mapMetadataToMeetingFields({
      id: 'dQw4w9WgXcQ',
      title: 'My Channel Update',
      upload_date: '20260710',
      duration: 634,
      channel: 'JD Bruce CPA',
    });
    expect(out.title).toBe('My Channel Update');
    expect(out.date).toBe('2026-07-10T00:00:00.000Z');
    expect(out.durationSec).toBe(634);
    expect(out.videoId).toBe('dQw4w9WgXcQ');
    expect(out.channel).toBe('JD Bruce CPA');
  });
  it('falls back to uploader when channel missing', () => {
    const out = mapMetadataToMeetingFields({ id: 'x'.repeat(11), title: 'T', uploader: 'JD' });
    expect(out.channel).toBe('JD');
  });
  it('uses a placeholder title and a valid ISO date when fields are absent', () => {
    const out = mapMetadataToMeetingFields({ id: 'x'.repeat(11) });
    expect(out.title).toBe('YouTube Video');
    expect(Number.isNaN(Date.parse(out.date))).toBe(false);
    expect(out.durationSec).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `mapMetadataToMeetingFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

Add `mapMetadataToMeetingFields` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): map yt-dlp metadata to meeting fields

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `checkBinary` / `fetchMetadata` — DI spawn wrappers

**Files:**
- Modify: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

**DI shape (mirrors correctionReembed.js):** the module exports a factory `createYoutubeImporter({ spawn, fileExists, recordingsDir, log, onProgress })`. The instance methods close over `spawn` (injected `child_process.spawn`) so tests pass a fake spawn that returns an EventEmitter-like child.

- [ ] **Step 1: Write the failing test**

```js
import { EventEmitter } from 'events';
import { createYoutubeImporter } from '../../src/main/services/youtubeImport.js';

// Minimal fake child: stdout/stderr are EventEmitters, plus a close event.
function fakeChild({ stdout = '', stderr = '', code = 0, error = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (error) { child.emit('error', error); return; }
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

function makeImporter(spawnImpl, overrides = {}) {
  return createYoutubeImporter({
    spawn: spawnImpl,
    fileExists: () => true,
    recordingsDir: 'C:/rec',
    log: () => {},
    onProgress: () => {},
    ...overrides,
  });
}

describe('checkBinary', () => {
  it('resolves true when yt-dlp --version exits 0', async () => {
    const spawn = vi.fn(() => fakeChild({ stdout: '2026.07.01\n', code: 0 }));
    const yt = makeImporter(spawn);
    await expect(yt.checkBinary()).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith('yt-dlp', ['--version'], expect.any(Object));
  });
  it('resolves false when spawn errors (binary missing)', async () => {
    const spawn = vi.fn(() => fakeChild({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const yt = makeImporter(spawn);
    await expect(yt.checkBinary()).resolves.toBe(false);
  });
});

describe('fetchMetadata', () => {
  it('spawns dump-json and returns mapped fields', async () => {
    const json = JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'T', upload_date: '20260710', duration: 5 });
    const spawn = vi.fn(() => fakeChild({ stdout: json, code: 0 }));
    const yt = makeImporter(spawn);
    const meta = await yt.fetchMetadata('dQw4w9WgXcQ');
    expect(spawn).toHaveBeenCalledWith(
      'yt-dlp',
      ['--dump-json', '--no-download', '--no-playlist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      expect.any(Object)
    );
    expect(meta.title).toBe('T');
    expect(meta.date).toBe('2026-07-10T00:00:00.000Z');
  });
  it('rejects with the stderr tail on non-zero exit', async () => {
    const spawn = vi.fn(() => fakeChild({ stderr: 'ERROR: Private video', code: 1 }));
    const yt = makeImporter(spawn);
    await expect(yt.fetchMetadata('dQw4w9WgXcQ')).rejects.toThrow(/Private video/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `createYoutubeImporter is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
const path = require('path');

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
  const log = deps.log || (() => {});
  const onProgress = deps.onProgress || (() => {});

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
```

Add to `module.exports`: `createYoutubeImporter` (and keep the pure helpers exported). Require `path` at top of file (used by `downloadAudio` in Task 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): add checkBinary + fetchMetadata via injected spawn

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: `downloadAudio` + `importFromUrl` — orchestration

**Files:**
- Modify: `src/main/services/youtubeImport.js`
- Test: `tests/unit/youtubeImport.test.js`

`importFromUrl(url)` orchestrates checkBinary → fetchMetadata → downloadAudio and returns `{ audioPath, meta }` **without creating a meeting** (main.js creates it after success, per spec §3). It reports progress via the injected `onProgress`.

- [ ] **Step 1: Write the failing test**

```js
describe('downloadAudio', () => {
  it('spawns extraction argv, reports progress, returns the mp3 path', async () => {
    const progressLines = '[download]   0.0% of 5MiB\n[download]  50.0% of 5MiB\n[download] 100% of 5MiB\n';
    const spawn = vi.fn(() => fakeChild({ stdout: progressLines, code: 0 }));
    const seen = [];
    const yt = makeImporter(spawn, { onProgress: (p) => seen.push(p) });
    const out = await yt.downloadAudio('dQw4w9WgXcQ');
    expect(out).toBe(path.join('C:/rec', 'youtube-dQw4w9WgXcQ.mp3'));
    expect(spawn).toHaveBeenCalledWith(
      'yt-dlp',
      buildDownloadArgs('dQw4w9WgXcQ', path.join('C:/rec', 'youtube-dQw4w9WgXcQ.mp3')),
      expect.any(Object)
    );
    // progress scaled into the download band and monotonic-ish (last near 90)
    expect(seen.length).toBeGreaterThan(0);
  });
  it('rejects with stderr tail on non-zero exit', async () => {
    const spawn = vi.fn(() => fakeChild({ stderr: 'ERROR: Video unavailable', code: 1 }));
    const yt = makeImporter(spawn);
    await expect(yt.downloadAudio('dQw4w9WgXcQ')).rejects.toThrow(/Video unavailable/);
  });
  it('rejects when the expected mp3 is missing after a 0 exit', async () => {
    const spawn = vi.fn(() => fakeChild({ code: 0 }));
    const yt = makeImporter(spawn, { fileExists: () => false });
    await expect(yt.downloadAudio('dQw4w9WgXcQ')).rejects.toThrow(/not found after download/);
  });
});

describe('importFromUrl', () => {
  it('runs check → metadata → download and returns {audioPath, meta}', async () => {
    const json = JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'T', upload_date: '20260710' });
    const spawn = vi.fn((cmd, args) => {
      if (args.includes('--version')) return fakeChild({ stdout: 'v', code: 0 });
      if (args.includes('--dump-json')) return fakeChild({ stdout: json, code: 0 });
      return fakeChild({ stdout: '[download] 100% of 5MiB\n', code: 0 });
    });
    const yt = makeImporter(spawn);
    const res = await yt.importFromUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(res.audioPath).toBe(path.join('C:/rec', 'youtube-dQw4w9WgXcQ.mp3'));
    expect(res.meta.title).toBe('T');
  });
  it('throws a binary-missing error when yt-dlp is absent', async () => {
    const spawn = vi.fn(() => fakeChild({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const yt = makeImporter(spawn);
    await expect(yt.importFromUrl('https://youtu.be/dQw4w9WgXcQ')).rejects.toMatchObject({ code: 'binary-missing' });
  });
  it('throws for an unparseable URL before spawning', async () => {
    const spawn = vi.fn();
    const yt = makeImporter(spawn);
    await expect(yt.importFromUrl('not a youtube url')).rejects.toThrow(/valid YouTube URL/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: FAIL — `downloadAudio is not a function`.

- [ ] **Step 3: Write minimal implementation** (add inside `createYoutubeImporter`, before `return`)

```js
  function outputPathFor(videoId) {
    return path.join(deps.recordingsDir, `youtube-${videoId}.mp3`);
  }

  async function downloadAudio(videoId) {
    const outPath = outputPathFor(videoId);
    // Download progress occupies the 15–90% band of the overall task.
    const onLine = line => {
      const p = parseDownloadProgress(line);
      if (p) onProgress(15 + Math.round((p.percent / 100) * 75), `Downloading audio ${Math.round(p.percent)}%`);
    };
    const { stderr, code } = await runYtDlp(spawn, buildDownloadArgs(videoId, outPath), { onLine });
    if (code !== 0) {
      throw new Error(`yt-dlp download failed: ${stderrTail(stderr) || 'unknown error'}`);
    }
    if (!deps.fileExists(outPath)) {
      throw new Error(`Downloaded audio not found after download: ${outPath}`);
    }
    return outPath;
  }

  /**
   * Full flow: validate URL → binary check → metadata → download.
   * @returns {Promise<{audioPath:string, meta:object}>}
   */
  async function importFromUrl(url) {
    const videoId = parseVideoId(url);
    if (!videoId) {
      throw new Error('Not a valid YouTube URL');
    }
    onProgress(5, 'Checking yt-dlp...');
    const hasBinary = await checkBinary();
    if (!hasBinary) {
      const err = new Error('yt-dlp not found — install with `winget install yt-dlp`');
      err.code = 'binary-missing';
      throw err;
    }
    onProgress(10, 'Fetching video info...');
    const meta = await fetchMetadata(videoId);
    onProgress(15, `Downloading: ${meta.title}`);
    log(`[YouTubeImport] Downloading "${meta.title}" (${videoId})`);
    const audioPath = await downloadAudio(videoId);
    onProgress(90, 'Download complete');
    return { audioPath, meta };
  }
```

Add `downloadAudio` and `importFromUrl` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeImport.test.js`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/youtubeImport.js tests/unit/youtubeImport.test.js
git commit -m "feat(youtube): add downloadAudio + importFromUrl orchestration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `youtubeImportSchema` — IPC validation

**Files:**
- Modify: `src/main/validation/ipcSchemas.js` (add schema near the other Import schemas ~line 197, add to `module.exports` ~line 524)

The renderer already extracts/validates the id; this is a defense-in-depth boundary. Loose contains-`youtu` check + length cap; strict parsing happens in `parseVideoId`.

- [ ] **Step 1: Add the schema** (after `importAudioFileSchema`, before the Google Auth section around line 197)

```js
const youtubeImportSchema = z.object({
  url: z
    .string()
    .min(1, 'URL cannot be empty')
    .max(2048, 'URL is too long')
    .regex(/youtu\.?be/i, 'Must be a YouTube URL'),
});
```

- [ ] **Step 2: Export it** — in the `module.exports` block, in the `// Import schemas` group add:

```js
  youtubeImportSchema,
```

- [ ] **Step 3: Verify lint**

Run: `npx eslint src/main/validation/ipcSchemas.js`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/main/validation/ipcSchemas.js
git commit -m "feat(youtube): add youtubeImport IPC schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: `contentPassGate.js` — Stage 3 title protection (pure, tested)

**Files:**
- Create: `src/main/routing/../services/contentPassGate.js` → `src/main/services/contentPassGate.js`
- Test: `tests/unit/contentPassGate.test.js`

**Why a module:** The Stage 3 rename gate and the generic-title-suggestion gate both live inside the enormous `generateMeetingSummary` in `main.js`, which tests cannot import. Extracting the two decisions makes the spec's "youtube meeting is never renamed" testable and keeps `main.js` readable. The `GENERIC_TITLES` array (currently inline at `main.js:12706`) moves here (used only there → DRY).

**Evidence — current `main.js` behavior being preserved:**
- Rename branch `main.js:12696`: `if (pass.title && !meeting.obsidianLink) {`
- Suggestion branch `main.js:12725-12735`: `!renamedByContentPass && genericTitles.some(g => currentTitle === g || currentTitle.startsWith(g) || currentTitle.includes(' ' + g) || currentTitle.includes(g + ' '))`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/contentPassGate.test.js
import { describe, it, expect } from 'vitest';
import {
  shouldRenameFromContentPass,
  shouldSuggestTitle,
  isGenericTitle,
} from '../../src/main/services/contentPassGate.js';

describe('shouldRenameFromContentPass', () => {
  it('renames an un-synced, non-youtube meeting with a pass title', () => {
    expect(shouldRenameFromContentPass({ passTitle: 'Acme - Bob - Taxes', obsidianLink: undefined, platform: 'zoom' })).toBe(true);
  });
  it('NEVER renames a youtube meeting (title is authoritative)', () => {
    expect(shouldRenameFromContentPass({ passTitle: 'Acme - Bob - Taxes', obsidianLink: undefined, platform: 'youtube' })).toBe(false);
  });
  it('does not rename an already-synced meeting', () => {
    expect(shouldRenameFromContentPass({ passTitle: 'X', obsidianLink: 'clients/a/x.md', platform: 'zoom' })).toBe(false);
  });
  it('does not rename without a pass title', () => {
    expect(shouldRenameFromContentPass({ passTitle: '', obsidianLink: undefined, platform: 'zoom' })).toBe(false);
  });
});

describe('shouldSuggestTitle', () => {
  it('suggests for a generic-titled non-youtube meeting', () => {
    expect(shouldSuggestTitle({ title: 'recording', platform: 'zoom', renamedByContentPass: false })).toBe(true);
  });
  it('NEVER suggests for a youtube meeting even if the title reads generic', () => {
    expect(shouldSuggestTitle({ title: 'My recording of Q3', platform: 'youtube', renamedByContentPass: false })).toBe(false);
  });
  it('skips suggestion when Stage 3 already renamed', () => {
    expect(shouldSuggestTitle({ title: 'call', platform: 'zoom', renamedByContentPass: true })).toBe(false);
  });
  it('skips suggestion for a non-generic title', () => {
    expect(shouldSuggestTitle({ title: 'Acme Q3 Planning', platform: 'zoom', renamedByContentPass: false })).toBe(false);
  });
});

describe('isGenericTitle', () => {
  it('matches numbered/prefixed generics', () => {
    expect(isGenericTitle('transcript2')).toBe(true);
    expect(isGenericTitle('Zoom Meeting')).toBe(true);
  });
  it('is false for a real title', () => {
    expect(isGenericTitle('Acme Planning')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/contentPassGate.test.js`
Expected: FAIL — cannot resolve import.

- [ ] **Step 3: Write minimal implementation**

```js
// src/main/services/contentPassGate.js
/**
 * Pure decisions for the auto-summary Stage 3 (content-aware) pass, extracted
 * from generateMeetingSummary so they can be unit-tested.
 *
 * Title protection (spec §4): a `platform === 'youtube'` meeting keeps its
 * authoritative video title — Stage 3 must never rename it, and the legacy
 * generic-title suggestion must never clobber it either. Only the RENAME is
 * gated on platform; speaker reassignment verdicts still apply to youtube
 * meetings (handled by the caller — this module only governs the title).
 */

const GENERIC_TITLES = [
  'transcript', 'meeting', 'imported', 'untitled', 'new meeting', 'new note',
  'call', 'zoom', 'teams', 'google meet', 'krisp', 'recording', 'audio', 'video',
];

/** True if the title looks like a placeholder (is/starts-with/contains a generic word). */
function isGenericTitle(title) {
  const t = (title || '').toLowerCase().trim();
  return GENERIC_TITLES.some(
    g => t === g || t.startsWith(g) || t.includes(' ' + g) || t.includes(g + ' ')
  );
}

/**
 * Should the Stage 3 content pass rename the meeting?
 * @param {{passTitle:?string, obsidianLink:?string, platform:?string}} args
 */
function shouldRenameFromContentPass({ passTitle, obsidianLink, platform }) {
  if (!passTitle) return false;       // pass produced no better title
  if (obsidianLink) return false;     // already synced → renaming dupes vault files
  if (platform === 'youtube') return false; // authoritative title
  return true;
}

/**
 * Should the legacy generic-title suggestion path run?
 * @param {{title:?string, platform:?string, renamedByContentPass:boolean}} args
 */
function shouldSuggestTitle({ title, platform, renamedByContentPass }) {
  if (renamedByContentPass) return false; // Stage 3 already set a structured title
  if (platform === 'youtube') return false; // authoritative title
  return isGenericTitle(title);
}

module.exports = {
  GENERIC_TITLES,
  isGenericTitle,
  shouldRenameFromContentPass,
  shouldSuggestTitle,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/contentPassGate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/contentPassGate.js tests/unit/contentPassGate.test.js
git commit -m "feat(youtube): add contentPassGate title-protection predicates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Wire `contentPassGate` into `generateMeetingSummary`

**Files:**
- Modify: `src/main.js` (require near the other service requires ~line 59; Stage 3 block `12696`; generic block `12705-12735`)

No new unit test — Task 8 covers the logic; this task swaps the inline conditions for the tested predicates. Verify the full suite + lint after.

- [ ] **Step 1: Add the require** — near `src/main.js:59` (after the `backgroundTaskManager` require), add:

```js
const { shouldRenameFromContentPass, shouldSuggestTitle } = require('./main/services/contentPassGate');
```

- [ ] **Step 2: Gate the rename branch** — replace `src/main.js:12696`:

Current:
```js
      if (pass.title && !meeting.obsidianLink) {
```
Replacement:
```js
      if (shouldRenameFromContentPass({ passTitle: pass.title, obsidianLink: meeting.obsidianLink, platform: meeting.platform })) {
```

- [ ] **Step 3: Replace the inline generic-title block** — replace `src/main.js:12705-12735` (the `const genericTitles = [...]` array through the end of the `needsTitleSuggestion` assignment):

Current:
```js
    // Check if title is generic and needs suggestion
    const genericTitles = [
      'transcript',
      'meeting',
      'imported',
      'untitled',
      'new meeting',
      'new note',
      'call',
      'zoom',
      'teams',
      'google meet',
      'krisp',
      'recording',
      'audio',
      'video',
    ];
    const currentTitle = (meeting.title || '').toLowerCase().trim();
    // A structured Stage 3 title ("Company - Name - Topic") may contain a
    // generic word (e.g. "Call") — don't let the legacy suggestion clobber it.
    const needsTitleSuggestion =
      !renamedByContentPass &&
      genericTitles.some(generic => {
        // Match if title IS the generic word, starts with it (including numbered variants like "transcript2"), or contains it as a word
        return (
          currentTitle === generic ||
          currentTitle.startsWith(generic) || // Matches "transcript", "transcript2", "transcript-foo", etc.
          currentTitle.includes(' ' + generic) ||
          currentTitle.includes(generic + ' ')
        );
      });
```
Replacement:
```js
    // Check if title is generic and needs suggestion. A structured Stage 3 title
    // ("Company - Name - Topic") may contain a generic word (e.g. "Call") — the
    // renamedByContentPass guard prevents the legacy suggestion from clobbering
    // it, and youtube meetings keep their authoritative video title (spec §4).
    const needsTitleSuggestion = shouldSuggestTitle({
      title: meeting.title,
      platform: meeting.platform,
      renamedByContentPass,
    });
```

- [ ] **Step 4: Run the full suite + lint (no regressions)**

Run: `npx vitest run`
Expected: 341 passing (wasapiCapture EADDRINUSE environmental only).
Run: `npx eslint src/main.js`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(youtube): gate Stage 3 rename + title suggestion via contentPassGate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: `youtubeRoute.js` — content/youtube routing (pure, tested)

**Files:**
- Create: `src/main/routing/youtubeRoute.js`
- Test: `tests/unit/youtubeRoute.test.js`

**Why a module + why relative path:** The unfiled fallback in `RoutingEngine` returns a **vault-relative** `fullPath` (`RoutingEngine.js:88`) that `exportMeetingToObsidian` resolves via `vaultStructure.getAbsolutePath(route.fullPath)` (`main.js:4061`). We mirror that exactly: a relative `content/youtube/<date>-<slug>` route resolved by the same code path — no need to know the absolute vault root. The per-route loop recomputes the file `baseFilename` from `meeting.date.toISOString()` + `slugify(meeting.title)` (`main.js:4037-4040`), so building the folder name identically here keeps folder and file slugs in sync.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/youtubeRoute.test.js
import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildYoutubeRoute, YOUTUBE_VAULT_DIR } from '../../src/main/routing/youtubeRoute.js';

describe('buildYoutubeRoute', () => {
  it('routes to content/youtube with a date-slug folder', () => {
    const route = buildYoutubeRoute({ title: 'My Channel Update', date: '2026-07-10T00:00:00.000Z', platform: 'youtube' });
    expect(route.type).toBe('youtube');
    expect(route.organizationName).toBe('YouTube');
    expect(route.fullPath).toBe(path.join('content', 'youtube', '2026-07-10-my-channel-update'));
  });
  it('folder slug matches the export file convention (toISOString date + slugify)', () => {
    const route = buildYoutubeRoute({ title: "J.D.'s Q3 Review!", date: '2026-01-05T12:34:00.000Z' });
    expect(route.fullPath).toBe(path.join('content', 'youtube', '2026-01-05-jds-q3-review'));
  });
  it('falls back to a valid folder when date/title absent', () => {
    const route = buildYoutubeRoute({});
    expect(route.fullPath.startsWith(YOUTUBE_VAULT_DIR)).toBe(true);
    expect(route.fullPath).toMatch(/\d{4}-\d{2}-\d{2}-meeting$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/youtubeRoute.test.js`
Expected: FAIL — cannot resolve import.

- [ ] **Step 3: Write minimal implementation**

```js
// src/main/routing/youtubeRoute.js
/**
 * YouTube content routing (spec §5). platform === 'youtube' meetings land in a
 * fixed `content/youtube/` folder under the vault root, a sibling mechanism to
 * the RoutingEngine `_unfiled` fallback. Returns a VAULT-RELATIVE fullPath so
 * exportMeetingToObsidian resolves it via vaultStructure.getAbsolutePath, exactly
 * like unfiled routes. Not user-configurable for now (YAGNI).
 */
const path = require('path');
const slugify = require('../utils/slugify');

const YOUTUBE_VAULT_DIR = path.join('content', 'youtube');

/**
 * @param {{title?:string, date?:string}} meeting
 * @returns {{type:string, slug:null, basePath:string, fullPath:string,
 *   folderName:string, dateStr:string, titleSlug:string, organizationName:string}}
 */
function buildYoutubeRoute(meeting) {
  const date = meeting && meeting.date ? new Date(meeting.date) : new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD (matches export file slug)
  const titleSlug = slugify(meeting && meeting.title);
  const folderName = `${dateStr}-${titleSlug}`;
  return {
    type: 'youtube',
    slug: null,
    basePath: YOUTUBE_VAULT_DIR,
    fullPath: path.join(YOUTUBE_VAULT_DIR, folderName),
    folderName,
    dateStr,
    titleSlug,
    organizationName: 'YouTube',
  };
}

module.exports = { buildYoutubeRoute, YOUTUBE_VAULT_DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/youtubeRoute.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/routing/youtubeRoute.js tests/unit/youtubeRoute.test.js
git commit -m "feat(youtube): add buildYoutubeRoute for content/youtube routing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Wire the youtube routing branch into `exportMeetingToObsidian`

**Files:**
- Modify: `src/main.js` (require ~line 46; routing if/else chain `4001-4028`)

Insert the youtube branch **after** the `obsidianLink` override branch (so re-exports of an already-synced youtube meeting reuse their path — no vault dupes) and **before** the `routingEngine.route()` else. A `forceReroute` on a youtube meeting correctly falls through to this branch.

- [ ] **Step 1: Add the require** — near `src/main.js:46` (after `const slugify = require('./main/utils/slugify');`):

```js
const { buildYoutubeRoute } = require('./main/routing/youtubeRoute');
```

- [ ] **Step 2: Insert the routing branch** — replace `src/main.js:4013` (the `} else {` that opens the routing-engine branch) with the youtube branch plus the original else:

Current:
```js
    } else {
      // Use routing engine
      const routingDecision = routingEngine.route({
```
Replacement:
```js
    } else if (meeting.platform === 'youtube') {
      // spec §5: channel content routes to a fixed content/youtube/ folder
      // (vault-relative — resolved by vaultStructure.getAbsolutePath in the loop
      // below, same as _unfiled).
      routes = [buildYoutubeRoute(meeting)];
      console.log(`[ObsidianExport] YouTube content route: ${routes[0].fullPath}`);
    } else {
      // Use routing engine
      const routingDecision = routingEngine.route({
```

- [ ] **Step 3: Run the full suite + lint**

Run: `npx vitest run`
Expected: 341 passing (+ the 3 new suites from Tasks 1–10 already added; count grows accordingly — no failures).
Run: `npx eslint src/main.js`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(youtube): route youtube meetings to content/youtube on export

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Extract `rerunTranscriptionForMeeting` from the rerun IPC handler

**Files:**
- Modify: `src/main.js` (`transcription:rerun` handler `8153-8393`)

**Decision (evidence-based):** The transcription+waterfall+speaker-ID+summary sequence the YouTube flow needs is ~235 lines of working logic inside the `transcription:rerun` handler (`main.js:8155-8392`). Replicating it = ~235 lines of NEW code and a second thing to keep in sync. **Extracting** the handler body into a shared `async function rerunTranscriptionForMeeting({ meetingId, provider, audioPath, sender })` is almost entirely a MOVE (near-zero new code): the IPC handler becomes a 3-line delegate and the YouTube handler calls the same function. Extraction wins on "less new code" and DRY. The only body edit is `event.sender` → `sender` (single occurrence at `main.js:8215`); everything else references module-scope symbols (`mainWindow`, `databaseService`, `generateAndSaveAutoSummary`, etc.) and moves unchanged.

This is a pure refactor — no behavior change. There is no unit test for this handler (it depends on Electron/DB singletons); regression coverage is the full suite staying green + lint, and the manual E2E in Task 15.

- [ ] **Step 1: Convert the handler into a thin delegate** — replace `src/main.js:8153-8155`:

Current:
```js
ipcMain.handle(
  'transcription:rerun',
  withValidation(transcriptionRerunSchema, async (event, { meetingId, provider, audioPath }) => {
```
Replacement:
```js
/**
 * Shared transcription pipeline: (re)transcribe a meeting's audio, run the v2.0
 * speaker waterfall, and regenerate the exec summary. Used by the
 * transcription:rerun IPC handler AND the youtube:import flow (Task 13).
 * @param {{meetingId:string, provider?:?string, audioPath?:?string, sender:object}} args
 *   sender = a webContents used for import:progress events.
 */
async function rerunTranscriptionForMeeting({ meetingId, provider = null, audioPath = null, sender }) {
```

- [ ] **Step 2: Redirect the progress event to `sender`** — replace `src/main.js:8215`:

Current:
```js
      event.sender.send('import:progress', {
```
Replacement:
```js
      sender.send('import:progress', {
```

- [ ] **Step 3: Close the function and register the delegating handler** — replace `src/main.js:8392-8393` (the handler's closing `})` + `);`):

Current:
```js
  })
);
```
Replacement:
```js
}

ipcMain.handle(
  'transcription:rerun',
  withValidation(transcriptionRerunSchema, async (event, { meetingId, provider, audioPath }) =>
    rerunTranscriptionForMeeting({ meetingId, provider, audioPath, sender: event.sender })
  )
);
```

> Note: the extracted function body still uses `mainWindow` directly (dialog fallback at ~`8167`, `meeting-updated` at ~`8378`) — these are module-scope and remain valid. For a YouTube import the audio always exists, so the dialog fallback never fires.

- [ ] **Step 4: Run the full suite + lint (pure refactor — must stay green)**

Run: `npx vitest run`
Expected: no new failures (same count as after Task 11).
Run: `npx eslint src/main.js`
Expected: clean (watch for an "unused `event`" — the delegate still uses `event.sender`, so it's fine).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "refactor(transcription): extract rerunTranscriptionForMeeting helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13: `youtube:import` IPC handler

**Files:**
- Modify: `src/main.js` (constants/requires; add handler near the rerun handler ~`8393`; add `youtubeImportSchema` to the destructured import ~`194`)

**Meeting record decision (spec §3 reconciled with the codebase):** The spec says `type: 'past'`, but the meeting-schema `type` enum is `['profile','calendar','document','imported']` (`src/shared/validation.js:48`) — `'past'` is the `saveMeeting(meeting, 'past')` LIST arg, not the `meeting.type` field. Use `type: 'document'` (the value `ImportManager.createMeeting` and `createMeetingNoteAndRecord` use) and pass `'past'` as the second `saveMeeting` arg. `videoFile` = the absolute mp3 path so `rerunTranscriptionForMeeting`'s `audioPath || meeting.videoFile` resolves without a dialog.

- [ ] **Step 1: Add `youtubeImportSchema` to the ipcSchemas destructure** — in the `require('./main/validation/ipcSchemas')` block, in the `// Import schemas` group (near `src/main.js:157-160`), add:

```js
  youtubeImportSchema,
```

- [ ] **Step 2: Add the youtubeImport require + confirm RECORDING_PATH** — near `src/main.js:59`, after the `contentPassGate` require added in Task 9, add:

```js
const { createYoutubeImporter } = require('./main/services/youtubeImport');
```
(`RECORDING_PATH = path.join(app.getPath('userData'), 'recordings')` already exists at `main.js:2255` — reuse it as `recordingsDir`.)

- [ ] **Step 3: Register the handler** — immediately after the `transcription:rerun` registration (after the block added in Task 12, ~`src/main.js:8400`), add:

```js
// ===================================================================
// YouTube Import IPC Handler (spec 2026-07-10-youtube-import-design.md)
// ===================================================================
ipcMain.handle(
  'youtube:import',
  withValidation(youtubeImportSchema, async (event, { url }) => {
    const fsMod = require('fs');
    const taskId = backgroundTaskManager.addTask({
      type: 'youtube-import',
      description: 'Importing YouTube video...',
    });
    try {
      const importer = createYoutubeImporter({
        spawn: require('child_process').spawn,
        fileExists: p => fsMod.existsSync(p),
        recordingsDir: RECORDING_PATH,
        log: msg => console.log(msg),
        onProgress: (percent, message) => backgroundTaskManager.updateTask(taskId, percent, message),
      });

      // Ensure the recordings dir exists (first-run safety).
      if (!fsMod.existsSync(RECORDING_PATH)) {
        fsMod.mkdirSync(RECORDING_PATH, { recursive: true });
      }

      // Download first — nothing is persisted until this succeeds (spec §3: no orphans).
      const { audioPath, meta } = await importer.importFromUrl(url);

      // Create the meeting record now that we have real audio + metadata.
      const meetingId = 'meeting-' + Date.now();
      const meeting = {
        id: meetingId,
        type: 'document', // schema enum: profile|calendar|document|imported ('past' is the saveMeeting list arg)
        title: meta.title,
        date: meta.date,
        platform: 'youtube',
        participants: [],
        transcript: [],
        videoFile: audioPath,
        recordingId: audioPath, // rerun resolves audio via videoFile; recordingId kept for parity
        content: `# ${meta.title}\nSource: YouTube (${meta.channel || 'unknown channel'})`,
        source: 'youtube',
        importedFrom: url,
        importedAt: new Date().toISOString(),
      };
      databaseService.saveMeeting(meeting, 'past');
      backgroundTaskManager.completeTask(taskId, { meetingId, title: meta.title });

      // Hand off to the shared transcription pipeline (transcription + waterfall
      // speaker ID + exec summary). It creates its own background task.
      await rerunTranscriptionForMeeting({
        meetingId,
        provider: null,
        audioPath,
        sender: event.sender,
      });

      // Refresh the renderer's meeting list so the new note appears.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('meeting-updated', meetingId);
      }

      return { success: true, meetingId, title: meta.title };
    } catch (error) {
      const message =
        error.code === 'binary-missing'
          ? 'yt-dlp not found — install with `winget install yt-dlp`, then retry.'
          : `${error.message} (try \`yt-dlp -U\` to update yt-dlp)`;
      backgroundTaskManager.failTask(taskId, message);
      console.error('[YouTubeImport] Failed:', error);
      return { success: false, error: message };
    }
  })
);
```

- [ ] **Step 4: Run the full suite + lint**

Run: `npx vitest run`
Expected: no new failures.
Run: `npx eslint src/main.js`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(youtube): add youtube:import IPC handler with pipeline handoff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 14: Renderer — preload method, menu item, toolbar button, modal

**Files:**
- Modify: `src/preload.js` (near the import methods ~`213`)
- Modify: `src/index.html` (File submenu ~`105`; toolbar ~`346`; add modal near `saveViewModal` ~`797`)
- Modify: `src/renderer.js` (`menuActions` ~`296`; new `openYoutubeImportModal` function)

**Modal pattern (followed exactly):** `saveViewModal` (`index.html:778-797`) — a STATIC `modal-overlay` with `style="display:none"`, shown via `modal.style.display = 'flex'` and hidden via `'none'`, with confirm/cancel/close/overlay/keydown listeners wired then cleaned up (`renderer.js:3545-3575`). All dynamic text uses `textContent` (no innerHTML). URL validation reuses `parseVideoId` logic client-side: invalid → inline error, no IPC call (spec §1).

- [ ] **Step 1: Expose the IPC method** — in `src/preload.js`, after the `importFile` line (~`213`), add:

```js
  youtubeImport: url => ipcRenderer.invoke('youtube:import', { url }),
```

- [ ] **Step 2: Add the File-menu item** — in `src/index.html`, after the `menuImport` button (`index.html:105`), add:

```html
          <button class="titlebar-dropdown-item" id="menuImportYouTube">Import from YouTube...</button>
```

- [ ] **Step 3: Add the toolbar button** — in `src/index.html`, after the Import button block (`index.html:346`), add:

```html
        <!-- Import from YouTube Button -->
        <button class="toolbar-icon-btn" id="youtubeImportBtn" title="Import from YouTube">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M23 12s0-3.5-.45-5.17a2.6 2.6 0 00-1.83-1.84C19.05 4.55 12 4.55 12 4.55s-7.05 0-8.72.44a2.6 2.6 0 00-1.83 1.84C1 8.5 1 12 1 12s0 3.5.45 5.17a2.6 2.6 0 001.83 1.84c1.67.44 8.72.44 8.72.44s7.05 0 8.72-.44a2.6 2.6 0 001.83-1.84C23 15.5 23 12 23 12z" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M9.75 15.5l6-3.5-6-3.5v7z" fill="currentColor"/>
          </svg>
        </button>
```

- [ ] **Step 4: Add the modal markup** — in `src/index.html`, after the `saveViewModal` block closes (`index.html:797`), add:

```html
    <!-- Import from YouTube Modal -->
    <div class="modal-overlay" id="youtubeImportModal" style="display: none;">
      <div class="modal-content" style="max-width: 480px;">
        <div class="modal-header">
          <h2>Import from YouTube</h2>
          <button class="modal-close" id="closeYoutubeImportModal">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 12px;">Paste a YouTube video URL. The audio is downloaded, transcribed, and summarized like a recorded meeting.</p>
          <input type="text" id="youtubeUrlInput" class="modal-input" placeholder="https://www.youtube.com/watch?v=..." style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 14px; background: var(--bg-primary); color: var(--text-primary);">
          <div id="youtubeUrlError" style="display: none; color: var(--danger-color, #d33); font-size: 13px; margin-top: 8px;"></div>
        </div>
        <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; padding-top: 15px;">
          <button class="btn-secondary" id="cancelYoutubeImportBtn" style="padding: 8px 16px; border-radius: 6px; cursor: pointer;">Cancel</button>
          <button class="btn-primary" id="confirmYoutubeImportBtn" style="padding: 8px 16px; border-radius: 6px; cursor: pointer;">Import</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 5: Wire the menu action + toolbar button** — in `src/renderer.js`, add a `menuImportYouTube` entry to the `menuActions` object (after `menuImport`, ~`renderer.js:299`):

```js
    menuImportYouTube: () => {
      openYoutubeImportModal();
    },
```

Then add the `openYoutubeImportModal` function at top level (near `saveCurrentFiltersAsView`, ~`renderer.js:3545`). It mirrors the saveView modal lifecycle and does client-side validation:

```js
/**
 * Client-side YouTube id extraction (mirrors main/services/youtubeImport
 * parseVideoId) so an invalid URL shows an inline error and never hits IPC.
 */
function extractYoutubeVideoId(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  const idRe = /^[A-Za-z0-9_-]{11}$/;
  const watch = url.match(/[?&]v=([^&#]+)/);
  let candidate = watch ? watch[1] : null;
  if (!candidate) {
    const pathMatch = url.match(/(?:youtu\.be\/|\/shorts\/)([^/?&#]+)/);
    if (pathMatch) candidate = pathMatch[1];
  }
  return candidate && idRe.test(candidate) ? candidate : null;
}

/** Open the Import-from-YouTube modal and run the import on confirm. */
function openYoutubeImportModal() {
  const modal = document.getElementById('youtubeImportModal');
  const input = document.getElementById('youtubeUrlInput');
  const errorEl = document.getElementById('youtubeUrlError');
  const confirmBtn = document.getElementById('confirmYoutubeImportBtn');
  const cancelBtn = document.getElementById('cancelYoutubeImportBtn');
  const closeBtn = document.getElementById('closeYoutubeImportModal');
  if (!modal || !input) {
    showToast('Could not open YouTube import', 'error');
    return;
  }

  input.value = '';
  errorEl.style.display = 'none';
  errorEl.textContent = '';
  modal.style.display = 'flex';
  input.focus();

  const cleanup = () => {
    modal.style.display = 'none';
    confirmBtn?.removeEventListener('click', handleConfirm);
    cancelBtn?.removeEventListener('click', cleanup);
    closeBtn?.removeEventListener('click', cleanup);
    input?.removeEventListener('keydown', handleKeydown);
    modal?.removeEventListener('click', handleOverlayClick);
  };

  const showError = message => {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  };

  const handleConfirm = async () => {
    const url = input.value.trim();
    if (!extractYoutubeVideoId(url)) {
      showError('Enter a valid YouTube URL (watch, youtu.be, or shorts).');
      input.focus();
      return;
    }
    cleanup();
    showToast('Starting YouTube import — see background tasks for progress', 'info');
    try {
      const result = await window.electronAPI.youtubeImport(url);
      if (result.success) {
        showToast(`Imported "${result.title}"`, 'success');
        await loadMeetingsDataFromFile();
        renderMeetings();
      } else {
        showToast(result.error || 'YouTube import failed', 'error');
      }
    } catch (error) {
      showToast('YouTube import failed: ' + error.message, 'error');
    }
  };

  const handleKeydown = e => {
    if (e.key === 'Enter') handleConfirm();
    else if (e.key === 'Escape') cleanup();
  };
  const handleOverlayClick = e => {
    if (e.target === modal) cleanup();
  };

  confirmBtn?.addEventListener('click', handleConfirm);
  cancelBtn?.addEventListener('click', cleanup);
  closeBtn?.addEventListener('click', cleanup);
  input?.addEventListener('keydown', handleKeydown);
  modal?.addEventListener('click', handleOverlayClick);
}
```

Finally, wire the toolbar button — in the DOMContentLoaded wiring where other toolbar buttons are bound (search `getElementById('importBtn')` in `renderer.js`), add near it:

```js
  const youtubeImportBtn = document.getElementById('youtubeImportBtn');
  if (youtubeImportBtn) {
    youtubeImportBtn.addEventListener('click', openYoutubeImportModal);
  }
```

- [ ] **Step 6: Lint (renderer has no unit tests — lint + manual E2E are the gate)**

Run: `npx eslint src/renderer.js src/preload.js`
Expected: clean. (`showToast`, `loadMeetingsDataFromFile`, `renderMeetings` are existing top-level renderer functions.)

- [ ] **Step 7: Commit**

```bash
git add src/preload.js src/index.html src/renderer.js
git commit -m "feat(youtube): add Import-from-YouTube menu, toolbar button, and modal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 15: Full verification + manual E2E checklist for JD

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run: `npx vitest run`
Expected: baseline 341 + the new suites (`youtubeImport`, `contentPassGate`, `youtubeRoute`) all passing; only the environmental `wasapiCapture` EADDRINUSE may fail.
Run: `npx eslint src/ tests/`
Expected: zero warnings/errors.

- [ ] **Step 2: Commit the plan doc (docs/ is gitignored — force-add)**

```bash
git add -f docs/superpowers/plans/2026-07-10-youtube-import.md
git commit -m "docs(youtube): add YouTube import implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Manual E2E (JD runs this — do NOT automate; needs real binary + GUI)**

**Prereq:** `winget install yt-dlp` (then confirm `yt-dlp --version` in a fresh terminal — must be on PATH). Quit the installed app so only the dev build runs (`npm start`, red tray icon) — both share `%APPDATA%/jd-notes-things/logs/main.log`.

Checklist:
1. **Happy path:** File → "Import from YouTube..." (and the toolbar YouTube button) opens the modal. Paste a real URL from JD's own channel → Import.
   - Background task "Importing YouTube video..." shows download %, then a "Re-running transcription" task.
   - New meeting appears in the list with the **video's title** and **upload date** (not "YouTube Video" / today).
   - Open the meeting: transcript is diarized; **JD's name** appears via voice profile (single-speaker video auto-labels him and strengthens his profile).
   - Exec auto-summary is present.
2. **Routing:** Export the meeting (or confirm auto-export). File lands under `<vault>/content/youtube/<YYYY-MM-DD>-<slug>/` with matching folder and file slugs (`<date>-<slug>.md` + `-transcript.md`). Title was NOT rewritten to "Company - Person - Topic".
3. **Invalid URL:** Paste `https://vimeo.com/123` (or gibberish) → inline error in the modal, no background task, no IPC call.
4. **Missing binary:** Temporarily rename/remove yt-dlp from PATH → import shows the actionable toast "yt-dlp not found — install with `winget install yt-dlp`".
5. **Failure path:** Paste a private/unavailable video URL → background task fails with the yt-dlp stderr tail in the toast and the "try `yt-dlp -U`" hint; no orphan meeting record is created.

Report results back before merging.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 UI (menu + toolbar button + modal, createElement/textContent, invalid→inline error no IPC) → Task 14.
- §2 youtubeImport.js (DI; checkBinary, metadata, download, progress, pure helpers) → Tasks 1–6.
- §3 IPC + handoff (validated `youtube:import`; download-then-create; platform/title/date/videoFile/recordingId/empty participants; rerun handoff) → Tasks 12–13.
- §4 Title protection (gate rename on platform; reassignments still apply; renamedByContentPass interplay) → Tasks 8–9.
- §5 Routing (platform==='youtube' → content/youtube; shared slugify + date; before routing-engine call) → Tasks 10–11.
- §6 Errors (missing binary message, invalid URL no task, failure stderr tail, `yt-dlp -U` hint) → Tasks 13–14.
- Testing (parseVideoId shapes+garbage, exact argv, metadata mapping, missing-binary/failing-download shapes, meeting-only-after-success, Stage 3 no-rename, routing→content/youtube) → Tasks 1–10 + Task 15 manual E2E.

**Placeholder scan:** none — every code step contains complete code.

**Type/name consistency:** `createYoutubeImporter`, `importFromUrl`, `parseVideoId`, `buildMetadataArgs`, `buildDownloadArgs`, `parseDownloadProgress`, `mapMetadataToMeetingFields`, `checkBinary`, `fetchMetadata`, `downloadAudio` consistent across module + tests + handler. `rerunTranscriptionForMeeting({meetingId, provider, audioPath, sender})` consistent between Tasks 12 and 13. `buildYoutubeRoute`/`YOUTUBE_VAULT_DIR`, `shouldRenameFromContentPass`/`shouldSuggestTitle`/`isGenericTitle` consistent between definition, tests, and main.js wiring. `meeting.type: 'document'` reconciled against the schema enum (not spec's mislabeled `'past'`).

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks.
2. **Inline Execution** — execute in-session with checkpoints.
