// tests/unit/appLoopbackCapture.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { AppLoopbackCapture } = await import('../../src/main/recording/AppLoopbackCapture.js');

function mockNative() {
  const handlers = new Map();
  return {
    startAudioCapture: vi.fn((pid, opts) => {
      handlers.set(pid, opts.onData);
      return pid;
    }),
    stopAudioCapture: vi.fn((pid) => {
      handlers.delete(pid);
      return true;
    }),
    _emit: (pid, chunk) => handlers.get(pid)?.(chunk),
  };
}

describe('AppLoopbackCapture', () => {
  let native, cap, wavPath;
  const tmpFiles = [];

  beforeEach(() => {
    native = mockNative();
    AppLoopbackCapture._setNativeModule(native);
    cap = new AppLoopbackCapture();
    cap._silenceTickMs = 10; // fast pacing in tests
    wavPath = path.join(os.tmpdir(), `alc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    tmpFiles.push(wavPath);
  });

  afterEach(() => {
    for (const f of tmpFiles) {
      fs.rmSync(f, { force: true });
    }
    tmpFiles.length = 0;
  });

  it('isAvailable reflects native module presence', () => {
    expect(AppLoopbackCapture.isAvailable()).toBe(true);
    AppLoopbackCapture._setNativeModule(null);
    expect(AppLoopbackCapture.isAvailable()).toBe(false);
  });

  it('start writes a WAV header and appends data chunks', async () => {
    await cap.start(1234, wavPath);
    native._emit('1234', new Uint8Array([1, 2, 3, 4]));
    await cap.stop();

    const buf = fs.readFileSync(wavPath);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.length).toBeGreaterThanOrEqual(44 + 4);
    // RIFF size patched on stop
    expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    expect(buf.readUInt32LE(40)).toBe(buf.length - 44);
  });

  it('pads silence to real-time byte rate when app is silent', async () => {
    await cap.start(1234, wavPath);
    await new Promise((r) => setTimeout(r, 120)); // several silence ticks
    await cap.stop();
    const dataBytes = fs.readFileSync(wavPath).length - 44;
    // ≥ ~50ms of audio at the configured byte rate, from silence alone
    expect(dataBytes).toBeGreaterThan(cap._byteRate * 0.05);
  });

  it('stop calls native stopAudioCapture with the pid string', async () => {
    await cap.start(1234, wavPath);
    await cap.stop();
    expect(native.stopAudioCapture).toHaveBeenCalledWith('1234');
  });

  it('start throws when native module missing', async () => {
    AppLoopbackCapture._setNativeModule(null);
    await expect(new AppLoopbackCapture().start(1, wavPath)).rejects.toThrow(/not available/);
  });

  it('is an EventEmitter (error surface for LocalProvider wiring)', () => {
    expect(typeof cap.on).toBe('function');
    expect(typeof cap.emit).toBe('function');
  });

  it('isolates write failures: emits error and stops capturing, stop() still safe', async () => {
    await cap.start(1234, wavPath);
    expect(cap.isCapturing).toBe(true);

    const errorSpy = vi.fn();
    cap.on('error', errorSpy);

    const writeSpy = vi.spyOn(fs, 'writeSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    try {
      native._emit('1234', new Uint8Array([1, 2, 3, 4]));
    } finally {
      writeSpy.mockRestore();
    }

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0].message).toMatch(/ENOSPC/);
    expect(cap.isCapturing).toBe(false);
    // native capture was torn down as part of the failure
    expect(native.stopAudioCapture).toHaveBeenCalledWith('1234');

    // stop() after a failure must never throw
    await expect(cap.stop()).resolves.toBeUndefined();
  });

  it('start cleans up the fd when native startAudioCapture throws', async () => {
    native.startAudioCapture.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(cap.start(1234, wavPath)).rejects.toThrow(/spawn failed/);
    expect(cap.isCapturing).toBe(false);

    // fd was released — stop() resolves cleanly, and the file is removable
    await expect(cap.stop()).resolves.toBeUndefined();
    expect(() => fs.rmSync(wavPath, { force: true })).not.toThrow();
  });
});
