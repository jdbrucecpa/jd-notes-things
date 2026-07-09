// src/main/recording/buildFFmpegArgs.js

/**
 * Build FFmpeg command-line arguments for multi-source audio recording.
 *
 * @param {Array<{device: string, volume: number}>} sources - Enabled audio sources.
 *   `device` is the exact dshow device name. `volume` is 0-200 (percentage).
 * @param {{autoBalance: boolean}} mixer - Mixer settings.
 * @param {string} outputPath - Path for the output MP3 file.
 * @param {{micTrackPath?: string, systemTrackPath?: string}} [trackOutputs] - Optional
 *   solo-track outputs recorded PRE-volume (raw), split off the same filtergraph as the
 *   main mix. `micTrackPath` uses the first non-wasapi (dshow) source; ignored if there
 *   is none. `systemTrackPath` submixes all wasapi sources; ignored if there are none.
 * @returns {string[]} FFmpeg argument array (without the leading "ffmpeg" binary name).
 */
function buildFFmpegArgs(sources, mixer = {}, outputPath, trackOutputs = {}) {
  if (!sources || sources.length === 0) {
    throw new Error('buildFFmpegArgs: at least one audio source is required');
  }

  const args = ['-y']; // overwrite without asking

  // Add input sources
  for (const source of sources) {
    if (!source.device) {
      throw new Error('buildFFmpegArgs: all sources must have a non-null device');
    }
    const sourceType = source.type || 'dshow';
    if (sourceType === 'wasapi') {
      // WASAPI loopback: raw PCM via named pipe
      args.push(
        '-f', 's16le',
        '-ar', String(source.sampleRate || 48000),
        '-ac', String(source.channels || 2),
        '-i', source.device
      );
    } else {
      // DirectShow input device (mic, stereo mix, etc.)
      args.push('-f', 'dshow', '-i', `audio=${source.device}`);
    }
  }

  // Solo-track targets. Mic = first dshow source; system = all wasapi sources.
  const micIndex = sources.findIndex(s => (s.type || 'dshow') !== 'wasapi');
  const wasapiIndexes = sources
    .map((s, i) => (s.type === 'wasapi' ? i : -1))
    .filter(i => i >= 0);
  const wantMicTrack = !!trackOutputs.micTrackPath && micIndex >= 0;
  const wantSystemTrack = !!trackOutputs.systemTrackPath && wasapiIndexes.length > 0;

  // Determine if we need a filter_complex
  const needsFilter =
    sources.length > 1 ||
    sources.some(s => s.volume !== 100) ||
    mixer.autoBalance ||
    wantMicTrack ||
    wantSystemTrack;

  if (needsFilter) {
    const filterParts = [];
    const streamLabels = [];
    const sysSrcLabels = [];

    // Per-source chains. Sources feeding a solo track get asplit so the raw
    // (pre-volume) stream can be mapped to the solo output — FFmpeg forbids
    // -map'ing an input stream that filter_complex already consumes.
    for (let i = 0; i < sources.length; i++) {
      const vol = (sources[i].volume / 100).toFixed(1);
      const label = `a${i}`;
      if (wantMicTrack && i === micIndex) {
        filterParts.push(`[${i}:a]asplit=2[mic_solo][mic_in]`);
        filterParts.push(`[mic_in]volume=${vol}[${label}]`);
      } else if (wantSystemTrack && sources[i].type === 'wasapi') {
        const src = `sys_src${sysSrcLabels.length}`;
        filterParts.push(`[${i}:a]asplit=2[${src}][w_in${i}]`);
        filterParts.push(`[w_in${i}]volume=${vol}[${label}]`);
        sysSrcLabels.push(`[${src}]`);
      } else {
        filterParts.push(`[${i}:a]volume=${vol}[${label}]`);
      }
      streamLabels.push(`[${label}]`);
    }

    // System submix: single wasapi source needs no amix — rename its split leg.
    if (wantSystemTrack) {
      if (sysSrcLabels.length === 1) {
        // Rewrite the single split to emit [sys_solo] directly.
        const i = wasapiIndexes[0];
        const idx = filterParts.findIndex(p => p.startsWith(`[${i}:a]asplit`));
        filterParts[idx] = `[${i}:a]asplit=2[sys_solo][w_in${i}]`;
      } else {
        filterParts.push(
          `${sysSrcLabels.join('')}amix=inputs=${sysSrcLabels.length}:duration=longest[sys_solo]`
        );
      }
    }

    // Mix or pass through (main output — unchanged semantics)
    if (sources.length > 1) {
      const mixLabel = mixer.autoBalance ? 'mix' : 'out';
      filterParts.push(
        `${streamLabels.join('')}amix=inputs=${sources.length}:duration=longest[${mixLabel}]`
      );

      if (mixer.autoBalance) {
        filterParts.push('[mix]dynaudnorm=f=150:g=15:p=0.95[out]');
      }
    } else {
      // Single source with non-default volume or autoBalance
      if (mixer.autoBalance) {
        filterParts.push('[a0]dynaudnorm=f=150:g=15:p=0.95[out]');
      } else {
        // Single source: relabel its chain output to [out].
        const last = filterParts.pop();
        filterParts.push(last.replace('[a0]', '[out]'));
      }
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', '[out]');
  }

  // Main output encoding
  args.push('-acodec', 'libmp3lame', '-ab', '128k', '-ar', '44100', outputPath);

  // Solo outputs (raw/pre-volume), after the main output.
  if (needsFilter && wantMicTrack) {
    args.push(
      '-map', '[mic_solo]',
      '-acodec', 'libmp3lame', '-ab', '96k', '-ar', '44100',
      trackOutputs.micTrackPath
    );
  }
  if (needsFilter && wantSystemTrack) {
    args.push(
      '-map', '[sys_solo]',
      '-acodec', 'libmp3lame', '-ab', '96k', '-ar', '44100',
      trackOutputs.systemTrackPath
    );
  }

  return args;
}

module.exports = { buildFFmpegArgs };
