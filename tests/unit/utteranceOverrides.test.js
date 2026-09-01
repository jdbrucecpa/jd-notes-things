import { describe, it, expect } from 'vitest';
import {
  computeUtteranceOverrides,
  WINDOW_MS,
  OVERRIDE_MIN_DURATION_S,
  OVERRIDE_STRONG_FRACTION,
  OVERRIDE_CONTRA_FRACTION,
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

// Helper: utterance with word timings in seconds (local-provider shape)
function utt(speaker, startSec, endSec) {
  return {
    speaker,
    text: 'placeholder',
    timestamp: Math.round(startSec * 1000),
    words: [
      { word: 'a', start: startSec, end: startSec + 0.1 },
      { word: 'b', start: endSec - 0.1, end: endSec },
    ],
  };
}

const anchor = {
  userLabel: 'SPEAKER_00',
  userDominance: 0.9,
  remoteLabels: ['SPEAKER_01'],
};

describe('computeUtteranceOverrides', () => {
  it('flips a remote-labeled utterance that is exclusively mic-active to the user', () => {
    // Utterance 1 labeled SPEAKER_01 but lives 10-15s where ONLY the mic is hot.
    const transcript = [
      utt('SPEAKER_00', 0, 8),
      utt('SPEAKER_01', 10, 15),
      utt('SPEAKER_01', 20, 30),
    ];
    const mic = windows(30, [{ start: 0, end: 8, v: 0.4 }, { start: 10, end: 15, v: 0.4 }]);
    const app = windows(30, [{ start: 20, end: 30, v: 0.4 }]);
    const overrides = computeUtteranceOverrides(transcript, anchor, mic, app);
    expect(overrides).toEqual([{ index: 1, from: 'SPEAKER_01', to: 'SPEAKER_00' }]);
  });

  it('flips a user-labeled utterance that is exclusively app-active to the sole remote label', () => {
    const transcript = [
      utt('SPEAKER_00', 0, 8),
      utt('SPEAKER_00', 10, 15), // actually remote speech
      utt('SPEAKER_01', 20, 30),
    ];
    const mic = windows(30, [{ start: 0, end: 8, v: 0.4 }]);
    const app = windows(30, [{ start: 10, end: 15, v: 0.4 }, { start: 20, end: 30, v: 0.4 }]);
    const overrides = computeUtteranceOverrides(transcript, anchor, mic, app);
    expect(overrides).toEqual([{ index: 1, from: 'SPEAKER_00', to: 'SPEAKER_01' }]);
  });

  it('does NOT flip on double-talk / echo bleed (both stems active)', () => {
    const transcript = [utt('SPEAKER_01', 10, 15)];
    // Remote speech playing through speakers picked up by the mic: both hot.
    const mic = windows(30, [{ start: 10, end: 15, v: 0.3 }]);
    const app = windows(30, [{ start: 10, end: 15, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, anchor, mic, app)).toEqual([]);
  });

  it('does NOT flip a user→remote utterance when the remote target is ambiguous', () => {
    const multiRemote = { ...anchor, remoteLabels: ['SPEAKER_01', 'SPEAKER_02'] };
    const transcript = [
      utt('SPEAKER_00', 10, 15), // app-active, but 2 possible remote targets
      utt('SPEAKER_01', 20, 25),
      utt('SPEAKER_02', 26, 30),
    ];
    const mic = windows(30, []);
    const app = windows(30, [{ start: 10, end: 30, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, multiRemote, mic, app)).toEqual([]);
  });

  it('falls back to the sole non-user transcript label when anchor.remoteLabels is empty', () => {
    const noRemotes = { ...anchor, remoteLabels: [] };
    const transcript = [
      utt('SPEAKER_00', 10, 15), // app-active → must flip to the only other label
      utt('SPEAKER_01', 20, 30),
    ];
    const mic = windows(30, []);
    const app = windows(30, [{ start: 10, end: 30, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, noRemotes, mic, app)).toEqual([
      { index: 0, from: 'SPEAKER_00', to: 'SPEAKER_01' },
    ]);
  });

  it('skips utterances shorter than the minimum duration', () => {
    const transcript = [utt('SPEAKER_01', 10, 10 + OVERRIDE_MIN_DURATION_S / 2)];
    const mic = windows(30, [{ start: 9, end: 12, v: 0.4 }]);
    const app = windows(30, [{ start: 20, end: 30, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, anchor, mic, app)).toEqual([]);
  });

  it('skips utterances without word timings', () => {
    const transcript = [{ speaker: 'SPEAKER_01', text: 'no words', timestamp: 10000, words: [] }];
    const mic = windows(30, [{ start: 9, end: 12, v: 0.4 }]);
    const app = windows(30, []);
    expect(computeUtteranceOverrides(transcript, anchor, mic, app)).toEqual([]);
  });

  it('returns no overrides when either stem is missing', () => {
    const transcript = [utt('SPEAKER_01', 10, 15)];
    const mic = windows(30, [{ start: 10, end: 15, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, anchor, mic, null)).toEqual([]);
    expect(computeUtteranceOverrides(transcript, anchor, null, mic)).toEqual([]);
  });

  it('returns no overrides without a user anchor', () => {
    const transcript = [utt('SPEAKER_01', 10, 15)];
    const mic = windows(30, [{ start: 10, end: 15, v: 0.4 }]);
    const app = windows(30, []);
    const noAnchor = { userLabel: null, userDominance: 0, remoteLabels: [] };
    expect(computeUtteranceOverrides(transcript, noAnchor, mic, app)).toEqual([]);
    expect(computeUtteranceOverrides(transcript, null, mic, app)).toEqual([]);
  });

  it('does NOT flip when the utterance span is mostly silent on both stems', () => {
    // Only 1s of a 10s utterance is mic-active: micOnlyFrac = 0.1 < strong.
    const transcript = [utt('SPEAKER_01', 10, 20)];
    const mic = windows(30, [{ start: 10, end: 11, v: 0.4 }]);
    const app = windows(30, [{ start: 25, end: 30, v: 0.4 }]);
    expect(computeUtteranceOverrides(transcript, anchor, mic, app)).toEqual([]);
  });

  it('exports sane tunables', () => {
    expect(OVERRIDE_STRONG_FRACTION).toBeGreaterThan(0.5);
    expect(OVERRIDE_CONTRA_FRACTION).toBeLessThan(0.5);
    expect(OVERRIDE_MIN_DURATION_S).toBeGreaterThan(0);
  });
});
