/**
 * Field-level read-modify-write for the meetings store.
 *
 * Many main-process flows read ALL meetings, await slow work (transcription,
 * speaker matching, LLM calls), then write the snapshot back. Writing the whole
 * snapshot silently reverted every row that changed in the meantime — e.g. a
 * recording started during another meeting's post-processing lost its
 * recordingId and was never transcribed (2026-09-29).
 *
 * read() remembers a per-field fingerprint of what it returned; write() sends
 * only the fields the caller actually changed, merged onto the CURRENT row.
 * Fingerprints are hashes (not copies) because a full snapshot is ~40 MB.
 */
const crypto = require('crypto');

const LISTS = [
  ['upcomingMeetings', 'upcoming'],
  ['pastMeetings', 'past'],
];

const ABSENT = 'absent';

function hashValue(value) {
  if (value === undefined) return ABSENT;
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('base64');
}

function fingerprintMeeting(meeting) {
  const fields = {};
  for (const key of Object.keys(meeting)) {
    fields[key] = hashValue(meeting[key]);
  }
  return fields;
}

function* eachMeeting(data) {
  for (const [listKey, status] of LISTS) {
    for (const meeting of data?.[listKey] || []) {
      if (meeting && meeting.id) yield { meeting, status };
    }
  }
}

/**
 * @param {{upcomingMeetings?: Array, pastMeetings?: Array}} data
 * @returns {Map<string, {status: string, fields: Object<string,string>}>}
 */
function captureBaseline(data) {
  const baseline = new Map();
  for (const { meeting, status } of eachMeeting(data)) {
    baseline.set(meeting.id, { status, fields: fingerprintMeeting(meeting) });
  }
  return baseline;
}

/**
 * Compare data against its baseline.
 * @returns {Array<{id, set?, unset?, status, insert?}>} one patch per changed meeting.
 *   status is 'upcoming'|'past' when the meeting moved lists, else null (keep the row's).
 */
function diffAgainstBaseline(baseline, data) {
  const patches = [];
  for (const { meeting, status } of eachMeeting(data)) {
    const base = baseline.get(meeting.id);
    if (!base) {
      patches.push({ id: meeting.id, insert: meeting, status });
      continue;
    }

    const set = {};
    const unset = [];
    const keys = new Set([...Object.keys(meeting), ...Object.keys(base.fields)]);
    for (const key of keys) {
      if (key === 'id') continue;
      if (hashValue(meeting[key]) === (base.fields[key] ?? ABSENT)) continue;
      if (meeting[key] === undefined) unset.push(key);
      else set[key] = meeting[key];
    }

    const moved = base.status !== status;
    if (Object.keys(set).length > 0 || unset.length > 0 || moved) {
      patches.push({ id: meeting.id, set, unset, status: moved ? status : null });
    }
  }
  return patches;
}

/** Apply a {set, unset} patch onto the current meeting object (returns a new object). */
function applyPatchToMeeting(current, patch) {
  const merged = { ...current, ...(patch.set || {}) };
  for (const key of patch.unset || []) delete merged[key];
  return merged;
}

/**
 * @param {() => {getAllMeetings: Function, applyMeetingPatches: Function}} getDb
 *   Lazy so the store can be created before databaseService is initialized.
 */
function createMeetingStore(getDb) {
  const baselines = new WeakMap();

  function read() {
    const data = getDb().getAllMeetings();
    baselines.set(data, captureBaseline(data));
    return data;
  }

  function write(data, baseline = baselines.get(data)) {
    if (!data) return;

    let patches;
    if (baseline) {
      patches = diffAgainstBaseline(baseline, data);
    } else {
      // Data not produced by read() (hand-built object): upsert what it contains,
      // merged onto current rows — never touches meetings it doesn't include.
      patches = [...eachMeeting(data)].map(({ meeting, status }) => ({
        id: meeting.id,
        insert: meeting,
        status,
      }));
    }
    if (patches.length === 0) return;

    getDb().applyMeetingPatches(patches);

    // Re-baseline what was written so a later write from this same snapshot
    // only sends fields changed after this point.
    if (baselines.has(data)) {
      const own = baselines.get(data);
      const byId = new Map([...eachMeeting(data)].map(e => [e.meeting.id, e]));
      for (const patch of patches) {
        const entry = byId.get(patch.id);
        if (entry) own.set(patch.id, { status: entry.status, fields: fingerprintMeeting(entry.meeting) });
      }
    }
  }

  /** Read fresh, let operationFn modify (or rebuild) the data, write only what changed. */
  async function update(operationFn) {
    const current = read();
    const baseline = baselines.get(current);
    const updated = await operationFn(current);
    // operationFn may return `current` or a rebuilt object — either way the
    // fresh read is what it was derived from.
    if (updated) write(updated, baseline);
  }

  return { read, write, update };
}

module.exports = {
  captureBaseline,
  diffAgainstBaseline,
  applyPatchToMeeting,
  createMeetingStore,
};
