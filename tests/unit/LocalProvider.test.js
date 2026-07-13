import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { LocalProvider, parseWindowEnumOutput } from '../../src/main/recording/LocalProvider.js';

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

  describe('Google Meet detection', () => {
    it('detects an in-call Chrome Meet tab (hyphen)', () => {
      const r = provider._parseMeetingFromTitle('Meet - abc-defg-hij - Google Chrome', 'chrome');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
      expect(r.title).toBe('Meet - abc-defg-hij - Google Chrome');
      expect(r.processName).toBe('chrome');
    });

    it('detects a named Chrome Meet tab with an en-dash', () => {
      const r = provider._parseMeetingFromTitle('Meet – Weekly Sync - Google Chrome', 'chrome');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
    });

    it('detects a Meet tab in Edge (msedge)', () => {
      const r = provider._parseMeetingFromTitle('Meet - xyz-abcd-efg - Work - Microsoft​ Edge', 'msedge');
      expect(r).not.toBeNull();
      expect(r.platform).toBe('google-meet');
    });

    it('returns null for the bare Google Meet landing page', () => {
      const r = provider._parseMeetingFromTitle('Google Meet - Google Chrome', 'chrome');
      expect(r).toBeNull();
    });

    it('returns null for an unrelated "Meet notes" document tab', () => {
      const r = provider._parseMeetingFromTitle('Meet notes - Google Docs - Google Chrome', 'chrome');
      expect(r).toBeNull();
    });

    it('returns null for a Meet title in a non-Chrome/Edge browser (firefox)', () => {
      const r = provider._parseMeetingFromTitle('Meet - abc-defg-hij — Mozilla Firefox', 'firefox');
      expect(r).toBeNull();
    });

    it('does not regress Zoom/Teams parsing', () => {
      expect(provider._parseMeetingFromTitle('Zoom Meeting', 'zoom.exe').platform).toBe('zoom');
      expect(
        provider._parseMeetingFromTitle('Standup | Microsoft Teams', 'ms-teams.exe').platform
      ).toBe('teams');
    });
  });

  // Regression: Windows PowerShell 5.1's ConvertTo-Json emits C0 control
  // characters other than \b \f \n \r \t RAW into JSON string literals (seen
  // in the wild: a BEL U+0007 in a Chrome tab title), which JSON.parse rejects
  // ("Bad control character in string literal"). parseWindowEnumOutput must
  // tolerate that instead of failing every poll.
  describe('parseWindowEnumOutput', () => {
    it('parses a clean multi-window JSON array', () => {
      const out = JSON.stringify([
        { ProcessName: 'zoom', MainWindowTitle: 'Zoom Meeting', Id: 9864 },
        { ProcessName: 'chrome', MainWindowTitle: 'Inbox - Gmail', Id: 8580 },
      ]);
      expect(parseWindowEnumOutput(out)).toEqual([
        { processName: 'zoom', title: 'Zoom Meeting', pid: 9864 },
        { processName: 'chrome', title: 'Inbox - Gmail', pid: 8580 },
      ]);
    });

    it('wraps the single-object form PowerShell emits for exactly one result', () => {
      const out = JSON.stringify({ ProcessName: 'zoom', MainWindowTitle: 'Zoom Meeting', Id: 1 });
      expect(parseWindowEnumOutput(out)).toEqual([
        { processName: 'zoom', title: 'Zoom Meeting', pid: 1 },
      ]);
    });

    it('survives a raw BEL control character inside a title string', () => {
      // Mimics real ConvertTo-Json pretty-printed output with the unescaped BEL
      const out = [
        '[',
        '    {',
        '        "ProcessName":  "chrome",',
        '        "MainWindowTitle":  "Sign In \u0007 Max. your best interest. - Google Chrome",',
        '        "Id":  8580',
        '    },',
        '    {',
        '        "ProcessName":  "zoom",',
        '        "MainWindowTitle":  "Zoom Meeting",',
        '        "Id":  9864',
        '    }',
        ']',
      ].join('\r\n');
      const windows = parseWindowEnumOutput(out);
      expect(windows).toHaveLength(2);
      expect(windows[0].title).toBe('Sign In  Max. your best interest. - Google Chrome');
      expect(windows[1]).toEqual({ processName: 'zoom', title: 'Zoom Meeting', pid: 9864 });
    });

    it('strips other raw C0 controls but preserves escaped ones and structure', () => {
      const out = '[{"ProcessName":"app","MainWindowTitle":"a\u0001b\\tc","Id":5}]';
      expect(parseWindowEnumOutput(out)).toEqual([{ processName: 'app', title: 'ab\tc', pid: 5 }]);
    });

    it('defaults missing fields (null ProcessName from a dead pid)', () => {
      const out = JSON.stringify([{ ProcessName: null, MainWindowTitle: null, Id: null }]);
      expect(parseWindowEnumOutput(out)).toEqual([{ processName: '', title: '', pid: 0 }]);
    });
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

  // Close-debounce regression: a meeting window's title can drop out of the
  // window list for a single poll while the meeting is still live (Zoom in
  // particular). meeting-closed must only fire after CLOSE_CONFIRM_POLLS
  // consecutive absent polls — otherwise a flicker spuriously closes the meeting
  // (and, with auto-stop wired, would stop a live recording mid-meeting).
  describe('meeting detection close-debounce', () => {
    const ZOOM = [{ processName: 'zoom', title: 'Zoom Meeting', pid: 123 }];
    const NONE = [];

    it('emits meeting-detected once when a meeting window appears', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue(ZOOM);
      const detected = vi.fn();
      provider.on('meeting-detected', detected);

      await provider._pollForMeetings();
      await provider._pollForMeetings(); // still present — must not re-emit

      expect(detected).toHaveBeenCalledTimes(1);
      expect(detected).toHaveBeenCalledWith(expect.objectContaining({ windowId: 'zoom-123', platform: 'zoom' }));
    });

    it('does NOT emit meeting-closed on a single missed poll (flicker)', async () => {
      const list = vi.spyOn(provider, '_getWindowList');
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(ZOOM); // detected
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(NONE); // one flicker
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(ZOOM); // back again before the confirm threshold
      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(provider._meetingDetected).toBe(true);
    });

    it('emits meeting-closed once after CLOSE_CONFIRM_POLLS consecutive misses', async () => {
      const list = vi.spyOn(provider, '_getWindowList');
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(ZOOM); // detected
      await provider._pollForMeetings();
      list.mockResolvedValue(NONE); // gone for good
      await provider._pollForMeetings(); // miss 1 — no close yet
      expect(closed).not.toHaveBeenCalled();
      await provider._pollForMeetings(); // miss 2 — close

      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith({ windowId: 'zoom-123' });
      expect(provider._meetingDetected).toBe(false);
    });

    // Regression: Zoom HIDES its meeting window during screen share, so the
    // window vanishing from the poll is not proof the meeting ended. Zoom runs
    // each meeting in a dedicated child process that exits at meeting end —
    // hold the meeting open while that process is alive, otherwise a screen
    // share mid-meeting fires meeting-closed and auto-stops a live recording.
    it('holds a Zoom meeting open when the window is hidden but the meeting process is alive (screen share)', async () => {
      const list = vi.spyOn(provider, '_getWindowList');
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(true);
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(ZOOM); // detected
      await provider._pollForMeetings();
      list.mockResolvedValue(NONE); // window hidden by screen share
      for (let i = 0; i < 5; i++) {
        await provider._pollForMeetings(); // well past CLOSE_CONFIRM_POLLS
      }

      expect(closed).not.toHaveBeenCalled();
      expect(provider._meetingDetected).toBe(true);
      expect(provider._isProcessAlive).toHaveBeenCalledWith(123);
    });

    it('closes a held-open Zoom meeting once the meeting process exits', async () => {
      const list = vi.spyOn(provider, '_getWindowList');
      const alive = vi.spyOn(provider, '_isProcessAlive').mockReturnValue(true);
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(ZOOM); // detected
      await provider._pollForMeetings();
      list.mockResolvedValue(NONE);
      await provider._pollForMeetings(); // miss 1
      await provider._pollForMeetings(); // miss 2 — held open (process alive)
      expect(closed).not.toHaveBeenCalled();

      alive.mockReturnValue(false); // meeting process exited
      await provider._pollForMeetings();

      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith({ windowId: 'zoom-123' });
      expect(provider._meetingDetected).toBe(false);
    });

    it('closes a Teams meeting on window absence even while ms-teams.exe is alive', async () => {
      const TEAMS = [{ processName: 'ms-teams', title: 'Standup | Microsoft Teams', pid: 55 }];
      const list = vi.spyOn(provider, '_getWindowList');
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(true);
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(TEAMS); // detected
      await provider._pollForMeetings();
      list.mockResolvedValue(NONE); // meeting window closed; Teams shell still running
      await provider._pollForMeetings(); // miss 1
      await provider._pollForMeetings(); // miss 2 — close (no process-liveness hold for Teams)

      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith({ windowId: 'ms-teams-55' });
      expect(provider._meetingDetected).toBe(false);
    });

    // Immediate re-probe: after the close-debounce misses, LocalProvider does one
    // extra synchronous enumeration. If the tracked meeting window reappeared (a
    // flicker that outlasted the debounce, or a Meet tab-switch that came back),
    // hold the meeting open and do NOT emit meeting-closed.
    it('holds the meeting open when the window reappears on the immediate re-probe', async () => {
      const TEAMS = [{ processName: 'ms-teams', title: 'Standup | Microsoft Teams', pid: 55 }];
      const list = vi.spyOn(provider, '_getWindowList');
      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      list.mockResolvedValueOnce(TEAMS); // poll 1: detected
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(NONE); // poll 2: miss 1
      await provider._pollForMeetings();
      list.mockResolvedValueOnce(NONE); // poll 3 main scan: miss 2 (reaches threshold)
      list.mockResolvedValueOnce(TEAMS); // poll 3 re-probe: window reappeared
      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(provider._meetingDetected).toBe(true);
      expect(provider._missCount).toBe(0);
    });
  });

  describe('Google Meet browser-exit backstop', () => {
    it('emits meeting-closed with reason "browser-exit" when the recording browser PID dies', async () => {
      // Avoid a real PowerShell spawn if the poll continues past the backstop.
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(false);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = { windowId: 'chrome-4321', platform: 'google-meet' };

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith({ windowId: 'chrome-4321', reason: 'browser-exit' });
      expect(provider._recordingBrowserPid).toBeNull();
    });

    it('does not fire the backstop while the browser PID is still alive', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(true);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = { windowId: 'chrome-4321', platform: 'google-meet' };

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(provider._recordingBrowserPid).toBe(4321);
    });

    it('falls back to a synthetic browser-<pid> windowId when _activeMeeting was already cleared', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      vi.spyOn(provider, '_isProcessAlive').mockReturnValue(false);
      provider._recording = true;
      provider._recordingBrowserPid = 4321;
      provider._activeMeeting = null; // an earlier window-absence close cleared it

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).toHaveBeenCalledWith({ windowId: 'browser-4321', reason: 'browser-exit' });
    });

    it('does not run the backstop when not recording', async () => {
      vi.spyOn(provider, '_getWindowList').mockResolvedValue([]);
      const alive = vi.spyOn(provider, '_isProcessAlive');
      provider._recording = false;
      provider._recordingBrowserPid = 4321;

      const closed = vi.fn();
      provider.on('meeting-closed', closed);

      await provider._pollForMeetings();

      expect(closed).not.toHaveBeenCalled();
      expect(alive).not.toHaveBeenCalled();
    });
  });

  describe('per-track recording wiring', () => {
    it('derives track paths from the recording path', () => {
      const p = provider._deriveTrackPaths('C:\\rec\\recording-X.mp3');
      expect(p.micTrackPath).toBe('C:\\rec\\recording-X-mic.mp3');
      expect(p.appTrackPath).toBe('C:\\rec\\recording-X-app.wav');
      expect(p.systemTrackPath).toBe('C:\\rec\\recording-X-sys.mp3');
    });

    it('extracts the meeting PID from the active meeting windowId', () => {
      provider._activeMeeting = { windowId: 'zoom-27736', platform: 'zoom' };
      expect(provider._activeMeetingPid()).toBe(27736);
      provider._activeMeeting = null;
      expect(provider._activeMeetingPid()).toBeNull();
      provider._activeMeeting = { windowId: 'weird' };
      expect(provider._activeMeetingPid()).toBeNull();
    });

    it('recording-ended includes track paths', async () => {
      const fake = new EventEmitter();
      fake.stdin = { write: () => {}, end: () => {} };
      fake.kill = vi.fn(() => fake.emit('close', 0));
      provider._gracefulQuitMs = 10;
      provider._recording = true;
      provider._ffmpegProcess = fake;
      provider._activeRecording = { recordingId: 'r.mp3', audioFilePath: 'r.mp3' };
      provider._activeTrackPaths = { micAudioFilePath: 'r-mic.mp3', appAudioFilePath: null, systemAudioFilePath: null };
      fake.on('close', code => provider._handleFfmpegClose('r.mp3', 'r.mp3', code));

      const ended = new Promise(res => provider.once('recording-ended', res));
      await provider.stopRecording('r.mp3');
      const evt = await ended;
      expect(evt.micAudioFilePath).toBe('r-mic.mp3');
      expect(evt.appAudioFilePath).toBeNull();
    });

    // Regression: a start failure (FFmpeg spawn error, WasapiCapture rejection,
    // buildFFmpegArgs throw) must clean up all partial state — otherwise
    // _recording stays true and every later startRecording throws
    // 'already recording' until app restart.
    it('startRecording cleans up and stays startable when FFmpeg spawn fails', async () => {
      provider._activeMeeting = null; // no app capture path needed
      vi.spyOn(provider, '_startFFmpeg').mockRejectedValue(new Error('spawn ENOENT'));
      provider._stopWasapiCaptures = vi.fn().mockResolvedValue();

      await expect(provider.startRecording()).rejects.toThrow('spawn ENOENT');
      expect(provider._recording).toBe(false);
      expect(provider._activeRecording).toBeNull();
      expect(provider._activeTrackPaths).toBeNull();
      expect(provider._pendingTrackOutputs).toBeNull();
      expect(provider._stopWasapiCaptures).toHaveBeenCalled();

      // A second attempt must not be blocked by 'already recording'.
      vi.spyOn(provider, '_startFFmpeg').mockResolvedValue();
      await expect(provider.startRecording()).resolves.toBeTruthy();
    });

    // Regression: AppLoopbackCapture patches the WAV RIFF/data sizes inside
    // stop() — recording-ended must not fire until that finalization completes,
    // or downstream consumers read a WAV whose header still says 0 data bytes.
    it('awaits app-capture stop before emitting recording-ended', async () => {
      let stopResolved = false;
      provider._appCapture = {
        stop: vi.fn(() => new Promise(r => setTimeout(() => { stopResolved = true; r(); }, 20))),
      };
      const ended = new Promise(res => provider.once('recording-ended', () => res(stopResolved)));
      await provider._handleFfmpegClose('r.mp3', 'r.mp3', 0);
      expect(await ended).toBe(true);
      expect(provider._appCapture).toBeNull();
    });
  });
});
