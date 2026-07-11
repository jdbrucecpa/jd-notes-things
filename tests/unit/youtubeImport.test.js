import { describe, it, expect } from 'vitest';
import {
  parseVideoId,
  buildMetadataArgs,
  buildDownloadArgs,
  parseDownloadProgress,
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
