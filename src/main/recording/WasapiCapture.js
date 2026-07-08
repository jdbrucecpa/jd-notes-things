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

    // Silence pacing. WASAPI output-loopback emits NO data while the device is
    // idle (nothing playing). FFmpeg reads this pipe as a live input and blocks
    // on the empty read, stalling the whole recording (0-byte file) and even
    // preventing a clean 'q' stop. To avoid starvation we keep the pipe fed at
    // the device's real-time byte-rate: real PCM when it arrives, zero-filled
    // silence for any deficit.
    this._silenceInterval = null;
    this._byteRate = 0; // bytes/sec of this device's PCM format
    this._frameBytes = 0; // bytes per audio frame (channels * bytesPerSample)
    this._bytesWritten = 0; // bytes sent to the pipe since the client connected
    this._pacingStart = 0; // Date.now() when FFmpeg connected to the pipe
    this._silenceTickMs = 100;
  }

  /**
   * Override the native module (for testing).
   * @param {object|null} mod
   */
  static _setNativeModule(mod) {
    nativeRecorder = mod;
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
    return devices.map((d) => ({
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

    // Precompute the PCM byte-rate so silence pacing can match real time.
    const bytesPerSample = Math.max(1, Math.floor((format.bitDepth || 16) / 8));
    this._frameBytes = Math.max(1, format.channels * bytesPerSample);
    this._byteRate = format.sampleRate * this._frameBytes;

    // Create named pipe server
    await new Promise((resolve, reject) => {
      this._pipeServer = net.createServer((client) => {
        this._pipeClient = client;
        // Anchor the pacing clock to when FFmpeg actually starts reading.
        this._bytesWritten = 0;
        this._pacingStart = Date.now();
        this._startSilencePacing();
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
        this._bytesWritten += buffer.length;
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
   * How many bytes of silence to write to catch the pipe up to real time.
   * Pure/testable: no I/O. Aligns to whole frames and caps at ~1s of silence
   * per call so a stalled clock can't emit an unbounded buffer.
   * @param {number} elapsedMs - ms since the FFmpeg client connected
   * @returns {number} silence bytes to write (0 if already caught up)
   */
  _computeSilenceDeficit(elapsedMs) {
    if (!this._byteRate || !this._frameBytes) return 0;
    const expected = Math.floor((elapsedMs / 1000) * this._byteRate);
    let deficit = expected - this._bytesWritten;
    if (deficit <= 0) return 0;
    deficit = Math.min(deficit, this._byteRate); // cap at ~1s
    deficit -= deficit % this._frameBytes; // whole frames only
    return deficit > 0 ? deficit : 0;
  }

  /**
   * Start the real-time silence-fill loop. Runs until stop() clears it.
   */
  _startSilencePacing() {
    if (this._silenceInterval) return;
    this._silenceInterval = setInterval(() => {
      if (!this._pipeClient || this._pipeClient.destroyed) return;
      const deficit = this._computeSilenceDeficit(Date.now() - this._pacingStart);
      if (deficit > 0) {
        this._pipeClient.write(Buffer.alloc(deficit)); // zeros = s16le silence
        this._bytesWritten += deficit;
      }
    }, this._silenceTickMs);
  }

  /**
   * Stop capture and clean up pipe.
   */
  async stop() {
    this.isCapturing = false;

    if (this._silenceInterval) {
      clearInterval(this._silenceInterval);
      this._silenceInterval = null;
    }

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
