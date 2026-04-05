// src/main/recording/buildFFmpegArgs.js

/**
 * Build FFmpeg command-line arguments for multi-source audio recording.
 *
 * @param {Array<{device: string, volume: number}>} sources - Enabled audio sources.
 *   `device` is the exact dshow device name. `volume` is 0-200 (percentage).
 * @param {{autoBalance: boolean}} mixer - Mixer settings.
 * @param {string} outputPath - Path for the output MP3 file.
 * @returns {string[]} FFmpeg argument array (without the leading "ffmpeg" binary name).
 */
function buildFFmpegArgs(sources, mixer, outputPath) {
  if (!sources || sources.length === 0) {
    throw new Error('buildFFmpegArgs: at least one audio source is required');
  }

  const args = ['-y']; // overwrite without asking

  // Add input sources
  for (const source of sources) {
    args.push('-f', 'dshow', '-i', `audio=${source.device}`);
  }

  // Determine if we need a filter_complex
  const needsFilter =
    sources.length > 1 || sources.some(s => s.volume !== 100) || mixer.autoBalance;

  if (needsFilter) {
    const filterParts = [];
    const streamLabels = [];

    // Per-source volume filters
    for (let i = 0; i < sources.length; i++) {
      const vol = (sources[i].volume / 100).toFixed(1);
      const label = `a${i}`;
      filterParts.push(`[${i}:a]volume=${vol}[${label}]`);
      streamLabels.push(`[${label}]`);
    }

    // Mix or pass through
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
        // Single source with non-default volume -- rename label to out
        filterParts.pop(); // remove the [a0] version
        const vol = (sources[0].volume / 100).toFixed(1);
        filterParts.push(`[0:a]volume=${vol}[out]`);
      }
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', '[out]');
  }

  // Output encoding
  args.push('-acodec', 'libmp3lame', '-ab', '128k', '-ar', '44100', outputPath);

  return args;
}

module.exports = { buildFFmpegArgs };
