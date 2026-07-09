import { describe, it, expect } from 'vitest';
import { mergeNearDuplicateLabels, MERGE_DISTANCE_THRESHOLD } from '../../src/main/services/speakerLabelMerge.js';

const emb = arr => ({ embedding: new Float32Array(arr) });

describe('mergeNearDuplicateLabels', () => {
  const segments = [
    { speaker: 'SPEAKER_00', start: 0, end: 60 },
    { speaker: 'SPEAKER_01', start: 60, end: 120 },
    { speaker: 'SPEAKER_02', start: 120, end: 125 }, // over-split shard of 00
  ];

  it('merges labels with near-identical embeddings into the longer-duration label', () => {
    const embeddings = [
      { speakerLabel: 'SPEAKER_00', ...emb([1, 0, 0]) },
      { speakerLabel: 'SPEAKER_01', ...emb([0, 1, 0]) },
      { speakerLabel: 'SPEAKER_02', ...emb([0.999, 0.01, 0]) }, // ~ same voice as 00
    ];
    const { relabelMap, segments: merged, embeddings: keptEmbeddings } =
      mergeNearDuplicateLabels(segments, embeddings);

    expect(relabelMap).toEqual({ SPEAKER_02: 'SPEAKER_00' });
    expect(merged.every(s => s.speaker !== 'SPEAKER_02')).toBe(true);
    expect(merged.filter(s => s.speaker === 'SPEAKER_00')).toHaveLength(2);
    expect(keptEmbeddings.map(e => e.speakerLabel)).toEqual(['SPEAKER_00', 'SPEAKER_01']);
  });

  it('merges nothing when all voices are distinct', () => {
    const embeddings = [
      { speakerLabel: 'SPEAKER_00', ...emb([1, 0, 0]) },
      { speakerLabel: 'SPEAKER_01', ...emb([0, 1, 0]) },
      { speakerLabel: 'SPEAKER_02', ...emb([0, 0, 1]) },
    ];
    const { relabelMap } = mergeNearDuplicateLabels(segments, embeddings);
    expect(relabelMap).toEqual({});
  });

  it('threshold is stricter than the profile high-confidence threshold (0.25)', () => {
    expect(MERGE_DISTANCE_THRESHOLD).toBeLessThan(0.25);
  });

  it('handles empty inputs', () => {
    const out = mergeNearDuplicateLabels([], []);
    expect(out.relabelMap).toEqual({});
    expect(out.segments).toEqual([]);
  });

  it('merges 3-way chain (A≈B, B≈C) with transitive resolution', () => {
    // A has 100s, B has 50s, C has 30s — A should be the survivor
    const segments = [
      { speaker: 'SPEAKER_A', start: 0, end: 100 },   // 100s duration
      { speaker: 'SPEAKER_B', start: 100, end: 150 },  // 50s duration
      { speaker: 'SPEAKER_C', start: 150, end: 180 },  // 30s duration
    ];
    const embeddings = [
      { speakerLabel: 'SPEAKER_A', ...emb([1, 0, 0]) },
      { speakerLabel: 'SPEAKER_B', ...emb([0.998, 0.01, 0]) },  // near-identical to A
      { speakerLabel: 'SPEAKER_C', ...emb([0.997, 0.015, 0]) }, // near-identical to B (and A)
    ];

    const { relabelMap, segments: merged, embeddings: keptEmbeddings } =
      mergeNearDuplicateLabels(segments, embeddings);

    // Both B and C should map to A (transitive resolution)
    expect(relabelMap).toEqual({ SPEAKER_B: 'SPEAKER_A', SPEAKER_C: 'SPEAKER_A' });
    expect(relabelMap.SPEAKER_B).toBe('SPEAKER_A');
    expect(relabelMap.SPEAKER_C).toBe('SPEAKER_A');

    // No intermediate hops: relabelMap values are fully-resolved survivors
    expect(Object.values(relabelMap).every(v => !relabelMap[v])).toBe(true);

    // Merged segments contain only A (plus any other distinct labels)
    const speakerLabels = merged.map(s => s.speaker);
    expect(speakerLabels.every(s => s === 'SPEAKER_A')).toBe(true);

    // Only A's embedding is kept
    expect(keptEmbeddings.map(e => e.speakerLabel)).toEqual(['SPEAKER_A']);
  });
});
