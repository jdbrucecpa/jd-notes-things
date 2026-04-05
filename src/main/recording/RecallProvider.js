const { RecordingProvider } = require('./RecordingProvider');

/**
 * Recording provider wrapping the Recall.ai Desktop SDK.
 *
 * Encapsulates all SDK-specific concerns:
 * - SDK init/shutdown with restart workaround for detecting open meetings
 * - Meeting detection via SDK events
 * - Audio recording via SDK + upload tokens
 * - Real-time participant and speech events
 */
class RecallProvider extends RecordingProvider {
  /**
   * @param {object} sdk - Recall.ai Desktop SDK instance
   * @param {object} [options]
   * @param {number} [options.restartDelayMs=3000] - Delay used in the SDK
   *   restart-for-detection workaround. Pass 0 in tests to avoid waiting.
   */
  constructor(sdk, options = {}) {
    super();
    this.sdk = sdk;
    this.sdkReady = false;
    this._recording = false;
    this._restartDelayMs = options.restartDelayMs ?? 3000;
  }

  async initialize(config) {
    // Accept either a raw sdkConfig object or named fields
    let sdkConfig;
    if (config.sdkConfig) {
      sdkConfig = config.sdkConfig;
    } else {
      const { accessToken, userId, realtimeEndpoints } = config;
      sdkConfig = {
        access_token: accessToken,
        user_id: userId,
      };
      if (realtimeEndpoints) {
        sdkConfig.realtime_endpoints = realtimeEndpoints;
      }
    }

    this.sdk.init(sdkConfig);
    this._registerSdkEventHandlers();

    // Workaround: restart SDK to detect already-open meetings
    await this._restartForDetection(sdkConfig);
  }

  async _restartForDetection(sdkConfig) {
    await new Promise(resolve => setTimeout(resolve, this._restartDelayMs));
    await this.sdk.shutdown();
    await new Promise(resolve => setTimeout(resolve, this._restartDelayMs));
    this.sdk.init(sdkConfig);
    this.sdkReady = true;
    this.emit('sdk-ready');
  }

  _registerSdkEventHandlers() {
    this.sdk.addEventListener('meeting-detected', (event) => {
      const win = event.window || event;
      this.emit('meeting-detected', {
        windowId: win.id,
        platform: win.platform,
        title: win.title,
        raw: event,
      });
    });

    this.sdk.addEventListener('meeting-closed', (event) => {
      this.emit('meeting-closed', {
        windowId: event.window?.id || event.windowId,
        raw: event,
      });
    });

    this.sdk.addEventListener('recording-ended', (event) => {
      this._recording = false;
      this.emit('recording-ended', {
        recordingId: event.window?.id || event.windowId || event.recordingId,
        audioFilePath: event.filePath || event.window?.filePath,
        raw: event,
      });
    });

    this.sdk.addEventListener('upload-progress', (event) => {
      this.emit('upload-progress', { raw: event, ...event });
    });

    this.sdk.addEventListener('sdk-state-change', (event) => {
      if (event.state === 'recording') {
        this._recording = true;
        this.emit('recording-started', { recordingId: event.window?.id || event.windowId });
      }
      this.emit('sdk-state-change', { state: event.state, raw: event });
    });

    this.sdk.addEventListener('realtime-event', (event) => {
      if (event.type === 'participant_join') {
        this.emit('participant-joined', {
          windowId: event.windowId,
          participant: event.data,
        });
      } else if (event.type === 'speech_activity') {
        this.emit('speech-activity', {
          windowId: event.windowId,
          participantId: event.data?.participantId,
          speaking: event.data?.speaking,
          timestamp: event.data?.timestamp,
        });
      }
    });

    this.sdk.addEventListener('error', (event) => {
      this.emit('error', {
        type: 'sdk-error',
        message: event.message || String(event),
      });
    });

    this.sdk.addEventListener('permissions-granted', (event) => {
      this.emit('permissions-granted', event);
    });
  }

  async startRecording(options) {
    const key = await this.sdk.prepareDesktopAudioRecording();

    if (options.uploadToken) {
      this.sdk.startRecording({
        windowId: key,
        uploadToken: options.uploadToken,
      });
    }

    this._recording = true;
    return key;
  }

  async stopRecording(recordingId) {
    this.sdk.stopRecording({ windowId: recordingId });
  }

  async shutdown() {
    await this.sdk.shutdown();
    this.sdkReady = false;
  }

  getState() {
    return {
      recording: this._recording,
      meetingDetected: false,
      sdkReady: this.sdkReady,
    };
  }
}

module.exports = { RecallProvider };
