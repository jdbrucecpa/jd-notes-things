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
