'use strict';

/**
 * How many bytes of silence to write to catch a live PCM pipe/file up to
 * real time. Pure: no I/O. Aligns to whole frames and caps at ~1s of
 * silence per call so a stalled clock can't emit an unbounded buffer.
 *
 * Shared by WasapiCapture (named-pipe feed) and AppLoopbackCapture (WAV feed).
 *
 * @param {number} elapsedMs - ms since the consumer clock started
 * @param {number} byteRate - bytes/sec of the PCM format
 * @param {number} frameBytes - bytes per audio frame (channels * bytesPerSample)
 * @param {number} bytesWritten - bytes emitted so far
 * @returns {number} silence bytes to write (0 if caught up)
 */
function computeSilenceDeficit(elapsedMs, byteRate, frameBytes, bytesWritten) {
  if (!byteRate || !frameBytes) return 0;
  const expected = Math.floor((elapsedMs / 1000) * byteRate);
  let deficit = expected - bytesWritten;
  if (deficit <= 0) return 0;
  deficit = Math.min(deficit, byteRate); // cap at ~1s
  deficit -= deficit % frameBytes; // whole frames only
  return deficit > 0 ? deficit : 0;
}

module.exports = { computeSilenceDeficit };
