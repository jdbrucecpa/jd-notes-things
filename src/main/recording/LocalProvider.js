const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { RecordingProvider } = require('./RecordingProvider');

const POLL_INTERVAL_MS = 2000;

const ZOOM_TITLES = ['Zoom Meeting', 'Zoom Webinar'];
const TEAMS_TITLE_SUFFIX = '| Microsoft Teams';
const TEAMS_PROCESS_NAMES = ['ms-teams', 'teams'];

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
    this._pollInterval = null;
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

    await this._startFFmpeg(audioFilePath);
    this.emit('recording-started', { recordingId, audioFilePath });
    return recordingId;
  }

  /**
   * Stop the active FFmpeg recording. Resolves when FFmpeg has exited.
   * The 'recording-ended' event fires from the process close handler.
   * @param {string} [_recordingId] - ignored; only one recording at a time
   * @returns {Promise<void>}
   */
  async stopRecording(_recordingId) {
    const proc = this._ffmpegProcess;
    if (!proc) {
      return;
    }

    // Wait for the process to actually exit
    const exitPromise = new Promise((resolve) => {
      proc.on('close', () => resolve());
    });

    // Send 'q' to FFmpeg stdin to trigger a clean shutdown
    try {
      proc.stdin.write('q');
      proc.stdin.end();
    } catch (_err) {
      // If stdin is already closed, kill the process directly
      proc.kill('SIGTERM');
    }

    return exitPromise;
  }

  async shutdown() {
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

    if (detectedMeeting && !this._meetingDetected) {
      // New meeting appeared
      this._meetingDetected = true;
      this._activeMeeting = detectedMeeting;
      this.emit('meeting-detected', {
        windowId: detectedMeeting.windowId,
        platform: detectedMeeting.platform,
        title: detectedMeeting.title,
        processName: detectedMeeting.processName,
      });
    } else if (!detectedMeeting && this._meetingDetected) {
      // Meeting went away
      const prev = this._activeMeeting;
      this._meetingDetected = false;
      this._activeMeeting = null;
      this.emit('meeting-closed', { windowId: prev?.windowId });
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
        "Get-Process | Where-Object { $_.MainWindowTitle -ne \"\" } | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json",
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
  _findLoopbackDevice() {
    return new Promise((resolve) => {
      const ff = spawn('ffmpeg', [
        '-list_devices', 'true',
        '-f', 'dshow',
        '-i', 'dummy',
      ], { windowsHide: true });

      let stderr = '';
      ff.stderr.on('data', chunk => { stderr += chunk; });

      ff.on('close', () => {
        // FFmpeg exits non-zero when listing devices — that is normal
        const lines = stderr.split('\n');
        for (const line of lines) {
          const lower = line.toLowerCase();
          // Common WASAPI loopback device names
          if (
            lower.includes('stereo mix') ||
            lower.includes('wave out mix') ||
            lower.includes('loopback') ||
            lower.includes('virtual cable') ||
            lower.includes('vb-audio')
          ) {
            // Extract the device name from the dshow listing line:
            // [dshow @ ...] "Stereo Mix (Realtek Audio)"
            const match = line.match(/"([^"]+)"/);
            if (match) {
              resolve(match[1]);
              return;
            }
          }
        }
        resolve(null);
      });

      ff.on('error', () => resolve(null));
    });
  }

  /**
   * Spawn FFmpeg to capture WASAPI loopback audio to `outputPath`.
   * Falls back to the default dshow audio device if no loopback device is found.
   * @param {string} outputPath
   */
  async _startFFmpeg(outputPath) {
    const loopbackDevice = await this._findLoopbackDevice();

    // Build the audio input source
    const audioInput = loopbackDevice
      ? `audio=${loopbackDevice}`
      : 'audio=virtual-audio-capturer'; // default fallback (common with screen recorders)

    this._ffmpegProcess = spawn('ffmpeg', [
      '-y',                 // overwrite without asking
      '-f', 'dshow',
      '-i', audioInput,
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-ar', '44100',
      outputPath,
    ], { windowsHide: true });

    const { recordingId, audioFilePath } = this._activeRecording;

    this._ffmpegProcess.on('close', (code) => {
      this._recording = false;
      this._ffmpegProcess = null;
      this.emit('recording-ended', { recordingId, audioFilePath, exitCode: code });
    });

    this._ffmpegProcess.on('error', (err) => {
      this.emit('error', { type: 'ffmpeg-error', message: err.message });
    });

    this._ffmpegProcess.stderr.on('data', (_chunk) => {
      // FFmpeg writes its progress to stderr — suppress for now.
      // Could emit progress events here in future.
    });
  }
}

module.exports = { LocalProvider };
