/**
 * Transcript Exporter Unit Tests
 *
 * Tests formatTranscriptForExport() and generateExportFilename().
 */

const { describe, it, expect } = await import('vitest');

const {
  formatTranscriptForExport,
  generateExportFilename,
} = require('../../src/main/export/transcriptExporter.js');

// ---------------------------------------------------------------------------
// formatTranscriptForExport
// ---------------------------------------------------------------------------

describe('formatTranscriptForExport', () => {
  it('returns empty string for null/undefined/empty transcript', () => {
    expect(formatTranscriptForExport(null)).toBe('');
    expect(formatTranscriptForExport(undefined)).toBe('');
    expect(formatTranscriptForExport([])).toBe('');
  });

  it('formats basic transcript entries as Speaker: text', () => {
    const transcript = [
      { speaker: 'Speaker 1', speakerName: 'Alice', text: 'Hello everyone.' },
      { speaker: 'Speaker 2', speakerName: 'Bob', text: 'Hi Alice!' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Alice: Hello everyone.\nBob: Hi Alice!');
  });

  it('falls back to speaker label when speakerName is missing', () => {
    const transcript = [
      { speaker: 'Speaker 1', text: 'No matched name here.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Speaker 1: No matched name here.');
  });

  it('uses speaker_name (DB column format) as fallback', () => {
    const transcript = [
      { speaker: 'Speaker 1', speaker_name: 'Carol', text: 'DB format name.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Carol: DB format name.');
  });

  it('skips entries with empty or whitespace-only text', () => {
    const transcript = [
      { speaker: 'Alice', text: 'Real content.' },
      { speaker: 'Bob', text: '' },
      { speaker: 'Carol', text: '   ' },
      { speaker: 'Dave', text: 'Also real.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Alice: Real content.\nDave: Also real.');
  });

  it('skips entries with null/undefined text', () => {
    const transcript = [
      { speaker: 'Alice', text: null },
      { speaker: 'Bob', text: undefined },
      { speaker: 'Carol', text: 'Valid.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Carol: Valid.');
  });

  it('flattens newlines in text to spaces', () => {
    const transcript = [
      { speaker: 'Alice', text: 'Line one.\nLine two.\r\nLine three.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Alice: Line one. Line two. Line three.');
  });

  it('collapses multiple spaces from flattened newlines', () => {
    const transcript = [
      { speaker: 'Alice', text: 'Before.  \n  After.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Alice: Before. After.');
  });

  it('uses "Unknown Speaker" when no speaker info exists', () => {
    const transcript = [{ text: 'Orphaned text.' }];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('Unknown Speaker: Orphaned text.');
  });

  it('prefers speakerName over speaker_name over speaker', () => {
    const transcript = [
      { speaker: 'raw', speaker_name: 'db_name', speakerName: 'matched', text: 'Priority test.' },
    ];
    const result = formatTranscriptForExport(transcript);
    expect(result).toBe('matched: Priority test.');
  });
});

// ---------------------------------------------------------------------------
// generateExportFilename
// ---------------------------------------------------------------------------

describe('generateExportFilename', () => {
  it('generates filename with date prefix and slugified title', () => {
    const meeting = { date: '2025-06-15T10:00:00Z', title: 'Weekly Standup' };
    const filename = generateExportFilename(meeting);
    expect(filename).toBe('2025-06-15-weekly-standup-transcript.txt');
  });

  it('uses "untitled-meeting" when title is missing', () => {
    // Use midday UTC to avoid date-shift in any timezone
    const meeting = { date: '2025-01-15T12:00:00Z' };
    const filename = generateExportFilename(meeting);
    expect(filename).toBe('2025-01-15-untitled-meeting-transcript.txt');
  });

  it('strips special characters from title', () => {
    const meeting = { date: '2025-03-10T14:00:00Z', title: 'Q1 Review (Final!) @Corp' };
    const filename = generateExportFilename(meeting);
    expect(filename).toBe('2025-03-10-q1-review-final-corp-transcript.txt');
  });

  it('truncates long titles to 50 characters', () => {
    const meeting = {
      date: '2025-02-20T09:00:00Z',
      title: 'A very long meeting title that should be truncated to prevent filesystem issues',
    };
    const filename = generateExportFilename(meeting);
    // Slug portion should be max 50 chars
    const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-transcript\.txt$/, '');
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it('handles title with only special characters', () => {
    const meeting = { date: '2025-04-01T12:00:00Z', title: '!!!' };
    const filename = generateExportFilename(meeting);
    // Slugify strips all special chars, leaving empty → falls back to empty slug
    expect(filename).toBe('2025-04-01--transcript.txt');
  });

  it('uses current date when date is missing', () => {
    const meeting = { title: 'No Date Meeting' };
    const filename = generateExportFilename(meeting);
    // Should start with a date pattern
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-no-date-meeting-transcript\.txt$/);
  });
});
