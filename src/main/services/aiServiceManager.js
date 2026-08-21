const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

const DEFAULT_SERVICE_URL = 'http://localhost:8374';
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_TIMEOUT_MS = 30000;
// Bound on how long shutdown() will wait for the killed process's 'exit'
// event before giving up and resolving anyway — callers that need the
// process handle to actually be released (e.g. repair(), which deletes the
// venv directory right after) should await this; it must never hang forever.
const SHUTDOWN_EXIT_TIMEOUT_MS = 5000;

class AIServiceManager {
  constructor() {
    // No default — auto-launch requires the user to configure the install
    // location in Settings. A service already running at serviceUrl still works.
    this.servicePath = null;
    this.serviceUrl = DEFAULT_SERVICE_URL;
    this._process = null;
    // Why the most recent ensureRunning() failed — surfaced to the UI so the
    // renderer doesn't have to invent a reason (it used to say "timeout" for
    // every failure, including a missing service path).
    this.lastError = null;
    // Bundled-service provisioning (Task 4's AudioServiceProvisioner). Wired
    // in by main.js; used only when servicePath is not set (advanced
    // override always wins — see ensureRunning()).
    this.provisioner = null;
    this._getHfToken = null;
    // Test seam for the bundled-launch spawn call (mirrors the injectable
    // `_spawn` on AudioServiceProvisioner) — the legacy .bat flow above still
    // calls the module-level `spawn` directly and is untouched.
    this._spawn = spawn;
  }

  setServicePath(servicePath) {
    this.servicePath = servicePath;
  }

  setServiceUrl(serviceUrl) {
    this.serviceUrl = serviceUrl;
  }

  setProvisioner(provisioner) {
    this.provisioner = provisioner;
  }

  setHfTokenGetter(getter) {
    this._getHfToken = getter;
  }

  isRunning() {
    return this._process !== null && !this._process.killed;
  }

  getProcess() {
    return this._process;
  }

  async checkHealth() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${this.serviceUrl}/health`, {
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  async ensureRunning(onProvisionProgress) {
    if (await this.checkHealth()) {
      log.info('[AIService] Already running');
      this.lastError = null;
      return true;
    }

    if (this.isRunning()) {
      log.info('[AIService] Process exists, waiting for health...');
      return this._pollHealth();
    }

    // Advanced override: a configured servicePath always wins and uses the
    // legacy .bat launch flow, even if a provisioner is also wired up.
    if (this.servicePath) {
      const batPath = path.join(this.servicePath, 'run-jd-audio-service.bat');
      if (!fs.existsSync(batPath)) {
        this.lastError = `Launch script not found: ${batPath} — check the JD Audio Service path in Settings`;
        log.error(`[AIService] ${this.lastError}`);
        return false;
      }

      log.info(`[AIService] Starting from: ${this.servicePath}`);
      this._process = spawn('cmd.exe', ['/c', batPath, '--no-tray'], {
        cwd: this.servicePath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this._attachProcessHandlers();
      return this._pollHealth();
    }

    if (this.provisioner) {
      try {
        await this.provisioner.ensureProvisioned(onProvisionProgress);
      } catch (err) {
        this.lastError = err.message;
        log.error(`[AIService] Provisioning failed: ${err.message}`);
        return false;
      }

      const env = { ...process.env };
      let hfToken = null;
      if (this._getHfToken) {
        try {
          hfToken = await this._getHfToken();
        } catch (err) {
          // A missing/unreadable token should not block launch — it's only
          // needed for first-time gated model downloads (models are already
          // cached in the common case). Degrade to "no token" instead of
          // letting this escape ensureRunning() as an unhandled rejection.
          log.warn(`[AIService] HF token read failed: ${err.message}`);
        }
      }
      if (hfToken) {
        env.HF_TOKEN = hfToken;
        env.HUGGING_FACE_HUB_TOKEN = hfToken;
      }

      const pythonExe = this.provisioner.getPythonExe();
      log.info(`[AIService] Starting bundled service: ${pythonExe}`);
      this._process = this._spawn(pythonExe, [path.join('src', 'main.py'), '--no-tray'], {
        cwd: this.provisioner.getServiceRoot(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
      this._attachProcessHandlers();
      return this._pollHealth();
    }

    this.lastError =
      'No service path configured — set the JD Audio Service folder in Settings (AI Services tab), or switch to a cloud transcription provider';
    log.error(`[AIService] ${this.lastError}`);
    return false;
  }

  _attachProcessHandlers() {
    this._process.on('exit', (code) => {
      log.info(`[AIService] Process exited with code ${code}`);
      this._process = null;
    });

    this._process.on('error', (err) => {
      log.error(`[AIService] Process error: ${err.message}`);
      this._process = null;
    });

    this._process.stderr.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line) log.debug(`[AIService stderr] ${line}`);
    });
  }

  _pollHealth() {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(async () => {
        if (Date.now() - start > HEALTH_POLL_TIMEOUT_MS) {
          clearInterval(interval);
          this.lastError = 'Timed out waiting for the service to become healthy';
          log.error('[AIService] Timed out waiting for service to start');
          resolve(false);
          return;
        }
        if (await this.checkHealth()) {
          clearInterval(interval);
          log.info('[AIService] Service is healthy');
          this.lastError = null;
          resolve(true);
        }
      }, HEALTH_POLL_INTERVAL_MS);
    });
  }

  // Kills the tracked process and returns a Promise that resolves once it has
  // actually exited (or after a bounded timeout, so this can never hang).
  // Callers that don't need to know when the process is gone — e.g. the
  // app-quit path — can call this without awaiting; it remains fire-and-forget
  // there since nothing consumes the returned promise.
  shutdown() {
    if (!this._process) {
      return Promise.resolve();
    }
    const proc = this._process;
    log.info(`[AIService] Killing process (PID ${proc.pid})`);

    const exited = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      proc.once('exit', finish);
      proc.once('error', finish);
      const timer = setTimeout(finish, SHUTDOWN_EXIT_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
        windowsHide: true,
      });
    } catch {
      proc.kill();
    }
    this._process = null;

    return exited;
  }
}

module.exports = { AIServiceManager };
