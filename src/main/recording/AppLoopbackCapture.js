'use strict';

const fs = require('fs');
const { computeSilenceDeficit } = require('./pcmPacing');

let appLoopback;
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

/**
 * Captures one process's audio (WASAPI process loopback via
 * application-loopback) into a real-time-paced WAV file. Silence is
 * zero-filled at the format byte rate so the file timeline stays aligned
 * with the concurrently-running FFmpeg recording — required for per-segment
 * RMS comparison in trackAnchorService.
 *
 * Deliberately decoupled from FFmpeg: a capture failure can never stall or
 * corrupt the main recording.
 */
class AppLoopbackCapture {
  constructor() {
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
  }

  static isAvailable() {
    return appLoopback !== null;
  }

  /**
   * @param {number|string} pid - meeting app process id
   * @param {string} outputWavPath
   */
  async start(pid, outputWavPath) {
    if (!appLoopback) throw new Error('application-loopback not available');
    if (this.isCapturing) throw new Error('AppLoopbackCapture: already capturing');

    this._pid = String(pid);
    this._fd = fs.openSync(outputWavPath, 'w');
    this._outputPath = outputWavPath;
    fs.writeSync(this._fd, this._buildWavHeader(0));
    this._bytesWritten = 0;
    this._pacingStart = Date.now();

    appLoopback.startAudioCapture(this._pid, {
      onData: (chunk) => {
        if (this._fd === null) return;
        fs.writeSync(this._fd, Buffer.from(chunk));
        this._bytesWritten += chunk.length;
      },
    });

    this._silenceInterval = setInterval(() => {
      if (this._fd === null) return;
      const deficit = computeSilenceDeficit(
        Date.now() - this._pacingStart,
        this._byteRate,
        this._frameBytes,
        this._bytesWritten
      );
      if (deficit > 0) {
        fs.writeSync(this._fd, Buffer.alloc(deficit)); // zeros = silence for 16-bit PCM
        this._bytesWritten += deficit;
      }
    }, this._silenceTickMs);

    this.isCapturing = true;
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
      // Patch RIFF/data sizes so the WAV is well-formed.
      const riff = Buffer.alloc(4);
      riff.writeUInt32LE(WAV_HEADER_BYTES - 8 + this._bytesWritten);
      fs.writeSync(fd, riff, 0, 4, 4);
      const dataSize = Buffer.alloc(4);
      dataSize.writeUInt32LE(this._bytesWritten);
      fs.writeSync(fd, dataSize, 0, 4, 40);
      fs.closeSync(fd);
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
