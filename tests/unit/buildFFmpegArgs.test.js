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

  // WASAPI source type tests
  it('wasapi source -- uses PCM format args instead of dshow', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 48000, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-f');
    expect(args).toContain('s16le');
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
    expect(args).toContain('-ac');
    expect(args).toContain('2');
    expect(args).not.toContain('dshow');
    expect(args).not.toContain('-filter_complex');
  });

  it('mixed dshow + wasapi sources -- correct args for both', () => {
    const sources = [
      { device: 'Mic (USB)', volume: 100, type: 'dshow' },
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 80, type: 'wasapi', sampleRate: 48000, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    // First input: dshow
    const firstFIdx = args.indexOf('-f');
    expect(args[firstFIdx + 1]).toBe('dshow');

    // Second input: s16le
    const secondFIdx = args.indexOf('-f', firstFIdx + 1);
    expect(args[secondFIdx + 1]).toBe('s16le');

    // Has amix
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('amix=inputs=2');
  });

  it('wasapi source without type field -- defaults to dshow (backward compat)', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('dshow');
    expect(args).not.toContain('s16le');
  });

  it('all wasapi sources -- no dshow args at all', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 48000, channels: 2 },
      { device: '\\\\.\\pipe\\jdnotes_wasapi_1', volume: 100, type: 'wasapi', sampleRate: 44100, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).not.toContain('dshow');
    expect(args.filter(a => a === 's16le').length).toBe(2);
  });

  it('wasapi source includes -ar and -ac before pipe path', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 44100, channels: 1 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    const fIdx = args.indexOf('-f');
    expect(args[fIdx + 1]).toBe('s16le');
    const arIdx = args.indexOf('-ar');
    expect(args[arIdx + 1]).toBe('44100');
    const acIdx = args.indexOf('-ac');
    expect(args[acIdx + 1]).toBe('1');
    // -i comes after format args
    const iIdx = args.indexOf('-i');
    expect(iIdx).toBeGreaterThan(acIdx);
  });
});

describe('buildFFmpegArgs track outputs', () => {
  const MIC = { device: 'My Mic', volume: 100, type: 'dshow' };
  const W0 = {
    device: '\\\\.\\pipe\\p0',
    volume: 100,
    type: 'wasapi',
    sampleRate: 48000,
    channels: 2,
  };
  const W1 = {
    device: '\\\\.\\pipe\\p1',
    volume: 100,
    type: 'wasapi',
    sampleRate: 96000,
    channels: 8,
  };

  it('emits mic solo output via asplit, pre-volume', () => {
    const args = buildFFmpegArgs([MIC, W0], {}, 'out.mp3', { micTrackPath: 'mic.mp3' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[0:a]asplit=2[mic_solo][mic_in]');
    expect(fc).toContain('[mic_in]volume=1.0[a0]');
    // main output then mic output
    const mapIdxs = args.map((a, i) => (a === '-map' ? i : -1)).filter(i => i >= 0);
    expect(args[mapIdxs[0] + 1]).toBe('[out]');
    expect(args[mapIdxs[1] + 1]).toBe('[mic_solo]');
    expect(args[args.length - 1]).toBe('mic.mp3');
  });

  it('emits system submix from multiple wasapi inputs', () => {
    const args = buildFFmpegArgs([MIC, W0, W1], {}, 'out.mp3', { systemTrackPath: 'sys.mp3' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[1:a]asplit=2[sys_src0][w_in1]');
    expect(fc).toContain('[2:a]asplit=2[sys_src1][w_in2]');
    expect(fc).toContain('[sys_src0][sys_src1]amix=inputs=2:duration=longest:normalize=0[sys_solo]');
    expect(args).toContain('[sys_solo]');
  });

  it('single wasapi input: solo comes straight off the split', () => {
    const args = buildFFmpegArgs([MIC, W0], {}, 'out.mp3', { systemTrackPath: 'sys.mp3' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[1:a]asplit=2[sys_solo][w_in1]');
    expect(fc).not.toContain('amix=inputs=1');
  });

  it('no trackOutputs → byte-identical behavior to before (regression)', () => {
    const a = buildFFmpegArgs([MIC, W0], { autoBalance: true }, 'out.mp3');
    const b = buildFFmpegArgs([MIC, W0], { autoBalance: true }, 'out.mp3', {});
    expect(a).toEqual(b);
    expect(a.join(' ')).not.toContain('asplit');
  });

  it('micTrackPath with no dshow source is ignored', () => {
    const args = buildFFmpegArgs([W0], {}, 'out.mp3', { micTrackPath: 'mic.mp3' });
    expect(args).not.toContain('mic.mp3');
  });

  it('both mic and system tracks together (mic + 2 wasapi)', () => {
    const args = buildFFmpegArgs([MIC, W0, W1], {}, 'out.mp3', {
      micTrackPath: 'mic.mp3',
      systemTrackPath: 'sys.mp3',
    });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain(':normalize=0');
    const mapIdxs = args.map((a, i) => (a === '-map' ? i : -1)).filter(i => i >= 0);
    expect(mapIdxs.map(i => args[i + 1])).toEqual(['[out]', '[mic_solo]', '[sys_solo]']);
    // Output paths appear in order: main, mic, system
    const outIdx = args.indexOf('out.mp3');
    const micIdx = args.indexOf('mic.mp3');
    const sysIdx = args.indexOf('sys.mp3');
    expect(outIdx).toBeGreaterThan(-1);
    expect(micIdx).toBeGreaterThan(outIdx);
    expect(sysIdx).toBeGreaterThan(micIdx);
  });

  it('mic at non-zero index still gets the mic split', () => {
    const args = buildFFmpegArgs([W0, MIC], {}, 'out.mp3', { micTrackPath: 'mic.mp3' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[1:a]asplit=2[mic_solo][mic_in]');
  });

  it('single dshow source + micTrackPath only', () => {
    const args = buildFFmpegArgs([MIC], {}, 'out.mp3', { micTrackPath: 'mic.mp3' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toBe('[0:a]asplit=2[mic_solo][mic_in];[mic_in]volume=1.0[out]');
    expect(args).toContain('out.mp3');
    expect(args).toContain('mic.mp3');
  });

  it('wasapi-only sources + both paths: mic ignored, system present', () => {
    const args = buildFFmpegArgs([W0, W1], {}, 'out.mp3', {
      micTrackPath: 'mic.mp3',
      systemTrackPath: 'sys.mp3',
    });
    expect(args).not.toContain('mic.mp3');
    expect(args).not.toContain('[mic_solo]');
    expect(args).toContain('[sys_solo]');
    expect(args).toContain('sys.mp3');
  });

  it('systemTrackPath with no wasapi source is ignored', () => {
    const args = buildFFmpegArgs([MIC], {}, 'out.mp3', { systemTrackPath: 'sys.mp3' });
    expect(args).not.toContain('sys.mp3');
  });
});
