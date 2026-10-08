/**
 * resolveRecordingTracks — given any file of a local recording (the mixed
 * .mp3 or one of its isolation stems), find the mixed file to transcribe and
 * the stems that exist beside it. Used by Re-run transcription so a re-run
 * gets the same Stage 1 track anchor as the original pipeline.
 */
const { resolveRecordingTracks } = require('../../src/main/services/recordingTracks');

const base = 'C:\\rec\\recording-2026-09-29T19-32-49-059Z';
const existsOnly = files => p => files.includes(p);

describe('resolveRecordingTracks', () => {
  const allThree = [`${base}.mp3`, `${base}-mic.mp3`, `${base}-sys.mp3`];

  it('finds mic and system stems next to the mixed file', () => {
    expect(resolveRecordingTracks(`${base}.mp3`, existsOnly(allThree))).toEqual({
      audioPath: `${base}.mp3`,
      micAudioFilePath: `${base}-mic.mp3`,
      appAudioFilePath: null,
      systemAudioFilePath: `${base}-sys.mp3`,
    });
  });

  it('includes the per-app .wav track when present', () => {
    const files = [...allThree, `${base}-app.wav`];
    expect(resolveRecordingTracks(`${base}.mp3`, existsOnly(files)).appAudioFilePath).toBe(
      `${base}-app.wav`
    );
  });

  it.each(['-mic.mp3', '-sys.mp3'])(
    'switches to the mixed file when a %s stem was picked',
    suffix => {
      const result = resolveRecordingTracks(`${base}${suffix}`, existsOnly(allThree));
      expect(result.audioPath).toBe(`${base}.mp3`);
      expect(result.micAudioFilePath).toBe(`${base}-mic.mp3`);
      expect(result.systemAudioFilePath).toBe(`${base}-sys.mp3`);
    }
  );

  it('keeps a picked stem when the mixed file is missing', () => {
    const files = [`${base}-mic.mp3`];
    expect(resolveRecordingTracks(`${base}-mic.mp3`, existsOnly(files)).audioPath).toBe(
      `${base}-mic.mp3`
    );
  });

  it('returns no stems for a recording without isolation tracks', () => {
    expect(resolveRecordingTracks(`${base}.mp3`, existsOnly([`${base}.mp3`]))).toEqual({
      audioPath: `${base}.mp3`,
      micAudioFilePath: null,
      appAudioFilePath: null,
      systemAudioFilePath: null,
    });
  });

  it('leaves non-mp3 imports alone', () => {
    const m4a = 'C:\\imports\\call.m4a';
    expect(resolveRecordingTracks(m4a, () => true)).toEqual({
      audioPath: m4a,
      micAudioFilePath: null,
      appAudioFilePath: null,
      systemAudioFilePath: null,
    });
  });
});
