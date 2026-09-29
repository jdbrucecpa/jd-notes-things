/**
 * Turn a renderer saveMeetingsData call into targeted patches for
 * databaseService.applyMeetingPatches.
 *
 * The renderer keeps its own copy of every meeting, refreshed only on certain
 * events, so it is routinely stale for meetings the main process is still
 * processing. Callers pass `meetingIds` (and optionally `fields`) so a note
 * save only touches what the user actually edited.
 */

// Owned by the main process: the current DB value wins over the renderer copy
// (renderer value used only when the DB has none).
const MAIN_MANAGED_FIELDS = [
  'recordingId',
  'uploadToken',
  'recordingComplete',
  'recordingEndTime',
  'summaries',
  'transcriptionProvider',
  'sdkUploadId',
  'recallRecordingId',
  'transcriptProvider',
  'transcriptConfidence',
  'platform',
];

const LISTS = [
  ['upcomingMeetings', 'upcoming'],
  ['pastMeetings', 'past'],
];

/**
 * @param {{upcomingMeetings: Array, pastMeetings: Array}} rendererData
 * @param {{upcomingMeetings: Array, pastMeetings: Array}} currentData - fresh DB read
 * @param {{meetingIds?: string[], fields?: string[]}} [options]
 * @returns {Array<{id, set?, unset?, insert?, status}>}
 */
function buildRendererSavePatches(rendererData, currentData, options = {}) {
  const { meetingIds, fields } = options;
  const targetIds = meetingIds ? new Set(meetingIds) : null;

  const currentById = new Map();
  for (const [listKey] of LISTS) {
    for (const m of currentData[listKey] || []) currentById.set(m.id, m);
  }

  const patches = [];
  for (const [listKey, status] of LISTS) {
    for (const rendererMeeting of rendererData[listKey] || []) {
      if (!rendererMeeting?.id) continue;
      if (targetIds && !targetIds.has(rendererMeeting.id)) continue;

      const currentMeeting = currentById.get(rendererMeeting.id);
      if (!currentMeeting) {
        patches.push({ id: rendererMeeting.id, insert: rendererMeeting, status });
        continue;
      }

      let set;
      if (fields) {
        set = {};
        for (const field of fields) {
          if (rendererMeeting[field] !== undefined) set[field] = rendererMeeting[field];
        }
      } else {
        set = { ...rendererMeeting };
        delete set.id;
        for (const field of MAIN_MANAGED_FIELDS) {
          if (currentMeeting[field]) set[field] = currentMeeting[field];
        }
      }

      // No unsets: fields missing from the renderer copy are ones it never
      // loaded (e.g. track paths added later), not deletions. No status moves:
      // the renderer never moves meetings between lists, and its lists go stale.
      patches.push({ id: rendererMeeting.id, set, unset: [], status: null });
    }
  }
  return patches;
}

module.exports = { buildRendererSavePatches, MAIN_MANAGED_FIELDS };
