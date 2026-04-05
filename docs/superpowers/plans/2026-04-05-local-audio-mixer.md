# Local Audio Mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-source audio mixing to LocalProvider so both the user's microphone and system audio are captured in a single recording.

**Architecture:** A pure function (`buildFFmpegArgs`) constructs the FFmpeg command from an array of audio sources + mixer settings. LocalProvider calls it instead of hardcoding args. Settings UI in the General panel lets users configure 3 fixed source slots with device dropdowns, volume sliders, and a test recording button.

**Tech Stack:** FFmpeg (dshow, amix, dynaudnorm filters), Electron IPC, Vitest

**Design spec:** `docs/superpowers/specs/2026-04-05-local-audio-mixer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/recording/buildFFmpegArgs.js` | Create | Pure function: sources + mixer settings + output path -> FFmpeg args array |
| `tests/unit/buildFFmpegArgs.test.js` | Create | Unit tests for the command builder |
| `src/main/recording/LocalProvider.js` | Modify | Extract `_enumerateDevices()`, refactor `_startFFmpeg` to use builder, add `setAudioConfig()` |
| `src/main.js` | Modify | New IPC handlers (`audioDevices:list`, `audioDevices:test`), pass audio config to LocalProvider |
| `src/preload.js` | Modify | Two new IPC bridges |
| `src/index.html` | Modify | New "Local Recording Sources" settings section |
| `src/renderer/settings.js` | Modify | Wire UI: device dropdowns, volume sliders, test button, visibility toggle |

---

## Task 1: FFmpeg Command Builder -- Tests

**Files:**
- Create: `tests/unit/buildFFmpegArgs.test.js`

- [ ] **Step 1: Create the test file with all test cases**

```javascript
// tests/unit/buildFFmpegArgs.test.js
import { describe, it, expect } from 'vitest';
import { buildFFmpegArgs } from '../../src/main/recording/buildFFmpegArgs.js';

describe('buildFFmpegArgs', () => {
  const defaultMixer = { autoBalance: false };

  it('single source -- no filter_complex', () => {
    const sources = [{ device: 'Stereo Mix (Realtek USB Audio)', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-f');
    expect(args).toContain('dshow');
    expect(args).toContain('-i');
    expect(args).toContain('audio=Stereo Mix (Realtek USB Audio)');
    expect(args).not.toContain('-filter_complex');
    expect(args).not.toContain('-map');
    expect(args[args.length - 1]).toBe('output.mp3');
  });

  it('single source with non-default volume -- applies volume filter', () => {
    const sources = [{ device: 'Mic (USB)', volume: 150 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-filter_complex');
    const filterIdx = args.indexOf('-filter_complex');
    expect(args[filterIdx + 1]).toContain('volume=1.5');
  });

  it('two sources -- correct filter_complex with amix', () => {
    const sources = [
      { device: 'Mic (USB)', volume: 100 },
      { device: 'Stereo Mix (Realtek USB Audio)', volume: 80 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    // Two -f dshow -i pairs
    const iCount = args.filter(a => a === '-i').length;
    expect(iCount).toBe(2);

    // filter_complex with amix
    const filterIdx = args.indexOf('-filter_complex');
    expect(filterIdx).toBeGreaterThan(-1);
    const filter = args[filterIdx + 1];
    expect(filter).toContain('[0:a]volume=1.0[a0]');
    expect(filter).toContain('[1:a]volume=0.8[a1]');
    expect(filter).toContain('amix=inputs=2:duration=longest');
    expect(filter).toContain('[out]');

    expect(args).toContain('-map');
    expect(args[args.indexOf('-map') + 1]).toBe('[out]');
  });

  it('three sources -- extended filter chain', () => {
    const sources = [
      { device: 'Device1', volume: 100 },
      { device: 'Device2', volume: 60 },
      { device: 'Device3', volume: 200 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    const iCount = args.filter(a => a === '-i').length;
    expect(iCount).toBe(3);

    const filterIdx = args.indexOf('-filter_complex');
    const filter = args[filterIdx + 1];
    expect(filter).toContain('[0:a]volume=1.0[a0]');
    expect(filter).toContain('[1:a]volume=0.6[a1]');
    expect(filter).toContain('[2:a]volume=2.0[a2]');
    expect(filter).toContain('amix=inputs=3:duration=longest');
  });

  it('volume 0% maps to volume=0.0', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 0 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[1:a]volume=0.0[a1]');
  });

  it('volume 200% maps to volume=2.0', () => {
    const sources = [
      { device: 'Mic', volume: 200 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[0:a]volume=2.0[a0]');
  });

  it('autoBalance on -- appends dynaudnorm to filter chain', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, { autoBalance: true }, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('dynaudnorm=f=150:g=15:p=0.95');
    expect(filter).toContain('[out]');
  });

  it('autoBalance off -- no dynaudnorm', () => {
    const sources = [
      { device: 'Mic', volume: 100 },
      { device: 'System', volume: 100 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).not.toContain('dynaudnorm');
  });

  it('autoBalance on single source at default volume -- applies dynaudnorm', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, { autoBalance: true }, 'output.mp3');
    expect(args).toContain('-filter_complex');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('dynaudnorm=f=150:g=15:p=0.95');
  });

  it('empty sources -- throws error', () => {
    expect(() => buildFFmpegArgs([], defaultMixer, 'output.mp3')).toThrow();
  });

  it('output always ends with MP3 encoding flags', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    const acodecIdx = args.indexOf('-acodec');
    expect(args[acodecIdx + 1]).toBe('libmp3lame');
    expect(args).toContain('-ab');
    expect(args[args.indexOf('-ab') + 1]).toBe('128k');
    expect(args).toContain('-ar');
    expect(args[args.indexOf('-ar') + 1]).toBe('44100');
  });

  it('args start with -y flag', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');
    expect(args[0]).toBe('-y');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/buildFFmpegArgs.test.js`
Expected: FAIL -- module `../../src/main/recording/buildFFmpegArgs.js` does not exist

- [ ] **Step 3: Commit test file**

```bash
git add tests/unit/buildFFmpegArgs.test.js
git commit -m "test: add buildFFmpegArgs unit tests (red)"
```

---

## Task 2: FFmpeg Command Builder -- Implementation

**Files:**
- Create: `src/main/recording/buildFFmpegArgs.js`

- [ ] **Step 1: Implement buildFFmpegArgs**

```javascript
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
  const needsFilter = sources.length > 1
    || sources.some(s => s.volume !== 100)
    || mixer.autoBalance;

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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/buildFFmpegArgs.test.js`
Expected: All 12 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/recording/buildFFmpegArgs.js
git commit -m "feat(recording): add buildFFmpegArgs pure function for multi-source mixing"
```

---

## Task 3: Extract `_enumerateDevices` and Refactor LocalProvider

**Files:**
- Modify: `src/main/recording/LocalProvider.js`

- [ ] **Step 1: Add require for buildFFmpegArgs at top of file**

After line 4 (`const { RecordingProvider } = require('./RecordingProvider');`), add:

```javascript
const { buildFFmpegArgs } = require('./buildFFmpegArgs');
```

- [ ] **Step 2: Add audio config fields to constructor**

In the constructor, after `this._pollInterval = null;` (line 36), add:

```javascript
    this._audioSources = []; // Populated via setAudioConfig()
    this._audioMixer = { autoBalance: false };
```

- [ ] **Step 3: Update `initialize()` to store audio config**

In the `initialize` method, after `this._startPolling();` (line 59), add:

```javascript

    // Store audio config if provided
    if (config.audioSources || config.audioMixer) {
      this.setAudioConfig(config.audioSources, config.audioMixer);
    }
```

- [ ] **Step 4: Replace `_findLoopbackDevice()` with thin wrapper**

Replace the entire `_findLoopbackDevice` method (lines 281-319) with:

```javascript
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
```

- [ ] **Step 5: Add `_enumerateDevices()` method**

After the new `_findLoopbackDevice()`, add:

```javascript
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

      ff.on('close', () => {
        const devices = [];
        const lines = stderr.split('\n');
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
        resolve(devices);
      });

      ff.on('error', () => resolve([]));
    });
  }
```

- [ ] **Step 6: Add `setAudioConfig()` method**

After `_enumerateDevices()`, add:

```javascript
  /**
   * Update audio source and mixer configuration. Takes effect on next recording start.
   * @param {Array<{label: string, device: string|null, volume: number, enabled: boolean}>} sources
   * @param {{autoBalance: boolean}} mixer
   */
  setAudioConfig(sources, mixer) {
    this._audioSources = sources || [];
    this._audioMixer = mixer || { autoBalance: false };
  }
```

- [ ] **Step 7: Replace `_startFFmpeg` with multi-source version**

Replace the entire `_startFFmpeg` method (lines 326-360) with:

```javascript
  /**
   * Spawn FFmpeg to capture audio from configured sources to `outputPath`.
   * Uses multi-source mixing when audioSources are configured,
   * falls back to single loopback device otherwise.
   * @param {string} outputPath
   */
  async _startFFmpeg(outputPath) {
    let ffmpegArgs;

    // Get enabled sources from config
    const enabledSources = this._audioSources
      .filter(s => s.enabled && s.device)
      .map(s => ({ device: s.device, volume: s.volume }));

    if (enabledSources.length > 0) {
      ffmpegArgs = buildFFmpegArgs(enabledSources, this._audioMixer, outputPath);
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

    this._ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });

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
      // FFmpeg writes its progress to stderr -- suppress for now.
    });
  }
```

- [ ] **Step 8: Run existing LocalProvider tests**

Run: `npx vitest run tests/unit/LocalProvider.test.js`
Expected: All 6 existing tests PASS (no behavioral change to public API)

- [ ] **Step 9: Commit**

```bash
git add src/main/recording/LocalProvider.js
git commit -m "feat(recording): extract _enumerateDevices, refactor _startFFmpeg to use buildFFmpegArgs"
```

---

## Task 4: IPC Handlers and Preload Bridges

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`

- [ ] **Step 1: Add audio config handling to `app:updateSettings`**

In `src/main.js`, in the `app:updateSettings` handler, find the line `// v2.0: AI service URL for voice profile service` (line 8516). Immediately **before** it, add:

```javascript
    // v2.0: Audio source config for local recording mixer
    if (updates.audioSources !== undefined) {
      appSettings.audioSources = updates.audioSources;
      if (recordingProvider && typeof recordingProvider.setAudioConfig === 'function') {
        recordingProvider.setAudioConfig(
          updates.audioSources,
          updates.audioMixer || appSettings.audioMixer || { autoBalance: false }
        );
      }
    }
    if (updates.audioMixer !== undefined) {
      appSettings.audioMixer = updates.audioMixer;
      if (recordingProvider && typeof recordingProvider.setAudioConfig === 'function') {
        recordingProvider.setAudioConfig(
          appSettings.audioSources || [],
          updates.audioMixer
        );
      }
    }
```

- [ ] **Step 2: Pass audio config when initializing LocalProvider in `initSDK()`**

In `initSDK()` (around line 2225), update the `recordingManager.initialize` call:

```javascript
      await recordingManager.initialize({
        recordingPath: RECORDING_PATH,
        audioSources: appSettings.audioSources,
        audioMixer: appSettings.audioMixer,
      });
```

- [ ] **Step 3: Pass audio config in the hot-swap block**

In the `app:updateSettings` handler, find the hot-swap block for `updates.recordingProvider === 'local'` (around line 8488-8490). Update the config object:

```javascript
        if (updates.recordingProvider === 'local') {
          newProvider = new LocalProvider();
          config = {
            recordingPath: RECORDING_PATH,
            audioSources: appSettings.audioSources,
            audioMixer: appSettings.audioMixer,
          };
```

- [ ] **Step 4: Add `audioDevices:list` IPC handler**

After the closing of the `app:updateSettings` handler (line 8538), add:

```javascript
// Audio device enumeration (v2.0 mixer)
ipcMain.handle('audioDevices:list', async () => {
  try {
    if (recordingProvider && typeof recordingProvider._enumerateDevices === 'function') {
      const devices = await recordingProvider._enumerateDevices();
      return { success: true, devices };
    }
    const tempProvider = new LocalProvider();
    const devices = await tempProvider._enumerateDevices();
    return { success: true, devices };
  } catch (error) {
    logger.ipc.error('[IPC] audioDevices:list failed:', error);
    return { success: false, devices: [], error: error.message };
  }
});
```

- [ ] **Step 5: Add `audioDevices:test` IPC handler**

Immediately after the `audioDevices:list` handler, add:

```javascript
// Test recording from configured sources (v2.0 mixer)
ipcMain.handle('audioDevices:test', async () => {
  try {
    const { buildFFmpegArgs } = require('./main/recording/buildFFmpegArgs');

    const sources = (appSettings.audioSources || [])
      .filter(s => s.enabled && s.device)
      .map(s => ({ device: s.device, volume: s.volume }));

    if (sources.length === 0) {
      return { success: false, error: 'No audio sources configured' };
    }

    const testFile = path.join(
      RECORDING_PATH,
      `test-recording-${Date.now()}.mp3`
    );

    const ffmpegArgs = buildFFmpegArgs(
      sources,
      appSettings.audioMixer || { autoBalance: false },
      testFile
    );
    // Insert -t 3 after the last -i argument to limit to 3 seconds
    const lastInputIdx = ffmpegArgs.lastIndexOf('-i');
    const insertIdx = lastInputIdx + 2;
    ffmpegArgs.splice(insertIdx, 0, '-t', '3');

    return new Promise((resolve) => {
      const ff = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });

      ff.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, filePath: testFile });
        } else {
          resolve({ success: false, error: `FFmpeg exited with code ${code}` });
        }
      });

      ff.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    logger.ipc.error('[IPC] audioDevices:test failed:', error);
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 6: Add preload bridges**

In `src/preload.js`, find the `// AI Service health (v2.0)` comment (line 349). Before it, add:

```javascript
  // Audio device management (v2.0 mixer)
  audioDevicesList: () => ipcRenderer.invoke('audioDevices:list'),
  audioDevicesTest: () => ipcRenderer.invoke('audioDevices:test'),
```

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat(recording): add IPC handlers for audio device enumeration and test recording"
```

---

## Task 5: Settings UI -- HTML

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add the Local Recording Sources section**

In `src/index.html`, find the closing `</div>` of the "Recording Provider" section (line 1599). Immediately after it and before the "Transcription Provider" section comment (line 1601), insert:

```html

            <!-- Local Recording Sources Section (v2.0 mixer) -->
            <div class="settings-section" id="audioSourcesSection" style="display: none;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <h3 class="settings-section-title" style="margin-bottom: 0;">Local Recording Sources</h3>
                <button class="btn btn-sm" id="audioDevicesRefreshBtn">Refresh Devices</button>
              </div>
              <div class="settings-item-description" style="margin-bottom: 16px;">
                Configure audio inputs for local recording. At least one source must be enabled.
              </div>

              <!-- Source Slot 1: Microphone -->
              <div class="settings-item" style="flex-direction: column; align-items: flex-start; gap: 8px;" id="audioSourceSlot0">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                  <input type="checkbox" id="audioSourceEnabled0" checked />
                  <label for="audioSourceEnabled0" class="settings-item-label" style="margin: 0;">Microphone</label>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Device:</label>
                  <select class="settings-select" id="audioSourceDevice0" style="flex: 1;">
                    <option value="">(none)</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Volume:</label>
                  <input type="range" id="audioSourceVolume0" min="0" max="200" step="5" value="100" style="flex: 1;" />
                  <span id="audioSourceVolumeLabel0" style="min-width: 40px; font-size: 13px;">100%</span>
                </div>
              </div>

              <!-- Source Slot 2: System Audio -->
              <div class="settings-item" style="flex-direction: column; align-items: flex-start; gap: 8px;" id="audioSourceSlot1">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                  <input type="checkbox" id="audioSourceEnabled1" checked />
                  <label for="audioSourceEnabled1" class="settings-item-label" style="margin: 0;">System Audio</label>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Device:</label>
                  <select class="settings-select" id="audioSourceDevice1" style="flex: 1;">
                    <option value="">(none)</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Volume:</label>
                  <input type="range" id="audioSourceVolume1" min="0" max="200" step="5" value="100" style="flex: 1;" />
                  <span id="audioSourceVolumeLabel1" style="min-width: 40px; font-size: 13px;">100%</span>
                </div>
              </div>

              <!-- Source Slot 3: Extra -->
              <div class="settings-item" style="flex-direction: column; align-items: flex-start; gap: 8px;" id="audioSourceSlot2">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                  <input type="checkbox" id="audioSourceEnabled2" />
                  <label for="audioSourceEnabled2" class="settings-item-label" style="margin: 0;">Source 3</label>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Device:</label>
                  <select class="settings-select" id="audioSourceDevice2" style="flex: 1;">
                    <option value="">(none)</option>
                  </select>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; width: 100%; padding-left: 24px;">
                  <label style="min-width: 50px; font-size: 13px; color: var(--text-secondary);">Volume:</label>
                  <input type="range" id="audioSourceVolume2" min="0" max="200" step="5" value="100" style="flex: 1;" />
                  <span id="audioSourceVolumeLabel2" style="min-width: 40px; font-size: 13px;">100%</span>
                </div>
              </div>

              <!-- Auto-balance toggle -->
              <div class="settings-item" style="margin-top: 8px;">
                <div class="settings-item-info">
                  <div class="settings-item-label">Auto-balance audio levels</div>
                  <div class="settings-item-description">Dynamically normalize volume across sources to prevent one from drowning out another</div>
                </div>
                <div class="settings-item-control">
                  <input type="checkbox" id="audioMixerAutoBalance" checked />
                </div>
              </div>

              <!-- Test recording -->
              <div class="settings-item" style="margin-top: 8px;">
                <div class="settings-item-info">
                  <div class="settings-item-label">Test Recording</div>
                  <div class="settings-item-description">Record 3 seconds from configured sources to verify levels</div>
                </div>
                <div class="settings-item-control" style="display: flex; align-items: center; gap: 8px;">
                  <button class="btn btn-sm" id="audioTestRecordBtn">Test Recording</button>
                  <span id="audioTestStatus" style="font-size: 13px; color: var(--text-secondary);"></span>
                </div>
              </div>
              <div id="audioTestPlayback" style="display: none; padding: 8px 0 0 0;">
                <audio id="audioTestPlayer" controls style="width: 100%;"></audio>
              </div>

              <!-- Error message area -->
              <div id="audioSourcesError" style="display: none; color: var(--error-color, #e74c3c); font-size: 13px; padding: 8px 0;"></div>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(ui): add Local Recording Sources section HTML in settings"
```

---

## Task 6: Settings UI -- JavaScript Wiring

**Files:**
- Modify: `src/renderer/settings.js`

- [ ] **Step 1: Add DOM references for audio source controls**

In `settings.js`, inside `initializeSettingsPanel()`, find the line that gets `fullyLocalPresetBtn` (line 158). After it, add:

```javascript
  // Audio source controls (v2.0 mixer)
  const audioSourcesSection = document.getElementById('audioSourcesSection');
  const audioDevicesRefreshBtn = document.getElementById('audioDevicesRefreshBtn');
  const audioTestRecordBtn = document.getElementById('audioTestRecordBtn');
  const audioTestStatus = document.getElementById('audioTestStatus');
  const audioTestPlayback = document.getElementById('audioTestPlayback');
  const audioTestPlayer = document.getElementById('audioTestPlayer');
  const audioMixerAutoBalance = document.getElementById('audioMixerAutoBalance');
  const audioSourcesError = document.getElementById('audioSourcesError');
```

- [ ] **Step 2: Add audio sources helper functions**

After the `checkLocalLLMStatus()` function (around line 715) and before `applyFullyLocalPreset()`, add:

```javascript
  // Cached device list for session
  let cachedAudioDevices = null;

  /**
   * Default labels for the three fixed audio source slots.
   */
  const SLOT_LABELS = ['Microphone', 'System Audio', 'Source 3'];

  /**
   * Fetch audio devices and populate all three dropdowns.
   * Auto-selects defaults on first load if no saved config exists.
   */
  async function refreshAudioDevices() {
    if (!window.electronAPI?.audioDevicesList) return;

    try {
      const result = await window.electronAPI.audioDevicesList();
      if (!result.success) {
        showAudioSourcesError(result.error || 'Failed to enumerate audio devices');
        return;
      }

      cachedAudioDevices = result.devices;
      if (audioSourcesError) audioSourcesError.style.display = 'none';

      if (result.devices.length === 0) {
        showAudioSourcesError('No audio devices detected. Is FFmpeg installed?');
        if (audioTestRecordBtn) audioTestRecordBtn.disabled = true;
        return;
      }
      if (audioTestRecordBtn) audioTestRecordBtn.disabled = false;

      // Populate all three device dropdowns
      for (let i = 0; i < 3; i++) {
        const select = document.getElementById(`audioSourceDevice${i}`);
        if (!select) continue;

        const currentValue = select.value;

        // Clear and rebuild options using safe DOM methods
        while (select.options.length > 0) {
          select.remove(0);
        }
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '(none)';
        select.appendChild(noneOpt);

        for (const device of result.devices) {
          const opt = document.createElement('option');
          opt.value = device.name;
          opt.textContent = device.name;
          select.appendChild(opt);
        }

        // Restore previous selection if it still exists
        if (currentValue && result.devices.some(d => d.name === currentValue)) {
          select.value = currentValue;
        }
      }

      // Auto-select defaults if no saved config
      applyAudioSourceDefaults(result.devices);
    } catch (err) {
      showAudioSourcesError('Failed to list audio devices: ' + err.message);
    }
  }

  /**
   * If no saved audioSources in appSettings, auto-select mic for slot 0
   * and loopback for slot 1.
   */
  async function applyAudioSourceDefaults(devices) {
    let hasSavedConfig = false;
    try {
      const result = await window.electronAPI.appGetSettings();
      if (result.success && result.data?.audioSources?.length > 0) {
        loadAudioSourcesFromConfig(result.data.audioSources, result.data.audioMixer);
        hasSavedConfig = true;
      }
    } catch { /* ignore */ }

    if (hasSavedConfig) return;

    // Auto-select defaults
    const micDevice = devices.find(d => d.isMicrophone);
    const loopbackDevice = devices.find(d => d.isLoopback);

    const select0 = document.getElementById('audioSourceDevice0');
    if (select0 && micDevice) select0.value = micDevice.name;

    const select1 = document.getElementById('audioSourceDevice1');
    if (select1 && loopbackDevice) select1.value = loopbackDevice.name;

    // Save the defaults immediately
    saveAudioSourceConfig();
  }

  /**
   * Load saved audio source config into the UI controls.
   */
  function loadAudioSourcesFromConfig(sources, mixer) {
    for (let i = 0; i < 3; i++) {
      const source = sources[i];
      if (!source) continue;

      const checkbox = document.getElementById(`audioSourceEnabled${i}`);
      const select = document.getElementById(`audioSourceDevice${i}`);
      const slider = document.getElementById(`audioSourceVolume${i}`);
      const label = document.getElementById(`audioSourceVolumeLabel${i}`);

      if (checkbox) checkbox.checked = source.enabled;
      if (select) select.value = source.device || '';
      if (slider) slider.value = source.volume;
      if (label) label.textContent = `${source.volume}%`;

      updateSlotDisabledState(i, source.enabled);
    }

    if (audioMixerAutoBalance && mixer) {
      audioMixerAutoBalance.checked = mixer.autoBalance !== false;
    }
  }

  /**
   * Read current UI state and save to appSettings.
   */
  function saveAudioSourceConfig() {
    const audioSources = [];
    for (let i = 0; i < 3; i++) {
      const checkbox = document.getElementById(`audioSourceEnabled${i}`);
      const select = document.getElementById(`audioSourceDevice${i}`);
      const slider = document.getElementById(`audioSourceVolume${i}`);

      audioSources.push({
        label: SLOT_LABELS[i],
        device: select?.value || null,
        volume: parseInt(slider?.value || '100', 10),
        enabled: checkbox?.checked || false,
      });
    }

    const audioMixerConfig = {
      autoBalance: audioMixerAutoBalance?.checked !== false,
    };

    if (window.electronAPI?.appUpdateSettings) {
      window.electronAPI.appUpdateSettings({
        audioSources,
        audioMixer: audioMixerConfig,
      });
    }
  }

  /**
   * Grey out or enable a source slot's dropdown and slider.
   */
  function updateSlotDisabledState(slotIndex, enabled) {
    const select = document.getElementById(`audioSourceDevice${slotIndex}`);
    const slider = document.getElementById(`audioSourceVolume${slotIndex}`);
    if (select) select.disabled = !enabled;
    if (slider) slider.disabled = !enabled;
  }

  /**
   * Show/hide the audio sources section based on recording provider.
   */
  function updateAudioSourcesVisibility() {
    if (!audioSourcesSection) return;
    const provider = recordingProviderSelect?.value || 'recall';
    if (provider === 'local') {
      audioSourcesSection.style.display = '';
      if (!cachedAudioDevices) {
        refreshAudioDevices();
      }
    } else {
      audioSourcesSection.style.display = 'none';
    }
  }

  /**
   * Show an error in the audio sources section.
   */
  function showAudioSourcesError(message) {
    if (!audioSourcesError) return;
    audioSourcesError.textContent = message;
    audioSourcesError.style.display = '';
  }
```

- [ ] **Step 3: Wire event handlers for all audio source controls**

After the `fullyLocalPresetBtn` event listener block (the one calling `applyFullyLocalPreset`), add:

```javascript
  // Audio source event handlers (v2.0 mixer)
  if (audioDevicesRefreshBtn) {
    audioDevicesRefreshBtn.addEventListener('click', () => {
      cachedAudioDevices = null;
      refreshAudioDevices();
    });
  }

  // Enable checkboxes
  for (let i = 0; i < 3; i++) {
    const checkbox = document.getElementById(`audioSourceEnabled${i}`);
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        updateSlotDisabledState(i, checkbox.checked);
        saveAudioSourceConfig();
      });
    }
  }

  // Device dropdowns
  for (let i = 0; i < 3; i++) {
    const select = document.getElementById(`audioSourceDevice${i}`);
    if (select) {
      select.addEventListener('change', () => saveAudioSourceConfig());
    }
  }

  // Volume sliders
  for (let i = 0; i < 3; i++) {
    const slider = document.getElementById(`audioSourceVolume${i}`);
    const label = document.getElementById(`audioSourceVolumeLabel${i}`);
    if (slider) {
      slider.addEventListener('input', () => {
        if (label) label.textContent = `${slider.value}%`;
      });
      slider.addEventListener('change', () => {
        if (label) label.textContent = `${slider.value}%`;
        saveAudioSourceConfig();
      });
    }
  }

  // Auto-balance checkbox
  if (audioMixerAutoBalance) {
    audioMixerAutoBalance.addEventListener('change', () => saveAudioSourceConfig());
  }

  // Test recording button
  if (audioTestRecordBtn) {
    audioTestRecordBtn.addEventListener('click', async () => {
      if (!window.electronAPI?.audioDevicesTest) return;

      audioTestRecordBtn.disabled = true;
      if (audioTestStatus) audioTestStatus.textContent = 'Recording 3 seconds...';
      if (audioTestPlayback) audioTestPlayback.style.display = 'none';

      try {
        const result = await window.electronAPI.audioDevicesTest();
        if (result.success) {
          if (audioTestStatus) audioTestStatus.textContent = 'Done!';
          if (audioTestPlayer && audioTestPlayback) {
            audioTestPlayer.src = `file://${result.filePath.replace(/\\/g, '/')}`;
            audioTestPlayback.style.display = '';
          }
        } else {
          if (audioTestStatus) audioTestStatus.textContent = result.error || 'Test failed';
        }
      } catch (err) {
        if (audioTestStatus) audioTestStatus.textContent = 'Error: ' + err.message;
      } finally {
        audioTestRecordBtn.disabled = false;
      }
    });
  }

  // Show/hide audio sources when recording provider changes
  if (recordingProviderSelect) {
    recordingProviderSelect.addEventListener('change', () => updateAudioSourcesVisibility());
  }
```

- [ ] **Step 4: Call visibility check from `loadSettingsIntoUI`**

In `loadSettingsIntoUI()`, after `checkLocalLLMStatus();` (around line 851), add:

```javascript
    // v2.0: Show/hide audio sources section based on recording provider
    // Delay so recording provider dropdown is populated from appSettings first
    setTimeout(() => updateAudioSourcesVisibility(), 100);
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings.js
git commit -m "feat(ui): wire audio source controls -- device dropdowns, volume sliders, test recording"
```

---

## Task 7: Lint and Integration Verification

**Files:** All modified files

- [ ] **Step 1: Run linter**

Run: `npm run lint`
Expected: 0 warnings, 0 errors. Fix any issues that arise.

- [ ] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass, including new `buildFFmpegArgs` tests and existing `LocalProvider` tests.

- [ ] **Step 3: Manual smoke test**

Run: `npm start`

Verify:
1. Open Settings > General tab
2. Recording Provider dropdown shows "Local" option
3. Select "Local" -- "Local Recording Sources" section appears
4. Click "Refresh Devices" -- device dropdowns populate with system audio devices
5. Slot 1 (Microphone) auto-selects a mic device
6. Slot 2 (System Audio) auto-selects Stereo Mix or loopback
7. Volume sliders respond to drag, label updates in real-time
8. Disable Slot 3 checkbox -- dropdown and slider grey out
9. Click "Test Recording" -- status shows "Recording 3 seconds...", then "Done!"
10. Audio player appears -- press play to hear mixed audio from configured sources
11. Switch Recording Provider back to "Recall" -- audio sources section hides
12. Switch back to "Local" -- section reappears with saved values

- [ ] **Step 4: Fix any issues and commit**

Only if fixes were needed from steps 1-3:

```bash
git add -A
git commit -m "fix: lint and integration fixes for audio mixer"
```
