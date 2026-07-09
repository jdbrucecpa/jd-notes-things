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
 * Idempotent via countVoiceSamplesForMeeting — a meeting that already has
 * voice samples (e.g. from a prior backfill run or manual Fix Speakers
 * assignment) is skipped.
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
 * Build {speaker, start, end} SECOND segments from utterance timestamps (ms),
 * restricted to labels with verified identities; per-speaker duration capped.
 *
 * @param {Array<Object>} transcript
 * @param {Object<string, {name: string, email: string}>} identities
 * @returns {Array<{speaker: string, start: number, end: number}>}
 */
function synthesizeSegments(transcript, identities) {
  const budget = new Map(); // label -> seconds used
  const segments = [];
  for (const u of transcript || []) {
    if (!identities[u.speaker]) continue;
    const startSec = (u.timestamp ?? 0) / 1000;
    const endSec = (u.endTimestamp ?? 0) / 1000;
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
 * @param {Function} deps.countVoiceSamplesForMeeting - (meetingId) => number
 * @param {Function} deps.fileExists - (path) => boolean
 * @param {Function} deps.embedSpeakers - (audioPath, segments) => Promise<Array<{speakerLabel, embedding}>>
 * @param {Function} deps.upsertProfileSample - (contact, embedding, durationSec, meetingId) => {profileId, created}|null
 * @param {Function} deps.log
 * @param {Object} [opts]
 * @param {Function} [opts.onProgress] - (done, total, summary) => void
 * @param {number} [opts.limit] - max meetings to embed (for staged rollout)
 * @returns {Promise<Object>} summary counts
 */
async function runBackfill(deps, opts = {}) {
  const { onProgress = () => {}, limit = Infinity } = opts;
  const all = deps.getAllMeetings();
  const meetings = [...(all.pastMeetings || [])];

  const summary = {
    scanned: 0,
    embedded: 0,
    samplesAdded: 0,
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
      const audioPath = meeting.videoFile || null;
      if (!audioPath || !deps.fileExists(audioPath)) {
        summary.skippedNoAudio++;
        continue;
      }
      if (deps.countVoiceSamplesForMeeting(meeting.id) > 0) {
        summary.skippedAlreadySampled++;
        continue;
      }
      const identities = extractSpeakerIdentities(meeting.transcript || []);
      if (Object.keys(identities).length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }
      const segments = synthesizeSegments(meeting.transcript, identities);
      if (segments.length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      const embeddings = await deps.embedSpeakers(audioPath, segments);
      summary.embedded++;

      for (const emb of embeddings) {
        const identity = identities[emb.speakerLabel];
        if (!identity) continue;
        const dur = segments
          .filter(s => s.speaker === emb.speakerLabel)
          .reduce((sum, s) => sum + (s.end - s.start), 0);
        const r = deps.upsertProfileSample(
          { contactName: identity.name, contactEmail: identity.email, googleContactId: null },
          emb.embedding,
          dur,
          meeting.id
        );
        if (r) summary.samplesAdded++;
      }
      deps.log(
        `[Backfill] ${meeting.id}: ${Object.keys(identities).length} identities, +${embeddings.length} embeddings`
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
  MAX_SECONDS_PER_SPEAKER,
  MIN_UTTERANCE_SECONDS,
};
