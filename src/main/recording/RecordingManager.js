const { EventEmitter } = require('events');

/**
 * Orchestrates recording providers and coordinates with the app.
 *
 * Owns: active recording tracking, meeting-to-note association,
 * recording state flags. Listens to provider events and re-emits
 * them for the rest of the app to consume.
 */
class RecordingManager extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.recordings = {};
    this.isRecording = false;
    this.detectedMeeting = null;
    this.recordingStartTime = null;
    this.currentMeetingTitle = null;
    this.currentMeetingId = null;

    this._bindProviderEvents();
  }

  _bindProviderEvents() {
    this.provider.on('meeting-detected', (data) => {
      this.detectedMeeting = data;
      this.emit('meeting-detected', data);
    });

    this.provider.on('meeting-closed', (data) => {
      this.detectedMeeting = null;
      this.emit('meeting-closed', data);
    });

    this.provider.on('recording-started', (data) => {
      this.isRecording = true;
      this.recordingStartTime = new Date();
      this.emit('recording-started', data);
    });

    this.provider.on('recording-ended', (data) => {
      const { recordingId } = data;
      this.removeRecording(recordingId);
      this.isRecording = Object.keys(this.recordings).length > 0;
      this.emit('recording-ended', data);
    });

    this.provider.on('error', (data) => {
      this.emit('error', data);
    });

    // Forward Recall-specific events without transformation
    for (const event of ['participant-joined', 'speech-activity', 'upload-progress', 'sdk-state-change']) {
      this.provider.on(event, (data) => this.emit(event, data));
    }
  }

  async initialize(config) {
    return this.provider.initialize(config);
  }

  async startRecording(options) {
    const { noteId, platform } = options;
    const recordingId = await this.provider.startRecording(options);

    this.addRecording(recordingId, noteId, platform);
    this.isRecording = true;
    this.recordingStartTime = new Date();
    this.currentMeetingTitle = options.meetingTitle || null;
    this.currentMeetingId = noteId;

    return recordingId;
  }

  async stopRecording(recordingId) {
    this.updateState(recordingId, 'stopping');
    const result = await this.provider.stopRecording(recordingId);
    this.removeRecording(recordingId);
    this.isRecording = Object.keys(this.recordings).length > 0;
    return result;
  }

  async shutdown() {
    return this.provider.shutdown();
  }

  async switchProvider(newProvider, config) {
    // Shut down old provider
    try {
      await this.provider.shutdown();
    } catch (_err) {
      // Old provider may already be stopped — non-fatal
    }
    this.provider.removeAllListeners();

    // Reset state
    this.recordings = {};
    this.isRecording = false;
    this.detectedMeeting = null;
    this.recordingStartTime = null;
    this.currentMeetingTitle = null;
    this.currentMeetingId = null;

    // Wire new provider
    this.provider = newProvider;
    this._bindProviderEvents();

    // Initialize
    await this.provider.initialize(config);
    this.emit('provider-switched', { provider: newProvider.constructor.name });
  }

  addRecording(recordingId, noteId, platform = 'unknown') {
    this.recordings[recordingId] = {
      noteId,
      platform,
      state: 'recording',
      startTime: new Date(),
    };
  }

  updateState(recordingId, state) {
    if (this.recordings[recordingId]) {
      this.recordings[recordingId].state = state;
      return true;
    }
    return false;
  }

  removeRecording(recordingId) {
    if (this.recordings[recordingId]) {
      delete this.recordings[recordingId];
      return true;
    }
    return false;
  }

  getForNote(noteId) {
    for (const [recordingId, info] of Object.entries(this.recordings)) {
      if (info.noteId === noteId) {
        return { recordingId, ...info };
      }
    }
    return null;
  }

  getActiveRecordings() {
    return { ...this.recordings };
  }

  hasActiveRecording(recordingId) {
    return !!this.recordings[recordingId];
  }

  getState() {
    return {
      isRecording: this.isRecording,
      detectedMeeting: this.detectedMeeting,
      recordingStartTime: this.recordingStartTime,
      currentMeetingTitle: this.currentMeetingTitle,
      currentMeetingId: this.currentMeetingId,
      activeRecordings: this.getActiveRecordings(),
    };
  }
}

module.exports = { RecordingManager };
