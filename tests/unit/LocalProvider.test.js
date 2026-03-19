import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalProvider } from '../../src/main/recording/LocalProvider.js';

describe('LocalProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new LocalProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('extends RecordingProvider (has EventEmitter + interface methods)', () => {
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.initialize).toBe('function');
    expect(typeof provider.startRecording).toBe('function');
    expect(typeof provider.stopRecording).toBe('function');
    expect(typeof provider.shutdown).toBe('function');
  });

  it('getState returns initial state', () => {
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.meetingDetected).toBe(false);
  });

  it('detectMeeting parses Zoom window title', () => {
    const result = provider._parseMeetingFromTitle('Zoom Meeting', 'zoom.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('zoom');
  });

  it('detectMeeting parses Zoom Webinar title', () => {
    const result = provider._parseMeetingFromTitle('Zoom Webinar', 'zoom.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('zoom');
  });

  it('detectMeeting parses Teams window title', () => {
    const result = provider._parseMeetingFromTitle('Weekly Standup | Microsoft Teams', 'ms-teams.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('teams');
  });

  it('detectMeeting returns null for non-meeting window', () => {
    const result = provider._parseMeetingFromTitle('Visual Studio Code', 'code.exe');
    expect(result).toBeNull();
  });

  it('detectMeeting returns null for empty title', () => {
    const result = provider._parseMeetingFromTitle('', 'unknown.exe');
    expect(result).toBeNull();
  });

  it('detectMeeting returns null for null title', () => {
    const result = provider._parseMeetingFromTitle(null, 'unknown.exe');
    expect(result).toBeNull();
  });
});
