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

  it('treats adding an email to the same name as enrichment, not a correction', () => {
    const diffs = diffCorrections(
      'm1',
      { SPEAKER_00: { name: 'Kurt', email: null, method: 'unverified-positional', confidence: 'low' } },
      { SPEAKER_00: { contactName: 'Kurt', contactEmail: 'kurt@x.com' } }
    );
    expect(diffs).toEqual([]);
  });

  it('treats emails as authoritative when both sides have one (same name, different email)', () => {
    const diffs = diffCorrections(
      'm1',
      { SPEAKER_00: { name: 'Kurt', email: 'kurt@x.com', method: 'voice-profile', confidence: 'high' } },
      { SPEAKER_00: { contactName: 'Kurt', contactEmail: 'kurt@other.com' } }
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      speakerLabel: 'SPEAKER_00',
      fromMethod: 'voice-profile',
      toEmail: 'kurt@other.com',
    });
  });

  it('emits when an email-backed identity is replaced by a differing name-only identity', () => {
    const diffs = diffCorrections(
      'm1',
      { SPEAKER_00: { name: 'Kurt', email: 'kurt@x.com', method: 'x' } },
      { SPEAKER_00: { contactName: 'Kurt Anderson', contactEmail: null } }
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      speakerLabel: 'SPEAKER_00',
      fromName: 'Kurt',
      fromMethod: 'x',
      toName: 'Kurt Anderson',
      toEmail: null,
    });
  });

  it('skips null entry values in newMappings without throwing', () => {
    const diffs = diffCorrections('m1', prev, {
      SPEAKER_00: null,
      SPEAKER_01: { contactName: 'Melissa H', contactEmail: 'melissa@x.com' },
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].speakerLabel).toBe('SPEAKER_01');
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
