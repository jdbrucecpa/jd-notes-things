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

  it('excludes double-talk segments from dominance', () => {
    const segs = [
      { speaker: 'SPEAKER_00', start: 0, end: 30 },
      { speaker: 'SPEAKER_00', start: 30, end: 40 }, // overlap window: both loud
      { speaker: 'SPEAKER_01', start: 40, end: 60 },
    ];
    const mic = windows(60, [{ start: 0, end: 40, v: 0.4 }]);
    const app = windows(60, [{ start: 30, end: 60, v: 0.4 }]);
    const r = computeAnchor(segs, mic, app);
    // Without exclusion the 30-40s block would dilute S0 dominance; with it S0 anchors.
    expect(r.userLabel).toBe('SPEAKER_00');
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
