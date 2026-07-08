// tests/unit/wasapiCapture.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { WasapiCapture } = await import('../../src/main/recording/WasapiCapture.js');

// Build mock native module and inject it
class MockAudioRecorder extends EventEmitter {
  async start() {}
  async stop() {}
}

MockAudioRecorder.getDevices = vi.fn(() => [
  {
    id: 'device-1',
    name: 'Sonar - Chat (Virtual Audio)',
    type: 'output',
    isDefault: false,
  },
  {
    id: 'device-2',
    name: 'Headphones (Atom DAC 2)',
    type: 'output',
    isDefault: true,
  },
]);

MockAudioRecorder.getDeviceFormat = vi.fn(() => ({
  sampleRate: 48000,
  channels: 2,
  bitDepth: 16,
  rawBitDepth: 32,
}));

const mockNativeModule = { AudioRecorder: MockAudioRecorder };

describe('WasapiCapture', () => {
  beforeEach(() => {
    WasapiCapture._setNativeModule(mockNativeModule);
  });

  describe('getOutputDevices', () => {
    it('returns output devices from native-recorder-nodejs', async () => {
      const devices = await WasapiCapture.getOutputDevices();

      expect(devices).toHaveLength(2);
      expect(devices[0]).toEqual({
        name: 'Sonar - Chat (Virtual Audio)',
        deviceId: 'device-1',
        isDefault: false,
      });
      expect(devices[1]).toEqual({
        name: 'Headphones (Atom DAC 2)',
        deviceId: 'device-2',
        isDefault: true,
      });
    });
  });

  describe('getDeviceFormat', () => {
    it('returns PCM format for a device', async () => {
      const format = await WasapiCapture.getDeviceFormat('device-1');

      expect(format).toEqual({
        sampleRate: 48000,
        channels: 2,
        bitDepth: 16,
      });
    });
  });

  describe('pipe path generation', () => {
    it('generates deterministic pipe paths', () => {
      const capture = new WasapiCapture();
      expect(capture._pipePath(0)).toBe('\\\\.\\pipe\\jdnotes_wasapi_0');
      expect(capture._pipePath(1)).toBe('\\\\.\\pipe\\jdnotes_wasapi_1');
    });
  });

  describe('lifecycle', () => {
    let capture;

    beforeEach(() => {
      capture = new WasapiCapture();
    });

    it('starts in stopped state', () => {
      expect(capture.isCapturing).toBe(false);
    });

    it('reports capturing after start', async () => {
      const result = await capture.start('device-1', 0);

      expect(result.pipePath).toBe('\\\\.\\pipe\\jdnotes_wasapi_0');
      expect(result.sampleRate).toBe(48000);
      expect(result.channels).toBe(2);
      expect(capture.isCapturing).toBe(true);

      await capture.stop();
      expect(capture.isCapturing).toBe(false);
    });
  });

  // Silence pacing keeps the pipe fed at real-time byte-rate so a silent WASAPI
  // output source never starves FFmpeg (which otherwise blocks on the empty pipe
  // read → 0-byte recording + can't stop cleanly).
  describe('silence pacing (_computeSilenceDeficit)', () => {
    let capture;

    beforeEach(() => {
      capture = new WasapiCapture();
      // 48 kHz stereo 16-bit → 192000 B/s, 4 bytes/frame.
      capture._byteRate = 48000 * 2 * 2;
      capture._frameBytes = 2 * 2;
      capture._bytesWritten = 0;
    });

    it('fills the full real-time deficit when no real data has arrived', () => {
      expect(capture._computeSilenceDeficit(1000)).toBe(192000);
    });

    it('returns 0 when real data has kept the pipe caught up', () => {
      capture._bytesWritten = 192000;
      expect(capture._computeSilenceDeficit(1000)).toBe(0);
    });

    it('fills only the shortfall when real data partially kept up', () => {
      capture._bytesWritten = 96000;
      expect(capture._computeSilenceDeficit(1000)).toBe(96000);
    });

    it('caps a large gap at ~1 second of silence per call', () => {
      expect(capture._computeSilenceDeficit(5000)).toBe(192000);
    });

    it('aligns silence to whole audio frames', () => {
      capture._bytesWritten = 1; // force a non-frame-aligned deficit
      const deficit = capture._computeSilenceDeficit(1000);
      expect(deficit % capture._frameBytes).toBe(0);
      expect(deficit).toBe(191996);
    });

    it('returns 0 before the byte-rate is known', () => {
      capture._byteRate = 0;
      capture._frameBytes = 0;
      expect(capture._computeSilenceDeficit(1000)).toBe(0);
    });
  });
});
