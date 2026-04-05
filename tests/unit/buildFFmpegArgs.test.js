// tests/unit/buildFFmpegArgs.test.js
import { describe, it, expect } from 'vitest';
import { buildFFmpegArgs } from '../../src/main/recording/buildFFmpegArgs.js';

describe('buildFFmpegArgs', () => {
  const defaultMixer = { autoBalance: false };

  it('single source -- no filter_complex', () => {
    const sources = [{ device: 'Stereo Mix (Realtek USB Audio)', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-f');
    expect(args).toContain('dshow');
    expect(args).toContain('-i');
    expect(args).toContain('audio=Stereo Mix (Realtek USB Audio)');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-map');
    expect(args[args.length - 1]).toBe('output.mp3');
  });

  it('single source with non-default volume -- applies volume filter', () => {
    const sources = [{ device: 'Mic (USB)', volume: 150 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-filter_complex');
    const filterIdx = args.indexOf('-filter_complex');
    expect(args[filterIdx + 1]).toContain('volume=1.5');
  });

  it('two sources -- correct filter_complex with amix', () => {
    const sources = [
      { device: 'Mic (USB)', volume: 100 },
      { device: 'Stereo Mix (Realtek USB Audio)', volume: 80 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    const iCount = args.filter(a => a === '-i').length;
    expect(iCount).toBe(2);

    const filterIdx = args.indexOf('-filter_complex');
    expect(filterIdx).toBeGreaterThan(-1);
    const filter = args[filterIdx + 1];
    expect(filter).toContain('[0:a]volume=1.0[a0]');
    expect(filter).toContain('[1:a]volume=0.8[a1]');
    expect(filter).toContain('amix=inputs=2:duration=longest');
    expect(filter).toContain('[out]');

    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('[out]');
  });

  it('three sources -- extended filter chain', () => {
    const sources = [
      { device: 'Device1', volume: 100 },
      { device: 'Device2', volume: 60 },
      { device: 'Device3', volume: 200 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    const iCount = args.filter(a => a === '-i').length;
    expect(iCount).toBe(3);

    const filterIdx = args.indexOf('-filter_complex');
    const filter = args[filterIdx + 1];
    expect(filter).toContain('[0:a]volume=1.0[a0]');
    expect(filter).toContain('[1:a]volume=0.6[a1]');
    expect(filter).toContain('[2:a]volume=2.0[a2]');
    expect(filter).toContain('amix=inputs=3:duration=longest');
  });

  it('volume 0% maps to volume=0.0', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 0 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[1:a]volume=0.0[a1]');
  });

  it('volume 200% maps to volume=2.0', () => {
    const sources = [
      { device: 'Mic', volume: 200 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[0:a]volume=2.0[a0]');
  });

  it('autoBalance on -- appends dynaudnorm to filter chain', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, { autoBalance: true }, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('dynaudnorm=f=150:g=15:p=0.95');
    expect(filter).toContain('[out]');
  });

  it('autoBalance off -- no dynaudnorm', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).not.toContain('dynaudnorm');
  });

  it('autoBalance on single source at default volume -- applies dynaudnorm', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, { autoBalance: true }, 'output.mp3');
    expect(args).toContain('-filter_complex');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('dynaudnorm=f=150:g=15:p=0.95');
  });

  it('empty sources -- throws error', () => {
    expect(() => buildFFmpegArgs([], defaultMixer, 'output.mp3')).toThrow();
  });

  it('source with null device -- throws error', () => {
    expect(() =>
      buildFFmpegArgs([{ device: null, volume: 100 }], { autoBalance: false }, 'output.mp3')
    ).toThrow();
  });

  it('output always ends with MP3 encoding flags', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const acodecIdx = args.indexOf('-acodec');
    expect(args[acodecIdx + 1]).toBe('libmp3lame');
    expect(args).toContain('-ab');
    expect(args[args.indexOf('-ab') + 1]).toBe('128k');
    expect(args).toContain('-ar');
    expect(args[args.indexOf('-ar') + 1]).toBe('44100');
  });

  it('args start with -y flag', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    expect(args[0]).toBe('-y');
  });
});
