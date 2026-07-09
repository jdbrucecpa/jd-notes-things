'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { computeSilenceDeficit } = require('./pcmPacing');

let appLoopback;
let nativeInjected = false; // true when tests inject via _setNativeModule
try {
  appLoopback = require('application-loopback');
} catch {
  appLoopback = null; // graceful degradation — capture reports unavailable
}

// PCM format of application-loopback (v1.2.7) capture output.
//
// CONFIRMED from upstream source (not guessed): the native binary hardcodes
// its WASAPI capture format and forces conversion into it regardless of the
// device's mix format. See CLoopbackCapture::ActivateCompleted() in
// https://github.com/WerdoxDev/application-loopback/blob/master/src-cpp/ApplicationLoopback/LoopbackCapture.cpp
// (shipped compiled as bin/win32-x64/ApplicationLoopback.exe in this package):
//   m_CaptureFormat.wFormatTag     = WAVE_FORMAT_PCM;
//   m_CaptureFormat.nChannels      = 2;
//   m_CaptureFormat.nSamplesPerSec = 48000;
//   m_CaptureFormat.wBitsPerSample = 16;
//   AudioClient->Initialize(..., AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, &m_CaptureFormat, ...)
// i.e. 48 kHz / stereo / 16-bit signed PCM, always — AUTOCONVERTPCM makes
// WASAPI itself resample/convert to this format before the bytes ever reach
// the onData callback.
//
// Also confirmed from the same source: OnAudioSampleRequested() calls
// IsBufferSilent(..., -70dB) and skips the stdout fwrite entirely for silent
// buffers — the native binary does NOT emit zero-filled silence, it emits
// nothing at all during quiet periods. This is exactly why this class must
// do its own real-time silence padding (via computeSilenceDeficit) rather
// than relying on chunk cadence to track wall-clock time.
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_FORMAT_CODE = 1; // 1 = PCM int

const WAV_HEADER_BYTES = 44;

// RIFF chunk sizes are uint32 — Buffer.writeUInt32LE THROWS past 0xFFFFFFFF.
// Stop writing data before the header fields can overflow (1 MB headroom).
// At 192000 B/s (48k/2ch/16-bit) this is ~6.2 hours of capture.
const MAX_WAV_DATA_BYTES = 0xffffffff - 1024 * 1024;

/**
 * Captures one process's audio (WASAPI process loopback via
 * application-loopback) into a real-time-paced WAV file. Silence is
 * zero-filled at the format byte rate so the file timeline stays aligned
 * with the concurrently-running FFmpeg recording — required for per-segment
 * RMS comparison in trackAnchorService.
 *
 * Deliberately decoupled from FFmpeg: a capture failure can never stall or
 * corrupt the main recording. Any runtime failure (disk write error, 4GB
 * WAV ceiling) tears down this capture only and surfaces via an 'error'
 * event — same convention as WasapiCapture, wired up by LocalProvider.
 */
class AppLoopbackCapture extends EventEmitter {
  constructor() {
    super();
    this._pid = null;
    this._fd = null;
    this._bytesWritten = 0; // data bytes (excludes header)
    this._pacingStart = 0;
    this._silenceInterval = null;
    this._silenceTickMs = 100;
    this._byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
    this._frameBytes = CHANNELS * BYTES_PER_SAMPLE;
    this.isCapturing = false;
  }

  static _setNativeModule(mod) {
    appLoopback = mod;
    nativeInjected = true;
  }

  static isAvailable() {
    return appLoopback !== null;
  }

  /**
   * Resolve the helper exe that application-loopback spawns. Its index.cjs
   * resolves the exe relative to its own __dirname and spawns it with NO
   * 'error' listener on the ChildProcess — a bad path (e.g. __dirname
   * rewritten to .webpack/main/ by bundling) would crash the whole Electron
   * main process with an unhandled 'error' event. Preflighting existence in
   * start() turns that into a catchable Error instead.
   *
   * Actual layout (verified in the installed package): the exe lives in a
   * platform subfolder — bin/win32-x64/ApplicationLoopback.exe — matching
   * index.cjs's `${platform()}-${arch()}` resolution.
   * @returns {string|null} absolute exe path, or null if unresolvable
   */
  static _helperExePath() {
    try {
      return path.join(
        path.dirname(require.resolve('application-loopback/package.json')),
        'bin',
        `${process.platform}-${process.arch}`,
        'ApplicationLoopback.exe'
      );
    } catch {
      return null;
    }
  }

  /**
   * @param {number|string} pid - meeting app process id
   * @param {string} outputWavPath
   */
  async start(pid, outputWavPath) {
    if (!appLoopback) throw new Error('application-loopback not available');
    if (this.isCapturing) throw new Error('AppLoopbackCapture: already capturing');

    // Preflight the helper exe so a missing binary is a normal throw here,
    // not an unguarded ChildProcess 'error' crash inside the package.
    // Skipped when tests injected a mock native module.
    if (!nativeInjected) {
      const exePath = AppLoopbackCapture._helperExePath();
      if (!exePath || !fs.existsSync(exePath)) {
        throw new Error(`application-loopback helper exe not found: ${exePath}`);
      }
    }

    this._pid = String(pid);
    this._fd = fs.openSync(outputWavPath, 'w');
    this._outputPath = outputWavPath;
    fs.writeSync(this._fd, this._buildWavHeader(0));
    this._bytesWritten = 0;
    this._pacingStart = Date.now();

    try {
      appLoopback.startAudioCapture(this._pid, {
        onData: (chunk) => {
          if (this._fd === null) return;
          if (this._bytesWritten + chunk.length > MAX_WAV_DATA_BYTES) {
            this._failCapture(new Error('AppLoopbackCapture: WAV 4GB limit reached'));
            return;
          }
          try {
            fs.writeSync(this._fd, Buffer.from(chunk));
            this._bytesWritten += chunk.length;
          } catch (err) {
            this._failCapture(err);
          }
        },
      });
    } catch (err) {
      // Native start failed synchronously — release the fd we just opened.
      const fd = this._fd;
      this._fd = null;
      this._pid = null;
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
      throw err;
    }

    this._silenceInterval = setInterval(() => {
      if (this._fd === null) return;
      const deficit = computeSilenceDeficit(
        Date.now() - this._pacingStart,
        this._byteRate,
        this._frameBytes,
        this._bytesWritten
      );
      if (deficit <= 0) return;
      if (this._bytesWritten + deficit > MAX_WAV_DATA_BYTES) {
        this._failCapture(new Error('AppLoopbackCapture: WAV 4GB limit reached'));
        return;
      }
      try {
        fs.writeSync(this._fd, Buffer.alloc(deficit)); // zeros = silence for 16-bit PCM
        this._bytesWritten += deficit;
      } catch (err) {
        this._failCapture(err);
      }
    }, this._silenceTickMs);

    this.isCapturing = true;
  }

  /**
   * Shared teardown for runtime failures (write error, 4GB ceiling).
   * Stops capture WITHOUT attempting further writes, then emits 'error'.
   * The main FFmpeg recording is unaffected — this capture just ends.
   * @param {Error} err
   */
  _failCapture(err) {
    this.isCapturing = false;

    if (this._silenceInterval) {
      clearInterval(this._silenceInterval);
      this._silenceInterval = null;
    }

    if (this._fd !== null) {
      const fd = this._fd;
      this._fd = null; // null FIRST so onData/interval never write again
      try {
        fs.closeSync(fd);
      } catch {
        /* fd may already be dead — that's fine */
      }
    }

    if (this._pid !== null && appLoopback) {
      try {
        appLoopback.stopAudioCapture(this._pid);
      } catch {
        /* already stopped */
      }
      this._pid = null;
    }

    this.emit('error', err);
  }

  async stop() {
    this.isCapturing = false;

    if (this._silenceInterval) {
      clearInterval(this._silenceInterval);
      this._silenceInterval = null;
    }

    if (this._pid !== null && appLoopback) {
      try {
        appLoopback.stopAudioCapture(this._pid);
      } catch {
        /* already stopped */
      }
      this._pid = null;
    }

    if (this._fd !== null) {
      const fd = this._fd;
      this._fd = null;
      // Patch RIFF/data sizes so the WAV is well-formed. Clamp to uint32
      // (writeUInt32LE throws past 0xFFFFFFFF). Log-and-continue on any
      // failure — stop() must never throw.
      try {
        const riff = Buffer.alloc(4);
        riff.writeUInt32LE(Math.min(WAV_HEADER_BYTES - 8 + this._bytesWritten, 0xffffffff));
        fs.writeSync(fd, riff, 0, 4, 4);
        const dataSize = Buffer.alloc(4);
        dataSize.writeUInt32LE(Math.min(this._bytesWritten, 0xffffffff));
        fs.writeSync(fd, dataSize, 0, 4, 40);
      } catch (err) {
        console.error('[AppLoopbackCapture] Failed to patch WAV header on stop:', err.message);
      }
      try {
        fs.closeSync(fd);
      } catch (err) {
        console.error('[AppLoopbackCapture] Failed to close WAV file on stop:', err.message);
      }
    }
  }

  _buildWavHeader(dataBytes) {
    const h = Buffer.alloc(WAV_HEADER_BYTES);
    h.write('RIFF', 0, 'ascii');
    h.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4);
    h.write('WAVE', 8, 'ascii');
    h.write('fmt ', 12, 'ascii');
    h.writeUInt32LE(16, 16); // fmt chunk size
    h.writeUInt16LE(WAV_FORMAT_CODE, 20);
    h.writeUInt16LE(CHANNELS, 22);
    h.writeUInt32LE(SAMPLE_RATE, 24);
    h.writeUInt32LE(this._byteRate, 28);
    h.writeUInt16LE(this._frameBytes, 32); // block align
    h.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
    h.write('data', 36, 'ascii');
    h.writeUInt32LE(dataBytes, 40);
    return h;
  }
}

module.exports = { AppLoopbackCapture };
