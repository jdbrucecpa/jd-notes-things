import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingManager } from '../../src/main/recording/RecordingManager.js';
import { EventEmitter } from 'events';

class MockProvider extends EventEmitter {
  async initialize() {}
  async startRecording() { return 'rec-123'; }
  async stopRecording() {}
  async shutdown() {}
  getState() { return { recording: false, meetingDetected: false }; }
}

describe('RecordingManager', () => {
  let manager;
  let provider;

  beforeEach(() => {
    provider = new MockProvider();
    manager = new RecordingManager(provider);
  });

  it('starts with no active recordings', () => {
    expect(manager.getActiveRecordings()).toEqual({});
    expect(manager.isRecording).toBe(false);
  });

  it('tracks recording after startRecording', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    expect(manager.isRecording).toBe(true);
    const recordings = manager.getActiveRecordings();
    expect(Object.keys(recordings)).toHaveLength(1);
  });

  it('cleans up after stopRecording', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    const recordingId = Object.keys(manager.getActiveRecordings())[0];
    await manager.stopRecording(recordingId);
    expect(manager.isRecording).toBe(false);
  });

  it('forwards meeting-detected from provider', () => {
    const handler = vi.fn();
    manager.on('meeting-detected', handler);
    provider.emit('meeting-detected', { windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(handler).toHaveBeenCalledWith({ windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(manager.detectedMeeting).toEqual({ windowId: 'w1', platform: 'zoom', title: 'Test' });
  });

  it('forwards recording-ended from provider', () => {
    const handler = vi.fn();
    manager.on('recording-ended', handler);
    provider.emit('recording-ended', { recordingId: 'r1', audioFilePath: '/tmp/a.mp3' });
    expect(handler).toHaveBeenCalled();
  });

  it('clears detectedMeeting on meeting-closed', () => {
    provider.emit('meeting-detected', { windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(manager.detectedMeeting).not.toBeNull();
    provider.emit('meeting-closed', { windowId: 'w1' });
    expect(manager.detectedMeeting).toBeNull();
  });

  it('getForNote finds recording by noteId', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    const found = manager.getForNote('note-1');
    expect(found).not.toBeNull();
    expect(found.noteId).toBe('note-1');
  });

  it('getForNote returns null for unknown noteId', () => {
    expect(manager.getForNote('nonexistent')).toBeNull();
  });

  it('hasActiveRecording checks by recordingId', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    const recordingId = Object.keys(manager.getActiveRecordings())[0];
    expect(manager.hasActiveRecording(recordingId)).toBe(true);
    expect(manager.hasActiveRecording('nonexistent')).toBe(false);
  });

  it('forwards Recall-specific events', () => {
    const handler = vi.fn();
    manager.on('upload-progress', handler);
    provider.emit('upload-progress', { progress: 50 });
    expect(handler).toHaveBeenCalledWith({ progress: 50 });
  });

  it('switchProvider swaps to a new provider', async () => {
    const newProvider = new MockProvider();
    const handler = vi.fn();
    manager.on('provider-switched', handler);

    await manager.switchProvider(newProvider, {});

    expect(manager.provider).toBe(newProvider);
    expect(manager.isRecording).toBe(false);
    expect(manager.detectedMeeting).toBeNull();
    expect(handler).toHaveBeenCalled();

    // New provider events should work
    const meetingHandler = vi.fn();
    manager.on('meeting-detected', meetingHandler);
    newProvider.emit('meeting-detected', { windowId: 'w2', platform: 'teams', title: 'New' });
    expect(meetingHandler).toHaveBeenCalled();
  });

  it('switchProvider stops old provider events', async () => {
    const oldHandler = vi.fn();
    manager.on('meeting-detected', oldHandler);

    const newProvider = new MockProvider();
    await manager.switchProvider(newProvider, {});

    // Old provider events should NOT trigger
    provider.emit('meeting-detected', { windowId: 'old', platform: 'zoom', title: 'Old' });
    expect(oldHandler).not.toHaveBeenCalled();
  });
});
