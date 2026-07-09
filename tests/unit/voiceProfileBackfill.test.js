import { describe, it, expect, vi } from 'vitest';
import {
  extractSpeakerIdentities,
  synthesizeSegments,
  runBackfill,
  MAX_SECONDS_PER_SPEAKER,
} from '../../src/main/services/voiceProfileBackfill.js';

const T = (speaker, name, email, startMs, endMs) => ({
  speaker,
  speakerName: name,
  speakerEmail: email,
  text: 'x'.repeat(30),
  timestamp: startMs,
  endTimestamp: endMs,
});

describe('extractSpeakerIdentities (pure)', () => {
  it('maps labels to their majority verified identity, skipping generic names and null emails', () => {
    const transcript = [
      T('SPEAKER_00', 'JD Bruce', 'jd@x.com', 0, 5000),
      T('SPEAKER_00', 'JD Bruce', 'jd@x.com', 5000, 9000),
      T('SPEAKER_00', 'Kurt Anderson', 'kurt@x.com', 9000, 10000), // minority mislabel
      T('SPEAKER_01', 'Speaker B', null, 10000, 20000), // generic + no email → excluded
    ];
    const ids = extractSpeakerIdentities(transcript);
    expect(ids).toEqual({ SPEAKER_00: { name: 'JD Bruce', email: 'jd@x.com' } });
  });
});

describe('synthesizeSegments (pure)', () => {
  it('converts ms → seconds, skips sub-1.5s utterances, caps per-speaker total', () => {
    const transcript = [
      T('SPEAKER_00', 'JD', 'jd@x.com', 0, 1000), // 1s — skipped
      T('SPEAKER_00', 'JD', 'jd@x.com', 2000, 8000), // 6s
      T('SPEAKER_00', 'JD', 'jd@x.com', 10000, 10000 + (MAX_SECONDS_PER_SPEAKER + 30) * 1000), // long: clipped by cap
    ];
    const segs = synthesizeSegments(transcript, { SPEAKER_00: { name: 'JD', email: 'jd@x.com' } });
    expect(segs.every(s => s.speaker === 'SPEAKER_00')).toBe(true);
    expect(segs[0]).toEqual({ speaker: 'SPEAKER_00', start: 2, end: 8 });
    const total = segs.reduce((sum, s) => sum + (s.end - s.start), 0);
    expect(total).toBeLessThanOrEqual(MAX_SECONDS_PER_SPEAKER + 0.001);
  });
});

describe('runBackfill', () => {
  it('embeds qualifying meetings, upserts per identity, skips already-sampled and missing-audio meetings', async () => {
    const meetings = [
      {
        id: 'm-good',
        videoFile: 'C:/audio/good.mp3',
        transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000), T('S1', 'Kurt', 'kurt@x.com', 60000, 120000)],
      },
      {
        id: 'm-sampled',
        videoFile: 'C:/audio/sampled.mp3',
        transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000)],
      },
      {
        id: 'm-noaudio',
        videoFile: 'C:/audio/missing.mp3',
        transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000)],
      },
      { id: 'm-unverified', videoFile: 'C:/audio/good2.mp3', transcript: [T('S0', 'Speaker A', null, 0, 60000)] },
    ];
    const deps = {
      getAllMeetings: () => ({ upcomingMeetings: [], pastMeetings: meetings }),
      countVoiceSamplesForMeeting: id => (id === 'm-sampled' ? 2 : 0),
      fileExists: p => p !== 'C:/audio/missing.mp3',
      embedSpeakers: vi.fn().mockImplementation(async (_path, segments) =>
        [...new Set(segments.map(s => s.speaker))].map(label => ({
          speakerLabel: label,
          embedding: new Float32Array([1, 0]),
        }))
      ),
      upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: true }),
      log: () => {},
    };

    const summary = await runBackfill(deps, { onProgress: () => {} });

    expect(deps.embedSpeakers).toHaveBeenCalledTimes(1); // only m-good
    expect(deps.upsertProfileSample).toHaveBeenCalledTimes(2); // JD + Kurt
    expect(summary).toMatchObject({
      scanned: 4,
      embedded: 1,
      samplesAdded: 2,
      samplesRejected: 0,
      skippedAlreadySampled: 1,
      skippedNoAudio: 1,
      skippedNoIdentities: 1,
    });
  });

  it('counts poisoning-guard rejections separately from added samples', async () => {
    const meetings = [
      {
        id: 'm-mixed',
        videoFile: 'C:/audio/mixed.mp3',
        transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000), T('S1', 'Kurt', 'kurt@x.com', 60000, 120000)],
      },
    ];
    const deps = {
      getAllMeetings: () => ({ upcomingMeetings: [], pastMeetings: meetings }),
      countVoiceSamplesForMeeting: () => 0,
      fileExists: () => true,
      embedSpeakers: vi.fn().mockImplementation(async (_path, segments) =>
        [...new Set(segments.map(s => s.speaker))].map(label => ({
          speakerLabel: label,
          embedding: new Float32Array([1, 0]),
        }))
      ),
      upsertProfileSample: vi
        .fn()
        .mockImplementation(contact =>
          contact.contactEmail === 'jd@x.com'
            ? { profileId: 1, created: false, rejected: true }
            : { profileId: 2, created: true }
        ),
      log: () => {},
    };

    const summary = await runBackfill(deps);

    expect(deps.upsertProfileSample).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 1, samplesRejected: 1 });
  });
});
