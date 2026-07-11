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
