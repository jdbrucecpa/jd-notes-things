import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    killed: false,
    on: vi.fn(),
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    kill: vi.fn(),
  })),
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AIServiceManager } = await import('../../src/main/services/aiServiceManager.js');

describe('AIServiceManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AIServiceManager();
  });

  it('starts with no child process', () => {
    expect(manager.isRunning()).toBe(false);
    expect(manager.getProcess()).toBeNull();
  });

  it('starts with no service path configured', () => {
    expect(manager.servicePath).toBeNull();
  });

  it('ensureRunning fails without spawning when no path is configured', async () => {
    const { spawn } = await import('child_process');
    manager.checkHealth = vi.fn(async () => false);
    const result = await manager.ensureRunning();
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ensureRunning succeeds via health check even with no path configured', async () => {
    manager.checkHealth = vi.fn(async () => true);
    const result = await manager.ensureRunning();
    expect(result).toBe(true);
  });

  it('isRunning returns false when no process', () => {
    expect(manager.isRunning()).toBe(false);
  });

  it('setServicePath updates the path', () => {
    manager.setServicePath('/new/path');
    expect(manager.servicePath).toBe('/new/path');
  });

  it('setServiceUrl updates the url', () => {
    manager.setServiceUrl('http://localhost:9999');
    expect(manager.serviceUrl).toBe('http://localhost:9999');
  });

  describe('shutdown', () => {
    // taskkill is fire-and-forget; what matters for these tests is the
    // tracked child process's own 'exit'/'error' events, so the fake process
    // is a minimal EventEmitter-like stub (mirrors the top-of-file
    // vi.mock('child_process', ...) shape) rather than a real process.
    const makeFakeProcess = (pid = 123) => {
      const listeners = {};
      return {
        pid,
        killed: false,
        kill: vi.fn(),
        once: vi.fn((event, cb) => {
          (listeners[event] ||= []).push(cb);
        }),
        _emit: (event, ...args) => {
          (listeners[event] || []).forEach((cb) => cb(...args));
        },
      };
    };

    it('kills the child process and clears _process synchronously', () => {
      const proc = makeFakeProcess();
      manager._process = proc;
      manager.shutdown();
      expect(manager._process).toBeNull();
    });

    it('is safe to call with no process', async () => {
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });

    it('returns a promise', () => {
      const proc = makeFakeProcess();
      manager._process = proc;
      const result = manager.shutdown();
      expect(result).toBeInstanceOf(Promise);
      proc._emit('exit', 0); // avoid an unresolved promise/timer leaking into later tests
    });

    it('resolves after the process exit event fires', async () => {
      const proc = makeFakeProcess();
      manager._process = proc;
      const shutdownPromise = manager.shutdown();
      let resolved = false;
      shutdownPromise.then(() => {
        resolved = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);

      proc._emit('exit', 0);
      await shutdownPromise;
      expect(resolved).toBe(true);
    });

    it('resolves within the timeout when no exit event ever fires', async () => {
      vi.useFakeTimers();
      try {
        const proc = makeFakeProcess();
        manager._process = proc;
        const shutdownPromise = manager.shutdown();
        let resolved = false;
        shutdownPromise.then(() => {
          resolved = true;
        });

        await vi.advanceTimersByTimeAsync(4999);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('lastError', () => {
    it('starts with no error', () => {
      expect(manager.lastError).toBeNull();
    });

    it('is set when no service path is configured', async () => {
      manager.checkHealth = vi.fn(async () => false);
      await manager.ensureRunning();
      expect(manager.lastError).toMatch(/No service path configured/);
    });

    it('is set when the launch script does not exist', async () => {
      manager.checkHealth = vi.fn(async () => false);
      manager.setServicePath('C:\\definitely\\not\\a\\real\\dir');
      await manager.ensureRunning();
      expect(manager.lastError).toMatch(/Launch script not found/);
    });

    it('is cleared when the service is already healthy', async () => {
      manager.lastError = 'stale error from a previous attempt';
      manager.checkHealth = vi.fn(async () => true);
      const result = await manager.ensureRunning();
      expect(result).toBe(true);
      expect(manager.lastError).toBeNull();
    });

    it('is set when health polling times out', async () => {
      vi.useFakeTimers();
      try {
        manager.checkHealth = vi.fn(async () => false);
        const promise = manager._pollHealth();
        await vi.advanceTimersByTimeAsync(31000);
        const result = await promise;
        expect(result).toBe(false);
        expect(manager.lastError).toMatch(/Timed out/);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('bundled provisioner launch', () => {
    const makeProvisioner = () => ({
      ensureProvisioned: vi.fn(async () => {}),
      getPythonExe: () => 'C:\\env\\venv\\Scripts\\python.exe',
      getServiceRoot: () => 'C:\\res\\audio-service',
    });

    it('provisions then spawns the provisioned python with --no-tray and HF_TOKEN', async () => {
      const provisioner = makeProvisioner();
      manager.setProvisioner(provisioner);
      manager.setHfTokenGetter(async () => 'hf_secret');
      // ai-service-manager's own spawn mock (see the top-of-file
      // vi.mock('child_process', ...)) never sees calls made from inside the
      // required aiServiceManager.js module in this Vitest setup — CJS
      // require() there resolves the real module, not the mock (confirmed by
      // isolated probing; regular npm packages have the same gap). The
      // bundled-launch path therefore uses an injectable `_spawn` seam,
      // mirroring the `_spawn` test seam already used in
      // AudioServiceProvisioner (src/main/services/audioServiceProvisioner.js).
      const fakeChild = {
        pid: 4242,
        killed: false,
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
      };
      const spawnSeam = vi.fn(() => fakeChild);
      manager._spawn = spawnSeam;
      // Health: down on the initial check (forces the spawn path), up on the
      // first poll tick after spawn.
      manager.checkHealth = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

      vi.useFakeTimers();
      let result;
      try {
        const promise = manager.ensureRunning();
        await vi.advanceTimersByTimeAsync(500);
        result = await promise;
      } finally {
        vi.useRealTimers();
      }

      expect(provisioner.ensureProvisioned).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(spawnSeam).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnSeam.mock.calls[0];
      expect(cmd).toBe('C:\\env\\venv\\Scripts\\python.exe');
      expect(args).toEqual([path.join('src', 'main.py'), '--no-tray']);
      expect(opts.cwd).toBe('C:\\res\\audio-service');
      expect(opts.windowsHide).toBe(true);
      expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
      expect(opts.env.HF_TOKEN).toBe('hf_secret');
      expect(opts.env.HUGGING_FACE_HUB_TOKEN).toBe('hf_secret');
    });

    it('degrades to no token and still launches when the HF token getter rejects', async () => {
      const provisioner = makeProvisioner();
      manager.setProvisioner(provisioner);
      manager.setHfTokenGetter(async () => {
        throw new Error('Credential Manager read failed');
      });
      const fakeChild = {
        pid: 4243,
        killed: false,
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
      };
      const spawnSeam = vi.fn(() => fakeChild);
      manager._spawn = spawnSeam;
      manager.checkHealth = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

      vi.useFakeTimers();
      let result;
      let rejection;
      const onUnhandledRejection = (err) => {
        rejection = err;
      };
      process.on('unhandledRejection', onUnhandledRejection);
      // Isolate from whatever the dev/CI shell happens to already export —
      // this test asserts the manager itself sets neither var, not that the
      // ambient environment is empty.
      const hadHfToken = Object.prototype.hasOwnProperty.call(process.env, 'HF_TOKEN');
      const prevHfToken = process.env.HF_TOKEN;
      const hadHfHubToken = Object.prototype.hasOwnProperty.call(
        process.env,
        'HUGGING_FACE_HUB_TOKEN'
      );
      const prevHfHubToken = process.env.HUGGING_FACE_HUB_TOKEN;
      delete process.env.HF_TOKEN;
      delete process.env.HUGGING_FACE_HUB_TOKEN;
      try {
        const promise = manager.ensureRunning();
        await vi.advanceTimersByTimeAsync(500);
        result = await promise;
        // Flush any pending microtasks so a same-tick unhandled rejection
        // would have already fired before we assert below.
        await Promise.resolve();
      } finally {
        vi.useRealTimers();
        process.off('unhandledRejection', onUnhandledRejection);
        if (hadHfToken) process.env.HF_TOKEN = prevHfToken;
        if (hadHfHubToken) process.env.HUGGING_FACE_HUB_TOKEN = prevHfHubToken;
      }

      expect(rejection).toBeUndefined();
      expect(result).toBe(true);
      expect(spawnSeam).toHaveBeenCalledTimes(1);
      const [, , opts] = spawnSeam.mock.calls[0];
      expect(opts.env.HF_TOKEN).toBeUndefined();
      expect(opts.env.HUGGING_FACE_HUB_TOKEN).toBeUndefined();
    });

    it('a configured servicePath (advanced override) wins over the provisioner', async () => {
      const provisioner = makeProvisioner();
      manager.setProvisioner(provisioner);
      manager.setServicePath('C:\\definitely\\not\\a\\real\\dir');
      manager.checkHealth = vi.fn(async () => false);
      manager._spawn = vi.fn();

      const result = await manager.ensureRunning();

      expect(result).toBe(false);
      expect(provisioner.ensureProvisioned).not.toHaveBeenCalled();
      expect(manager._spawn).not.toHaveBeenCalled();
      expect(manager.lastError).toMatch(/Launch script not found/);
    });

    it('surfaces provisioning failure via lastError and returns false', async () => {
      const provisioner = makeProvisioner();
      provisioner.ensureProvisioned = vi.fn(async () => {
        throw new Error('uv sync failed (exit 1)');
      });
      manager.setProvisioner(provisioner);
      manager.checkHealth = vi.fn(async () => false);
      manager._spawn = vi.fn();

      const result = await manager.ensureRunning();

      expect(result).toBe(false);
      expect(manager.lastError).toMatch(/uv sync failed/);
      expect(manager._spawn).not.toHaveBeenCalled();
    });
  });
});
