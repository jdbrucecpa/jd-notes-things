const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { RecordingProvider } = require('./RecordingProvider');
const { buildFFmpegArgs } = require('./buildFFmpegArgs');
const { WasapiCapture } = require('./WasapiCapture');
const { AppLoopbackCapture } = require('./AppLoopbackCapture');

// Prefer electron-log in the app; fall back to console in tests / non-Electron.
let log;
try {
  log = require('electron-log');
} catch {
  log = console;
}

const POLL_INTERVAL_MS = 2000;
// Consecutive polls a meeting window must be absent before we declare it closed.
// 2 polls @ 2s ≈ 4s of confirmed absence — long enough to ride out title flicker,
// short enough that auto-stop still fires promptly when the meeting really ends.
const CLOSE_CONFIRM_POLLS = 2;

const ZOOM_TITLES = ['Zoom Meeting', 'Zoom Webinar'];
const TEAMS_TITLE_SUFFIX = '| Microsoft Teams';
const TEAMS_PROCESS_NAMES = ['ms-teams', 'teams'];

// Robust window enumeration. `Get-Process | Where MainWindowTitle` only sees each
// process's *main* window — but Zoom's meeting window is frequently NOT its main
// window, so its "Zoom Meeting" title drops in and out between polls, causing the
// meeting to appear to open/close repeatedly. Instead we enumerate ALL visible
// top-level windows via user32 EnumWindows (P/Invoke through Add-Type), which
// finds the meeting window regardless of main-window status. Output shape matches
// the old command — [{ ProcessName, MainWindowTitle, Id }] — so parsing is unchanged.
//
// Note: Add-Type recompiles the helper on each spawn (~a few hundred ms of CPU
// every poll). Acceptable for a single-user desktop app; a persistent PowerShell
// host process would eliminate it if this ever shows up as meaningful overhead.
const WINDOW_ENUM_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class JDNWin { public string Title; public int Pid; }
public class JDNWindows {
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  private delegate bool EnumProc(IntPtr h, IntPtr p);
  public static List<JDNWin> Get() {
    var r = new List<JDNWin>();
    EnumProc cb = (h, p) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      r.Add(new JDNWin { Title = sb.ToString(), Pid = (int)pid });
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return r;
  }
}
"@
$procs = @{}
Get-Process | ForEach-Object { $procs[[int]$_.Id] = $_.ProcessName }
[JDNWindows]::Get() | ForEach-Object { [PSCustomObject]@{ ProcessName = $procs[[int]$_.Pid]; MainWindowTitle = $_.Title; Id = $_.Pid } } | ConvertTo-Json
`;

/**
 * LocalProvider — meeting detection via PowerShell window polling + audio
 * capture via FFmpeg WASAPI loopback.
 *
 * Events (inherited from RecordingProvider / EventEmitter):
 *   'meeting-detected'  { windowId, platform, title, processName }
 *   'meeting-closed'    { windowId }
 *   'recording-started' { recordingId, audioFilePath }
 *   'recording-ended'   { recordingId, audioFilePath }
 *   'error'             { type, message }
 */
class LocalProvider extends RecordingProvider {
  constructor() {
    super();
    this._recording = false;
    this._meetingDetected = false;
    this._activeMeeting = null; // { windowId, platform, title, processName }
    this._ffmpegProcess = null;
    this._activeRecording = null; // { recordingId, audioFilePath }
    this._ffmpegStderrTail = ''; // rolling tail of FFmpeg stderr for diagnostics
    this._pollInterval = null;
    this._audioSources = []; // Populated via setAudioConfig()
    this._audioMixer = { autoBalance: false };
    this._wasapiCaptures = []; // Active WasapiCapture instances during recording
    this._appCapture = null; // AppLoopbackCapture during recording
    this._activeTrackPaths = null; // { micAudioFilePath, appAudioFilePath, systemAudioFilePath }
    this._pendingTrackOutputs = null; // passed to buildFFmpegArgs at spawn time
    // Close-debounce: a meeting window's title can momentarily drop out of the
    // window list between polls (Zoom in particular reshuffles which of its
    // windows is "current"). Require the meeting window to be absent for several
    // consecutive polls before declaring it closed, so a single flicker doesn't
    // spuriously fire meeting-closed (and, once auto-stop is wired, stop a live
    // recording mid-meeting).
    this._missCount = 0;
    // Stop-sequence timings. FFmpeg's interactive 'q' quit is unreliable over a
    // piped stdin with live dshow + WASAPI named-pipe inputs, so stopRecording
    // force-kills if 'q' doesn't terminate FFmpeg within the grace window.
    this._gracefulQuitMs = 2500;
    this._forceKillMs = 1500;
    this._recordingPath = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
      'jd-notes-things',
      'recordings'
    );
  }

  // ---------------------------------------------------------------------------
  // RecordingProvider interface
  // ---------------------------------------------------------------------------

  /**
   * @param {object} [config]
   * @param {string} [config.recordingPath] - Directory for audio files
   */
  async initialize(config = {}) {
    if (config.recordingPath) {
      this._recordingPath = config.recordingPath;
    }

    // Ensure recordings directory exists
    try {
      fs.mkdirSync(this._recordingPath, { recursive: true });
    } catch (err) {
      this.emit('error', { type: 'init-error', message: `Cannot create recordings dir: ${err.message}` });
    }

    this._startPolling();

    // Store audio config if provided
    if (config.audioSources || config.audioMixer) {
      this.setAudioConfig(config.audioSources, config.audioMixer);
    }
  }

  /**
   * Start recording the system audio to a timestamped MP3 file.
   * @param {object} [options]
   * @returns {Promise<string>} recordingId (= audio file path)
   */
  async startRecording(_options = {}) {
    if (this._recording) {
      throw new Error('LocalProvider: already recording');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${timestamp}.mp3`;
    const audioFilePath = path.join(this._recordingPath, filename);
    const recordingId = audioFilePath;

    // Set state BEFORE starting FFmpeg so the close handler has valid data
    this._recording = true;
    this._activeRecording = { recordingId, audioFilePath };

    const trackPaths = this._deriveTrackPaths(audioFilePath);

    try {
      // Preferred isolation track: per-process capture of the detected meeting
      // app (remote voices only — the user's own voice never renders there).
      // Falls back to a system-only submix inside FFmpeg when unavailable.
      //
      // Phase-1 limitation: the capture binds to the meeting app's PID as it is
      // at record-start and never re-binds. If the meeting app restarts
      // mid-recording under a new PID, the app track degrades to silence for the
      // remainder — acceptable, since the system-submix/mixed recordings still
      // capture the audio. PID re-binding is future work.
      let appTrackActive = false;
      const meetingPid = this._activeMeetingPid();
      if (meetingPid && AppLoopbackCapture.isAvailable()) {
        try {
          this._appCapture = new AppLoopbackCapture();
          this._appCapture.on('error', (err) => {
            // Capture failure degrades the isolation track only — never the recording.
            this.emit('error', { type: 'app-loopback-error', message: err.message });
          });
          await this._appCapture.start(meetingPid, trackPaths.appTrackPath);
          appTrackActive = true;
          log.info(`[LocalProvider] App-loopback capture started (pid=${meetingPid})`);
        } catch (err) {
          log.warn(`[LocalProvider] App-loopback capture failed, using system submix: ${err.message}`);
          this._appCapture = null;
        }
      }

      this._pendingTrackOutputs = {
        micTrackPath: trackPaths.micTrackPath,
        systemTrackPath: appTrackActive ? null : trackPaths.systemTrackPath,
      };
      this._activeTrackPaths = {
        micAudioFilePath: null, // set in _startFFmpeg once real sources are known
        appAudioFilePath: appTrackActive ? trackPaths.appTrackPath : null,
        systemAudioFilePath: null,
      };

      await this._startFFmpeg(audioFilePath);
    } catch (err) {
      // Start failed (WasapiCapture rejection, buildFFmpegArgs throw, spawn
      // failure, ...). Tear down anything partially started and reset state so
      // the next startRecording isn't blocked by a stale 'already recording'.
      try {
        await this._stopWasapiCaptures();
      } catch {
        /* best effort */
      }
      if (this._appCapture) {
        await this._appCapture.stop().catch(() => {});
        this._appCapture = null;
      }
      this._recording = false;
      this._activeRecording = null;
      this._activeTrackPaths = null;
      this._pendingTrackOutputs = null;
      throw err;
    }

    this.emit('recording-started', { recordingId, audioFilePath });
    return recordingId;
  }

  /** Track-file paths derived from the main recording path. */
  _deriveTrackPaths(audioFilePath) {
    const base = audioFilePath.replace(/\.mp3$/i, '');
    return {
      micTrackPath: `${base}-mic.mp3`,
      appTrackPath: `${base}-app.wav`,
      systemTrackPath: `${base}-sys.mp3`,
    };
  }

  /** PID of the detected meeting app window, or null. windowId is "<proc>-<pid>". */
  _activeMeetingPid() {
    const windowId = this._activeMeeting?.windowId;
    if (!windowId) return null;
    const pid = parseInt(windowId.split('-').pop(), 10);
    return Number.isFinite(pid) ? pid : null;
  }

  /**
   * Stop the active FFmpeg recording. Resolves once FFmpeg has exited.
   * The 'recording-ended' event fires from the process close handler.
   *
   * FFmpeg's interactive 'q' quit is unreliable over a piped (non-console) stdin
   * when it is juggling live inputs — especially a dshow device plus WASAPI named
   * pipes — because it only checks stdin between input reads and can block on a
   * pipe read. So we ask it to quit gracefully (lets libmp3lame flush its final
   * frames) but force-kill if it hasn't exited within the grace window. MP3 has
   * no container trailer, so a force-killed file is still playable to the last frame.
   *
   * @param {string} [_recordingId] - ignored; only one recording at a time
   * @returns {Promise<void>}
   */
  async stopRecording(_recordingId) {
    const proc = this._ffmpegProcess;
    if (!proc) {
      // No process to stop — make sure we don't leave a stale "recording" flag
      // that would block the next startRecording with "already recording".
      if (this._recording) {
        this._recording = false;
        await this._stopWasapiCaptures();
        if (this._appCapture) {
          await this._appCapture.stop().catch(() => {});
          this._appCapture = null;
        }
      }
      return;
    }

    // Resolve as soon as FFmpeg actually exits (whether via 'q' or a kill).
    const exitPromise = new Promise((resolve) => {
      proc.once('close', () => resolve());
    });

    // 1. Graceful: ask FFmpeg to quit so libmp3lame flushes its final frames.
    try {
      proc.stdin.write('q');
      proc.stdin.end();
    } catch (_err) {
      // stdin already closed — the force-kill below still guarantees termination.
    }

    // 2. Guaranteed: force-kill if 'q' didn't terminate FFmpeg in time.
    let killTimer = setTimeout(() => {
      killTimer = null;
      try {
        proc.kill(); // TerminateProcess on Windows → fires 'close'
      } catch (_err) {
        /* already exited */
      }
      // Absolute last resort if the process still hasn't gone.
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_err) {
          /* already exited */
        }
      }, this._forceKillMs);
    }, this._gracefulQuitMs);

    await exitPromise;
    if (killTimer) {
      clearTimeout(killTimer);
    }
  }

  /**
   * Cleanup when the FFmpeg process exits (graceful quit OR force-kill).
   * Single source of truth for tearing down recording state.
   */
  async _handleFfmpegClose(recordingId, audioFilePath, code) {
    this._recording = false;
    this._ffmpegProcess = null;
    this._stopWasapiCaptures();
    if (this._appCapture) {
      const appCapture = this._appCapture;
      this._appCapture = null;
      // Await the stop: it patches the WAV RIFF/data sizes, so the app track is
      // only well-formed once stop() resolves. Emitting recording-ended earlier
      // would hand downstream consumers a WAV whose header still says 0 bytes.
      try {
        await appCapture.stop(); // never throws by design; belt-and-braces
      } catch {
        /* best effort */
      }
    }
    const tracks = this._activeTrackPaths || {};
    this._activeTrackPaths = null;
    this._pendingTrackOutputs = null;
    // Surface FFmpeg's exit + stderr tail so a failed/empty recording is diagnosable.
    log.info(`[LocalProvider] FFmpeg exited (code=${code}).`);
    if (this._ffmpegStderrTail) {
      log.info(`[LocalProvider] FFmpeg stderr tail:\n${this._ffmpegStderrTail}`);
    }
    this.emit('recording-ended', {
      recordingId,
      audioFilePath,
      exitCode: code,
      micAudioFilePath: tracks.micAudioFilePath || null,
      appAudioFilePath: tracks.appAudioFilePath || null,
      systemAudioFilePath: tracks.systemAudioFilePath || null,
    });
  }

  async shutdown() {
    // Stop any active WASAPI captures
    await this._stopWasapiCaptures();

    if (this._appCapture) {
      await this._appCapture.stop().catch(() => {});
      this._appCapture = null;
    }

    this._stopPolling();

    if (this._ffmpegProcess) {
      await this.stopRecording();
    }
  }

  getState() {
    return {
      recording: this._recording,
      meetingDetected: this._meetingDetected,
    };
  }

  // ---------------------------------------------------------------------------
  // Window polling (PowerShell)
  // ---------------------------------------------------------------------------

  _startPolling() {
    if (this._pollInterval) return;
    this._pollInterval = setInterval(() => this._pollForMeetings(), POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  /**
   * Poll the running processes for meeting windows and emit events on changes.
   */
  async _pollForMeetings() {
    let windows;
    try {
      windows = await this._getWindowList();
    } catch (err) {
      this.emit('error', { type: 'poll-error', message: `Window poll failed: ${err.message}` });
      return;
    }

    // Find any active meeting window
    let detectedMeeting = null;
    for (const win of windows) {
      const match = this._parseMeetingFromTitle(win.title, win.processName);
      if (match) {
        detectedMeeting = { ...match, windowId: `${win.processName}-${win.pid}` };
        break;
      }
    }

    if (detectedMeeting) {
      // A meeting window is present this poll — reset the close-debounce counter.
      this._missCount = 0;
      if (!this._meetingDetected) {
        // New meeting appeared
        this._meetingDetected = true;
        this._activeMeeting = detectedMeeting;
        this.emit('meeting-detected', {
          windowId: detectedMeeting.windowId,
          platform: detectedMeeting.platform,
          title: detectedMeeting.title,
          processName: detectedMeeting.processName,
        });
      } else if (this._activeMeeting?.windowId !== detectedMeeting.windowId) {
        // The tracked meeting window changed (e.g. a new meeting replaced the old
        // one). Update our reference so meeting-closed reports the right windowId,
        // but don't re-emit meeting-detected for what is effectively the same
        // ongoing "in a meeting" state.
        this._activeMeeting = detectedMeeting;
      }
    } else if (this._meetingDetected) {
      // No meeting window this poll. Don't declare it closed immediately — the
      // title can drop out for a single poll while the meeting is still live.
      // Only fire meeting-closed after CLOSE_CONFIRM_POLLS consecutive misses.
      this._missCount += 1;
      if (this._missCount >= CLOSE_CONFIRM_POLLS) {
        const prev = this._activeMeeting;
        this._meetingDetected = false;
        this._activeMeeting = null;
        this._missCount = 0;
        this.emit('meeting-closed', { windowId: prev?.windowId });
      }
    }
  }

  /**
   * Retrieve the list of windows with non-empty titles via PowerShell.
   * @returns {Promise<Array<{processName: string, title: string, pid: number}>>}
   */
  _getWindowList() {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell', [
        '-NoProfile',
        '-Command',
        WINDOW_ENUM_SCRIPT,
      ], { windowsHide: true });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', chunk => { stdout += chunk; });
      ps.stderr.on('data', chunk => { stderr += chunk; });

      ps.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`PowerShell exited ${code}: ${stderr.trim()}`));
        }

        try {
          const raw = JSON.parse(stdout.trim());
          // PowerShell returns an object (not array) when there is exactly one result
          const items = Array.isArray(raw) ? raw : [raw];
          const windows = items.map(item => ({
            processName: (item.ProcessName || '').toLowerCase(),
            title: item.MainWindowTitle || '',
            pid: item.Id || 0,
          }));
          resolve(windows);
        } catch (parseErr) {
          reject(new Error(`PowerShell JSON parse failed: ${parseErr.message}`));
        }
      });

      ps.on('error', err => reject(err));
    });
  }

  // ---------------------------------------------------------------------------
  // Meeting title parsing (pure — no side effects, fully testable)
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a window title + process name corresponds to a meeting.
   *
   * @param {string|null} title - MainWindowTitle from the process
   * @param {string} processName - lower-cased process name (e.g. "zoom.exe")
   * @returns {{ platform: string, title: string, processName: string } | null}
   */
  _parseMeetingFromTitle(title, processName) {
    if (!title) return null;

    const lowerProcess = (processName || '').toLowerCase();
    const lowerTitle = title.toLowerCase();

    // --- Zoom ---
    // Process: zoom.exe; titles: "Zoom Meeting", "Zoom Webinar"
    if (lowerProcess.includes('zoom')) {
      for (const candidate of ZOOM_TITLES) {
        if (lowerTitle.includes(candidate.toLowerCase())) {
          return { platform: 'zoom', title, processName };
        }
      }
    }

    // --- Microsoft Teams ---
    // Process: ms-teams.exe or teams.exe
    // Title suffix: "... | Microsoft Teams"
    const isTeamsProcess = TEAMS_PROCESS_NAMES.some(name => lowerProcess.includes(name));
    const hasTeamsSuffix = lowerTitle.includes(TEAMS_TITLE_SUFFIX.toLowerCase());

    if (isTeamsProcess || hasTeamsSuffix) {
      // Exclude non-meeting windows (e.g. the main Teams shell with just "Microsoft Teams")
      if (hasTeamsSuffix && title.trim().toLowerCase() !== 'microsoft teams') {
        return { platform: 'teams', title, processName };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // FFmpeg WASAPI loopback capture
  // ---------------------------------------------------------------------------

  /**
   * Find a suitable WASAPI loopback (stereo mix / virtual cable) device name.
   * Returns a device name string or null if none found.
   * @returns {Promise<string|null>}
   */
  async _findLoopbackDevice() {
    const devices = await this._enumerateDevices();
    const loopback = devices.find(d => d.isLoopback);
    return loopback ? loopback.name : null;
  }

  /**
   * Enumerate all dshow audio devices by parsing FFmpeg output.
   * @returns {Promise<Array<{name: string, isLoopback: boolean, isMicrophone: boolean}>>}
   */
  _enumerateDevices() {
    return new Promise((resolve) => {
      const ff = spawn('ffmpeg', [
        '-list_devices', 'true',
        '-f', 'dshow',
        '-i', 'dummy',
      ], { windowsHide: true });

      let stderr = '';
      ff.stderr.on('data', chunk => { stderr += chunk; });

      ff.on('close', async () => {
        const devices = [];
        const lines = stderr.split('\n');

        // FFmpeg dshow output has two formats:
        // Older: section headers "DirectShow audio devices" / "DirectShow video devices"
        // Newer (8.x+): each line has type suffix like "Device Name" (audio)
        const hasNewFormat = lines.some(l => /"\s*\(audio\)/.test(l));

        if (hasNewFormat) {
          // New format: "DeviceName" (audio) — type on each line
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes('alternative name')) continue;
            if (!lower.includes('(audio)')) continue;

            const match = line.match(/"([^"]+)"/);
            if (!match) continue;

            const name = match[1];
            const nameLower = name.toLowerCase();
            const isLoopback =
              nameLower.includes('stereo mix') ||
              nameLower.includes('wave out mix') ||
              nameLower.includes('loopback') ||
              nameLower.includes('virtual cable') ||
              nameLower.includes('vb-audio');
            const isMicrophone =
              nameLower.includes('microphone') || nameLower.includes('mic');

            devices.push({ name, isLoopback, isMicrophone });
          }
        } else {
          // Legacy format: section-based with "DirectShow audio devices" header
          let inAudioSection = false;
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes('directshow audio devices')) {
              inAudioSection = true;
              continue;
            }
            if (lower.includes('directshow video devices')) {
              inAudioSection = false;
              continue;
            }
            if (!inAudioSection) continue;

            const match = line.match(/"([^"]+)"/);
            if (!match) continue;
            if (lower.includes('alternative name')) continue;

            const name = match[1];
            const nameLower = name.toLowerCase();
            const isLoopback =
              nameLower.includes('stereo mix') ||
              nameLower.includes('wave out mix') ||
              nameLower.includes('loopback') ||
              nameLower.includes('virtual cable') ||
              nameLower.includes('vb-audio');
            const isMicrophone =
              nameLower.includes('microphone') || nameLower.includes('mic');

            devices.push({ name, isLoopback, isMicrophone });
          }
        }

        // Merge WASAPI output devices if available
        if (WasapiCapture.isAvailable()) {
          try {
            const outputDevices = await WasapiCapture.getOutputDevices();
            for (const od of outputDevices) {
              devices.push({
                name: od.name,
                type: 'wasapi',
                deviceId: od.deviceId,
                isLoopback: false,
                isMicrophone: false,
                isDefault: od.isDefault,
              });
            }
          } catch {
            // WASAPI enumeration failed — continue with dshow-only devices
          }
        }

        resolve(devices);
      });

      ff.on('error', () => resolve([]));
    });
  }

  /**
   * Update audio source and mixer configuration. Takes effect on next recording start.
   * @param {Array<{label: string, device: string|null, volume: number, enabled: boolean}>} sources
   * @param {{autoBalance: boolean}} mixer
   */
  setAudioConfig(sources, mixer) {
    this._audioSources = sources || [];
    this._audioMixer = mixer || { autoBalance: false };
  }

  /**
   * Spawn FFmpeg to capture audio from configured sources to `outputPath`.
   * Supports both dshow (mic) and WASAPI (output device loopback) sources.
   * Falls back to single loopback device if no sources configured.
   * @param {string} outputPath
   */
  async _startFFmpeg(outputPath) {
    let ffmpegArgs;

    // Get enabled sources from config
    const enabledSources = this._audioSources
      .filter(s => s.enabled && s.device)
      .map(s => ({
        device: s.device,
        volume: s.volume,
        type: s.type || 'dshow',
        deviceId: s.deviceId || null,
      }));

    if (enabledSources.length > 0) {
      // Start WASAPI captures for output device sources
      const resolvedSources = [];
      let pipeIndex = 0;

      for (const source of enabledSources) {
        if (source.type === 'wasapi' && source.deviceId) {
          const capture = new WasapiCapture();
          capture.on('error', (err) => {
            this.emit('error', { type: 'wasapi-error', message: err.message });
          });

          const { pipePath, sampleRate, channels } = await capture.start(source.deviceId, pipeIndex);
          this._wasapiCaptures.push(capture);
          pipeIndex++;

          resolvedSources.push({
            device: pipePath,
            volume: source.volume,
            type: 'wasapi',
            sampleRate,
            channels,
          });
        } else {
          resolvedSources.push({
            device: source.device,
            volume: source.volume,
            type: 'dshow',
          });
        }
      }

      const trackOutputs = this._pendingTrackOutputs || {};
      ffmpegArgs = buildFFmpegArgs(resolvedSources, this._audioMixer, outputPath, trackOutputs);
      // Record which solo tracks actually made it into the command.
      const hasMic = resolvedSources.some(s => s.type !== 'wasapi');
      const hasWasapi = resolvedSources.some(s => s.type === 'wasapi');
      if (this._activeTrackPaths) {
        this._activeTrackPaths.micAudioFilePath = hasMic ? trackOutputs.micTrackPath : null;
        this._activeTrackPaths.systemAudioFilePath =
          trackOutputs.systemTrackPath && hasWasapi ? trackOutputs.systemTrackPath : null;
      }
    } else {
      // Fallback: single loopback device (backward compat)
      const loopbackDevice = await this._findLoopbackDevice();
      const audioInput = loopbackDevice
        ? `audio=${loopbackDevice}`
        : 'audio=virtual-audio-capturer';

      ffmpegArgs = [
        '-y',
        '-f', 'dshow',
        '-i', audioInput,
        '-acodec', 'libmp3lame',
        '-ab', '128k',
        '-ar', '44100',
        outputPath,
      ];
    }

    log.info('[LocalProvider] Spawning FFmpeg:', ['ffmpeg', ...ffmpegArgs].join(' '));
    this._ffmpegStderrTail = '';
    this._ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });

    const { recordingId, audioFilePath } = this._activeRecording;

    this._ffmpegProcess.on('close', (code) =>
      this._handleFfmpegClose(recordingId, audioFilePath, code)
    );

    this._ffmpegProcess.on('error', (err) => {
      this.emit('error', { type: 'ffmpeg-error', message: err.message });
    });

    this._ffmpegProcess.stderr.on('data', (chunk) => {
      // Keep a rolling tail of FFmpeg stderr (format errors, missing devices,
      // etc.). FFmpeg writes both progress and errors here.
      this._ffmpegStderrTail = (this._ffmpegStderrTail + chunk.toString()).slice(-4000);
    });
  }

  /**
   * Stop all active WASAPI captures.
   */
  async _stopWasapiCaptures() {
    const captures = this._wasapiCaptures;
    this._wasapiCaptures = [];
    for (const capture of captures) {
      try {
        await capture.stop();
      } catch {
        // Already stopped
      }
    }
  }
}

module.exports = { LocalProvider };
