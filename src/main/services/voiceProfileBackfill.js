/**
 * Voice Profile Backfill Service
 *
 * One-shot enrollment of voice profiles from ~198 historical meetings whose
 * transcripts carry human-verified speaker names/emails. This does NOT
 * re-diarize audio: it synthesizes {speaker, start, end} SECOND segments
 * directly from the existing utterance timestamps (already diarized), embeds
 * once per meeting via the injected embedSpeakers, and upserts one voice
 * profile sample per verified speaker via upsertProfileSample.
 *
 * Idempotent per-identity — an identity is skipped for a meeting only if its
 * profile already contributed a sample from it (e.g. from a prior backfill run
 * or manual Fix Speakers assignment). Meetings sampled for OTHER speakers are
 * revisited for the missing ones.
 *
 * Dependency-injected (no direct service imports) so it's fully unit
 * testable; IPC wiring is a later Phase-2 task.
 */

/** Cap embedded speech per speaker per meeting — bounds GPU cost, plenty for a centroid. */
const MAX_SECONDS_PER_SPEAKER = 90;
/** Utterances shorter than this carry too little voice to embed reliably. */
const MIN_UTTERANCE_SECONDS = 1.5;

const GENERIC_NAME = /^(speaker|participant|guest|unknown)\b/i;

/**
 * Label → verified identity from a corrected transcript. An utterance counts
 * when it has a non-generic speakerName AND a speakerEmail. Majority vote per
 * label guards against a few mislabeled utterances.
 *
 * @param {Array<Object>} transcript
 * @returns {Object<string, {name: string, email: string}>}
 */
function extractSpeakerIdentities(transcript) {
  const votes = new Map(); // label -> Map<emailKey, {count, name, email}>
  for (const u of transcript || []) {
    if (!u.speaker || !u.speakerEmail || !u.speakerName) continue;
    if (GENERIC_NAME.test(u.speakerName)) continue;
    if (!votes.has(u.speaker)) votes.set(u.speaker, new Map());
    const key = u.speakerEmail.toLowerCase();
    const tally = votes.get(u.speaker);
    const cur = tally.get(key) || { count: 0, name: u.speakerName, email: u.speakerEmail };
    cur.count++;
    tally.set(key, cur);
  }

  const identities = {};
  for (const [label, tally] of votes) {
    let best = null;
    let total = 0;
    for (const cand of tally.values()) {
      total += cand.count;
      if (!best || cand.count > best.count) best = cand;
    }
    // Require a real majority so contested labels don't poison profiles.
    if (best && best.count / total > 0.5) {
      identities[label] = { name: best.name, email: best.email };
    }
  }
  return identities;
}

/**
 * When a legacy utterance has no endTimestamp, its end is derived from the
 * next utterance's start — capped so a long silence between utterances
 * doesn't get counted as speech.
 */
const DERIVED_SPAN_MAX_SECONDS = 15;

/**
 * Build {speaker, start, end} SECOND segments from utterance timestamps (ms),
 * restricted to labels with verified identities; per-speaker duration capped.
 *
 * Legacy transcripts (pre-v2.0, AssemblyAI era) store ONLY the start
 * timestamp — verified against the live DB 2026-07-10: 0 of 39k production
 * entries carry end_timestamp. For those, the end is derived from the next
 * utterance's start (capped at DERIVED_SPAN_MAX_SECONDS); the final
 * utterance's length is unknowable and is skipped.
 *
 * @param {Array<Object>} transcript - chronologically ordered utterances
 * @param {Object<string, {name: string, email: string}>} identities
 * @returns {Array<{speaker: string, start: number, end: number}>}
 */
function synthesizeSegments(transcript, identities) {
  const list = transcript || [];
  const budget = new Map(); // label -> seconds used
  const segments = [];
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!identities[u.speaker]) continue;
    if (u.timestamp == null) continue; // imported/legacy rows can lack timestamps entirely
    const startSec = u.timestamp / 1000;

    let endSec;
    if (u.endTimestamp != null) {
      endSec = u.endTimestamp / 1000;
    } else {
      const next = list[i + 1];
      if (!next || next.timestamp == null) continue; // last entry: length unknowable
      endSec = Math.min(next.timestamp / 1000, startSec + DERIVED_SPAN_MAX_SECONDS);
    }

    let span = endSec - startSec;
    if (span < MIN_UTTERANCE_SECONDS) continue;
    const used = budget.get(u.speaker) || 0;
    if (used >= MAX_SECONDS_PER_SPEAKER) continue;
    span = Math.min(span, MAX_SECONDS_PER_SPEAKER - used);
    budget.set(u.speaker, used + span);
    segments.push({ speaker: u.speaker, start: startSec, end: startSec + span });
  }
  return segments;
}

/**
 * One-shot idempotent backfill: for every meeting with an on-disk audio file,
 * verified speaker identities, and NO existing voice samples, embed the
 * synthesized segments and upsert one sample per identified speaker.
 *
 * @param {Object} deps
 * @param {Function} deps.getAllMeetings - () => { upcomingMeetings, pastMeetings }
 * @param {Function} deps.getSampledProfileIdsForMeeting - (meetingId) => number[];
 *   profile ids that already have a sample from the meeting (per-identity skip)
 * @param {Function} deps.getProfileIdByEmail - (email) => number|null; resolves a
 *   verified identity's existing profile id, or null if not yet enrolled
 * @param {Function} deps.fileExists - (path) => boolean
 * @param {string[]} [deps.recordingsDirs] - directories to probe for
 *   convention-named audio (`windows-desktop-<recordingId>.mp3`) — most
 *   Recall-era meetings never set videoFile, only recordingId
 * @param {Function} [deps.resolveContactName] - async (email) => string|null;
 *   resolves a human display name when a historical transcript carried the
 *   email as the speaker name (matching is email-keyed either way)
 * @param {Function} deps.embedSpeakers - (audioPath, segments) => Promise<Array<{speakerLabel, embedding}>>
 * @param {Function} deps.upsertProfileSample - (contact, embedding, durationSec, meetingId) => {profileId, created, rejected?}|null
 * @param {Function} deps.log
 * @param {Object} [opts]
 * @param {Function} [opts.onProgress] - (done, total, summary) => void
 * @param {number} [opts.limit] - max meetings to embed (for staged rollout)
 * @returns {Promise<{scanned: number, embedded: number, samplesAdded: number,
 *   samplesRejected: number, skippedAlreadySampled: number, skippedNoAudio: number,
 *   skippedNoIdentities: number, errors: number}>} summary counts — samplesRejected
 *   tracks samples the profile poisoning guard refused (not persisted)
 */
/**
 * Find the meeting's audio file on disk. Meetings store audio in three
 * historical shapes (verified against the live DB, 2026-07-10):
 *   1. `videoFile` — set only by re-transcription/import flows (~10 of 202)
 *   2. Recall-era: `recordingId` is a GUID; the file is
 *      `<recordingsDir>/windows-desktop-<recordingId>.mp3` (the vast majority)
 *   3. Local-era (v2.0): `recordingId` IS the absolute mp3 path
 * Returns the first candidate that exists, else null.
 *
 * @param {{videoFile?: string, recordingId?: string}} meeting
 * @param {{fileExists: Function, recordingsDirs?: string[]}} deps
 * @returns {string|null}
 */
function resolveAudioPath(meeting, deps) {
  const candidates = [];
  if (meeting.videoFile) candidates.push(meeting.videoFile);
  if (meeting.recordingId) {
    if (/[\\/]/.test(meeting.recordingId)) {
      // Local-era: recordingId is itself a file path.
      candidates.push(meeting.recordingId);
    } else {
      for (const dir of deps.recordingsDirs || []) {
        // String concat instead of path.join keeps this module dependency-free;
        // recordingsDirs are absolute paths supplied by the caller.
        candidates.push(`${dir}\\windows-desktop-${meeting.recordingId}.mp3`);
      }
    }
  }
  for (const candidate of candidates) {
    if (deps.fileExists(candidate)) return candidate;
  }
  return null;
}

async function runBackfill(deps, opts = {}) {
  const { onProgress = () => {}, limit = Infinity } = opts;
  const all = deps.getAllMeetings();
  const meetings = [...(all.pastMeetings || [])];

  const summary = {
    scanned: 0,
    embedded: 0,
    samplesAdded: 0,
    samplesRejected: 0,
    skippedAlreadySampled: 0,
    skippedNoAudio: 0,
    skippedNoIdentities: 0,
    errors: 0,
  };

  for (const meeting of meetings) {
    if (summary.embedded >= limit) break;
    summary.scanned++;
    onProgress(summary.scanned, meetings.length, summary);

    try {
      const audioPath = resolveAudioPath(meeting, deps);
      if (!audioPath) {
        summary.skippedNoAudio++;
        continue;
      }
      const identities = extractSpeakerIdentities(meeting.transcript || []);
      if (Object.keys(identities).length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      // Per-identity skip: an identity is skipped for this meeting only if its
      // profile already contributed a sample from it. Meetings previously
      // sampled for OTHER speakers are revisited for the missing ones. An
      // identity with no profile yet (getProfileIdByEmail -> null) is never
      // "already sampled", so it is always pending.
      const sampledProfileIds = new Set(deps.getSampledProfileIdsForMeeting(meeting.id));
      const pendingIdentities = {};
      for (const [label, identity] of Object.entries(identities)) {
        const pid = deps.getProfileIdByEmail(identity.email);
        if (pid != null && sampledProfileIds.has(pid)) continue;
        pendingIdentities[label] = identity;
      }
      if (Object.keys(pendingIdentities).length === 0) {
        summary.skippedAlreadySampled++;
        continue;
      }

      const segments = synthesizeSegments(meeting.transcript, pendingIdentities);
      if (segments.length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      const embeddings = await deps.embedSpeakers(audioPath, segments);
      summary.embedded++;

      for (const emb of embeddings) {
        const identity = pendingIdentities[emb.speakerLabel];
        if (!identity) continue;
        const dur = segments
          .filter(s => s.speaker === emb.speakerLabel)
          .reduce((sum, s) => sum + (s.end - s.start), 0);
        // Historical transcripts often carry the EMAIL as the speaker name;
        // resolve a human display name via contacts when the caller provides
        // a resolver (identity/matching is keyed by email either way).
        let displayName = identity.name;
        if (displayName.includes('@') && deps.resolveContactName) {
          try {
            displayName = (await deps.resolveContactName(identity.email)) || displayName;
          } catch {
            /* contacts unavailable — keep the email as the name */
          }
        }
        const r = deps.upsertProfileSample(
          { contactName: displayName, contactEmail: identity.email, googleContactId: null },
          emb.embedding,
          dur,
          meeting.id
        );
        if (r?.rejected) {
          // Poisoning guard refused the sample — nothing was persisted.
          summary.samplesRejected++;
          deps.log(
            `[Backfill] Sample rejected for ${identity.name} in ${meeting.id} (poisoning guard)`
          );
        } else if (r) {
          summary.samplesAdded++;
        }
      }
      deps.log(
        `[Backfill] ${meeting.id}: ${Object.keys(pendingIdentities).length} pending identities, +${embeddings.length} embeddings`
      );
    } catch (err) {
      summary.errors++;
      deps.log(`[Backfill] ${meeting.id} failed: ${err.message}`);
    }
  }
  return summary;
}

module.exports = {
  runBackfill,
  extractSpeakerIdentities,
  synthesizeSegments,
  resolveAudioPath,
  MAX_SECONDS_PER_SPEAKER,
  MIN_UTTERANCE_SECONDS,
};
