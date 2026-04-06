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
