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
});
