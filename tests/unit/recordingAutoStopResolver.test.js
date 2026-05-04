import { describe, it, expect } from 'vitest';
import { resolveMeetingClosedTarget } from '../../src/main/services/recordingAutoStopResolver.js';

describe('resolveMeetingClosedTarget', () => {
  describe('direct match (auto-detect / createMeetingNoteAndRecord path)', () => {
    it('stops the recording when SDK windowId is itself a recording key', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-1',
        activeRecordingKeys: ['win-1'],
      });
      expect(result.recordingToStop).toBe('win-1');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('direct-match');
    });

    it('does not clear detectedMeeting if it points at a different window', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-2',
        activeRecordingKeys: ['win-1'],
      });
      expect(result.recordingToStop).toBe('win-1');
      expect(result.shouldClearDetectedMeeting).toBe(false);
    });

    it('still matches even if other recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'win-1',
        detectedWindowId: 'win-1',
        activeRecordingKeys: ['win-1', 'win-2'],
      });
      expect(result.recordingToStop).toBe('win-1');
    });
  });

  describe('Quirk A: SDK fires meeting-closed with no window.id', () => {
    it('stops the sole active recording (legitimate v1.4.6 case)', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('sdk-no-window-id');
    });

    it('clears detection but stops nothing when no recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: undefined,
        activeRecordingKeys: [],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('sdk-no-window-id-no-active-recordings');
    });

    it('refuses to guess when multiple recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: undefined,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['rec-1', 'rec-2'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('sdk-no-window-id-multiple-active-recordings');
    });

    it('treats null sdkWindowId the same as undefined', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: null,
        detectedWindowId: 'zoom-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.reason).toBe('sdk-no-window-id');
    });
  });

  describe('Calendar / quick-record path: closed window IS the detected meeting', () => {
    it('stops the sole desk-key recording when the detected meeting closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBe('desk-key-abc');
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('closed-was-detected');
    });

    it('clears detection but stops nothing when 0 recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: [],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('closed-was-detected-no-active-recordings');
    });

    it('refuses to guess when multiple recordings are active', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-window-1',
        detectedWindowId: 'teams-window-1',
        activeRecordingKeys: ['rec-a', 'rec-b'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(true);
      expect(result.reason).toBe('closed-was-detected-multiple-active-recordings');
    });
  });

  describe('Quirk B / v1.4.6 regression: unrelated window closes', () => {
    // These tests pin down the specific bug v1.4.6 introduced: a Teams lobby /
    // preview window closing fires meeting-closed with a windowId that does
    // NOT match the recording and is NOT the detected meeting. v1.4.6 stopped
    // the sole active recording anyway. v1.4.7 must NOT.

    it('does not stop the SDK-keyed recording when an unrelated Teams lobby closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-lobby-XYZ',
        detectedWindowId: 'teams-meeting-ABC',
        activeRecordingKeys: ['teams-meeting-ABC'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });

    it('does not stop a desk-key recording when an unrelated window closes', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'teams-lobby-XYZ',
        detectedWindowId: 'teams-meeting-ABC',
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });

    it('does not stop anything when no detected meeting is set and the window is unknown', () => {
      const result = resolveMeetingClosedTarget({
        sdkWindowId: 'unknown-window',
        detectedWindowId: undefined,
        activeRecordingKeys: ['desk-key-abc'],
      });
      expect(result.recordingToStop).toBeNull();
      expect(result.shouldClearDetectedMeeting).toBe(false);
      expect(result.reason).toBe('unrelated-window-closed');
    });
  });
});
