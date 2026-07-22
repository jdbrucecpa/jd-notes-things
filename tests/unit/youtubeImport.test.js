import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import {
  parseVideoId,
  buildMetadataArgs,
  buildDownloadArgs,
  parseDownloadProgress,
  mapMetadataToMeetingFields,
  winGetCandidates,
  createYoutubeImporter,
} from '../../src/main/services/youtubeImport.js';

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
    // Hermetic defaults: no WinGet fallback candidates unless a test opts in.
    env: {},
    listDir: () => [],
    ...overrides,
  });
}

const LOCALAPPDATA = 'C:\\Users\\jd\\AppData\\Local';
const WINGET_LINKS_EXE = path.join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe');
const WINGET_PACKAGES_DIR = path.join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
const WINGET_PKG_ENTRY = 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe';
const WINGET_PKG_EXE = path.join(WINGET_PACKAGES_DIR, WINGET_PKG_ENTRY, 'yt-dlp.exe');

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

describe('winGetCandidates', () => {
  it('returns the Links shim then Packages exes, in order', () => {
    const out = winGetCandidates(
      { LOCALAPPDATA },
      {
        fileExists: () => true,
        listDir: (dir) => (dir === WINGET_PACKAGES_DIR ? [WINGET_PKG_ENTRY, 'Some.Other_Package'] : []),
      }
    );
    expect(out).toEqual([WINGET_LINKS_EXE, WINGET_PKG_EXE]);
  });
  it('skips the Links shim when the file does not exist', () => {
    const out = winGetCandidates(
      { LOCALAPPDATA },
      {
        fileExists: (p) => p !== WINGET_LINKS_EXE,
        listDir: () => [WINGET_PKG_ENTRY],
      }
    );
    expect(out).toEqual([WINGET_PKG_EXE]);
  });
  it('only globs directories matching yt-dlp.yt-dlp_*', () => {
    const out = winGetCandidates(
      { LOCALAPPDATA },
      {
        fileExists: (p) => p !== WINGET_LINKS_EXE,
        listDir: () => ['Gyan.FFmpeg_abc', 'yt-dlp.yt-dlp-nightly_xyz', WINGET_PKG_ENTRY],
      }
    );
    expect(out).toEqual([WINGET_PKG_EXE]);
  });
  it('returns [] when LOCALAPPDATA is unset', () => {
    expect(winGetCandidates({}, { fileExists: () => true, listDir: () => [WINGET_PKG_ENTRY] })).toEqual([]);
  });
  it('tolerates a listDir that throws', () => {
    const out = winGetCandidates(
      { LOCALAPPDATA },
      { fileExists: (p) => p === WINGET_LINKS_EXE, listDir: () => { throw new Error('EPERM'); } }
    );
    expect(out).toEqual([WINGET_LINKS_EXE]);
  });
});

describe('binary resolution fallback', () => {
  // spawn that ENOENTs for the bare PATH name but works for a given absolute path.
  function pathBrokenSpawn(workingBinary, behavior = {}) {
    return vi.fn((cmd, args) => {
      if (cmd !== workingBinary) {
        return fakeChild({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
      }
      const by = behavior[args[0]];
      return fakeChild(by || { stdout: '2026.07.01\n', code: 0 });
    });
  }
  const wingetOverrides = {
    env: { LOCALAPPDATA },
    fileExists: () => true,
    listDir: (dir) => (dir === WINGET_PACKAGES_DIR ? [WINGET_PKG_ENTRY] : []),
  };

  it('checkBinary falls back to the WinGet Links exe when PATH spawn ENOENTs', async () => {
    const spawn = pathBrokenSpawn(WINGET_LINKS_EXE);
    const yt = makeImporter(spawn, wingetOverrides);
    await expect(yt.checkBinary()).resolves.toBe(true);
    // Tried PATH first, then the Links shim.
    expect(spawn).toHaveBeenNthCalledWith(1, 'yt-dlp', ['--version'], expect.any(Object));
    expect(spawn).toHaveBeenNthCalledWith(2, WINGET_LINKS_EXE, ['--version'], expect.any(Object));
  });
  it('falls through to the Packages glob when Links is absent', async () => {
    const spawn = pathBrokenSpawn(WINGET_PKG_EXE);
    const yt = makeImporter(spawn, {
      ...wingetOverrides,
      fileExists: (p) => p !== WINGET_LINKS_EXE,
    });
    await expect(yt.checkBinary()).resolves.toBe(true);
    expect(spawn).toHaveBeenLastCalledWith(WINGET_PKG_EXE, ['--version'], expect.any(Object));
  });
  it('checkBinary is false when no candidate spawns', async () => {
    const spawn = vi.fn(() => fakeChild({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const yt = makeImporter(spawn, wingetOverrides);
    await expect(yt.checkBinary()).resolves.toBe(false);
  });
  it('caches resolution — repeated checks probe only once', async () => {
    const spawn = vi.fn(() => fakeChild({ stdout: 'v\n', code: 0 }));
    const yt = makeImporter(spawn);
    await yt.checkBinary();
    await yt.checkBinary();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('importFromUrl completes end-to-end using the fallback binary', async () => {
    const json = JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'T', upload_date: '20260710' });
    const spawn = pathBrokenSpawn(WINGET_LINKS_EXE, {
      '--version': { stdout: 'v\n', code: 0 },
      '--dump-json': { stdout: json, code: 0 },
      '-x': { stdout: '[download] 100% of 5MiB\n', code: 0 },
    });
    const yt = makeImporter(spawn, wingetOverrides);
    const res = await yt.importFromUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(res.meta.title).toBe('T');
    // Every post-resolution invocation used the fallback path, never the bare name again.
    const cmdsAfterProbe = spawn.mock.calls.slice(2).map(c => c[0]);
    expect(cmdsAfterProbe.length).toBeGreaterThan(0);
    expect(cmdsAfterProbe.every(c => c === WINGET_LINKS_EXE)).toBe(true);
  });
});

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
