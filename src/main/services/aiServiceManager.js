const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

const DEFAULT_SERVICE_PATH = 'C:\\Users\\brigh\\Documents\\code\\jd-audio-service';
const DEFAULT_SERVICE_URL = 'http://localhost:8374';
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_TIMEOUT_MS = 30000;

class AIServiceManager {
  constructor() {
    this.servicePath = DEFAULT_SERVICE_PATH;
    this.serviceUrl = DEFAULT_SERVICE_URL;
    this._process = null;
  }

  setServicePath(servicePath) {
    this.servicePath = servicePath;
  }

  setServiceUrl(serviceUrl) {
    this.serviceUrl = serviceUrl;
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

  async ensureRunning() {
    if (await this.checkHealth()) {
      log.info('[AIService] Already running');
      return true;
    }

    if (this.isRunning()) {
      log.info('[AIService] Process exists, waiting for health...');
      return this._pollHealth();
    }

    const batPath = path.join(this.servicePath, 'run-jd-audio-service.bat');
    if (!fs.existsSync(batPath)) {
      log.error(`[AIService] Launch script not found: ${batPath}`);
      return false;
    }

    log.info(`[AIService] Starting from: ${this.servicePath}`);
    this._process = spawn('cmd.exe', ['/c', batPath, '--no-tray'], {
      cwd: this.servicePath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

    return this._pollHealth();
  }

  _pollHealth() {
    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(async () => {
        if (Date.now() - start > HEALTH_POLL_TIMEOUT_MS) {
          clearInterval(interval);
          log.error('[AIService] Timed out waiting for service to start');
          resolve(false);
          return;
        }
        if (await this.checkHealth()) {
          clearInterval(interval);
          log.info('[AIService] Service is healthy');
          resolve(true);
        }
      }, HEALTH_POLL_INTERVAL_MS);
    });
  }

  shutdown() {
    if (this._process) {
      log.info(`[AIService] Killing process (PID ${this._process.pid})`);
      try {
        spawn('taskkill', ['/pid', String(this._process.pid), '/t', '/f'], {
          windowsHide: true,
        });
      } catch {
        this._process.kill();
      }
      this._process = null;
    }
  }
}

module.exports = { AIServiceManager };
