/**
 * speakerLabelMerge.js
 *
 * Stage 0 of the speaker waterfall: diarization routinely over-splits one
 * person into multiple labels. This module merges labels whose embeddings are
 * near-duplicates BEFORE any matching stage runs, so downstream stages see
 * one label per voice.
 *
 * Merging is stricter than profile matching (0.25): near-duplicate within
 * one meeting means same mic, same session — distances run much lower.
 */

const { cosineDistance } = require('./voiceProfileService');

/**
 * Stage 0 diarization label merge: distance ≤ this means near-identical voice
 * within one meeting (stricter than cross-meeting profile threshold 0.25).
 */
const MERGE_DISTANCE_THRESHOLD = 0.15;

/**
 * Merge labels whose embeddings are near-duplicates.
 *
 * Algorithm: greedy pairwise merge. For each pair of labels within the
 * threshold, absorb the shorter-duration label into the longer. Then fully
 * resolve chains (A->B->C becomes A->C) so relabelMap values are survivors.
 *
 * @param {Array<{speaker: string, start: number, end: number}>} segments - diarization segments, timestamps in seconds
 * @param {Array<{speakerLabel: string, embedding: Float32Array}>} embeddings - per-label embeddings
 * @returns {{
 *   relabelMap: Object<string,string>,   // absorbedLabel -> survivorLabel (fully resolved, no hops)
 *   segments: Array,                     // relabeled segments (absorbed labels replaced with survivors)
 *   embeddings: Array,                   // survivors only
 * }}
 */
function mergeNearDuplicateLabels(segments, embeddings) {
  // Handle empty inputs
  if (segments.length === 0 || embeddings.length === 0) {
    return { relabelMap: {}, segments: [], embeddings: [] };
  }

  // Compute total duration for each speaker label
  const durations = new Map();
  for (const s of segments) {
    const duration = Math.max(0, s.end - s.start);
    durations.set(s.speaker, (durations.get(s.speaker) || 0) + duration);
  }

  // Greedy pairwise merge: absorb shorter-duration label into longer
  const relabelMap = {};

  /**
   * Resolve a label through the relabel chain.
   * @param {string} label
   * @returns {string}
   */
  const resolve = label => {
    while (relabelMap[label]) {
      label = relabelMap[label];
    }
    return label;
  };

  // Compare all pairs of embeddings
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      // Resolve current labels through any existing merges
      const aResolved = resolve(embeddings[i].speakerLabel);
      const bResolved = resolve(embeddings[j].speakerLabel);

      // Skip if already merged or same label
      if (aResolved === bResolved) continue;

      // Check if embeddings are near-duplicate
      const distance = cosineDistance(embeddings[i].embedding, embeddings[j].embedding);

      if (distance <= MERGE_DISTANCE_THRESHOLD) {
        // Absorb shorter into longer by duration
        const aDuration = durations.get(aResolved) || 0;
        const bDuration = durations.get(bResolved) || 0;
        const [survivor, absorbed] = aDuration >= bDuration ? [aResolved, bResolved] : [bResolved, aResolved];

        relabelMap[absorbed] = survivor;
      }
    }
  }

  // Fully resolve chains: A->B->C becomes A->C so relabelMap values have no further hops
  for (const key of Object.keys(relabelMap)) {
    relabelMap[key] = resolve(key);
  }

  // Relabel segments using fully-resolved map
  const relabeledSegments = segments.map(s => {
    const resolved = resolve(s.speaker);
    return resolved !== s.speaker ? { ...s, speaker: resolved } : s;
  });

  // Keep only embeddings of survivor labels (not absorbed)
  const keptEmbeddings = embeddings.filter(e => !relabelMap[e.speakerLabel]);

  return { relabelMap, segments: relabeledSegments, embeddings: keptEmbeddings };
}

module.exports = { mergeNearDuplicateLabels, MERGE_DISTANCE_THRESHOLD };
