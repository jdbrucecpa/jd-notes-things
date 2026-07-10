import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// vitest runs from the repo root
const mainSrc = readFileSync(path.resolve('src/main.js'), 'utf8');

describe('meeting markdown generation (source guard)', () => {
  it('emits no Obsidian wiki-link template literals', () => {
    // The interpolated wiki-link form must be gone everywhere.
    expect(mainSrc.includes('[[' + '${')).toBe(false);
  });

  it('links the summary to the transcript with a relative markdown link', () => {
    expect(mainSrc).toContain('[Transcript](./' + '${baseFilename}-transcript.md)');
  });

  it('links the transcript back to the summary with a relative markdown link', () => {
    expect(mainSrc).toContain('[Summary](./' + '${baseFilename}.md)');
  });
});
