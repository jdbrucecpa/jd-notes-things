# WASAPI Loopback Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WASAPI loopback capture so output devices (speakers, Sonar channels) appear as selectable audio sources and can be recorded alongside mic input.

**Architecture:** `native-recorder-nodejs` captures audio from output devices via WASAPI loopback, streams raw PCM through Windows named pipes to FFmpeg, which mixes all sources (dshow mic + WASAPI outputs) into a single MP3. A new `WasapiCapture` module wraps the npm package and manages pipe lifecycle.

**Tech Stack:** native-recorder-nodejs (N-API, prebuilt binaries), Windows named pipes (Node.js `net` module), FFmpeg amix, Vitest

**Design spec:** `docs/superpowers/specs/2026-04-05-wasapi-loopback-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `native-recorder-nodejs` dependency |
| `src/main/recording/WasapiCapture.js` | Create | Wraps native-recorder-nodejs, manages named pipes and AudioRecorder instances |
| `tests/unit/wasapiCapture.test.js` | Create | Unit tests for WasapiCapture (mocked native-recorder-nodejs) |
| `src/main/recording/buildFFmpegArgs.js` | Modify | Handle `wasapi` source type with PCM format args |
| `tests/unit/buildFFmpegArgs.test.js` | Modify | Add mixed source type tests |
| `src/main/recording/LocalProvider.js` | Modify | Start/stop WasapiCapture instances, merge device lists |
| `src/main.js` | Modify | Update audioDevices:list + audioDevices:test for WASAPI sources |
| `src/renderer/settings.js` | Modify | Optgroup for output devices, save/load type+deviceId |

---

## Task 1: Install native-recorder-nodejs

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install native-recorder-nodejs`
Expected: Package installs with prebuilt binaries for Electron 40.x. Check for N-API compilation warnings — there should be none.

- [ ] **Step 2: Verify it loads and lists devices**

Create a temporary test script and run it:

```bash
node -e "const { AudioRecorder } = require('native-recorder-nodejs'); const devices = AudioRecorder.getDevices('output'); console.log(JSON.stringify(devices, null, 2));"
```

Expected: JSON array of output devices including Sonar channels and Atom DAC 2. If this fails, the package isn't compatible — stop and report.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add native-recorder-nodejs for WASAPI loopback capture"
```

---

## Task 2: WasapiCapture Module -- Tests

**Files:**
- Create: `tests/unit/wasapiCapture.test.js`

- [ ] **Step 1: Create test file**

```javascript
// tests/unit/wasapiCapture.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock native-recorder-nodejs before importing WasapiCapture
vi.mock('native-recorder-nodejs', () => {
  const EventEmitter = require('events');

  class MockAudioRecorder extends EventEmitter {
    async start() {}
    async stop() {}
  }

  return {
    AudioRecorder: Object.assign(MockAudioRecorder, {
      getDevices: vi.fn(() => [
        { id: 'device-1', name: 'Sonar - Chat (Virtual Audio)', type: 'output', isDefault: false },
        { id: 'device-2', name: 'Headphones (Atom DAC 2)', type: 'output', isDefault: true },
      ]),
      getDeviceFormat: vi.fn(() => ({
        sampleRate: 48000,
        channels: 2,
        bitDepth: 16,
        rawBitDepth: 32,
      })),
    }),
  };
});

import { WasapiCapture } from '../../src/main/recording/WasapiCapture.js';

describe('WasapiCapture', () => {
  describe('getOutputDevices', () => {
    it('returns output devices from native-recorder-nodejs', async () => {
      const devices = await WasapiCapture.getOutputDevices();

      expect(devices).toHaveLength(2);
      expect(devices[0]).toEqual({
        name: 'Sonar - Chat (Virtual Audio)',
        deviceId: 'device-1',
        isDefault: false,
      });
      expect(devices[1]).toEqual({
        name: 'Headphones (Atom DAC 2)',
        deviceId: 'device-2',
        isDefault: true,
      });
    });
  });

  describe('getDeviceFormat', () => {
    it('returns PCM format for a device', async () => {
      const format = await WasapiCapture.getDeviceFormat('device-1');

      expect(format).toEqual({
        sampleRate: 48000,
        channels: 2,
        bitDepth: 16,
      });
    });
  });

  describe('pipe path generation', () => {
    it('generates deterministic pipe paths', () => {
      const capture = new WasapiCapture();
      expect(capture._pipePath(0)).toBe('\\\\.\\pipe\\jdnotes_wasapi_0');
      expect(capture._pipePath(1)).toBe('\\\\.\\pipe\\jdnotes_wasapi_1');
    });
  });

  describe('lifecycle', () => {
    let capture;

    beforeEach(() => {
      capture = new WasapiCapture();
    });

    it('starts in stopped state', () => {
      expect(capture.isCapturing).toBe(false);
    });

    it('reports capturing after start', async () => {
      // start() creates a named pipe server and AudioRecorder
      // In test, the pipe won't actually be connected to FFmpeg,
      // but the state should update
      const result = await capture.start('device-1', 0);

      expect(result.pipePath).toBe('\\\\.\\pipe\\jdnotes_wasapi_0');
      expect(result.sampleRate).toBe(48000);
      expect(result.channels).toBe(2);
      expect(capture.isCapturing).toBe(true);

      // Clean up
      await capture.stop();
      expect(capture.isCapturing).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/wasapiCapture.test.js`
Expected: FAIL — module `../../src/main/recording/WasapiCapture.js` does not exist

- [ ] **Step 3: Commit**

```bash
git add tests/unit/wasapiCapture.test.js
git commit -m "test: add WasapiCapture unit tests (red)"
```

---

## Task 3: WasapiCapture Module -- Implementation

**Files:**
- Create: `src/main/recording/WasapiCapture.js`

- [ ] **Step 1: Implement WasapiCapture**

```javascript
// src/main/recording/WasapiCapture.js
const { EventEmitter } = require('events');
const net = require('net');

let nativeRecorder;
try {
  nativeRecorder = require('native-recorder-nodejs');
} catch {
  // native-recorder-nodejs not installed — graceful degradation
  nativeRecorder = null;
}

/**
 * Wraps native-recorder-nodejs for WASAPI loopback capture.
 * Manages named pipes to stream PCM data to FFmpeg.
 */
class WasapiCapture extends EventEmitter {
  constructor() {
    super();
    this._recorder = null;
    this._pipeServer = null;
    this._pipeClient = null;
    this.isCapturing = false;
  }

  /**
   * Check if native-recorder-nodejs is available.
   * @returns {boolean}
   */
  static isAvailable() {
    return nativeRecorder !== null;
  }

  /**
   * Enumerate output audio devices via WASAPI.
   * @returns {Promise<Array<{name: string, deviceId: string, isDefault: boolean}>>}
   */
  static async getOutputDevices() {
    if (!nativeRecorder) return [];
    const devices = nativeRecorder.AudioRecorder.getDevices('output');
    return devices.map(d => ({
      name: d.name,
      deviceId: d.id,
      isDefault: d.isDefault || false,
    }));
  }

  /**
   * Get PCM format for a specific device.
   * @param {string} deviceId
   * @returns {Promise<{sampleRate: number, channels: number, bitDepth: number}>}
   */
  static async getDeviceFormat(deviceId) {
    if (!nativeRecorder) throw new Error('native-recorder-nodejs not available');
    const format = nativeRecorder.AudioRecorder.getDeviceFormat(deviceId);
    return {
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitDepth: format.bitDepth,
    };
  }

  /**
   * Generate a named pipe path for a given index.
   * @param {number} index
   * @returns {string}
   */
  _pipePath(index) {
    return `\\\\.\\pipe\\jdnotes_wasapi_${index}`;
  }

  /**
   * Start capturing from a WASAPI output device.
   * Creates a named pipe server and begins streaming PCM data.
   *
   * @param {string} deviceId — WASAPI device identifier
   * @param {number} pipeIndex — index for named pipe path (0, 1, 2)
   * @returns {Promise<{pipePath: string, sampleRate: number, channels: number}>}
   */
  async start(deviceId, pipeIndex) {
    if (!nativeRecorder) throw new Error('native-recorder-nodejs not available');
    if (this.isCapturing) throw new Error('WasapiCapture: already capturing');

    const format = await WasapiCapture.getDeviceFormat(deviceId);
    const pipePath = this._pipePath(pipeIndex);

    // Create named pipe server
    await new Promise((resolve, reject) => {
      this._pipeServer = net.createServer((client) => {
        this._pipeClient = client;
        client.on('error', () => {
          // FFmpeg disconnected — expected on stop
        });
      });

      this._pipeServer.on('error', (err) => {
        this.emit('error', { type: 'pipe-error', message: err.message });
        reject(err);
      });

      this._pipeServer.listen(pipePath, () => {
        resolve();
      });
    });

    // Create and start AudioRecorder
    this._recorder = new nativeRecorder.AudioRecorder();

    this._recorder.on('data', (buffer) => {
      if (this._pipeClient && !this._pipeClient.destroyed) {
        this._pipeClient.write(buffer);
      }
    });

    this._recorder.on('error', (err) => {
      this.emit('error', { type: 'wasapi-error', message: err.message });
    });

    await this._recorder.start({ deviceType: 'output', deviceId });
    this.isCapturing = true;

    return { pipePath, sampleRate: format.sampleRate, channels: format.channels };
  }

  /**
   * Stop capture and clean up pipe.
   */
  async stop() {
    this.isCapturing = false;

    if (this._recorder) {
      try {
        await this._recorder.stop();
      } catch {
        // Recorder may already be stopped
      }
      this._recorder.removeAllListeners();
      this._recorder = null;
    }

    if (this._pipeClient) {
      this._pipeClient.destroy();
      this._pipeClient = null;
    }

    if (this._pipeServer) {
      this._pipeServer.close();
      this._pipeServer = null;
    }
  }
}

module.exports = { WasapiCapture };
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/wasapiCapture.test.js`
Expected: All tests PASS

- [ ] **Step 3: Run linter**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 4: Commit**

```bash
git add src/main/recording/WasapiCapture.js
git commit -m "feat(recording): add WasapiCapture module for WASAPI loopback via named pipes"
```

---

## Task 4: buildFFmpegArgs -- WASAPI Source Type Support

**Files:**
- Modify: `tests/unit/buildFFmpegArgs.test.js`
- Modify: `src/main/recording/buildFFmpegArgs.js`

- [ ] **Step 1: Add tests for wasapi source type**

Append these tests inside the existing `describe('buildFFmpegArgs', ...)` block in `tests/unit/buildFFmpegArgs.test.js`:

```javascript
  // WASAPI source type tests
  it('wasapi source -- uses PCM format args instead of dshow', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 48000, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('-f');
    expect(args).toContain('s16le');
    expect(args).toContain('-ar');
    expect(args).toContain('48000');
    expect(args).toContain('-ac');
    expect(args).toContain('2');
    expect(args).not.toContain('dshow');
    expect(args).not.toContain('-filter_complex');
  });

  it('mixed dshow + wasapi sources -- correct args for both', () => {
    const sources = [
      { device: 'Mic (USB)', volume: 100, type: 'dshow' },
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 80, type: 'wasapi', sampleRate: 48000, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    // First input: dshow
    const firstFIdx = args.indexOf('-f');
    expect(args[firstFIdx + 1]).toBe('dshow');

    // Second input: s16le
    const secondFIdx = args.indexOf('-f', firstFIdx + 1);
    expect(args[secondFIdx + 1]).toBe('s16le');

    // Has amix
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('amix=inputs=2');
  });

  it('wasapi source without type field -- defaults to dshow (backward compat)', () => {
    const sources = [{ device: 'Mic', volume: 100 }];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).toContain('dshow');
    expect(args).not.toContain('s16le');
  });

  it('all wasapi sources -- no dshow args at all', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 48000, channels: 2 },
      { device: '\\\\.\\pipe\\jdnotes_wasapi_1', volume: 100, type: 'wasapi', sampleRate: 44100, channels: 2 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    expect(args).not.toContain('dshow');
    expect(args.filter(a => a === 's16le').length).toBe(2);
  });

  it('wasapi source includes -ar and -ac before pipe path', () => {
    const sources = [
      { device: '\\\\.\\pipe\\jdnotes_wasapi_0', volume: 100, type: 'wasapi', sampleRate: 44100, channels: 1 },
    ];
    const args = buildFFmpegArgs(sources, defaultMixer, 'output.mp3');

    const fIdx = args.indexOf('-f');
    expect(args[fIdx + 1]).toBe('s16le');
    const arIdx = args.indexOf('-ar');
    expect(args[arIdx + 1]).toBe('44100');
    const acIdx = args.indexOf('-ac');
    expect(args[acIdx + 1]).toBe('1');
    // -i comes after format args
    const iIdx = args.indexOf('-i');
    expect(iIdx).toBeGreaterThan(acIdx);
  });
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run tests/unit/buildFFmpegArgs.test.js`
Expected: New wasapi tests FAIL (buildFFmpegArgs doesn't handle `type: 'wasapi'` yet), existing tests still PASS

- [ ] **Step 3: Update buildFFmpegArgs to handle wasapi sources**

Replace the input source loop in `src/main/recording/buildFFmpegArgs.js` (lines 19-25). The current code is:

```javascript
  // Add input sources
  for (const source of sources) {
    if (!source.device) {
      throw new Error('buildFFmpegArgs: all sources must have a non-null device');
    }
    args.push('-f', 'dshow', '-i', `audio=${source.device}`);
  }
```

Replace with:

```javascript
  // Add input sources
  for (const source of sources) {
    if (!source.device) {
      throw new Error('buildFFmpegArgs: all sources must have a non-null device');
    }
    const sourceType = source.type || 'dshow';
    if (sourceType === 'wasapi') {
      // WASAPI loopback: raw PCM via named pipe
      args.push(
        '-f', 's16le',
        '-ar', String(source.sampleRate || 48000),
        '-ac', String(source.channels || 2),
        '-i', source.device
      );
    } else {
      // DirectShow input device (mic, stereo mix, etc.)
      args.push('-f', 'dshow', '-i', `audio=${source.device}`);
    }
  }
```

- [ ] **Step 4: Run all buildFFmpegArgs tests**

Run: `npx vitest run tests/unit/buildFFmpegArgs.test.js`
Expected: All tests PASS (existing 13 + new 5 = 18 total)

- [ ] **Step 5: Run linter**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 6: Commit**

```bash
git add src/main/recording/buildFFmpegArgs.js tests/unit/buildFFmpegArgs.test.js
git commit -m "feat(recording): add wasapi source type support to buildFFmpegArgs"
```

---

## Task 5: LocalProvider -- WASAPI Integration

**Files:**
- Modify: `src/main/recording/LocalProvider.js`

- [ ] **Step 1: Add WasapiCapture require**

After the `buildFFmpegArgs` require (line 5), add:

```javascript
const { WasapiCapture } = require('./WasapiCapture');
```

- [ ] **Step 2: Add WASAPI capture tracking to constructor**

In the constructor, after `this._audioMixer = { autoBalance: false };` (line 34), add:

```javascript
    this._wasapiCaptures = []; // Active WasapiCapture instances during recording
```

- [ ] **Step 3: Update `_enumerateDevices` to merge WASAPI output devices**

At the end of the `_enumerateDevices` method, just before `resolve(devices);` (line 376), add:

```javascript
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
```

Note: Since this is inside a Promise callback that uses `resolve()`, you need to make the callback `async`. Change `ff.on('close', () => {` to `ff.on('close', async () => {`.

- [ ] **Step 4: Update `_startFFmpeg` to handle WASAPI sources**

Replace the `_startFFmpeg` method. The current version (starting around line 399) needs to be replaced with:

```javascript
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

      ffmpegArgs = buildFFmpegArgs(resolvedSources, this._audioMixer, outputPath);
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
      // Stop all WASAPI captures
      this._stopWasapiCaptures();
      this.emit('recording-ended', { recordingId, audioFilePath, exitCode: code });
    });

    this._ffmpegProcess.on('error', (err) => {
      this.emit('error', { type: 'ffmpeg-error', message: err.message });
    });

    this._ffmpegProcess.stderr.on('data', (_chunk) => {
      // FFmpeg writes its progress to stderr -- suppress for now.
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
```

- [ ] **Step 5: Update `shutdown` to clean up WASAPI captures**

In the `shutdown()` method (around line 123), add before the existing code:

```javascript
    // Stop any active WASAPI captures
    await this._stopWasapiCaptures();
```

- [ ] **Step 6: Run existing tests**

Run: `npx vitest run tests/unit/LocalProvider.test.js`
Expected: All 11 existing tests PASS

- [ ] **Step 7: Run linter**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 8: Commit**

```bash
git add src/main/recording/LocalProvider.js
git commit -m "feat(recording): integrate WasapiCapture into LocalProvider for output device loopback"
```

---

## Task 6: IPC and Settings UI Updates

**Files:**
- Modify: `src/main.js`
- Modify: `src/renderer/settings.js`

- [ ] **Step 1: Update `audioDevices:list` IPC handler**

In `src/main.js`, find the `audioDevices:list` handler (line 8568). Replace the handler body:

```javascript
ipcMain.handle('audioDevices:list', async () => {
  try {
    // Always get dshow devices
    let devices = [];
    if (recordingProvider && typeof recordingProvider._enumerateDevices === 'function') {
      devices = await recordingProvider._enumerateDevices();
    } else {
      const tempProvider = new LocalProvider();
      devices = await tempProvider._enumerateDevices();
      await tempProvider.shutdown();
    }
    return { success: true, devices };
  } catch (error) {
    logger.ipc.error('[IPC] audioDevices:list failed:', error);
    return { success: false, devices: [], error: error.message };
  }
});
```

Note: `_enumerateDevices` now returns both dshow AND wasapi devices (merged in Task 5 step 3), so the IPC handler doesn't need to change its return structure — just the devices array is richer.

- [ ] **Step 2: Update `audioDevices:test` IPC handler to support WASAPI sources**

In `src/main.js`, find the `audioDevices:test` handler (line 8585). Replace it:

```javascript
ipcMain.handle('audioDevices:test', async () => {
  try {
    const { buildFFmpegArgs } = require('./main/recording/buildFFmpegArgs');
    const { WasapiCapture } = require('./main/recording/WasapiCapture');

    const sources = (appSettings.audioSources || [])
      .filter(s => s.enabled && s.device)
      .map(s => ({
        device: s.device,
        volume: s.volume,
        type: s.type || 'dshow',
        deviceId: s.deviceId || null,
      }));

    if (sources.length === 0) {
      return { success: false, error: 'No audio sources configured' };
    }

    const testFile = path.join(
      RECORDING_PATH,
      `test-recording-${Date.now()}.mp3`
    );

    // Start WASAPI captures for output sources
    const wasapiCaptures = [];
    const resolvedSources = [];
    let pipeIndex = 0;

    for (const source of sources) {
      if (source.type === 'wasapi' && source.deviceId) {
        const capture = new WasapiCapture();
        const { pipePath, sampleRate, channels } = await capture.start(source.deviceId, pipeIndex);
        wasapiCaptures.push(capture);
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

    const ffmpegArgs = buildFFmpegArgs(
      resolvedSources,
      appSettings.audioMixer || { autoBalance: false },
      testFile
    );
    // Insert -t 3 after the last -i argument to limit to 3 seconds
    const lastInputIdx = ffmpegArgs.lastIndexOf('-i');
    const insertIdx = lastInputIdx + 2;
    ffmpegArgs.splice(insertIdx, 0, '-t', '3');

    return new Promise((resolve) => {
      const ff = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
      let ffmpegStderr = '';
      ff.stderr.on('data', (chunk) => { ffmpegStderr += chunk; });

      ff.on('close', async (code) => {
        // Clean up WASAPI captures
        for (const c of wasapiCaptures) {
          try { await c.stop(); } catch { /* ignore */ }
        }

        if (code === 0) {
          resolve({ success: true, filePath: testFile });
        } else {
          const detail = ffmpegStderr.slice(-300).trim();
          resolve({ success: false, error: `FFmpeg exited with code ${code}`, detail });
        }
      });

      ff.on('error', async (err) => {
        for (const c of wasapiCaptures) {
          try { await c.stop(); } catch { /* ignore */ }
        }
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    logger.ipc.error('[IPC] audioDevices:test failed:', error);
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 3: Update `refreshAudioDevices` in settings.js to show optgroups**

In `src/renderer/settings.js`, find the `refreshAudioDevices` function (line 802). Replace the dropdown population loop (the `for (let i = 0; i < 3; i++)` block, lines 822-847) with:

```javascript
      // Separate input and output devices
      const inputDevices = result.devices.filter(d => d.type !== 'wasapi');
      const outputDevices = result.devices.filter(d => d.type === 'wasapi');

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

        // Input devices
        if (inputDevices.length > 0) {
          const inputGroup = document.createElement('optgroup');
          inputGroup.label = 'Input Devices';
          for (const device of inputDevices) {
            const opt = document.createElement('option');
            opt.value = device.name;
            opt.textContent = device.name;
            opt.dataset.type = 'dshow';
            inputGroup.appendChild(opt);
          }
          select.appendChild(inputGroup);
        }

        // Output devices (WASAPI loopback)
        if (outputDevices.length > 0) {
          const outputGroup = document.createElement('optgroup');
          outputGroup.label = 'Output Devices (Loopback)';
          for (const device of outputDevices) {
            const opt = document.createElement('option');
            opt.value = device.name;
            opt.textContent = device.name;
            opt.dataset.type = 'wasapi';
            opt.dataset.deviceId = device.deviceId || '';
            outputGroup.appendChild(opt);
          }
          select.appendChild(outputGroup);
        }

        // Restore previous selection if it still exists
        if (currentValue && result.devices.some(d => d.name === currentValue)) {
          select.value = currentValue;
        }
      }
```

- [ ] **Step 4: Update `saveAudioSourceConfig` to include type and deviceId**

In `src/renderer/settings.js`, find `saveAudioSourceConfig` (line 904). Replace the loop body:

```javascript
  function saveAudioSourceConfig() {
    const audioSources = [];
    for (let i = 0; i < 3; i++) {
      const checkbox = document.getElementById(`audioSourceEnabled${i}`);
      const select = document.getElementById(`audioSourceDevice${i}`);
      const slider = document.getElementById(`audioSourceVolume${i}`);

      // Get type and deviceId from the selected option's dataset
      const selectedOption = select?.selectedOptions?.[0];
      const type = selectedOption?.dataset?.type || 'dshow';
      const deviceId = selectedOption?.dataset?.deviceId || null;

      audioSources.push({
        label: SLOT_LABELS[i],
        device: select?.value || null,
        type: type,
        deviceId: deviceId,
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
```

- [ ] **Step 5: Update `applyAudioSourceDefaults` to prefer WASAPI output for slot 2**

In `src/renderer/settings.js`, find `applyAudioSourceDefaults` (line 855). Replace the auto-select logic (after the `if (hasSavedConfig) return;` line):

```javascript
    const micDevice = devices.find(d => d.isMicrophone);
    // Prefer WASAPI default output device, fall back to dshow loopback
    const systemDevice = devices.find(d => d.type === 'wasapi' && d.isDefault)
      || devices.find(d => d.isLoopback);

    const select0 = document.getElementById('audioSourceDevice0');
    if (select0 && micDevice) select0.value = micDevice.name;

    const select1 = document.getElementById('audioSourceDevice1');
    if (select1 && systemDevice) select1.value = systemDevice.name;

    saveAudioSourceConfig();
```

- [ ] **Step 6: Run linter**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/renderer/settings.js
git commit -m "feat(recording): update IPC and settings UI for WASAPI output device selection"
```

---

## Task 7: Lint and Integration Verification

**Files:** All modified files

- [ ] **Step 1: Run linter**

Run: `npm run lint`
Expected: 0 warnings, 0 errors

- [ ] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass, including new WasapiCapture tests and updated buildFFmpegArgs tests

- [ ] **Step 3: Manual smoke test**

Run: `npm start`

Verify:
1. Open Settings > General tab
2. Select "Local" recording provider
3. "Local Recording Sources" section appears
4. Click "Refresh Devices" — dropdowns show TWO groups: "Input Devices" and "Output Devices (Loopback)"
5. Output devices include Sonar channels (Chat, Gaming, Media) and Headphones (Atom DAC 2)
6. Set Slot 1 to SteelSeries Alias Pro Input (mic)
7. Set Slot 2 to SteelSeries Sonar - Chat (output loopback)
8. Click "Test Recording" — play audio through a chat-routed app during the 3 seconds
9. Playback should contain both mic audio and the chat channel audio
10. Switch to Recall provider — section hides
11. Switch back to Local — section reappears with saved selections

- [ ] **Step 4: Fix any issues and commit**

Only if fixes were needed:

```bash
git add -A
git commit -m "fix: lint and integration fixes for WASAPI loopback"
```
