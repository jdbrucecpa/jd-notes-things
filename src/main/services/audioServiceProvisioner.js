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
  }

  computeLockHash() {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(path.join(this.serviceRoot, 'uv.lock')));
    h.update(fs.readFileSync(path.join(this.serviceRoot, 'pyproject.toml')));
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
    fs.rmSync(path.join(this.envDir, 'venv'), { recursive: true, force: true });
    fs.rmSync(path.join(this.envDir, MARKER_FILE), { force: true });
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
