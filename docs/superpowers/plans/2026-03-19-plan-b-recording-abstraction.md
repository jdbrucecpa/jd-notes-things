# Plan B: Recording Layer Abstraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the recording system from main.js into a clean provider abstraction (RecordingProvider/RecordingManager/RecallProvider), enabling local recording alongside Recall.ai SDK in v2.0.

**Architecture:** Three-class split: RecordingProvider (interface), RecallProvider (wraps existing SDK code), RecordingManager (orchestrates providers + coordinates app). All recording state, event handlers, and SDK calls move out of main.js into `src/main/recording/`. Server.js webhook code removed, Stream Deck moved to its own service.

**Tech Stack:** Electron 40.x, Node.js, Recall.ai Desktop SDK 2.x, EventEmitter, FFmpeg (for LocalProvider later)

**Spec:** `docs/superpowers/specs/2026-03-18-v2-local-first-design.md` — Component 2
**Decision doc:** `docs/superpowers/plans/2026-03-18-plan-b-recording-abstraction.md`

**Repository:** `C:\Users\brigh\Documents\code\jd-notes-things` (branch: `v2.0`)

**Test commands:**
- Unit tests: `npm test`
- E2E tests: `E2E_TEST=1 npm start` then `npm run test:e2e`
- Lint: `npm run lint`

---

## File Structure

### New files to create:

```
src/main/recording/
├── RecordingProvider.js      # Base class (EventEmitter) — interface contract
├── RecallProvider.js         # Wraps Recall.ai SDK — extracted from main.js
├── RecordingManager.js       # Orchestrator — coordinates provider + app
└── index.js                  # Exports for clean imports

src/main/services/
└── streamDeckService.js      # Extracted from server.js

tests/unit/
├── RecordingProvider.test.js # Interface contract tests
├── RecordingManager.test.js  # Orchestration logic tests
└── RecallProvider.test.js    # SDK wrapper tests
```

### Files to modify:

```
src/main.js                   # Remove ~800 lines of recording code, wire RecordingManager
src/server.js                 # Remove webhook routes, simplify to Stream Deck proxy
```

### Files to delete:

```
(none — server.js is modified, not deleted)
```

---

## Critical Constraints

1. **Recall mode must keep working after every commit.** This is an incremental extraction, not a rewrite. The existing E2E tests must pass at every step.
2. **main.js is 12,384 lines.** Read exact sections before modifying. Line numbers shift with each edit — always re-read before editing.
3. **The `recording-ended` handler (lines 2507-2960) is 450 lines and the most complex flow.** It handles transcription, export, participant matching — much of this stays in RecordingManager, not RecallProvider.
4. **Global state (`isRecording`, `detectedMeeting`, `sdkReady`, etc.) at lines 370-407 must migrate to RecordingManager.**

---

### Task 1: Create RecordingProvider base class

**Files:**
- Create: `src/main/recording/RecordingProvider.js`
- Create: `tests/unit/RecordingProvider.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/RecordingProvider.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { RecordingProvider } from '../../src/main/recording/RecordingProvider.js';

describe('RecordingProvider', () => {
  it('is an EventEmitter', () => {
    const provider = new RecordingProvider();
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.emit).toBe('function');
  });

  it('throws on unimplemented initialize', async () => {
    const provider = new RecordingProvider();
    await expect(provider.initialize({})).rejects.toThrow('must implement');
  });

  it('throws on unimplemented startRecording', async () => {
    const provider = new RecordingProvider();
    await expect(provider.startRecording({})).rejects.toThrow('must implement');
  });

  it('throws on unimplemented stopRecording', async () => {
    const provider = new RecordingProvider();
    await expect(provider.stopRecording('id')).rejects.toThrow('must implement');
  });

  it('throws on unimplemented shutdown', async () => {
    const provider = new RecordingProvider();
    await expect(provider.shutdown()).rejects.toThrow('must implement');
  });

  it('has getState returning default state', () => {
    const provider = new RecordingProvider();
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.meetingDetected).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/RecordingProvider.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RecordingProvider**

Create `src/main/recording/RecordingProvider.js`:

```javascript
const { EventEmitter } = require('events');

/**
 * Base class for recording providers.
 *
 * Events emitted by all providers:
 *   'meeting-detected'   { windowId, platform, title }
 *   'meeting-closed'     { windowId }
 *   'recording-started'  { recordingId, windowId }
 *   'recording-ended'    { recordingId, audioFilePath }
 *   'error'              { type, message }
 *
 * RecallProvider-only events:
 *   'participant-joined'  { windowId, participant }
 *   'speech-activity'     { windowId, participantId, speaking, timestamp }
 *   'upload-progress'     { recordingId, progress }
 *   'sdk-state-change'    { state }
 */
class RecordingProvider extends EventEmitter {
  async initialize(config) {
    throw new Error('Subclass must implement initialize()');
  }

  async startRecording(options) {
    throw new Error('Subclass must implement startRecording()');
  }

  async stopRecording(recordingId) {
    throw new Error('Subclass must implement stopRecording()');
  }

  async shutdown() {
    throw new Error('Subclass must implement shutdown()');
  }

  getState() {
    return {
      recording: false,
      meetingDetected: false,
      activeRecordings: new Map(),
    };
  }
}

module.exports = { RecordingProvider };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/RecordingProvider.test.js`
Expected: All 6 PASS

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: 0 warnings, 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/main/recording/RecordingProvider.js tests/unit/RecordingProvider.test.js
git commit -m "feat(recording): add RecordingProvider base class"
```

---

### Task 2: Create RecordingManager orchestrator

**Files:**
- Create: `src/main/recording/RecordingManager.js`
- Create: `tests/unit/RecordingManager.test.js`

The RecordingManager owns: active recording tracking, meeting-to-note association, recording state flags. It listens to provider events and coordinates the rest of the app.

- [ ] **Step 1: Write failing test**

Create `tests/unit/RecordingManager.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingManager } from '../../src/main/recording/RecordingManager.js';
import { EventEmitter } from 'events';

// Minimal mock provider
class MockProvider extends EventEmitter {
  async initialize() {}
  async startRecording() { return 'rec-123'; }
  async stopRecording() {}
  async shutdown() {}
  getState() { return { recording: false, meetingDetected: false }; }
}

describe('RecordingManager', () => {
  let manager;
  let provider;

  beforeEach(() => {
    provider = new MockProvider();
    manager = new RecordingManager(provider);
  });

  it('starts with no active recordings', () => {
    expect(manager.getActiveRecordings()).toEqual({});
    expect(manager.isRecording).toBe(false);
  });

  it('tracks recording after startRecording', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    expect(manager.isRecording).toBe(true);
    const recordings = manager.getActiveRecordings();
    expect(Object.keys(recordings)).toHaveLength(1);
  });

  it('cleans up after stopRecording', async () => {
    await manager.startRecording({ noteId: 'note-1', platform: 'zoom' });
    const recordingId = Object.keys(manager.getActiveRecordings())[0];
    await manager.stopRecording(recordingId);
    expect(manager.isRecording).toBe(false);
  });

  it('forwards meeting-detected from provider', () => {
    const handler = vi.fn();
    manager.on('meeting-detected', handler);
    provider.emit('meeting-detected', { windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(handler).toHaveBeenCalledWith({ windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(manager.detectedMeeting).toEqual({ windowId: 'w1', platform: 'zoom', title: 'Test' });
  });

  it('forwards recording-ended from provider', () => {
    const handler = vi.fn();
    manager.on('recording-ended', handler);
    provider.emit('recording-ended', { recordingId: 'r1', audioFilePath: '/tmp/a.mp3' });
    expect(handler).toHaveBeenCalled();
  });

  it('clears detectedMeeting on meeting-closed', () => {
    provider.emit('meeting-detected', { windowId: 'w1', platform: 'zoom', title: 'Test' });
    expect(manager.detectedMeeting).not.toBeNull();
    provider.emit('meeting-closed', { windowId: 'w1' });
    expect(manager.detectedMeeting).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/RecordingManager.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RecordingManager**

Create `src/main/recording/RecordingManager.js`:

```javascript
const { EventEmitter } = require('events');

/**
 * Orchestrates recording providers and coordinates with the app.
 *
 * Owns: active recording tracking, meeting-to-note association,
 * recording state flags. Listens to provider events and re-emits
 * them for the rest of the app to consume.
 */
class RecordingManager extends EventEmitter {
  constructor(provider) {
    super();
    this.provider = provider;
    this.recordings = {};
    this.isRecording = false;
    this.detectedMeeting = null;
    this.recordingStartTime = null;
    this.currentMeetingTitle = null;
    this.currentMeetingId = null;

    this._bindProviderEvents();
  }

  _bindProviderEvents() {
    // Forward all provider events, adding orchestration logic

    this.provider.on('meeting-detected', (data) => {
      this.detectedMeeting = data;
      this.emit('meeting-detected', data);
    });

    this.provider.on('meeting-closed', (data) => {
      this.detectedMeeting = null;
      this.emit('meeting-closed', data);
    });

    this.provider.on('recording-started', (data) => {
      this.isRecording = true;
      this.recordingStartTime = new Date();
      this.emit('recording-started', data);
    });

    this.provider.on('recording-ended', (data) => {
      const { recordingId } = data;
      this.removeRecording(recordingId);
      this.isRecording = Object.keys(this.recordings).length > 0;
      this.emit('recording-ended', data);
    });

    this.provider.on('error', (data) => {
      this.emit('error', data);
    });

    // Forward Recall-specific events without transformation
    for (const event of ['participant-joined', 'speech-activity', 'upload-progress', 'sdk-state-change']) {
      this.provider.on(event, (data) => this.emit(event, data));
    }
  }

  async initialize(config) {
    return this.provider.initialize(config);
  }

  async startRecording(options) {
    const { noteId, platform } = options;
    const recordingId = await this.provider.startRecording(options);

    this.addRecording(recordingId, noteId, platform);
    this.isRecording = true;
    this.recordingStartTime = new Date();
    this.currentMeetingTitle = options.meetingTitle || null;
    this.currentMeetingId = noteId;

    return recordingId;
  }

  async stopRecording(recordingId) {
    this.updateState(recordingId, 'stopping');
    return this.provider.stopRecording(recordingId);
  }

  async shutdown() {
    return this.provider.shutdown();
  }

  // --- Active recordings tracker (extracted from main.js lines 1959-2013) ---

  addRecording(recordingId, noteId, platform = 'unknown') {
    this.recordings[recordingId] = {
      noteId,
      platform,
      state: 'recording',
      startTime: new Date(),
    };
  }

  updateState(recordingId, state) {
    if (this.recordings[recordingId]) {
      this.recordings[recordingId].state = state;
      return true;
    }
    return false;
  }

  removeRecording(recordingId) {
    if (this.recordings[recordingId]) {
      delete this.recordings[recordingId];
      return true;
    }
    return false;
  }

  getForNote(noteId) {
    for (const [recordingId, info] of Object.entries(this.recordings)) {
      if (info.noteId === noteId) {
        return { recordingId, ...info };
      }
    }
    return null;
  }

  getActiveRecordings() {
    return { ...this.recordings };
  }

  hasActiveRecording(recordingId) {
    return !!this.recordings[recordingId];
  }

  getState() {
    return {
      isRecording: this.isRecording,
      detectedMeeting: this.detectedMeeting,
      recordingStartTime: this.recordingStartTime,
      currentMeetingTitle: this.currentMeetingTitle,
      currentMeetingId: this.currentMeetingId,
      activeRecordings: this.getActiveRecordings(),
    };
  }
}

module.exports = { RecordingManager };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/RecordingManager.test.js`
Expected: All 6 PASS

- [ ] **Step 5: Run lint**

Run: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/main/recording/RecordingManager.js tests/unit/RecordingManager.test.js
git commit -m "feat(recording): add RecordingManager orchestrator"
```

---

### Task 3: Create RecallProvider — SDK wrapper

**Files:**
- Create: `src/main/recording/RecallProvider.js`
- Create: `tests/unit/RecallProvider.test.js`

This wraps the existing Recall.ai SDK calls. It does NOT extract from main.js yet — that happens in Task 5. This task creates the class with the correct interface so we can verify the structure before wiring it in.

- [ ] **Step 1: Write failing test**

Create `tests/unit/RecallProvider.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallProvider } from '../../src/main/recording/RecallProvider.js';

// Mock the Recall SDK
const mockSdk = {
  init: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  prepareDesktopAudioRecording: vi.fn().mockResolvedValue('window-key-123'),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  addEventListener: vi.fn(),
};

describe('RecallProvider', () => {
  let provider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RecallProvider(mockSdk);
  });

  it('extends EventEmitter', () => {
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.emit).toBe('function');
  });

  it('initialize calls SDK init', async () => {
    await provider.initialize({ accessToken: 'test', userId: 'host' });
    expect(mockSdk.init).toHaveBeenCalled();
  });

  it('startRecording calls prepareDesktopAudioRecording and startRecording', async () => {
    await provider.initialize({ accessToken: 'test', userId: 'host' });
    const recordingId = await provider.startRecording({
      windowId: 'w1',
      uploadToken: 'tok-123',
    });
    expect(mockSdk.prepareDesktopAudioRecording).toHaveBeenCalled();
    expect(recordingId).toBe('window-key-123');
  });

  it('stopRecording calls SDK stopRecording', async () => {
    await provider.stopRecording('rec-123');
    expect(mockSdk.stopRecording).toHaveBeenCalledWith({ windowId: 'rec-123' });
  });

  it('shutdown calls SDK shutdown', async () => {
    await provider.shutdown();
    expect(mockSdk.shutdown).toHaveBeenCalled();
  });

  it('getState returns initial state', () => {
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.sdkReady).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/RecallProvider.test.js`

- [ ] **Step 3: Implement RecallProvider**

Create `src/main/recording/RecallProvider.js`:

```javascript
const { RecordingProvider } = require('./RecordingProvider');

/**
 * Recording provider that wraps the Recall.ai Desktop SDK.
 *
 * Encapsulates all SDK-specific concerns:
 * - SDK init/shutdown with restart workaround
 * - Meeting detection via SDK events
 * - Audio recording via SDK + upload tokens
 * - Real-time participant events
 */
class RecallProvider extends RecordingProvider {
  constructor(sdk) {
    super();
    this.sdk = sdk;
    this.sdkReady = false;
    this._recording = false;
  }

  async initialize(config) {
    const { accessToken, userId, realtimeEndpoints, createUploadToken } = config;
    this.createUploadToken = createUploadToken;

    const sdkConfig = {
      access_token: accessToken,
      user_id: userId,
    };
    if (realtimeEndpoints) {
      sdkConfig.realtime_endpoints = realtimeEndpoints;
    }

    this.sdk.init(sdkConfig);
    this._registerSdkEventHandlers();

    // Workaround: restart SDK to detect already-open meetings
    await this._restartForDetection(sdkConfig);
  }

  async _restartForDetection(sdkConfig) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    await this.sdk.shutdown();
    await new Promise(resolve => setTimeout(resolve, 3000));
    this.sdk.init(sdkConfig);
    this.sdkReady = true;
    this.emit('sdk-ready');
  }

  _registerSdkEventHandlers() {
    this.sdk.addEventListener('meeting-detected', (event) => {
      const { window: win } = event;
      this.emit('meeting-detected', {
        windowId: win.id,
        platform: win.platform,
        title: win.title,
      });
    });

    this.sdk.addEventListener('meeting-closed', (event) => {
      this.emit('meeting-closed', { windowId: event.window?.id });
    });

    this.sdk.addEventListener('recording-ended', (event) => {
      this._recording = false;
      this.emit('recording-ended', {
        recordingId: event.windowId || event.recordingId,
        audioFilePath: event.filePath,
        uploadData: event,
      });
    });

    this.sdk.addEventListener('upload-progress', (event) => {
      this.emit('upload-progress', event);
    });

    this.sdk.addEventListener('sdk-state-change', (event) => {
      if (event.state === 'recording') {
        this._recording = true;
        this.emit('recording-started', { recordingId: event.windowId });
      }
      this.emit('sdk-state-change', { state: event.state });
    });

    this.sdk.addEventListener('realtime-event', (event) => {
      if (event.type === 'participant_join') {
        this.emit('participant-joined', {
          windowId: event.windowId,
          participant: event.data,
        });
      } else if (event.type === 'speech_activity') {
        this.emit('speech-activity', {
          windowId: event.windowId,
          participantId: event.data?.participantId,
          speaking: event.data?.speaking,
          timestamp: event.data?.timestamp,
        });
      }
    });

    this.sdk.addEventListener('error', (event) => {
      this.emit('error', {
        type: 'sdk-error',
        message: event.message || String(event),
      });
    });
  }

  async startRecording(options) {
    const key = await this.sdk.prepareDesktopAudioRecording();

    if (options.uploadToken) {
      this.sdk.startRecording({
        windowId: key,
        uploadToken: options.uploadToken,
      });
    }

    this._recording = true;
    return key;
  }

  async stopRecording(recordingId) {
    this.sdk.stopRecording({ windowId: recordingId });
  }

  async shutdown() {
    await this.sdk.shutdown();
    this.sdkReady = false;
  }

  getState() {
    return {
      recording: this._recording,
      meetingDetected: false, // Updated via events
      sdkReady: this.sdkReady,
    };
  }
}

module.exports = { RecallProvider };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/RecallProvider.test.js`
Expected: All 6 PASS

- [ ] **Step 5: Create index.js barrel export**

Create `src/main/recording/index.js`:

```javascript
const { RecordingProvider } = require('./RecordingProvider');
const { RecordingManager } = require('./RecordingManager');
const { RecallProvider } = require('./RecallProvider');

module.exports = { RecordingProvider, RecordingManager, RecallProvider };
```

- [ ] **Step 6: Run lint and all unit tests**

Run: `npm run lint && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/main/recording/ tests/unit/RecallProvider.test.js
git commit -m "feat(recording): add RecallProvider SDK wrapper"
```

---

### Task 4: Extract Stream Deck from server.js

**Files:**
- Create: `src/main/services/streamDeckService.js`
- Modify: `src/server.js`

The current server.js (521 lines) hosts both webhook routes AND Stream Deck WebSocket support. The webhooks are for Recall.ai async transcription (being deprecated). Stream Deck stays.

- [ ] **Step 1: Read server.js**

Read `src/server.js` in full. Identify:
- Stream Deck code: the WebSocket upgrade handler, frame encoding/decoding, client management, broadcast functions
- Webhook code: the `/webhook/recall` POST handler, Svix verification, `/start-recording` GET handler
- What exports the rest of the app depends on

- [ ] **Step 2: Create streamDeckService.js**

Extract all Stream Deck WebSocket code from server.js into `src/main/services/streamDeckService.js`. This includes:
- `configureStreamDeck()`
- `setStreamDeckEnabled()`
- `handleStreamDeckUpgrade()`
- `broadcastStreamDeckStatus()`
- `updateStreamDeckRecordingState()`
- `getStreamDeckStatus()`
- All WebSocket frame encoding/decoding helpers
- The connected clients Set

The new file exports all the same functions. The server.js imports from it.

- [ ] **Step 3: Simplify server.js**

Remove from server.js:
- The `/webhook/recall` POST handler and Svix verification
- The localtunnel integration (if referenced)
- The `/start-recording` GET handler (upload token creation — this moves to RecallProvider in Task 5)

Keep in server.js:
- Express app creation
- Stream Deck imports from new streamDeckService.js
- Any other non-recording routes

After this, server.js should be ~50-100 lines, not 521.

- [ ] **Step 4: Verify Stream Deck still works**

The Stream Deck functionality should work identically — same WebSocket behavior, same exports.

Run: `npm run lint && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/main/services/streamDeckService.js src/server.js
git commit -m "refactor(server): extract Stream Deck to streamDeckService, remove webhooks"
```

---

### Task 5: Wire RecordingManager into main.js

**This is the critical task.** Replace the inline recording code in main.js with RecordingManager + RecallProvider.

**Files:**
- Modify: `src/main.js`

**Strategy:** Incremental replacement. Do NOT delete all recording code at once. Instead:
1. Import RecordingManager + RecallProvider at the top
2. Initialize them where SDK init currently happens
3. Replace `activeRecordings` references with `recordingManager` methods
4. Replace `isRecording`, `detectedMeeting`, `sdkReady` globals with `recordingManager.getState()`
5. Replace inline SDK event handlers with RecordingManager event listeners
6. Replace IPC handlers to delegate to RecordingManager
7. Delete the extracted code sections

- [ ] **Step 1: Read main.js recording sections**

Re-read these exact sections (line numbers may have shifted from earlier commits):
- Global state declarations (~lines 370-407)
- `activeRecordings` object (~lines 1959-2013)
- SDK initialization (~lines 2290-2352)
- SDK event handlers (~lines 2361-3091)
- `startManualRecording` IPC handler (~lines 10131-10336)
- `stopManualRecording` IPC handler (~lines 10339-10385)
- `updateSystemTrayMenu` (~lines 794-808)

- [ ] **Step 2: Add imports and initialization**

Near the top of main.js (after other requires), add:

```javascript
const { RecordingManager, RecallProvider } = require('./main/recording');
```

Where the SDK is currently initialized (~line 2290), replace with:

```javascript
// Initialize recording system
const recallSdk = require('@recallai/desktop-sdk').default;
const recallProvider = new RecallProvider(recallSdk);
const recordingManager = new RecordingManager(recallProvider);

await recordingManager.initialize({
  accessToken: recallApiKey,
  userId: os.hostname(),
  createUploadToken: createDesktopSdkUpload,
});
```

- [ ] **Step 3: Replace global state references**

Find all references to these globals and replace:
- `isRecording` → `recordingManager.isRecording`
- `detectedMeeting` → `recordingManager.detectedMeeting`
- `sdkReady` → `recordingManager.provider.sdkReady` (or check via `recordingManager.getState()`)
- `recordingStartTime` → `recordingManager.recordingStartTime`
- `currentRecordingMeetingTitle` → `recordingManager.currentMeetingTitle`
- `currentRecordingMeetingId` → `recordingManager.currentMeetingId`
- `activeRecordings.addRecording(...)` → `recordingManager.addRecording(...)`
- `activeRecordings.removeRecording(...)` → `recordingManager.removeRecording(...)`
- `activeRecordings.hasActiveRecording(...)` → `recordingManager.hasActiveRecording(...)`
- `activeRecordings.getForNote(...)` → `recordingManager.getForNote(...)`
- `activeRecordings.getAll()` → `recordingManager.getActiveRecordings()`
- `activeRecordings.updateState(...)` → `recordingManager.updateState(...)`

**Important:** Use find-and-replace carefully. Some of these are used in 10+ places throughout main.js.

- [ ] **Step 4: Replace SDK event handlers with RecordingManager listeners**

The inline SDK event handlers (~lines 2361-3091) need to be replaced with RecordingManager event listeners. The key difference: RecordingManager events contain normalized data (not raw SDK event objects).

For example, the `meeting-detected` handler that shows the widget and sends a toast:

```javascript
// OLD (inline SDK handler):
RecallAiSdk.addEventListener('meeting-detected', (event) => {
  detectedMeeting = { window: event.window, ... };
  // show widget, send toast, etc.
});

// NEW (RecordingManager listener):
recordingManager.on('meeting-detected', (data) => {
  // data = { windowId, platform, title }
  // show widget, send toast, etc. (same UI logic, different data shape)
});
```

Do this for ALL event handlers. The UI logic (showing widgets, sending toasts, updating tray) stays in main.js — only the SDK-specific code moves to RecallProvider.

The `recording-ended` handler (~lines 2507-2960) is the most complex. Most of its logic (transcription, export, participant matching) is app-level orchestration that stays in main.js as a `recordingManager.on('recording-ended', ...)` listener. Only the raw SDK event parsing moves to RecallProvider.

- [ ] **Step 5: Replace IPC handlers**

Replace `startManualRecording` handler to delegate to RecordingManager:

```javascript
ipcMain.handle('startManualRecording', async (event, meetingId, transcriptionProvider, action) => {
  // ... existing meeting lookup and validation logic stays ...

  // Replace SDK-specific calls with RecordingManager
  const recordingId = await recordingManager.startRecording({
    noteId: validatedId,
    platform: meeting.platform || 'desktop',
    meetingTitle: meeting.title,
    uploadToken: uploadData.upload_token,
  });

  // ... rest of the handler stays (data persistence, etc.) ...
});
```

Replace `stopManualRecording` similarly:

```javascript
ipcMain.handle('stopManualRecording', async (event, recordingId) => {
  const validatedId = RecordingIdSchema.parse(recordingId);
  await recordingManager.stopRecording(validatedId);
  return { success: true };
});
```

- [ ] **Step 6: Delete extracted code**

After all references are replaced:
- Delete the `activeRecordings` object definition (~lines 1959-2013)
- Delete the SDK initialization block (~lines 2290-2352)
- Delete all inline SDK event handler registrations (~lines 2361-3091)
- Delete the recording-related global variable declarations (but NOT the non-recording globals)

- [ ] **Step 7: Run lint and all tests**

Run: `npm run lint && npm test`

If E2E tests exist for recording, run those too:
Run: `npm run test:e2e` (if applicable — requires app to be running with E2E_TEST=1)

- [ ] **Step 8: Commit**

```bash
git add src/main.js
git commit -m "refactor(main): wire RecordingManager, extract ~800 lines of recording code"
```

---

### Task 6: Implement LocalProvider — window monitoring

**Files:**
- Create: `src/main/recording/LocalProvider.js`
- Create: `tests/unit/LocalProvider.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/LocalProvider.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalProvider } from '../../src/main/recording/LocalProvider.js';

describe('LocalProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new LocalProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('extends RecordingProvider', () => {
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.initialize).toBe('function');
    expect(typeof provider.startRecording).toBe('function');
    expect(typeof provider.stopRecording).toBe('function');
  });

  it('getState returns initial state', () => {
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.meetingDetected).toBe(false);
  });

  it('detectMeeting parses Zoom window title', () => {
    // Test the window title parsing logic directly
    const result = provider._parseMeetingFromTitle('Zoom Meeting', 'Zoom.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('zoom');
  });

  it('detectMeeting parses Teams window title', () => {
    const result = provider._parseMeetingFromTitle('Weekly Standup | Microsoft Teams', 'ms-teams.exe');
    expect(result).not.toBeNull();
    expect(result.platform).toBe('teams');
  });

  it('detectMeeting returns null for non-meeting window', () => {
    const result = provider._parseMeetingFromTitle('Visual Studio Code', 'code.exe');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement LocalProvider**

Create `src/main/recording/LocalProvider.js`:

```javascript
const { RecordingProvider } = require('./RecordingProvider');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Local recording provider using window monitoring + FFmpeg WASAPI.
 *
 * Meeting detection: PowerShell polling every 2s for Zoom/Teams window titles.
 * Audio capture: FFmpeg with WASAPI loopback.
 * No real-time participant events — resolved post-meeting via calendar + voice profiles.
 */
class LocalProvider extends RecordingProvider {
  constructor() {
    super();
    this._recording = false;
    this._meetingDetected = false;
    this._detectedWindowId = null;
    this._pollingInterval = null;
    this._ffmpegProcess = null;
    this._currentRecordingId = null;
    this._recordingPath = '';
  }

  async initialize(config) {
    this._recordingPath = config.recordingPath || path.join(
      process.env.APPDATA || '', 'jd-notes-things', 'recordings'
    );

    // Ensure recording directory exists
    if (!fs.existsSync(this._recordingPath)) {
      fs.mkdirSync(this._recordingPath, { recursive: true });
    }

    // Start window monitoring
    this._startPolling();
  }

  _startPolling() {
    this._pollingInterval = setInterval(() => {
      this._pollForMeetings();
    }, 2000);
  }

  async _pollForMeetings() {
    try {
      const windows = await this._getWindowList();
      let foundMeeting = null;

      for (const win of windows) {
        const meeting = this._parseMeetingFromTitle(win.title, win.processName);
        if (meeting) {
          foundMeeting = { ...meeting, windowId: win.id || win.title };
          break;
        }
      }

      if (foundMeeting && !this._meetingDetected) {
        this._meetingDetected = true;
        this._detectedWindowId = foundMeeting.windowId;
        this.emit('meeting-detected', foundMeeting);
      } else if (!foundMeeting && this._meetingDetected) {
        this._meetingDetected = false;
        this.emit('meeting-closed', { windowId: this._detectedWindowId });
        this._detectedWindowId = null;
      }
    } catch (err) {
      // Polling errors are non-fatal — skip this cycle
    }
  }

  async _getWindowList() {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell', [
        '-NoProfile', '-Command',
        'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json',
      ]);

      let stdout = '';
      ps.stdout.on('data', (data) => { stdout += data.toString(); });
      ps.stderr.on('data', () => {}); // Ignore stderr
      ps.on('close', (code) => {
        if (code !== 0) return resolve([]);
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(list.map(w => ({
            id: String(w.Id),
            title: w.MainWindowTitle || '',
            processName: (w.ProcessName || '').toLowerCase() + '.exe',
          })));
        } catch {
          resolve([]);
        }
      });
    });
  }

  _parseMeetingFromTitle(title, processName) {
    if (!title) return null;

    // Zoom: "Zoom Meeting" or "Zoom Webinar" in title
    if (title.includes('Zoom Meeting') || title.includes('Zoom Webinar')) {
      return { platform: 'zoom', title, windowId: title };
    }

    // Teams: " | Microsoft Teams" suffix + ms-teams.exe process
    if (title.endsWith(' | Microsoft Teams') ||
        (processName && processName.includes('ms-teams'))) {
      if (title.includes(' | Microsoft Teams') || title.includes('Microsoft Teams')) {
        return { platform: 'teams', title, windowId: title };
      }
    }

    return null;
  }

  async startRecording(options) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `local-${timestamp}.mp3`;
    const outputPath = path.join(this._recordingPath, filename);

    this._currentRecordingId = timestamp;

    // Start FFmpeg with WASAPI loopback
    await this._startFFmpeg(outputPath);

    this._recording = true;
    this.emit('recording-started', {
      recordingId: this._currentRecordingId,
      windowId: this._detectedWindowId,
    });

    return this._currentRecordingId;
  }

  async _startFFmpeg(outputPath) {
    // Find loopback device
    const device = await this._findLoopbackDevice();

    this._ffmpegProcess = spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', `audio=${device}`,
      '-codec:a', 'libmp3lame',
      '-q:a', '2',
      '-y',
      outputPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this._currentOutputPath = outputPath;

    this._ffmpegProcess.on('close', (code) => {
      this._recording = false;
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        this.emit('recording-ended', {
          recordingId: this._currentRecordingId,
          audioFilePath: outputPath,
        });
      } else {
        this.emit('error', {
          type: 'recording-failed',
          message: `FFmpeg exited with code ${code}, no audio file produced`,
        });
      }
    });
  }

  async _findLoopbackDevice() {
    // Enumerate audio devices and find loopback
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
      ffmpeg.on('close', () => {
        // Parse device list from FFmpeg stderr
        // Look for "Stereo Mix" or similar loopback device
        const lines = stderr.split('\n');
        for (const line of lines) {
          if (line.includes('Stereo Mix') || line.includes('WASAPI loopback') || line.includes('What U Hear')) {
            const match = line.match(/"([^"]+)"/);
            if (match) return resolve(match[1]);
          }
        }
        // Fallback: use first audio device
        for (const line of lines) {
          if (line.includes('(audio)')) {
            const match = line.match(/"([^"]+)"/);
            if (match) return resolve(match[1]);
          }
        }
        reject(new Error('No loopback audio device found. Enable "Stereo Mix" in Windows Sound settings or install a virtual audio cable.'));
      });
    });
  }

  async stopRecording(recordingId) {
    if (this._ffmpegProcess) {
      // Send 'q' to FFmpeg stdin for graceful shutdown
      this._ffmpegProcess.stdin.write('q');
      // FFmpeg will flush and exit, triggering the 'close' handler
    }
  }

  async shutdown() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    if (this._ffmpegProcess) {
      this._ffmpegProcess.stdin.write('q');
    }
  }

  getState() {
    return {
      recording: this._recording,
      meetingDetected: this._meetingDetected,
    };
  }
}

module.exports = { LocalProvider };
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/unit/LocalProvider.test.js`
Expected: All 5 PASS

- [ ] **Step 5: Add LocalProvider to index.js**

Update `src/main/recording/index.js`:

```javascript
const { RecordingProvider } = require('./RecordingProvider');
const { RecordingManager } = require('./RecordingManager');
const { RecallProvider } = require('./RecallProvider');
const { LocalProvider } = require('./LocalProvider');

module.exports = { RecordingProvider, RecordingManager, RecallProvider, LocalProvider };
```

- [ ] **Step 6: Run lint and all tests**

Run: `npm run lint && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/main/recording/LocalProvider.js src/main/recording/index.js tests/unit/LocalProvider.test.js
git commit -m "feat(recording): add LocalProvider with window monitoring + FFmpeg capture"
```

---

### Task 7: Add provider selection to settings

**Files:**
- Modify: `src/renderer/settings.js` (add recording provider dropdown)
- Modify: `src/main.js` (read provider setting at startup, instantiate correct provider)

- [ ] **Step 1: Add provider selection UI**

In the settings panel, add a dropdown for recording provider. Follow the existing pattern used for transcription provider selection. The setting should be stored in localStorage as `recordingProvider` with values `recall` (default) or `local`.

Read `src/renderer/settings.js` to find where transcription provider dropdown is defined and follow the same pattern.

- [ ] **Step 2: Read provider setting at app startup**

In main.js, where the RecordingManager is initialized (from Task 5), read the setting:

```javascript
// Read recording provider preference
const recordingProviderSetting = store.get('recordingProvider', 'recall');

let provider;
if (recordingProviderSetting === 'local') {
  const { LocalProvider } = require('./main/recording');
  provider = new LocalProvider();
} else {
  const RecallAiSdk = require('@recallai/desktop-sdk').default;
  const { RecallProvider } = require('./main/recording');
  provider = new RecallProvider(RecallAiSdk);
}

const recordingManager = new RecordingManager(provider);
```

This means switching providers requires an app restart, which is expected per the spec.

- [ ] **Step 3: Add restart prompt when provider changes**

When the user changes the recording provider in settings, show a toast: "Recording provider changed. Restart the app to apply."

- [ ] **Step 4: Run lint and all tests**

Run: `npm run lint && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings.js src/main.js
git commit -m "feat(settings): add recording provider selection (Recall/Local)"
```

---

### Task 8: Manual integration testing

**Files:** None — verification only

- [ ] **Step 1: Test Recall mode still works**

1. Ensure `recordingProvider` setting is `recall` (or not set — default)
2. Start the app: `npm start`
3. Join a Zoom or Teams meeting
4. Verify meeting is detected (widget appears or toast shows)
5. Start recording manually
6. Let it record for 30 seconds
7. Stop recording
8. Verify transcript is generated

If any step fails, debug and fix before proceeding.

- [ ] **Step 2: Test Local mode basic detection**

1. Set `recordingProvider` to `local` in settings
2. Restart the app
3. Open a Zoom meeting (or Teams)
4. Verify meeting detection fires (widget/toast)
5. Close the meeting window
6. Verify meeting-closed event fires

Note: Audio recording requires a loopback device (Stereo Mix). If not available, the detection test still validates the window monitoring works.

- [ ] **Step 3: Test Local mode recording (if loopback available)**

1. Enable Stereo Mix in Windows Sound settings (or install virtual audio cable)
2. Start a Zoom/Teams meeting with audio
3. Start recording
4. Let it record for 30 seconds
5. Stop recording
6. Verify MP3 file is created in `%APPDATA%/jd-notes-things/recordings/`
7. Verify file is playable and contains audio

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: integration test fixes for recording provider abstraction"
```
