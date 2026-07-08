import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { LocalProvider } from '../../src/main/recording/LocalProvider.js';

describe('LocalProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new LocalProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('extends RecordingProvider (has EventEmitter + interface methods)', () => {
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.initialize).toBe('function');
    expect(typeof provider.startRecording).toBe('function');
    expect(typeof provider.stopRecording).toBe('function');
    expect(typeof provider.shutdown).toBe('function');
  });

  it('getState returns initial state', () => {
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.meetingDetected).toBe(false);
  });

  it('detectMeeting parses Zoom window title', () => {
    const result = provider._parseMeetingFromTitle('Zoom Meeting', 'zoom.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('zoom');
  });

  it('detectMeeting parses Zoom Webinar title', () => {
    const result = provider._parseMeetingFromTitle('Zoom Webinar', 'zoom.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('zoom');
  });

  it('detectMeeting parses Teams window title', () => {
    const result = provider._parseMeetingFromTitle('Weekly Standup | Microsoft Teams', 'ms-teams.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('teams');
  });

  it('detectMeeting returns null for non-meeting window', () => {
    const result = provider._parseMeetingFromTitle('Visual Studio Code', 'code.exe');
    expect(result).toBeNull();
  });

  it('detectMeeting returns null for empty title', () => {
    const result = provider._parseMeetingFromTitle('', 'unknown.exe');
    expect(result).toBeNull();
  });

  it('detectMeeting returns null for null title', () => {
    const result = provider._parseMeetingFromTitle(null, 'unknown.exe');
    expect(result).toBeNull();
  });

  // v2.0 mixer: setAudioConfig
  it('setAudioConfig stores sources and mixer settings', () => {
    const sources = [
      { label: 'Mic', device: 'Test Mic', volume: 120, enabled: true },
      { label: 'System', device: 'Stereo Mix', volume: 80, enabled: true },
    ];
    const mixer = { autoBalance: true };

    provider.setAudioConfig(sources, mixer);

    expect(provider._audioSources).toEqual(sources);
    expect(provider._audioMixer).toEqual(mixer);
  });

  it('setAudioConfig defaults to empty array and autoBalance false for null args', () => {
    provider.setAudioConfig(null, null);

    expect(provider._audioSources).toEqual([]);
    expect(provider._audioMixer).toEqual({ autoBalance: false });
  });

  it('constructor initializes audio config with defaults', () => {
    expect(provider._audioSources).toEqual([]);
    expect(provider._audioMixer).toEqual({ autoBalance: false });
  });

  // Regression: stopping a recording must terminate FFmpeg and clear state even
  // when FFmpeg ignores the graceful 'q' quit (as it does with live dshow +
  // WASAPI named-pipe inputs). Before the force-kill fallback, stopRecording hung
  // forever, leaving _recording=true → next start threw "already recording" and
  // the file kept growing.
  it('stopRecording force-kills FFmpeg when "q" is ignored, then clears state and emits recording-ended', async () => {
    // Fake FFmpeg: writing 'q' does nothing; only kill() terminates it (→ one 'close').
    const fake = new EventEmitter();
    let closed = false;
    fake.stdin = { write: () => {}, end: () => {} };
    fake.kill = vi.fn(() => {
      if (!closed) {
        closed = true;
        fake.emit('close', null);
      }
    });

    // Shrink stop timings so the test runs fast.
    provider._gracefulQuitMs = 20;
    provider._forceKillMs = 20;

    // Wire the provider as if a recording is in progress (mirrors _startFFmpeg).
    provider._recording = true;
    provider._ffmpegProcess = fake;
    provider._activeRecording = { recordingId: 'rec-1', audioFilePath: 'rec-1.mp3' };
    fake.on('close', (code) => provider._handleFfmpegClose('rec-1', 'rec-1.mp3', code));

    const ended = new Promise((resolve) => provider.once('recording-ended', resolve));

    // Must resolve (not hang) despite 'q' being ignored.
    await provider.stopRecording('rec-1');
    const endedEvent = await ended;

    expect(fake.kill).toHaveBeenCalled();
    expect(provider._recording).toBe(false);
    expect(provider._ffmpegProcess).toBeNull();
    expect(endedEvent).toMatchObject({ recordingId: 'rec-1', audioFilePath: 'rec-1.mp3' });
  });

  it('stopRecording clears a stale recording flag when no FFmpeg process exists', async () => {
    provider._recording = true;
    provider._ffmpegProcess = null;

    await provider.stopRecording('whatever');

    expect(provider._recording).toBe(false);
  });
});
