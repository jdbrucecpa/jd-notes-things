/**
 * Local recordings are written as a mixed file plus isolation stems
 * (see LocalProvider._deriveTrackPaths):
 *   recording-<ts>.mp3       mixed — what gets transcribed
 *   recording-<ts>-mic.mp3   microphone only
 *   recording-<ts>-sys.mp3   system/output audio only
 *   recording-<ts>-app.wav   per-app loopback (when available)
 * The stems are never transcribed; they feed the Stage 1 track anchor.
 */
const STEM_SUFFIX = /-(mic|sys)\.mp3$|-app\.wav$/i;

/**
 * Given any file of a recording (mixed or a stem), return the mixed file to
 * transcribe and the stems that exist beside it.
 * @param {string} filePath
 * @param {(p: string) => boolean} fileExists
 * @returns {{audioPath: string, micAudioFilePath: ?string, appAudioFilePath: ?string, systemAudioFilePath: ?string}}
 */
function resolveRecordingTracks(filePath, fileExists) {
  const none = { micAudioFilePath: null, appAudioFilePath: null, systemAudioFilePath: null };

  let base;
  if (STEM_SUFFIX.test(filePath)) {
    base = filePath.replace(STEM_SUFFIX, '');
  } else if (/\.mp3$/i.test(filePath)) {
    base = filePath.replace(/\.mp3$/i, '');
  } else {
    return { audioPath: filePath, ...none };
  }

  const mixed = `${base}.mp3`;
  const existing = p => (fileExists(p) ? p : null);
  return {
    audioPath: fileExists(mixed) ? mixed : filePath,
    micAudioFilePath: existing(`${base}-mic.mp3`),
    appAudioFilePath: existing(`${base}-app.wav`),
    systemAudioFilePath: existing(`${base}-sys.mp3`),
  };
}

module.exports = { resolveRecordingTracks };
