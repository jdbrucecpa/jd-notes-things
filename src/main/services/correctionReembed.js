/**
 * Correction Re-embed (spec F1)
 *
 * When a Fix Speakers correction lands on a label that has no persisted
 * embedding (track-anchored, auto-matched, or pending labels often carry none),
 * the correction otherwise teaches the voice profiles nothing. This module
 * re-embeds the meeting audio for just the corrected label(s) and feeds the
 * result through upsertProfileSample so the correction becomes a voice sample
 * for the RIGHT person.
 *
 * Reuses the backfill's pure segment/audio helpers (synthesizeSegments,
 * resolveAudioPath) so legacy missing-end-timestamps and the 90s/speaker cap
 * are handled identically. Dependency-injected and non-throwing: the caller
 * runs it fire-and-forget, so the correction is never blocked by embedding
 * work. A cloud-only meeting (no local audio) or an unreachable audio service
 * is a silent skip / warning, not an error.
 */

const { synthesizeSegments, resolveAudioPath } = require('./voiceProfileBackfill');

/**
 * @param {Object} deps
 * @param {Function} deps.fileExists - (path) => boolean
 * @param {string[]} deps.recordingsDirs - dirs to probe for convention-named audio
 * @param {Function} deps.embedSpeakers - (audioPath, segments) => Promise<Array<{speakerLabel, embedding}>>
 * @param {Function} deps.upsertProfileSample - (contact, embedding, durationSec, meetingId) => {profileId, created, rejected?}|null
 * @param {Function} [deps.log] - (msg) => void
 * @param {Function} [deps.warn] - (msg) => void
 * @param {{videoFile?: string, recordingId?: string, transcript?: Array}} meeting
 * @param {Array<{speakerLabel: string, name: string, email: string}>} targets - corrected labels lacking an embedding
 * @param {string} meetingId
 * @returns {Promise<{embedded: number, samplesAdded: number, samplesRejected: number,
 *   skippedNoAudio?: boolean, skippedNoSegments?: boolean, error?: string}>}
 */
async function reembedCorrections(deps, meeting, targets, meetingId) {
  const log = deps.log || (() => {});
  const warn = deps.warn || (() => {});
  const summary = { embedded: 0, samplesAdded: 0, samplesRejected: 0 };

  if (!Array.isArray(targets) || targets.length === 0) return summary;

  try {
    const audioPath = resolveAudioPath(meeting, {
      fileExists: deps.fileExists,
      recordingsDirs: deps.recordingsDirs,
    });
    if (!audioPath) {
      log(`[CorrectionReembed] No local audio for ${meetingId} — skipping (cloud-only meeting)`);
      summary.skippedNoAudio = true;
      return summary;
    }

    // Restrict synthesized segments to the corrected labels only.
    const identities = {};
    for (const t of targets) identities[t.speakerLabel] = { name: t.name, email: t.email };
    const segments = synthesizeSegments(meeting.transcript || [], identities);
    if (segments.length === 0) {
      log(`[CorrectionReembed] No usable segments for ${meetingId} — nothing to embed`);
      summary.skippedNoSegments = true;
      return summary;
    }

    const embeddings = await deps.embedSpeakers(audioPath, segments);
    summary.embedded = 1;

    for (const emb of embeddings) {
      const target = targets.find(t => t.speakerLabel === emb.speakerLabel);
      if (!target) continue;
      const durationSec = segments
        .filter(s => s.speaker === emb.speakerLabel)
        .reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
      const upsert = deps.upsertProfileSample(
        { contactName: target.name, contactEmail: target.email, googleContactId: null },
        emb.embedding,
        durationSec,
        meetingId
      );
      if (upsert?.rejected) {
        summary.samplesRejected++;
        log(`[CorrectionReembed] Sample for ${target.name} rejected by poisoning guard in ${meetingId}`);
      } else if (upsert) {
        summary.samplesAdded++;
        log(
          `[CorrectionReembed] ${target.name} ${upsert.created ? 'enrolled' : 'strengthened'} ` +
            `via re-embed of ${emb.speakerLabel} in ${meetingId}`
        );
      }
    }
  } catch (err) {
    summary.error = err.message;
    warn(`[CorrectionReembed] Re-embed failed for ${meetingId} (correction still applied): ${err.message}`);
  }

  return summary;
}

module.exports = { reembedCorrections };
