import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CorrectionTelemetry, diffCorrections } from '../../src/main/services/correctionTelemetry.js';

describe('diffCorrections (pure)', () => {
  const prev = {
    SPEAKER_00: { name: 'JD Bruce', email: 'jd@x.com', method: 'track-anchor', confidence: 'high' },
    SPEAKER_01: { name: 'Kurt Anderson', email: 'kurt@x.com', method: 'unverified-positional', confidence: 'low' },
  };

  it('records only entries whose assigned contact actually changed', () => {
    const diffs = diffCorrections('m1', prev, {
      SPEAKER_00: { contactName: 'JD Bruce', contactEmail: 'jd@x.com' }, // unchanged
      SPEAKER_01: { contactName: 'Melissa H', contactEmail: 'melissa@x.com' }, // corrected
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      meetingId: 'm1',
      speakerLabel: 'SPEAKER_01',
      fromName: 'Kurt Anderson',
      fromMethod: 'unverified-positional',
      fromConfidence: 'low',
      toName: 'Melissa H',
      toEmail: 'melissa@x.com',
    });
  });

  it('ignores labels with no prior mapping entry', () => {
    expect(diffCorrections('m1', {}, { X: { contactName: 'A' } })).toEqual([]);
  });
});

describe('CorrectionTelemetry (file-backed)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  });

  it('appends corrections and reports stats by overridden stage', () => {
    const t = new CorrectionTelemetry(path.join(dir, 'telemetry.json'));
    t.record([
      { at: 'x', meetingId: 'm1', speakerLabel: 'A', fromMethod: 'unverified-positional', fromName: 'K', fromConfidence: 'low', toName: 'M', toEmail: 'm@x.com' },
      { at: 'x', meetingId: 'm2', speakerLabel: 'B', fromMethod: 'track-anchor', fromName: 'J', fromConfidence: 'high', toName: 'Q', toEmail: 'q@x.com' },
      { at: 'x', meetingId: 'm3', speakerLabel: 'C', fromMethod: 'unverified-positional', fromName: 'Z', fromConfidence: 'low', toName: 'W', toEmail: 'w@x.com' },
    ]);
    const t2 = new CorrectionTelemetry(path.join(dir, 'telemetry.json')); // reload from disk
    const stats = t2.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byMethod['unverified-positional']).toBe(2);
    expect(stats.byMethod['track-anchor']).toBe(1);
  });
});
