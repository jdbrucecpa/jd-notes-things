const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let log;
try {
  log = require('electron-log');
} catch {
  log = console;
}

const MARKER_FILE = 'provision-marker.json';

/**
 * Provisions and maintains the self-contained Python environment for the
 * bundled JD Audio Service under %LOCALAPPDATA%\JDNotesThings\audio-service.
 * All paths are injected so the class is testable outside Electron. uv does
 * the heavy lifting: it downloads CPython itself, so no system Python is
 * required. The env is keyed by a hash of uv.lock + pyproject.toml — any
 * dependency change in a new app version re-provisions automatically.
 */
class AudioServiceProvisioner {
  constructor({ serviceRoot, envDir, uvPath }) {
    this.serviceRoot = serviceRoot;
    this.envDir = envDir;
    this.uvPath = uvPath;
    this._spawn = spawn; // test seam
    this._rm = fs.rmSync; // test seam
  }

  computeLockHash() {
    // Normalize CRLF->LF before hashing so a CI checkout with
    // core.autocrlf=true (which materializes CRLF) doesn't produce a
    // different hash than a locally-provisioned LF env — that mismatch
    // would trigger a surprise full ~5 GB reprovision after an auto-update
    // built on such a checkout. .gitattributes pins these files to LF in
    // git itself; this normalization is belt-and-braces for any non-git
    // copy path (e.g. packaging/staging).
    const h = crypto.createHash('sha256');
    h.update(
      fs.readFileSync(path.join(this.serviceRoot, 'uv.lock'), 'utf8').replace(/\r\n/g, '\n')
    );
    h.update(
      fs
        .readFileSync(path.join(this.serviceRoot, 'pyproject.toml'), 'utf8')
        .replace(/\r\n/g, '\n')
    );
    return h.digest('hex');
  }

  isProvisioned() {
    try {
      const marker = JSON.parse(
        fs.readFileSync(path.join(this.envDir, MARKER_FILE), 'utf8')
      );
      return marker.lockHash === this.computeLockHash();
    } catch {
      return false;
    }
  }

  async provision(onProgress = () => {}) {
    fs.mkdirSync(this.envDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const proc = this._spawn(this.uvPath, ['sync', '--frozen', '--no-dev'], {
        cwd: this.serviceRoot,
        windowsHide: true,
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: path.join(this.envDir, 'venv'),
          UV_PYTHON_INSTALL_DIR: path.join(this.envDir, 'python'),
        },
      });
      let tail = '';
      proc.stderr?.on('data', (chunk) => {
        const line = chunk.toString();
        tail = (tail + line).slice(-2000);
        onProgress(line);
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`uv sync failed (exit ${code}): ${tail.trim()}`));
      });
    });
    fs.writeFileSync(
      path.join(this.envDir, MARKER_FILE),
      JSON.stringify({ lockHash: this.computeLockHash(), provisionedAt: new Date().toISOString() })
    );
    log.info('[AIService] Environment provisioned');
  }

  async ensureProvisioned(onProgress) {
    if (this.isProvisioned()) return;
    await this.provision(onProgress);
  }

  async repair(onProgress) {
    // Repair runs right after aiServiceManager.shutdown() kills the running
    // service. On Windows the dying python.exe's file handles into venv/ can
    // take a moment to release even after the process has exited, so a bare
    // rmSync can throw EPERM/EBUSY here. maxRetries/retryDelay are Node's
    // built-in Windows-safe retry for exactly this (see EPERM handling in
    // fs.rmSync docs) — defense-in-depth on top of awaiting shutdown().
    const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
    this._rm(path.join(this.envDir, 'venv'), RM_OPTS);
    this._rm(path.join(this.envDir, MARKER_FILE), RM_OPTS);
    await this.provision(onProgress);
  }

  getPythonExe() {
    return path.join(this.envDir, 'venv', 'Scripts', 'python.exe');
  }

  getServiceRoot() {
    return this.serviceRoot;
  }
}

module.exports = { AudioServiceProvisioner };
