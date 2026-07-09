import { describe, it, expect } from 'vitest';
import {
  segmentRms,
  computeAnchor,
  WINDOW_MS,
  DOMINANCE_THRESHOLD,
  DOMINANCE_MARGIN,
} from '../../src/main/services/trackAnchorService.js';

// Helper: RMS window arrays where value v spans [startSec, endSec)
function windows(totalSec, spans) {
  const arr = new Float32Array(Math.ceil((totalSec * 1000) / WINDOW_MS));
  for (const { start, end, v } of spans) {
    for (let i = Math.floor((start * 1000) / WINDOW_MS); i < Math.floor((end * 1000) / WINDOW_MS); i++) {
      arr[i] = v;
    }
  }
  return arr;
}

describe('segmentRms', () => {
  it('averages window RMS across a segment', () => {
    const w = windows(10, [{ start: 2, end: 4, v: 0.5 }]);
    expect(segmentRms(w, 2, 4)).toBeCloseTo(0.5);
    expect(segmentRms(w, 6, 8)).toBeCloseTo(0);
  });

  it('clamps past-EOF windows to zero contribution (short solo track)', () => {
    const w = windows(5, [{ start: 0, end: 5, v: 0.4 }]);
    // Segment extends past the end of a 5s track
    expect(segmentRms(w, 4, 6)).toBeGreaterThan(0);
    expect(segmentRms(w, 6, 8)).toBe(0);
  });
});

describe('computeAnchor', () => {
  // 2-person meeting: user (S0) speaks 0-30s, remote (S1) speaks 30-60s.
  const segments = [
    { speaker: 'SPEAKER_00', start: 0, end: 30 },
    { speaker: 'SPEAKER_01', start: 30, end: 60 },
  ];

  it('anchors the mic-dominant label as user and app-active labels as remote', () => {
    const mic = windows(60, [{ start: 0, end: 30, v: 0.4 }, { start: 30, end: 60, v: 0.05 }]); // bleed
    const app = windows(60, [{ start: 30, end: 60, v: 0.4 }]);
    const r = computeAnchor(segments, mic, app);
    expect(r.userLabel).toBe('SPEAKER_00');
    expect(r.remoteLabels).toEqual(['SPEAKER_01']);
    expect(r.userDominance).toBeGreaterThan(DOMINANCE_THRESHOLD);
  });

  it('returns no user anchor when mic is silent, but still flags remote labels', () => {
    const mic = windows(60, []);
    const app = windows(60, [{ start: 0, end: 60, v: 0.4 }]);
    const r = computeAnchor(segments, mic, app);
    expect(r.userLabel).toBeNull();
    expect(r.remoteLabels).toEqual(['SPEAKER_00', 'SPEAKER_01']);
  });

  it('returns no user anchor when both labels equally mic-active (ambiguous)', () => {
    const mic = windows(60, [{ start: 0, end: 60, v: 0.3 }]);
    const app = windows(60, [{ start: 0, end: 60, v: 0.3 }]);
    const r = computeAnchor(segments, mic, app);
    expect(r.userLabel).toBeNull();
  });

  it('excludes double-talk segments from dominance (discriminating)', () => {
    const segs = [
      { speaker: 'SPEAKER_00', start: 0, end: 30 },
      { speaker: 'SPEAKER_00', start: 30, end: 40 }, // double-talk: both loud
      { speaker: 'SPEAKER_01', start: 40, end: 60 }, // remote
      { speaker: 'SPEAKER_02', start: 60, end: 90 }, // mic-active competitor
    ];
    const mic = windows(90, [
      { start: 0, end: 40, v: 0.4 }, // S0 speech (30-40 overlaps app)
      { start: 60, end: 90, v: 0.15 }, // S2 speech on mic
    ]);
    const app = windows(90, [
      { start: 30, end: 60, v: 0.4 }, // overlap 30-40 + S1 speech
      { start: 60, end: 90, v: 0.03 }, // S2 bleed below appFloor (~0.04): not app-active
    ]);
    const r = computeAnchor(segs, mic, app);
    // With exclusion: S0 dominance = 1.0, S2 = 0.15/0.18 ≈ 0.833 → margin ≈ 0.167 ≥ 0.15
    // → S0 anchors. Without exclusion: S0 = (1.0 + 0.5)/2 = 0.75 < S2's 0.833 → S2 ranks
    // first but its margin ≈ 0.083 < 0.15 → userLabel null. So this assertion fails
    // unless double-talk segments are excluded.
    expect(r.userLabel).toBe('SPEAKER_00');
    expect(r.remoteLabels).toEqual(['SPEAKER_01']);
  });

  it('handles missing app track (mic-only): anchors only on unambiguous mic dominance', () => {
    const mic = windows(60, [{ start: 0, end: 30, v: 0.4 }]);
    const r = computeAnchor(segments, mic, null);
    expect(r.userLabel).toBe('SPEAKER_00');
    expect(r.remoteLabels).toEqual([]);
  });

  it('exports sane tunables', () => {
    expect(DOMINANCE_THRESHOLD).toBeGreaterThan(0.5);
    expect(DOMINANCE_MARGIN).toBeGreaterThan(0);
  });
});
