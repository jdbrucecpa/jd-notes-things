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
