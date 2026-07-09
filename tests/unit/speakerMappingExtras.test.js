import { describe, it, expect } from 'vitest';
import { mergeSpeakerMappingExtras } from '../../src/main/services/speakerMappingExtras.js';

describe('mergeSpeakerMappingExtras', () => {
  const fromRows = {
    SPEAKER_00: { email: 'jd@x.com', name: 'JD', confidence: 'high', method: 'track-anchor' },
    SPEAKER_01: { email: null, name: 'Unknown', confidence: 'low', method: 'unmatched' },
  };
  const fromJson = {
    SPEAKER_00: { email: 'jd@x.com', name: 'JD', confidence: 'high', method: 'track-anchor', dominance: 0.88 },
    SPEAKER_01: { email: null, name: 'Unknown', confidence: 'low', method: 'unmatched',
      embedding: [0.1, 0.2], status: 'unmatched', needsVerification: true,
      candidates: [{ profileId: 3, contactName: 'Kurt' }] },
  };

  it('copies extra keys from JSON onto row-built entries without touching row-owned fields', () => {
    const merged = mergeSpeakerMappingExtras(fromRows, fromJson);
    expect(merged.SPEAKER_01.embedding).toEqual([0.1, 0.2]);
    expect(merged.SPEAKER_01.status).toBe('unmatched');
    expect(merged.SPEAKER_01.needsVerification).toBe(true);
    expect(merged.SPEAKER_01.candidates).toHaveLength(1);
    expect(merged.SPEAKER_00.dominance).toBeCloseTo(0.88);
    // Row-owned fields keep the ROW value even if JSON diverges
    expect(merged.SPEAKER_00.name).toBe('JD');
  });

  it('row value wins for overlapping row-owned fields', () => {
    const merged = mergeSpeakerMappingExtras(
      { A: { email: 'new@x.com', name: 'New Name', confidence: 'manual', method: 'user-correction' } },
      { A: { email: 'old@x.com', name: 'Old', confidence: 'low', method: 'unmatched', embedding: [1] } }
    );
    expect(merged.A.email).toBe('new@x.com');
    expect(merged.A.method).toBe('user-correction');
    expect(merged.A.embedding).toEqual([1]);
  });

  it('handles null/invalid JSON and labels missing on either side', () => {
    expect(mergeSpeakerMappingExtras(fromRows, null)).toEqual(fromRows);
    const merged = mergeSpeakerMappingExtras(fromRows, { SPEAKER_99: { embedding: [1] } });
    expect(merged).toEqual(fromRows); // JSON-only labels are NOT added (rows are authoritative)
  });
});
