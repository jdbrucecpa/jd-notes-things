const { EventEmitter } = require('events');

/**
 * Base class for recording providers.
 *
 * Events emitted by all providers:
 *   'meeting-detected'   { windowId, platform, title }
 *   'meeting-closed'     { windowId }
 *   'recording-started'  { recordingId, windowId }
 *   'recording-ended'    { recordingId, audioFilePath }
 *   'error'              { type, message }
 *
 * RecallProvider-only events:
 *   'participant-joined'  { windowId, participant }
 *   'speech-activity'     { windowId, participantId, speaking, timestamp }
 *   'upload-progress'     { recordingId, progress }
 *   'sdk-state-change'    { state }
 */
class RecordingProvider extends EventEmitter {
  async initialize(_config) {
    throw new Error('Subclass must implement initialize()');
  }

  async startRecording(_options) {
    throw new Error('Subclass must implement startRecording()');
  }

  async stopRecording(_recordingId) {
    throw new Error('Subclass must implement stopRecording()');
  }

  async shutdown() {
    throw new Error('Subclass must implement shutdown()');
  }

  getState() {
    return {
      recording: false,
      meetingDetected: false,
      activeRecordings: new Map(),
    };
  }
}

module.exports = { RecordingProvider };
