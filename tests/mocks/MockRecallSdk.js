/**
 * MockRecallSdk - Test double for @recallai/desktop-sdk
 *
 * Replays scripted meeting scenarios (JSON files) to simulate the full
 * SDK event lifecycle: meeting detection → participant joins → speech
 * events → recording end. Produces a real MP3 file at the expected path
 * so the downstream transcription pipeline works unchanged.
 *
 * Usage:
 *   // In main.js, swap the real SDK for this mock:
 *   const RecallAiSdk = process.env.MOCK_SDK
 *     ? require('../tests/mocks/MockRecallSdk')
 *     : require('@recallai/desktop-sdk');
 *
 * Environment variables:
 *   MOCK_SDK=1              Enable the mock
 *   MOCK_SCENARIO=<name>    Scenario JSON filename (without .json), default: "two-person-client-call"
 *   MOCK_SPEED=<multiplier> Speed up timeline (e.g., 10 = 10x faster), default: 1
 *   MOCK_AUTO_RECORD=1      Auto-start recording after meeting-detected (skip UI click)
 *   MOCK_SKIP_AUDIO=1       Skip copying audio fixture (for pure UI tests)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Event system ────────────────────────────────────────────────────────────

const listeners = new Map();
let activeTimers = [];
let mockState = 'idle'; // idle | recording | paused
let currentWindowId = null;
let recordingPath = null;
let currentScenario = null;
let _initConfig = null;

function addEventListener(eventName, callback) {
  if (!listeners.has(eventName)) {
    listeners.set(eventName, []);
  }
  listeners.get(eventName).push(callback);
}

function removeEventListener(eventName, callback) {
  if (!listeners.has(eventName)) return;
  const cbs = listeners.get(eventName);
  const idx = cbs.indexOf(callback);
  if (idx !== -1) cbs.splice(idx, 1);
}

function emit(eventName, data) {
  const cbs = listeners.get(eventName) || [];
  for (const cb of cbs) {
    try {
      cb(data);
    } catch (err) {
      console.error(`[MockSDK] Error in ${eventName} listener:`, err);
    }
  }
}

// ─── Path resolution ─────────────────────────────────────────────────────────
// When bundled by webpack, __dirname points to .webpack/main/, not tests/mocks/.
// We resolve paths relative to process.cwd() (the project root) which is stable
// in both dev (electron-forge start) and direct node execution.

function getProjectRoot() {
  return process.cwd();
}

// ─── Scenario loading ────────────────────────────────────────────────────────

function loadScenario(scenarioName) {
  const scenarioDir = path.join(getProjectRoot(), 'tests', 'fixtures', 'scenarios');
  const scenarioPath = path.join(scenarioDir, `${scenarioName}.json`);

  if (!fs.existsSync(scenarioPath)) {
    const available = fs.readdirSync(scenarioDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    throw new Error(
      `[MockSDK] Scenario "${scenarioName}" not found at ${scenarioPath}\n` +
      `Available scenarios: ${available.join(', ')}`
    );
  }

  const raw = fs.readFileSync(scenarioPath, 'utf-8');
  return JSON.parse(raw);
}

// ─── Timeline event builders ─────────────────────────────────────────────────
// These translate scenario JSON events into the exact shapes the real SDK emits.

function buildMeetingDetectedEvent(windowId, data) {
  return {
    window: {
      id: windowId,
      platform: data.platform || 'zoom',
      title: data.title || 'Mock Meeting',
    },
  };
}

function buildParticipantJoinEvent(windowId, data) {
  return {
    event: 'participant_events.join',
    window: { id: windowId },
    data: {
      data: {
        participant: {
          id: data.id,
          name: data.name,
          is_host: data.is_host || false,
          platform: data.platform || 'zoom',
          email: data.email || null,
        },
      },
    },
  };
}

function buildSpeechOnEvent(windowId, data) {
  return {
    event: 'participant_events.speech_on',
    window: { id: windowId },
    data: {
      data: {
        participant: {
          id: data.participantId,
          name: data.name || 'Unknown',
        },
        timestamp: data.timestamp || null,
      },
    },
  };
}

function buildSpeechOffEvent(windowId, data) {
  return {
    event: 'participant_events.speech_off',
    window: { id: windowId },
    data: {
      data: {
        participant: {
          id: data.participantId,
          name: data.name || 'Unknown',
        },
        timestamp: data.timestamp || null,
      },
    },
  };
}

function buildRecordingEndedEvent(windowId) {
  return {
    window: { id: windowId },
  };
}

function buildSdkStateChangeEvent(windowId, stateCode) {
  return {
    sdk: { state: { code: stateCode } },
    window: { id: windowId },
  };
}

function buildMeetingClosedEvent(windowId) {
  return {
    window: { id: windowId },
  };
}

// ─── Timeline execution ──────────────────────────────────────────────────────

function runTimeline(scenario, windowId) {
  const speed = parseFloat(process.env.MOCK_SPEED) || 1;
  const timeline = scenario.timeline || [];

  console.log(`[MockSDK] Running scenario "${scenario.name}" with ${timeline.length} events (speed: ${speed}x)`);

  for (const entry of timeline) {
    const delay = Math.round(entry.delayMs / speed);

    const timer = setTimeout(() => {
      // Don't fire events if we've been shut down
      if (!currentScenario) return;

      switch (entry.event) {
        case 'meeting-detected':
          console.log(`[MockSDK] → meeting-detected (${entry.data.platform})`);
          emit('meeting-detected', buildMeetingDetectedEvent(windowId, entry.data));
          break;

        case 'participant-join':
          if (mockState === 'recording') {
            console.log(`[MockSDK] → participant join: ${entry.data.name}`);
            emit('realtime-event', buildParticipantJoinEvent(windowId, entry.data));
          }
          break;

        case 'speech-on':
          if (mockState === 'recording') {
            console.log(`[MockSDK] → speech_on: ${entry.data.name} @ ${entry.data.timestamp?.relative}s`);
            emit('realtime-event', buildSpeechOnEvent(windowId, entry.data));
          }
          break;

        case 'speech-off':
          if (mockState === 'recording') {
            console.log(`[MockSDK] → speech_off: ${entry.data.name} @ ${entry.data.timestamp?.relative}s`);
            emit('realtime-event', buildSpeechOffEvent(windowId, entry.data));
          }
          break;

        default:
          console.warn(`[MockSDK] Unknown timeline event: ${entry.event}`);
      }
    }, delay);

    activeTimers.push(timer);
  }

  // Auto-stop recording after scenario duration (if configured)
  if (scenario.autoStopAfterMs && process.env.MOCK_AUTO_RECORD) {
    const stopDelay = Math.round(scenario.autoStopAfterMs / speed);
    const stopTimer = setTimeout(() => {
      if (mockState === 'recording') {
        console.log(`[MockSDK] Auto-stopping recording after ${scenario.autoStopAfterMs}ms (scenario timer)`);
        stopRecording({ windowId });
      }
    }, stopDelay);
    activeTimers.push(stopTimer);
  }
}

// ─── Audio fixture management ────────────────────────────────────────────────

function copyAudioFixture(scenario, windowId) {
  if (process.env.MOCK_SKIP_AUDIO) {
    console.log('[MockSDK] MOCK_SKIP_AUDIO set, skipping audio fixture copy');
    return;
  }

  if (!scenario.audioFixture) {
    console.warn('[MockSDK] No audioFixture defined in scenario');
    return;
  }

  if (!recordingPath) {
    console.error('[MockSDK] No recording path configured - call init() first');
    return;
  }

  // Resolve the fixture path relative to project root
  const fixturePath = path.join(getProjectRoot(), scenario.audioFixture);

  if (!fs.existsSync(fixturePath)) {
    console.error(`[MockSDK] Audio fixture not found: ${fixturePath}`);
    return;
  }

  // Ensure recording directory exists
  if (!fs.existsSync(recordingPath)) {
    fs.mkdirSync(recordingPath, { recursive: true });
  }

  const destPath = path.join(recordingPath, `windows-desktop-${windowId}.mp3`);
  fs.copyFileSync(fixturePath, destPath);
  console.log(`[MockSDK] Copied audio fixture → ${destPath} (${(fs.statSync(destPath).size / 1024).toFixed(1)}KB)`);
}

// ─── SDK API (matches @recallai/desktop-sdk interface) ───────────────────────

function init(config) {
  _initConfig = config;
  recordingPath = config?.config?.recording_path || null;
  mockState = 'idle';

  const scenarioName = process.env.MOCK_SCENARIO || 'two-person-client-call';

  console.log('[MockSDK] ═══════════════════════════════════════════════════');
  console.log(`[MockSDK] Mock Recall.ai SDK initialized`);
  console.log(`[MockSDK] Scenario: ${scenarioName}`);
  console.log(`[MockSDK] Recording path: ${recordingPath}`);
  console.log('[MockSDK] ═══════════════════════════════════════════════════');

  try {
    currentScenario = loadScenario(scenarioName);
    currentWindowId = `mock-${crypto.randomUUID()}`;

    // Start the timeline (meeting-detected fires first, then participants after recording starts)
    runTimeline(currentScenario, currentWindowId);
  } catch (err) {
    console.error('[MockSDK] Failed to load scenario:', err.message);
  }
}

async function shutdown() {
  console.log('[MockSDK] Shutting down...');
  // Clear all pending timers
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers = [];
  currentScenario = null;
  mockState = 'idle';
}

async function prepareDesktopAudioRecording() {
  // Return the windowId, just like the real SDK
  const windowId = currentWindowId || `mock-${crypto.randomUUID()}`;
  currentWindowId = windowId;
  console.log(`[MockSDK] prepareDesktopAudioRecording → ${windowId}`);
  return windowId;
}

async function startRecording({ windowId, uploadToken }) {
  console.log(`[MockSDK] startRecording(windowId: ${windowId}, uploadToken: ${uploadToken ? '***' : 'none'})`);
  mockState = 'recording';

  // Copy the audio fixture to the expected location
  if (currentScenario) {
    copyAudioFixture(currentScenario, windowId);
  }

  // Emit state change
  emit('sdk-state-change', buildSdkStateChangeEvent(windowId, 'recording'));

  // If participants were scheduled before recording started, re-fire them
  // (The real SDK fires participant events only during an active recording)
  if (currentScenario) {
    const speed = parseFloat(process.env.MOCK_SPEED) || 1;
    const participantEvents = (currentScenario.timeline || [])
      .filter(e => e.event === 'participant-join');

    for (const entry of participantEvents) {
      // Fire immediately if their scheduled time has already passed,
      // otherwise they'll fire from the main timeline
      const timer = setTimeout(() => {
        if (mockState === 'recording') {
          console.log(`[MockSDK] → participant join (post-record-start): ${entry.data.name}`);
          emit('realtime-event', buildParticipantJoinEvent(windowId, entry.data));
        }
      }, Math.round(100 / speed)); // Small delay to ensure recording state is propagated
      activeTimers.push(timer);
    }
  }
}

function stopRecording({ windowId }) {
  console.log(`[MockSDK] stopRecording(windowId: ${windowId})`);

  if (mockState !== 'recording') {
    console.warn(`[MockSDK] stopRecording called but state is "${mockState}", not "recording"`);
  }

  mockState = 'idle';

  // Emit state changes in sequence, matching real SDK behavior
  emit('sdk-state-change', buildSdkStateChangeEvent(windowId, 'idle'));

  // Fire recording-ended after a short delay (real SDK has a small delay too)
  const timer = setTimeout(() => {
    console.log(`[MockSDK] → recording-ended for ${windowId}`);
    emit('recording-ended', buildRecordingEndedEvent(windowId));
  }, 200);
  activeTimers.push(timer);
}

async function uploadRecording({ windowId }) {
  console.log(`[MockSDK] uploadRecording(windowId: ${windowId})`);

  // Simulate upload progress
  const speed = parseFloat(process.env.MOCK_SPEED) || 1;
  const steps = [10, 25, 50, 75, 90, 100];

  for (let i = 0; i < steps.length; i++) {
    const timer = setTimeout(() => {
      emit('upload-progress', {
        progress: steps[i],
        window: { id: windowId },
      });
    }, Math.round((i + 1) * 500 / speed));
    activeTimers.push(timer);
  }

  return { success: true };
}

// ─── Control API (test-only, not in real SDK) ────────────────────────────────

/**
 * Trigger a meeting-closed event programmatically.
 * Useful in E2E tests to simulate the user leaving the meeting.
 */
function triggerMeetingClosed(windowId) {
  const wid = windowId || currentWindowId;
  console.log(`[MockSDK] triggerMeetingClosed(${wid})`);
  emit('meeting-closed', buildMeetingClosedEvent(wid));
}

/**
 * Inject an ad-hoc participant join mid-test.
 */
function injectParticipant(windowId, participantData) {
  const wid = windowId || currentWindowId;
  console.log(`[MockSDK] injectParticipant: ${participantData.name}`);
  emit('realtime-event', buildParticipantJoinEvent(wid, participantData));
}

/**
 * Load and run a different scenario mid-test.
 */
function switchScenario(scenarioName) {
  // Clear existing timeline
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers = [];

  currentScenario = loadScenario(scenarioName);
  currentWindowId = `mock-${crypto.randomUUID()}`;
  runTimeline(currentScenario, currentWindowId);
  console.log(`[MockSDK] Switched to scenario: ${scenarioName}`);
}

/**
 * Get current mock state for assertions.
 */
function getMockState() {
  return {
    state: mockState,
    windowId: currentWindowId,
    scenario: currentScenario?.name || null,
    listenerCount: Array.from(listeners.entries()).reduce(
      (acc, [k, v]) => ({ ...acc, [k]: v.length }), {}
    ),
  };
}

// ─── Module exports ──────────────────────────────────────────────────────────

module.exports = {
  // Standard SDK API (matches @recallai/desktop-sdk)
  init,
  shutdown,
  addEventListener,
  removeEventListener,
  prepareDesktopAudioRecording,
  startRecording,
  stopRecording,
  uploadRecording,

  // Test-only control API
  triggerMeetingClosed,
  injectParticipant,
  switchScenario,
  getMockState,

  // Constants for test assertions
  MOCK: true,
};
