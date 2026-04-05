# JD Audio Service Auto-Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically start JD Audio Service when recording with local transcription, so users never need to manually launch a separate app.

**Architecture:** New `AIServiceManager` class manages the Python service as a child process. On recording start (local transcription), it checks `/health`, spawns the service if down, polls until ready. On app quit, it kills the child process. Settings UI adds a manual Start button and service path input.

**Tech Stack:** Node.js `child_process.spawn`, Electron IPC, existing health check endpoint

---

## File Structure

| File | Change | Responsibility |
|------|--------|---------------|
| `src/main/services/aiServiceManager.js` | Create | Child process lifecycle: spawn, health poll, kill |
| `tests/unit/aiServiceManager.test.js` | Create | Unit tests for AIServiceManager |
| `src/main.js` | Modify | Import manager, call `ensureRunning()` before local transcription, kill on quit |
| `src/index.html` | Modify | Add Start button + service path input in settings |
| `src/renderer/settings.js` | Modify | Wire Start button, path input, status transitions |
| `src/preload.js` | Modify | Add `aiServiceStart` and `aiServicePathUpdate` IPC bridges |

---

### Task 1: Create AIServiceManager

**Files:**
- Create: `src/main/services/aiServiceManager.js`
- Create: `tests/unit/aiServiceManager.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/aiServiceManager.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process and fetch before importing
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    on: vi.fn(),
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    kill: vi.fn(),
  })),
}));

// Mock electron-log
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

  it('shutdown kills the child process', () => {
    // Simulate a running process
    const mockProcess = { kill: vi.fn(), pid: 123 };
    manager._process = mockProcess;
    manager.shutdown();
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager._process).toBeNull();
  });

  it('shutdown is safe to call with no process', () => {
    expect(() => manager.shutdown()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/aiServiceManager.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write AIServiceManager implementation**

```javascript
// src/main/services/aiServiceManager.js
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

  /**
   * Check if the service is healthy via GET /health.
   * @returns {Promise<boolean>}
   */
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

  /**
   * Ensure the service is running. If already healthy, returns immediately.
   * If not, spawns the process and polls /health until ready.
   * @returns {Promise<boolean>} true if service is healthy
   */
  async ensureRunning() {
    // Already healthy?
    if (await this.checkHealth()) {
      log.info('[AIService] Already running');
      return true;
    }

    // Already spawned but not yet healthy? Just poll.
    if (this.isRunning()) {
      log.info('[AIService] Process exists, waiting for health...');
      return this._pollHealth();
    }

    // Validate service path
    const batPath = path.join(this.servicePath, 'run-jd-audio-service.bat');
    if (!fs.existsSync(batPath)) {
      log.error(`[AIService] Launch script not found: ${batPath}`);
      return false;
    }

    // Spawn the service
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

  /**
   * Poll /health until the service responds OK or timeout.
   * @returns {Promise<boolean>}
   */
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

  /**
   * Kill the child process if running.
   */
  shutdown() {
    if (this._process) {
      log.info(`[AIService] Killing process (PID ${this._process.pid})`);
      try {
        // On Windows, spawn('cmd.exe') creates a process tree — use taskkill
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/aiServiceManager.test.js`
Expected: 6 tests PASS

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 6: Commit**

```bash
git add src/main/services/aiServiceManager.js tests/unit/aiServiceManager.test.js
git commit -m "feat: add AIServiceManager for JD Audio Service lifecycle"
```

---

### Task 2: Wire AIServiceManager into main process

**Files:**
- Modify: `src/main.js`
- Modify: `src/preload.js`

- [ ] **Step 1: Import and initialize AIServiceManager in main.js**

Near the top of `src/main.js` (around line 61, after the VoiceProfileService import), add:

```javascript
const { AIServiceManager } = require('./main/services/aiServiceManager');
```

After the recording abstraction layer variables (around line 414), add:

```javascript
// v2.0: JD Audio Service manager (auto-launch for local transcription)
const aiServiceManager = new AIServiceManager();
```

- [ ] **Step 2: Configure AIServiceManager when app settings load**

In the `app.whenReady()` block, after `appSettings` is loaded and before `initSDK()` (around line 1537), add:

```javascript
// Configure AI service manager from settings
if (appSettings.aiServicePath) {
  aiServiceManager.setServicePath(appSettings.aiServicePath);
}
if (appSettings.aiServiceUrl) {
  aiServiceManager.setServiceUrl(appSettings.aiServiceUrl);
}
```

- [ ] **Step 3: Call ensureRunning before local transcription starts**

In the `recording-ended` handler, right before the local transcription path (around line 2636, where `if (transcriptionProvider === 'local')` is), add the auto-launch:

```javascript
            // v2.0: Auto-launch JD Audio Service if not running
            if (transcriptionProvider === 'local') {
              const aiServiceUrl =
                voiceProfileService?.aiServiceUrl || 'http://localhost:8374';
              vocabularyOptions.aiServiceUrl = aiServiceUrl;
              console.log(
                `[Transcription] Local provider using AI service at: ${aiServiceUrl}`
              );

              // Ensure the service is running before transcription
              const serviceReady = await aiServiceManager.ensureRunning();
              if (!serviceReady) {
                console.error('[Transcription] JD Audio Service failed to start');
                backgroundTaskManager.updateTask(recordingTaskId, 15, 'Starting AI service failed — transcription may fail');
              }
            }
```

This replaces the existing `if (transcriptionProvider === 'local')` block at lines 2636-2643.

- [ ] **Step 4: Kill the service on app quit**

In the `app.on('before-quit')` handler (line 1880), add after the tray cleanup:

```javascript
  // Stop JD Audio Service if we launched it
  aiServiceManager.shutdown();
  console.log('[AIService] Shutdown');
```

- [ ] **Step 5: Handle aiServiceUrl setting updates**

The existing handler at line 8471 (`if (updates.aiServiceUrl && voiceProfileService)`) already updates `voiceProfileService`. Add the AIServiceManager update after it:

```javascript
    if (updates.aiServiceUrl) {
      if (voiceProfileService) {
        voiceProfileService.setAIServiceUrl(updates.aiServiceUrl);
      }
      aiServiceManager.setServiceUrl(updates.aiServiceUrl);
    }
```

- [ ] **Step 6: Handle aiServicePath setting updates**

After the `aiServiceUrl` handler, add:

```javascript
    if (updates.aiServicePath) {
      aiServiceManager.setServicePath(updates.aiServicePath);
    }
```

- [ ] **Step 7: Add IPC handler for manual start**

After the existing `aiService:health` handler (around line 6782), add:

```javascript
ipcMain.handle('aiService:start', async () => {
  try {
    const healthy = await aiServiceManager.ensureRunning();
    return { success: healthy, status: healthy ? 'connected' : 'failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 8: Add preload bridge**

In `src/preload.js`, after the `aiServiceHealth` line (line 350), add:

```javascript
  aiServiceStart: () => ipcRenderer.invoke('aiService:start'),
```

- [ ] **Step 9: Run lint and tests**

Run: `npm run lint && npm test`
Expected: 0 warnings, all tests pass

- [ ] **Step 10: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat: wire AIServiceManager — auto-launch on local transcription, kill on quit"
```

---

### Task 3: Add Settings UI controls

**Files:**
- Modify: `src/index.html`
- Modify: `src/renderer/settings.js`

- [ ] **Step 1: Add Start button and path input to index.html**

In `src/index.html`, find the JD Audio Service URL settings item (line 1630-1638). After the status span on line 1637, add a Start button:

```html
                  <input type="text" class="settings-input" id="aiServiceUrlInput" placeholder="http://localhost:8374" />
                  <span class="service-status" id="aiServiceStatus"></span>
                  <button class="btn btn-sm" id="aiServiceStartBtn" style="margin-left: 8px; display: none;">Start</button>
```

After the entire JD Audio Service URL settings-item div (after line 1639), add a new settings-item for the path:

```html
              <div class="settings-item">
                <div class="settings-item-info">
                  <div class="settings-item-label">JD Audio Service Path</div>
                  <div class="settings-item-description">Local path to the jd-audio-service directory</div>
                </div>
                <div class="settings-item-control">
                  <input type="text" class="settings-input" id="aiServicePathInput" placeholder="C:\Users\brigh\Documents\code\jd-audio-service" />
                </div>
              </div>
```

- [ ] **Step 2: Wire Start button in settings.js**

In `src/renderer/settings.js`, in the element lookup section (around line 153), add:

```javascript
  const aiServiceStartBtn = document.getElementById('aiServiceStartBtn');
  const aiServicePathInput = document.getElementById('aiServicePathInput');
```

In the event listeners section (around line 440, after the aiServiceUrl handler), add:

```javascript
  // AI Service Start button
  if (aiServiceStartBtn) {
    aiServiceStartBtn.addEventListener('click', async () => {
      aiServiceStartBtn.textContent = 'Starting...';
      aiServiceStartBtn.disabled = true;
      try {
        const result = await window.electronAPI.aiServiceStart();
        if (result.success) {
          notifySuccess('JD Audio Service started');
          await checkAIServiceStatus();
        } else {
          notifyError('Failed to start JD Audio Service: ' + (result.error || 'timeout'));
        }
      } catch (err) {
        notifyError('Failed to start JD Audio Service');
      }
      aiServiceStartBtn.textContent = 'Start';
      aiServiceStartBtn.disabled = false;
    });
  }

  // AI Service Path
  if (aiServicePathInput) {
    aiServicePathInput.addEventListener('change', e => {
      const newPath = e.target.value.trim();
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ aiServicePath: newPath });
      }
      notifySuccess('JD Audio Service path updated');
    });
  }
```

- [ ] **Step 3: Show/hide Start button based on connection status**

In `src/renderer/settings.js`, update `checkAIServiceStatus()` to toggle the Start button:

```javascript
  async function checkAIServiceStatus() {
    const statusEl = document.getElementById('aiServiceStatus');
    const startBtn = document.getElementById('aiServiceStartBtn');
    if (!statusEl) return;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'service-status checking';
    try {
      const result = await window.electronAPI.aiServiceHealth();
      if (result && result.status === 'connected') {
        statusEl.textContent = 'Connected';
        statusEl.className = 'service-status connected';
        if (startBtn) startBtn.style.display = 'none';
      } else {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'service-status disconnected';
        if (startBtn) startBtn.style.display = 'inline-block';
      }
    } catch {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'service-status disconnected';
      if (startBtn) startBtn.style.display = 'inline-block';
    }
  }
```

- [ ] **Step 4: Load path into UI on settings open**

In `loadSettingsIntoUI()` (around line 800, after the aiServiceUrl load), add:

```javascript
    if (aiServicePathInput) {
      aiServicePathInput.value = currentSettings.aiServicePath || 'C:\\Users\\brigh\\Documents\\code\\jd-audio-service';
    }
```

Also add `aiServicePath` to `DEFAULT_SETTINGS` (around line 32):

```javascript
  aiServicePath: 'C:\\Users\\brigh\\Documents\\code\\jd-audio-service', // v2.0: JD Audio Service directory
```

- [ ] **Step 5: Run lint and tests**

Run: `npm run lint && npm test`
Expected: 0 warnings, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.html src/renderer/settings.js
git commit -m "feat(ui): add Start button and path input for JD Audio Service in settings"
```

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Run full lint and unit tests**

Run: `npm run lint && npm test`
Expected: 0 warnings, 133+ tests pass (new AIServiceManager tests)

- [ ] **Step 2: Manual test — auto-launch flow**

1. Make sure JD Audio Service is NOT running
2. Start the dev app: `npm start`
3. Open Settings → General → set transcription provider to "Local"
4. Verify the AI service status shows "Disconnected" with a "Start" button
5. Create a new meeting note and click Record
6. Verify the service starts automatically (status changes to Connected)
7. Stop recording — transcription should proceed normally

- [ ] **Step 3: Manual test — manual start flow**

1. With the service stopped, click the "Start" button in Settings
2. Verify it shows "Starting..." then "Connected"

- [ ] **Step 4: Manual test — app quit cleanup**

1. With the service auto-launched, quit the app
2. Verify the JD Audio Service process is no longer running (check Task Manager)
