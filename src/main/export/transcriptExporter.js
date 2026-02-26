'use strict';

/**
 * Transcript Exporter — converts DB transcript entries to importable text files.
 *
 * Uses the "inline-basic" format (`Speaker Name: dialogue text`) which round-trips
 * perfectly through TranscriptParser's inline pattern.  Timestamps are deliberately
 * omitted because bracketed timestamps would match the lower-priority timestamp
 * pattern and break speaker/text separation on re-import.
 */

/**
 * Format an array of transcript entries into the inline-basic export format.
 * Each non-empty entry becomes one line: `SpeakerName: text`
 *
 * @param {Array<Object>} transcript - Array of transcript entry objects from the DB
 * @returns {string} Formatted transcript text ready to write to a file
 */
function formatTranscriptForExport(transcript) {
  if (!transcript || transcript.length === 0) return '';

  const lines = [];

  for (const entry of transcript) {
    // Skip entries with no usable text
    const text = (entry.text || '').trim();
    if (!text) continue;

    // Prefer matched real name, fall back to raw speaker label
    const speaker = (entry.speakerName || entry.speaker_name || entry.speaker || 'Unknown Speaker').trim();

    // Flatten any embedded newlines so each utterance stays on one line
    const flatText = text.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ');

    lines.push(`${speaker}: ${flatText}`);
  }

  return lines.join('\n');
}

/**
 * Generate a filename for an exported transcript file.
 * Pattern: `YYYY-MM-DD-title-slug-transcript.txt`
 *
 * @param {Object} meeting - Meeting object (needs at least `date` and `title`)
 * @returns {string} Suggested filename (no directory component)
 */
function generateExportFilename(meeting) {
  const date = meeting.date ? new Date(meeting.date) : new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const titleSlug = slugify(meeting.title || 'untitled-meeting');

  return `${dateStr}-${titleSlug}-transcript.txt`;
}

/**
 * Convert a string to a URL/filesystem-friendly slug.
 * Mirrors RoutingEngine._slugify() for consistency.
 * @private
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

module.exports = { formatTranscriptForExport, generateExportFilename };
