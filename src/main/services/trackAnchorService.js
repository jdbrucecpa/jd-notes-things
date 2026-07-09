/**
 * TrackAnchorService — Stage 1 of the speaker waterfall.
 *
 * Answers two questions from diarized segments + per-track loudness:
 *   - which diarized speaker label is the USER (mic-dominant)?
 *   - which labels are provably REMOTE (active on the app/system track)?
 *
 * Design: an I/O wrapper (decodeToRmsWindows) decodes each isolation track
 * via FFmpeg to 8kHz mono s16le and reduces it to a Float32Array of
 * per-100ms RMS values (1 hour ≈ 36,000 floats). All decisions are pure
 * functions (segmentRms, computeAnchor) over those arrays — no I/O, easy
 * to unit test.
 *
 * Two physical caveats baked in below:
 *   - Solo tracks (mic-only, app-only) can be SHORTER than the mixed file
 *     (e.g. mic input ended early). segmentRms clamps to array bounds and
 *     treats past-EOF as 0.
 *   - The app WAV zero-fills silence in real time, so its timeline is
 *     continuous and always aligned with the mixed file's timebase.
 */

const { spawn } = require('child_process');
const log = require('electron-log');

const WINDOW_MS = 100; // RMS window size
const DECODE_ARGS = ['-f', 's16le', '-ar', '8000', '-ac', '1']; // 8kHz mono s16le
const SAMPLES_PER_WINDOW = (8000 * WINDOW_MS) / 1000; // 800

// Anchor decision tunables (see spec §5 Stage 1). Adjusted via correction
// telemetry over time (Phase 2).
const DOMINANCE_THRESHOLD = 0.65; // user label must exceed this mean dominance
const DOMINANCE_MARGIN = 0.15; // and beat the runner-up by this much
const ACTIVE_FLOOR_RATIO = 0.1; // "track active" = RMS > 10% of its p95
const REMOTE_ACTIVE_FRACTION = 0.6; // label is remote if >=60% of its segments are app-active

/**
 * Mean RMS of the windows covering [startSec, endSec). Pure.
 * Windows past the end of the array contribute 0 (solo tracks can be shorter
 * than the mixed recording — e.g. the mic input ended early); the divisor is
 * the REQUESTED window count so a mostly-EOF segment reads as near-silent
 * rather than spuriously loud.
 */
function segmentRms(rmsWindows, startSec, endSec) {
  const from = Math.max(0, Math.floor((startSec * 1000) / WINDOW_MS));
  const requestedTo = Math.ceil((endSec * 1000) / WINDOW_MS);
  const to = Math.min(rmsWindows.length, requestedTo);
  if (requestedTo <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += rmsWindows[i];
  return sum / (requestedTo - from);
}

/** 95th-percentile of the non-zero values in an RMS array (activity reference). Pure. */
function p95(rmsWindows) {
  const sorted = Array.from(rmsWindows)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

/**
 * Stage 1 anchor decision. Pure — operates on precomputed RMS window arrays.
 *
 * User anchor: the label whose speech is mic-dominant — mean of
 * micRMS/(micRMS+appRMS) over its segments, excluding double-talk segments
 * (both tracks active), must clear DOMINANCE_THRESHOLD and beat the
 * runner-up by DOMINANCE_MARGIN.
 *
 * Remote anchor: with a per-app track, the user's voice never renders on it
 * (Zoom/Teams play only remote audio) — any label mostly active there is
 * provably NOT the user, even when the mic anchor fails (muted mic).
 *
 * @param {Array<{speaker: string, start: number, end: number}>} segments - diarized segments (seconds)
 * @param {Float32Array|null} micWindows - per-100ms RMS of the mic track
 * @param {Float32Array|null} appWindows - per-100ms RMS of the app/system track
 * @returns {{ userLabel: string|null, userDominance: number, remoteLabels: string[] }}
 */
function computeAnchor(segments, micWindows, appWindows) {
  const micFloor = micWindows ? p95(micWindows) * ACTIVE_FLOOR_RATIO : 0;
  const appFloor = appWindows ? p95(appWindows) * ACTIVE_FLOOR_RATIO : 0;

  // Per-label dominance stats, excluding double-talk segments.
  const stats = new Map(); // label -> { domSum, domCount, appActive, total }
  for (const seg of segments) {
    if (!stats.has(seg.speaker)) {
      stats.set(seg.speaker, { domSum: 0, domCount: 0, appActive: 0, total: 0 });
    }
    const st = stats.get(seg.speaker);
    st.total++;

    const mic = micWindows ? segmentRms(micWindows, seg.start, seg.end) : 0;
    const app = appWindows ? segmentRms(appWindows, seg.start, seg.end) : 0;

    const micActive = Boolean(micWindows) && mic > micFloor;
    const appActive = Boolean(appWindows) && app > appFloor;

    if (appActive) st.appActive++;

    // Double-talk: both tracks active → the ratio is meaningless; exclude
    // from dominance (but the app-activity count above still stands).
    if (micActive && appActive) continue;

    if (mic + app > 0) {
      st.domSum += mic / (mic + app);
      st.domCount++;
    }
  }

  // Remote anchor: label mostly active on the app track.
  const remoteLabels = [];
  if (appWindows) {
    for (const [label, st] of stats) {
      if (st.total > 0 && st.appActive / st.total >= REMOTE_ACTIVE_FRACTION) {
        remoteLabels.push(label);
      }
    }
  }

  // User anchor: highest mean dominance, above threshold + margin, not remote.
  const ranked = Array.from(stats.entries())
    .filter(([label, st]) => st.domCount > 0 && !remoteLabels.includes(label))
    .map(([label, st]) => ({ label, dom: st.domSum / st.domCount }))
    .sort((a, b) => b.dom - a.dom);

  let userLabel = null;
  let userDominance = 0;
  if (ranked.length > 0) {
    const best = ranked[0];
    const second = ranked[1]?.dom ?? 0;
    if (best.dom >= DOMINANCE_THRESHOLD && best.dom - second >= DOMINANCE_MARGIN) {
      userLabel = best.label;
      userDominance = best.dom;
    }
  }

  return { userLabel, userDominance, remoteLabels: remoteLabels.sort() };
}

/** Decode an audio file to per-100ms RMS windows via FFmpeg. Streams; O(windows) memory. */
function decodeToRmsWindows(audioFilePath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-i', audioFilePath, ...DECODE_ARGS, 'pipe:1'], {
      windowsHide: true,
    });
    const rms = [];
    let sumSquares = 0;
    let count = 0;
    let carry = Buffer.alloc(0);

    ff.stdout.on('data', chunk => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const s = buf.readInt16LE(i) / 32768;
        sumSquares += s * s;
        count++;
        if (count === SAMPLES_PER_WINDOW) {
          rms.push(Math.sqrt(sumSquares / count));
          sumSquares = 0;
          count = 0;
        }
      }
      carry = buf.subarray(usable);
    });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code !== 0 && rms.length === 0) {
        reject(new Error(`ffmpeg decode failed (code=${code}) for ${audioFilePath}`));
        return;
      }
      if (count > 0) rms.push(Math.sqrt(sumSquares / count));
      resolve(Float32Array.from(rms));
    });
  });
}

/**
 * Full Stage 1: decode available tracks and compute the anchor.
 * Any decode failure degrades gracefully (spec §9): missing/broken tracks
 * simply reduce the evidence available; with none, returns null (skip stage).
 *
 * @param {{ micAudioFilePath?: string|null, appAudioFilePath?: string|null,
 *           systemAudioFilePath?: string|null }} trackPaths
 * @param {Array<{speaker: string, start: number, end: number}>} segments
 * @returns {Promise<{userLabel: string|null, userDominance: number, remoteLabels: string[]}|null>}
 */
async function computeTrackAnchor(trackPaths, segments) {
  const micPath = trackPaths.micAudioFilePath || null;
  const appPath = trackPaths.appAudioFilePath || trackPaths.systemAudioFilePath || null;
  if (!micPath && !appPath) return null; // no isolation tracks → skip Stage 1

  let micWindows = null;
  let appWindows = null;
  try {
    if (micPath) micWindows = await decodeToRmsWindows(micPath);
  } catch (err) {
    log.warn(`[TrackAnchor] mic decode failed: ${err.message}`);
  }
  try {
    if (appPath) appWindows = await decodeToRmsWindows(appPath);
  } catch (err) {
    log.warn(`[TrackAnchor] app/system decode failed: ${err.message}`);
  }
  if (!micWindows && !appWindows) return null;

  const anchor = computeAnchor(segments, micWindows, appWindows);
  log.info(
    `[TrackAnchor] userLabel=${anchor.userLabel} dominance=${anchor.userDominance.toFixed(3)} ` +
      `remote=[${anchor.remoteLabels.join(',')}]`
  );
  return anchor;
}

module.exports = {
  computeTrackAnchor,
  computeAnchor,
  segmentRms,
  decodeToRmsWindows,
  WINDOW_MS,
  DOMINANCE_THRESHOLD,
  DOMINANCE_MARGIN,
};
