/**
 * Speaker mapping extras merge helper.
 *
 * Speaker mappings are persisted twice: (a) normalized `speaker_mappings`
 * table rows carrying only identity fields (`speaker_label, email, name,
 * confidence, method, email_source`), and (b) a full-JSON `speaker_mapping`
 * TEXT column on the meeting row that includes rich extras (`embedding`,
 * `status`, `needsVerification`, `candidates`, `distance`, `dominance`, ...).
 *
 * On rehydration, the normalized rows are authoritative for identity fields
 * (they're updated by corrections), but the extras only live in the JSON
 * column. This module merges the two back together so extras — critically
 * voice embeddings — survive a reload instead of vanishing whenever rows
 * exist.
 *
 * Kept as a standalone pure module (rather than inline in databaseService.js)
 * because databaseService has no unit-test harness for native SQLite; this
 * merge logic needs to be independently testable.
 */

// Fields owned by the normalized speaker_mappings table rows. On rehydration
// the row value is authoritative for these (rows are updated by corrections;
// the JSON column may be stale).
const ROW_OWNED_FIELDS = new Set(['email', 'name', 'confidence', 'method', 'emailSource']);

/**
 * Merge per-label EXTRA fields (embedding, status, needsVerification,
 * candidates, distance, dominance, …) from the meeting's speaker_mapping JSON
 * column onto the mapping rebuilt from normalized rows. The normalized rows
 * only persist identity fields, so without this merge, embeddings captured at
 * match time vanish on reload — starving correction-driven enrollment.
 *
 * @param {Object<string, object>} fromRows - mapping rebuilt from table rows (authoritative labels + identity)
 * @param {Object<string, object>|null} fromJson - parsed speaker_mapping JSON column (may be null/invalid)
 * @returns {Object<string, object>} merged mapping (new object; inputs untouched)
 */
function mergeSpeakerMappingExtras(fromRows, fromJson) {
  if (!fromJson || typeof fromJson !== 'object') return fromRows;
  const merged = {};
  for (const [label, rowEntry] of Object.entries(fromRows)) {
    merged[label] = { ...rowEntry };
    const jsonEntry = fromJson[label];
    if (!jsonEntry || typeof jsonEntry !== 'object') continue;
    for (const [key, value] of Object.entries(jsonEntry)) {
      if (ROW_OWNED_FIELDS.has(key)) continue;
      if (merged[label][key] === undefined) {
        merged[label][key] = value;
      }
    }
  }
  return merged;
}

module.exports = { mergeSpeakerMappingExtras };
