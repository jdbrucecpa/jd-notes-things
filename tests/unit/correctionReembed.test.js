import { describe, it, expect, vi } from 'vitest';
import { reembedCorrections } from '../../src/main/services/correctionReembed.js';

const T = (speaker, name, email, startMs, endMs) => ({
  speaker,
  speakerName: name,
  speakerEmail: email,
  text: 'x'.repeat(30),
  timestamp: startMs,
  endTimestamp: endMs,
});

function baseDeps(overrides = {}) {
  return {
    fileExists: () => true,
    recordingsDirs: ['C:/rec'],
    embedSpeakers: vi.fn().mockResolvedValue([{ speakerLabel: 'S0', embedding: new Float32Array([1, 0]) }]),
    upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: true }),
    log: () => {},
    warn: () => {},
    ...overrides,
  };
}

describe('reembedCorrections', () => {
  it('embeds the corrected label and upserts with the real synthesized duration', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const targets = [{ speakerLabel: 'S0', name: 'Kurt Anderson', email: 'kurt@x.com' }];
    const deps = baseDeps();

    const summary = await reembedCorrections(deps, meeting, targets, 'm1');

    expect(deps.embedSpeakers).toHaveBeenCalledTimes(1);
    const [audioPath, segments] = deps.embedSpeakers.mock.calls[0];
    expect(audioPath).toBe('C:/rec/a.mp3');
    expect([...new Set(segments.map(s => s.speaker))]).toEqual(['S0']);
    expect(deps.upsertProfileSample).toHaveBeenCalledWith(
      { contactName: 'Kurt Anderson', contactEmail: 'kurt@x.com', googleContactId: null },
      expect.any(Float32Array),
      expect.any(Number),
      'm1'
    );
    const passedDuration = deps.upsertProfileSample.mock.calls[0][2];
    expect(passedDuration).toBeGreaterThan(0);
    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 1, samplesRejected: 0 });
  });

  it('skips silently when no local audio is resolvable (cloud-only meeting)', async () => {
    const meeting = { transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({ fileExists: () => false, embedSpeakers: vi.fn() });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(deps.embedSpeakers).not.toHaveBeenCalled();
    expect(deps.upsertProfileSample).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ embedded: 0, skippedNoAudio: true });
  });

  it('returns without throwing when the audio service is unreachable', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({ embedSpeakers: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(deps.upsertProfileSample).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ embedded: 0, error: 'ECONNREFUSED' });
  });

  it('counts poisoning-guard rejections separately', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({
      upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: false, rejected: true }),
    });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 0, samplesRejected: 1 });
  });
});
