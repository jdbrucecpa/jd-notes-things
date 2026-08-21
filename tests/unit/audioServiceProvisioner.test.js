import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AudioServiceProvisioner } from '../../src/main/services/audioServiceProvisioner.js';

let tmp, serviceRoot, envDir, prov;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-test-'));
  serviceRoot = path.join(tmp, 'audio-service');
  envDir = path.join(tmp, 'env');
  fs.mkdirSync(serviceRoot, { recursive: true });
  fs.writeFileSync(path.join(serviceRoot, 'uv.lock'), 'lock-v1');
  fs.writeFileSync(path.join(serviceRoot, 'pyproject.toml'), 'proj-v1');
  prov = new AudioServiceProvisioner({ serviceRoot, envDir, uvPath: path.join(tmp, 'uv.exe') });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('AudioServiceProvisioner', () => {
  it('computeLockHash changes when uv.lock changes', () => {
    const h1 = prov.computeLockHash();
    fs.writeFileSync(path.join(serviceRoot, 'uv.lock'), 'lock-v2');
    expect(prov.computeLockHash()).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('isProvisioned is false with no marker, true after a matching marker', () => {
    expect(prov.isProvisioned()).toBe(false);
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'provision-marker.json'),
      JSON.stringify({ lockHash: prov.computeLockHash() })
    );
    expect(prov.isProvisioned()).toBe(true);
  });

  it('isProvisioned is false when the lock hash no longer matches', () => {
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'provision-marker.json'), JSON.stringify({ lockHash: 'stale' }));
    expect(prov.isProvisioned()).toBe(false);
  });

  it('provision spawns uv sync with frozen/no-dev and env overrides, then writes the marker', async () => {
    const calls = [];
    prov._spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => {
        p.stderr.emit('data', Buffer.from('Resolved 42 packages\n'));
        p.emit('close', 0);
      });
      return p;
    };
    const lines = [];
    await prov.provision((l) => lines.push(l));

    expect(calls[0].cmd).toContain('uv.exe');
    expect(calls[0].args).toEqual(['sync', '--frozen', '--no-dev']);
    expect(calls[0].opts.cwd).toBe(serviceRoot);
    expect(calls[0].opts.env.UV_PROJECT_ENVIRONMENT).toBe(path.join(envDir, 'venv'));
    expect(calls[0].opts.env.UV_PYTHON_INSTALL_DIR).toBe(path.join(envDir, 'python'));
    expect(lines.join('')).toContain('Resolved 42 packages');
    expect(prov.isProvisioned()).toBe(true);
  });

  it('provision rejects on non-zero exit and leaves no marker', async () => {
    prov._spawn = () => {
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => {
        p.stderr.emit('data', Buffer.from('error: no such package\n'));
        p.emit('close', 1);
      });
      return p;
    };
    await expect(prov.provision(() => {})).rejects.toThrow(/uv sync failed \(exit 1\)/);
    expect(prov.isProvisioned()).toBe(false);
  });

  it('ensureProvisioned skips provisioning when the marker matches', async () => {
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, 'provision-marker.json'),
      JSON.stringify({ lockHash: prov.computeLockHash() })
    );
    prov._spawn = vi.fn();
    await prov.ensureProvisioned(() => {});
    expect(prov._spawn).not.toHaveBeenCalled();
  });

  it('repair wipes the venv and marker before re-provisioning', async () => {
    const venv = path.join(envDir, 'venv');
    fs.mkdirSync(venv, { recursive: true });
    fs.writeFileSync(path.join(venv, 'stale.txt'), 'x');
    fs.writeFileSync(path.join(envDir, 'provision-marker.json'), JSON.stringify({ lockHash: 'x' }));
    let sawCleanDir = null;
    prov._spawn = () => {
      sawCleanDir = !fs.existsSync(venv);
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => p.emit('close', 0));
      return p;
    };
    await prov.repair(() => {});
    expect(sawCleanDir).toBe(true);
    expect(prov.isProvisioned()).toBe(true);
  });

  it('repair passes Windows-safe retry options to the venv/marker deletions', async () => {
    // Regression test: repair() runs immediately after aiServiceManager
    // .shutdown() kills the running service, and on Windows the dying
    // python.exe's handles into venv/ can still be closing when rmSync runs
    // — a bare rmSync can throw EPERM. maxRetries/retryDelay is Node's
    // built-in mitigation. Asserted via the `_rm` seam (mirrors `_spawn`)
    // rather than real file locking, which isn't reliably reproducible here.
    const rmCalls = [];
    prov._rm = vi.fn((target, opts) => {
      rmCalls.push({ target, opts });
    });
    prov._spawn = () => {
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stderr = new EventEmitter();
      process.nextTick(() => p.emit('close', 0));
      return p;
    };

    await prov.repair(() => {});

    expect(rmCalls).toHaveLength(2);
    expect(rmCalls[0].target).toBe(path.join(envDir, 'venv'));
    expect(rmCalls[1].target).toBe(path.join(envDir, 'provision-marker.json'));
    for (const { opts } of rmCalls) {
      expect(opts.force).toBe(true);
      expect(opts.maxRetries).toBe(10);
      expect(opts.retryDelay).toBe(200);
    }
  });

  it('getPythonExe points into the env venv', () => {
    expect(prov.getPythonExe()).toBe(path.join(envDir, 'venv', 'Scripts', 'python.exe'));
  });
});
