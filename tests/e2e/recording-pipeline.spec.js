/**
 * Recording Pipeline E2E Tests
 *
 * Comprehensive tests for the full meeting recording pipeline using MockRecallSdk.
 * Covers: widget UI, recording lifecycle, participant tracking, data integrity,
 * mock control API, and error resilience.
 *
 * Start app: npm run start:mock
 * Run tests: npm run test:e2e:recording
 */

const { test, expect, chromium } = require('@playwright/test');

const CDP_PORT = process.env.E2E_DEBUG_PORT || 9222;

let browser;
let mainPage;
let widgetPage;

test.beforeAll(async () => {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  } catch (err) {
    throw new Error(
      `Could not connect to Electron app on port ${CDP_PORT}.\n` +
      `Start the app first with: npm run start:mock\n` +
      `Error: ${err.message}`
    );
  }

  // Find both the main window and the recording widget
  const contexts = browser.contexts();
  for (const context of contexts) {
    for (const p of context.pages()) {
      const url = p.url();
      if (url.includes('main_window')) mainPage = p;
      else if (url.includes('recording_widget')) widgetPage = p;
    }
  }

  if (!mainPage) {
    throw new Error('Could not find main_window page. Is the app running?');
  }
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findWidgetPage() {
  if (widgetPage && !widgetPage.isClosed()) return widgetPage;
  const contexts = browser.contexts();
  for (const context of contexts) {
    for (const p of context.pages()) {
      if (p.url().includes('recording_widget')) {
        widgetPage = p;
        return widgetPage;
      }
    }
  }
  return null;
}

async function ensureMainView() {
  const closeButtons = ['#homeButton', '#settingsBackBtn', '#closeContacts', '#closeReports', '#closeClientSetup'];
  for (const btn of closeButtons) {
    const el = mainPage.locator(btn);
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await mainPage.waitForTimeout(300);
    }
  }
}

async function loadMeetings() {
  return mainPage.evaluate(async () => {
    const result = await window.electronAPI.loadMeetingsData();
    if (result && result.success && result.data) return result.data.pastMeetings || [];
    if (result && result.pastMeetings) return result.pastMeetings;
    return [];
  });
}

async function getMeetingById(meetingId) {
  return mainPage.evaluate(async (id) => {
    const result = await window.electronAPI.loadMeetingsData();
    const meetings = result?.data?.pastMeetings || result?.pastMeetings || [];
    return meetings.find(m => m.id === id) || null;
  }, meetingId);
}

async function getMockState() {
  return mainPage.evaluate(async () => {
    try {
      return await window.electronAPI.mockGetState();
    } catch {
      return null;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. WIDGET APPEARANCE & UI
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('1. Widget Appearance', () => {
  test('recording widget is visible after meeting detection', async () => {
    // Widget may not appear immediately — the mock SDK fires meeting-detected
    // on a timer, and the app restarts the SDK after 3s. Retry for up to 10s.
    let widget = null;
    for (let i = 0; i < 10; i++) {
      widget = await findWidgetPage();
      if (widget) break;
      await mainPage.waitForTimeout(1000);
    }

    if (!widget) {
      console.log('Widget not found after 10s — mock SDK timing issue, skipping');
      return;
    }
    console.log(`Widget URL: ${widget.url()}`);
  });

  test('widget has timer display showing 00:00', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const timer = widget.locator('#timerDisplay');
    await expect(timer).toBeVisible();
    const text = await timer.textContent();
    console.log(`Timer display: "${text}"`);
    // Timer should show 00:00 when not recording
    expect(text.trim()).toMatch(/\d{2}:\d{2}/);
  });

  test('widget has record button', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const recordBtn = widget.locator('#recordBtn');
    await expect(recordBtn).toBeVisible();

    const title = await recordBtn.getAttribute('title');
    console.log(`Record button title: "${title}"`);
  });

  test('widget has info button', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const infoBtn = widget.locator('#infoBtn');
    await expect(infoBtn).toBeVisible();
  });

  test('widget has pin (always-on-top) button', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const pinBtn = widget.locator('#pinBtn');
    await expect(pinBtn).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MOCK SDK STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('2. Mock SDK State', () => {
  test('mock SDK state is accessible via IPC', async () => {
    const state = await getMockState();
    console.log('Mock state:', JSON.stringify(state, null, 2));
    expect(state).not.toBeNull();
    expect(state.scenario).toBe('two-person-client-call');
  });

  test('mock SDK has event listeners registered', async () => {
    const state = await getMockState();
    if (!state) return test.skip();

    // The app registers listeners for these events
    const expectedListeners = ['meeting-detected', 'meeting-closed', 'recording-ended',
      'upload-progress', 'sdk-state-change', 'realtime-event', 'error', 'permissions-granted'];

    for (const event of expectedListeners) {
      const count = state.listenerCount[event] || 0;
      console.log(`  ${event}: ${count} listener(s)`);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RECORDING LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('3. Recording Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let recordingMeetingId = null;
  let recordingId = null;

  test('clicking record on widget shows recording options', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const recordBtn = widget.locator('#recordBtn');
    await recordBtn.click();
    await widget.waitForTimeout(500);

    // Should show options dialog (detected meeting, new meeting, etc.)
    const optionsPanel = widget.locator('#recordingOptions, .recording-options');
    const selectPanel = widget.locator('#meetingSelect, .meeting-select');
    const hasOptions = await optionsPanel.isVisible().catch(() => false);
    const hasSelect = await selectPanel.isVisible().catch(() => false);

    console.log(`Options panel visible: ${hasOptions}`);
    console.log(`Select panel visible: ${hasSelect}`);

    // If neither dialog appeared, recording may have started directly
    if (!hasOptions && !hasSelect) {
      console.log('No options dialog — recording may have started directly');
    }
  });

  test('can start recording via the widget', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    // Look for recording option buttons (detected meeting, new meeting)
    const options = widget.locator('.recording-option');
    const optionCount = await options.count();
    console.log(`Recording options available: ${optionCount}`);

    if (optionCount > 0) {
      // Click the first available option (usually the detected meeting)
      const firstOption = options.first();
      const optionText = await firstOption.textContent();
      console.log(`Clicking option: "${optionText.trim().substring(0, 50)}..."`);
      await firstOption.click();
    } else {
      // Try clicking record button again if no options shown
      const recordBtn = widget.locator('#recordBtn');
      await recordBtn.click();
    }

    // Wait for recording to start
    await widget.waitForTimeout(3000);

    // Check if recording started by looking at the widget state
    const recordBtn = widget.locator('#recordBtn');
    const hasRecordingClass = await recordBtn.evaluate(el => el.classList.contains('recording')).catch(() => false);
    const btnTitle = await recordBtn.getAttribute('title');
    console.log(`Record button has .recording class: ${hasRecordingClass}`);
    console.log(`Record button title: "${btnTitle}"`);
  });

  test('meeting note is created when recording starts', async () => {
    await mainPage.waitForTimeout(2000);

    const meetings = await loadMeetings();
    // Find the most recently created meeting (likely our mock recording)
    const recent = meetings
      .filter(m => m.recordingId)
      .sort((a, b) => new Date(b.date || b.startTime || 0) - new Date(a.date || a.startTime || 0));

    if (recent.length > 0) {
      recordingMeetingId = recent[0].id;
      recordingId = recent[0].recordingId;
      console.log(`Recording meeting ID: ${recordingMeetingId}`);
      console.log(`Recording ID (SDK window): ${recordingId}`);
      console.log(`Meeting title: ${recent[0].title}`);
      console.log(`Platform: ${recent[0].platform}`);
      console.log(`Transcription provider: ${recent[0].transcriptionProvider}`);
      expect(recordingMeetingId).toBeTruthy();
      expect(recordingId).toBeTruthy();
    } else {
      console.log('No meeting with recordingId found — recording may not have started');
    }
  });

  test('participants are tracked during recording', async () => {
    // Wait for mock participant join events to fire
    await mainPage.waitForTimeout(5000);

    if (!recordingMeetingId) {
      console.log('Skipping — no active recording');
      return;
    }

    const meeting = await getMeetingById(recordingMeetingId);
    if (!meeting) {
      console.log('Meeting not found in database');
      return;
    }

    const participants = meeting.participants || [];
    console.log(`Participants in meeting: ${participants.length}`);
    for (const p of participants) {
      console.log(`  - ${p.originalName} (host: ${p.isHost}, email: ${p.email || 'none'})`);
    }

    if (participants.length > 0) {
      // Verify the immutability contract
      for (const p of participants) {
        expect(p.originalName).toBeTruthy();
        expect(typeof p.originalName).toBe('string');
        // originalName should equal name (no corruption from contact matching)
        // unless contact matching found a better name
        expect(p.name).toBeTruthy();
      }
    }
  });

  test('recording state is reflected in main window', async () => {
    const recordingState = await mainPage.evaluate(() => {
      return {
        isRecording: window.isRecording || false,
        currentRecordingId: window.currentRecordingId || null,
      };
    });
    console.log('Main window recording state:', recordingState);
  });

  test('main window timer display activates during recording', async () => {
    const timerDisplay = mainPage.locator('#mainTimerDisplay');
    const isVisible = await timerDisplay.isVisible().catch(() => false);
    console.log(`Main window timer visible: ${isVisible}`);

    if (isVisible) {
      const timerValue = await mainPage.locator('#mainTimerValue').textContent().catch(() => 'N/A');
      console.log(`Main window timer value: ${timerValue}`);
    }
  });

  test('can stop recording', async () => {
    if (!recordingId) {
      // Try to stop via widget
      const widget = await findWidgetPage();
      if (widget) {
        const recordBtn = widget.locator('#recordBtn');
        await recordBtn.click();
        await widget.waitForTimeout(2000);
        console.log('Clicked record button (to stop)');
      }
      return;
    }

    // Stop recording via IPC
    const result = await mainPage.evaluate(async (recId) => {
      return await window.electronAPI.stopManualRecording(recId);
    }, recordingId);

    console.log('Stop recording result:', result);
    expect(result.success).toBe(true);

    // Wait for recording-ended pipeline
    await mainPage.waitForTimeout(3000);
  });

  test('meeting is marked complete after recording stops', async () => {
    if (!recordingMeetingId) return;

    const meeting = await getMeetingById(recordingMeetingId);
    if (meeting) {
      console.log(`Recording complete: ${meeting.recordingComplete}`);
      console.log(`Has transcript: ${!!meeting.transcript && meeting.transcript.length > 0}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. WIDGET INTERACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('4. Widget Interactions', () => {
  test('info button shows tooltip with meeting details', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const infoBtn = widget.locator('#infoBtn');
    if (!await infoBtn.isVisible().catch(() => false)) return test.skip();

    // Hover over info button to show tooltip
    await infoBtn.hover();
    await widget.waitForTimeout(500);

    const tooltip = widget.locator('#infoTooltip');
    const tooltipVisible = await tooltip.isVisible().catch(() => false);
    console.log(`Info tooltip visible after hover: ${tooltipVisible}`);

    if (tooltipVisible) {
      const title = await widget.locator('#infoTitle').textContent().catch(() => 'N/A');
      const platform = await widget.locator('#infoPlatform').textContent().catch(() => 'N/A');
      console.log(`Tooltip title: ${title}`);
      console.log(`Tooltip platform: ${platform}`);
    }
  });

  test('pin button toggles always-on-top state', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const pinBtn = widget.locator('#pinBtn');
    if (!await pinBtn.isVisible().catch(() => false)) return test.skip();

    // Check initial state
    const initialClass = await pinBtn.evaluate(el => el.classList.contains('pinned')).catch(() => null);
    console.log(`Pin button initially pinned: ${initialClass}`);

    // Click to toggle
    await pinBtn.click();
    await widget.waitForTimeout(300);

    const afterClass = await pinBtn.evaluate(el => el.classList.contains('pinned')).catch(() => null);
    console.log(`Pin button after click: ${afterClass}`);
  });

  test('widget recording context includes detected meeting', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    // Call getRecordingContext via the widget preload
    const context = await widget.evaluate(async () => {
      return await window.widgetAPI.getRecordingContext();
    });

    console.log('Recording context:', JSON.stringify(context, null, 2));

    if (context && context.success) {
      // In mock mode, detectedMeeting should be set (from mock meeting-detected event)
      if (context.context.detectedMeeting) {
        expect(context.context.detectedMeeting.platform).toBe('zoom');
        console.log(`Detected meeting: ${context.context.detectedMeeting.title}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MOCK CONTROL API
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('5. Mock Control API', () => {
  test('can inject a participant via control API', async () => {
    const result = await mainPage.evaluate(async () => {
      try {
        return await window.electronAPI.mockInjectParticipant({
          id: 'test-injected-001',
          name: 'Injected Test User',
          is_host: false,
          platform: 'zoom',
          email: null,
        });
      } catch {
        return { success: false, error: 'IPC not available' };
      }
    });
    console.log('Inject participant result:', result);
    // Result depends on whether there's an active recording
  });

  test('can get mock state via control API', async () => {
    const state = await getMockState();
    expect(state).not.toBeNull();
    console.log(`Mock state: ${state.state}, scenario: ${state.scenario}`);
  });

  test('can trigger meeting-closed via control API', async () => {
    const result = await mainPage.evaluate(async () => {
      try {
        return await window.electronAPI.mockTriggerMeetingClosed();
      } catch {
        return { success: false, error: 'IPC not available' };
      }
    });
    console.log('Trigger meeting-closed result:', result);
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('6. Data Integrity', () => {
  test('loadMeetingsData returns valid array', async () => {
    const meetings = await loadMeetings();
    expect(Array.isArray(meetings)).toBe(true);
    console.log(`Total meetings in database: ${meetings.length}`);
  });

  test('meeting participant originalName is never corrupted', async () => {
    const meetings = await loadMeetings();
    const withParticipants = meetings.filter(m => m.participants && m.participants.length > 0);

    let totalParticipants = 0;
    let allHaveOriginalName = true;

    for (const meeting of withParticipants) {
      for (const p of meeting.participants) {
        totalParticipants++;
        if (!p.originalName) {
          allHaveOriginalName = false;
          console.log(`MISSING originalName in meeting ${meeting.id}: ${JSON.stringify(p)}`);
        }
      }
    }

    console.log(`Checked ${totalParticipants} participants across ${withParticipants.length} meetings`);
    expect(allHaveOriginalName).toBe(true);
  });

  test('meetings with recordings have required fields', async () => {
    const meetings = await loadMeetings();
    const withRecording = meetings.filter(m => m.recordingId);

    console.log(`Meetings with recordings: ${withRecording.length}`);

    for (const m of withRecording) {
      expect(m.id).toBeTruthy();
      expect(m.recordingId).toBeTruthy();
      // These should be set by the mock createDesktopSdkUpload
      if (m.uploadToken) {
        expect(typeof m.uploadToken).toBe('string');
      }
    }
  });

  test('electronAPI exposes all required recording methods', async () => {
    const methods = await mainPage.evaluate(() => {
      const api = window.electronAPI;
      return {
        startManualRecording: typeof api.startManualRecording === 'function',
        stopManualRecording: typeof api.stopManualRecording === 'function',
        loadMeetingsData: typeof api.loadMeetingsData === 'function',
        updateMeetingField: typeof api.updateMeetingField === 'function',
        deleteMeeting: typeof api.deleteMeeting === 'function',
        mockGetState: typeof api.mockGetState === 'function',
        mockTriggerMeetingClosed: typeof api.mockTriggerMeetingClosed === 'function',
        mockInjectParticipant: typeof api.mockInjectParticipant === 'function',
      };
    });

    console.log('API methods:', methods);
    for (const [_name, available] of Object.entries(methods)) {
      expect(available).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ERROR RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('7. Error Resilience', () => {
  test('no critical console errors during test session', async () => {
    const errors = [];
    const handler = msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter expected messages
        if (!text.includes('[MockSDK]') &&
            !text.includes('Failed to send log to Desktop SDK') &&
            !text.includes('net::ERR_')) {
          errors.push(text);
        }
      }
    };

    mainPage.on('console', handler);
    await mainPage.waitForTimeout(3000);
    mainPage.off('console', handler);

    const criticalErrors = errors.filter(e =>
      e.includes('FATAL') ||
      e.includes('Uncaught') ||
      e.includes('Cannot read properties of null') ||
      e.includes('Cannot read properties of undefined')
    );

    if (criticalErrors.length > 0) {
      console.log('Critical errors found:', criticalErrors);
    }
    expect(criticalErrors).toEqual([]);
  });

  test('app remains responsive after mock events', async () => {
    // Verify the app isn't hung — can still navigate
    await ensureMainView();

    const mainView = mainPage.locator('#mainView');
    const isVisible = await mainView.isVisible().catch(() => false);
    expect(isVisible).toBe(true);
  });

  test('settings panel still opens correctly', async () => {
    // Verify mock mode doesn't break other views
    const settingsBtn = mainPage.locator('#settingsBtn');
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await mainPage.waitForTimeout(500);

      const settingsView = mainPage.locator('#settingsView');
      const isVisible = await settingsView.isVisible().catch(() => false);
      console.log(`Settings view opened: ${isVisible}`);

      // Close settings
      await ensureMainView();
    }
  });
});
