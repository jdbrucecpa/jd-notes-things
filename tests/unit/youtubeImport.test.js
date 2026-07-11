import { describe, it, expect } from 'vitest';
import {
  parseVideoId,
  buildMetadataArgs,
  buildDownloadArgs,
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
