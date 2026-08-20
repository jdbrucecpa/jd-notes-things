// tests/unit/resolveWasapiDevice.test.js
import { describe, it, expect } from 'vitest';
import { resolveWasapiDevice } from '../../src/main/recording/resolveWasapiDevice.js';

const DEVICES = [
  { name: 'SteelSeries Sonar - Gaming (SteelSeries Sonar Virtual Audio Device)', deviceId: '{0.0.0.00000000}.{new-gaming}', isDefault: true },
  { name: 'SteelSeries Sonar - Chat (SteelSeries Sonar Virtual Audio Device)', deviceId: '{0.0.0.00000000}.{new-chat}', isDefault: false },
  { name: 'Speakers (Atom DAC 2)', deviceId: '{0.0.0.00000000}.{atom}', isDefault: false },
];

describe('resolveWasapiDevice', () => {
  it('keeps the stored deviceId when it still exists', () => {
    const result = resolveWasapiDevice(DEVICES, {
      device: 'Speakers (Atom DAC 2)',
      deviceId: '{0.0.0.00000000}.{atom}',
    });
    expect(result).toEqual({ deviceId: '{0.0.0.00000000}.{atom}', healed: false });
  });

  it('re-resolves by device name when the stored deviceId is stale', () => {
    const result = resolveWasapiDevice(DEVICES, {
      device: 'SteelSeries Sonar - Gaming (SteelSeries Sonar Virtual Audio Device)',
      deviceId: '{0.0.0.00000000}.{stale-gaming-guid}',
    });
    expect(result).toEqual({ deviceId: '{0.0.0.00000000}.{new-gaming}', healed: true });
  });

  it('re-resolves by name when no deviceId was stored at all', () => {
    const result = resolveWasapiDevice(DEVICES, {
      device: 'SteelSeries Sonar - Chat (SteelSeries Sonar Virtual Audio Device)',
      deviceId: null,
    });
    expect(result).toEqual({ deviceId: '{0.0.0.00000000}.{new-chat}', healed: true });
  });

  it('returns null when neither id nor name matches any present device', () => {
    const result = resolveWasapiDevice(DEVICES, {
      device: 'Unplugged USB Headset',
      deviceId: '{0.0.0.00000000}.{gone}',
    });
    expect(result).toBeNull();
  });

  it('returns null for an empty device list', () => {
    const result = resolveWasapiDevice([], {
      device: 'Speakers (Atom DAC 2)',
      deviceId: '{0.0.0.00000000}.{atom}',
    });
    expect(result).toBeNull();
  });
});
