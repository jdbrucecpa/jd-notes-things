import { describe, it, expect } from 'vitest';
import slugify from '../../src/main/utils/slugify.js';

describe('slugify', () => {
  it('strips periods so initials collapse (J.D. -> jd)', () => {
    expect(slugify('Stephanie Bucko and J.D. Bruce')).toBe('stephanie-bucko-and-jd-bruce');
  });

  it('strips apostrophes (O-Brien -> obrien)', () => {
    expect(slugify("O'Brien Sync")).toBe('obrien-sync');
    expect(slugify('O’Brien Sync')).toBe('obrien-sync');
  });

  it('returns "meeting" for an empty string', () => {
    expect(slugify('')).toBe('meeting');
  });

  it('returns "meeting" for null/undefined', () => {
    expect(slugify(null)).toBe('meeting');
    expect(slugify(undefined)).toBe('meeting');
  });

  it('trims edge junk and collapses interior runs', () => {
    expect(slugify('  --Weird__ Title!! ')).toBe('weird-title');
  });

  it('preserves numbers', () => {
    expect(slugify('Q4 2026 Review')).toBe('q4-2026-review');
  });

  it('returns "meeting" when the title reduces to empty', () => {
    expect(slugify('!!!')).toBe('meeting');
  });

  it('caps very long titles at 80 chars without a trailing dash', () => {
    const long = 'word '.repeat(40); // 200 chars of "word word word ..."
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });
});
