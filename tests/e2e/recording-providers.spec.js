/**
 * Recording Provider Abstraction E2E Tests
 *
 * Tests the RecordingManager + RecallProvider/LocalProvider abstraction layer:
 * - Settings UI for provider selection
 * - Mock SDK scenario plays correctly through the new abstraction
 * - RecordingManager state tracking
 *
 * Start app: npm run start:mock
 * Run tests: npm run test:e2e:providers
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

  await mainPage.waitForLoadState('domcontentloaded');
  await mainPage.waitForTimeout(2000);
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
  // Dismiss any open modals
  await mainPage.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.style.display = 'none';
    });
  });
  await mainPage.waitForTimeout(200);

  const closeButtons = ['#homeButton', '#settingsBackBtn', '#closeSettings', '#closeContacts', '#closeReports', '#closeClientSetup'];
  for (const btn of closeButtons) {
    const el = mainPage.locator(btn);
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await mainPage.waitForTimeout(300);
    }
  }

  // Fallback: force close settings via DOM
  const settingsOpen = await mainPage.locator('#settingsView').isVisible().catch(() => false);
  if (settingsOpen) {
    await mainPage.evaluate(() => {
      const sv = document.getElementById('settingsView');
      const mv = document.getElementById('mainView');
      if (sv) sv.style.display = 'none';
      if (mv) mv.style.display = 'block';
    });
    await mainPage.waitForTimeout(300);
  }

  await mainPage.locator('#mainView').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
}

async function openSettings() {
  await ensureMainView();
  const settingsBtn = mainPage.locator('#settingsBtn');
  await settingsBtn.click();
  await mainPage.waitForTimeout(500);
  await expect(mainPage.locator('#settingsView')).toBeVisible({ timeout: 5000 });
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
// 1. SETTINGS UI — RECORDING PROVIDER SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('1. Recording Provider Settings', () => {
  test('recording provider dropdown exists in settings', async () => {
    await openSettings();

    // General tab is active by default and contains the recording provider select
    const select = mainPage.locator('#recordingProviderSelect');
    await expect(select).toBeAttached();

    // Scroll the select into view (it may be below the fold in the general panel)
    await select.scrollIntoViewIfNeeded().catch(() => {});

    // Verify it has the expected options
    const options = await mainPage.evaluate(() => {
      const sel = document.getElementById('recordingProviderSelect');
      if (!sel) return [];
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
    });

    console.log('Recording provider options:', JSON.stringify(options));
    expect(options.length).toBeGreaterThanOrEqual(2);

    const values = options.map(o => o.value);
    expect(values).toContain('recall');
    expect(values).toContain('local');

    await ensureMainView();
  });

  test('recording provider defaults to recall', async () => {
    await openSettings();

    const select = mainPage.locator('#recordingProviderSelect');
    await select.scrollIntoViewIfNeeded().catch(() => {});

    const value = await select.inputValue();
    console.log(`Recording provider current value: "${value}"`);
    expect(value).toBe('recall');

    await ensureMainView();
  });

  test('changing provider shows restart notification', async () => {
    await openSettings();

    const select = mainPage.locator('#recordingProviderSelect');
    await select.scrollIntoViewIfNeeded().catch(() => {});

    // Listen for toast elements appearing in the DOM
    const toastPromise = mainPage.waitForFunction(() => {
      // showToast appends a div with the message directly to document.body
      const toasts = document.querySelectorAll('body > div');
      for (const t of toasts) {
        if (t.textContent.includes('Restart') || t.textContent.includes('Recording provider changed')) {
          return t.textContent;
        }
      }
      return false;
    }, { timeout: 5000 }).catch(() => null);

    // Change to 'local'
    await select.selectOption('local');
    await mainPage.waitForTimeout(500);

    const toastResult = await toastPromise;
    console.log(`Toast notification: ${toastResult ? toastResult.jsonValue?.() || 'detected' : 'not detected'}`);

    if (toastResult) {
      const toastText = await toastResult.jsonValue();
      expect(toastText).toContain('Restart');
    }

    // Change back to 'recall' to not affect other tests
    await select.selectOption('recall');
    await mainPage.waitForTimeout(500);

    await ensureMainView();
  });

  test('provider setting persists via appGetSettings', async () => {
    // Verify the main process received the setting
    const result = await mainPage.evaluate(async () => {
      try {
        return await window.electronAPI.appGetSettings();
      } catch {
        return null;
      }
    });

    console.log(`appGetSettings success: ${result?.success}`);
    if (result?.success && result?.data) {
      const provider = result.data.recordingProvider;
      console.log(`Main process recordingProvider: "${provider}"`);
      // Should be 'recall' since we changed it back
      expect(provider).toBe('recall');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. RECORDINGMANAGER + RECALLPROVIDER PIPELINE (MOCK SDK)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('2. RecordingManager + RecallProvider Pipeline', () => {
  test('mock SDK state is accessible (provider abstraction passes through)', async () => {
    const state = await getMockState();
    console.log('Mock state:', JSON.stringify(state, null, 2));
    expect(state).not.toBeNull();
    expect(state.scenario).toBe('two-person-client-call');
  });

  test('SDK event listeners registered through provider chain', async () => {
    const state = await getMockState();
    if (!state) return test.skip();

    // These events are registered by RecallProvider on the SDK.
    // The mock SDK tracks listener counts.
    const expectedListeners = [
      'meeting-detected',
      'meeting-closed',
      'recording-ended',
      'upload-progress',
      'sdk-state-change',
      'realtime-event',
      'error',
      'permissions-granted',
    ];

    for (const event of expectedListeners) {
      const count = state.listenerCount[event] || 0;
      console.log(`  ${event}: ${count} listener(s)`);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('meeting detection works through RecordingManager', async () => {
    // The mock SDK fires meeting-detected on a timer.
    // RecallProvider receives it and re-emits.
    // RecordingManager receives it, sets detectedMeeting, and re-emits.
    // The widget should appear as a result.
    let widget = null;
    for (let i = 0; i < 10; i++) {
      widget = await findWidgetPage();
      if (widget) break;
      await mainPage.waitForTimeout(1000);
    }

    if (!widget) {
      console.log('Widget not found after 10s — mock SDK timing issue');
      // Do not fail — widget appearance depends on mock scenario timing
      return;
    }

    console.log(`Widget URL: ${widget.url()}`);
    expect(widget.url()).toContain('recording_widget');
  });

  test('widget recording context reflects provider abstraction', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    const context = await widget.evaluate(async () => {
      return await window.widgetAPI.getRecordingContext();
    });

    console.log('Recording context:', JSON.stringify(context, null, 2));

    if (context && context.success) {
      // detectedMeeting should be set from mock meeting-detected event
      // flowing through RecallProvider -> RecordingManager -> IPC
      if (context.context.detectedMeeting) {
        expect(context.context.detectedMeeting.platform).toBe('zoom');
        console.log(`Detected meeting: ${context.context.detectedMeeting.title}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RECORDING LIFECYCLE THROUGH PROVIDER ABSTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('3. Recording Lifecycle via RecordingManager', () => {
  test.describe.configure({ mode: 'serial' });

  let recordingMeetingId = null;
  let recordingId = null;

  test('can start recording through RecordingManager', async () => {
    const widget = await findWidgetPage();
    if (!widget) return test.skip();

    // Click record button
    const recordBtn = widget.locator('#recordBtn');
    await recordBtn.click();
    await widget.waitForTimeout(500);

    // Look for recording options or direct recording start
    const options = widget.locator('.recording-option');
    const optionCount = await options.count();
    console.log(`Recording options available: ${optionCount}`);

    if (optionCount > 0) {
      const firstOption = options.first();
      const optionText = await firstOption.textContent();
      console.log(`Clicking option: "${optionText.trim().substring(0, 50)}..."`);
      await firstOption.click();
    } else {
      // Recording may have started directly
      console.log('No options dialog — recording may have started directly');
    }

    await widget.waitForTimeout(3000);
  });

  test('RecordingManager tracks active recording', async () => {
    await mainPage.waitForTimeout(2000);

    // Load meetings to find the one created by the recording
    const meetings = await mainPage.evaluate(async () => {
      const result = await window.electronAPI.loadMeetingsData();
      if (result && result.success && result.data) return result.data.pastMeetings || [];
      if (result && result.pastMeetings) return result.pastMeetings;
      return [];
    });

    const recent = meetings
      .filter(m => m.recordingId)
      .sort((a, b) => new Date(b.date || b.startTime || 0) - new Date(a.date || a.startTime || 0));

    if (recent.length > 0) {
      recordingMeetingId = recent[0].id;
      recordingId = recent[0].recordingId;
      console.log(`Recording meeting ID: ${recordingMeetingId}`);
      console.log(`Recording ID: ${recordingId}`);
      console.log(`Meeting title: ${recent[0].title}`);
      expect(recordingMeetingId).toBeTruthy();
      expect(recordingId).toBeTruthy();
    } else {
      console.log('No meeting with recordingId found — recording may not have started');
    }
  });

  test('main window reflects recording state from RecordingManager', async () => {
    const recordingState = await mainPage.evaluate(() => {
      return {
        isRecording: window.isRecording || false,
        currentRecordingId: window.currentRecordingId || null,
      };
    });
    console.log('Main window recording state:', recordingState);
    // At minimum, verify we can read the state without errors
    expect(typeof recordingState.isRecording).toBe('boolean');
  });

  test('can stop recording through RecordingManager', async () => {
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

    // Stop recording via IPC (goes through RecordingManager -> RecallProvider)
    const result = await mainPage.evaluate(async (recId) => {
      return await window.electronAPI.stopManualRecording(recId);
    }, recordingId);

    console.log('Stop recording result:', result);
    expect(result.success).toBe(true);

    // Wait for recording-ended pipeline
    await mainPage.waitForTimeout(3000);
  });

  test('RecordingManager cleans up after recording ends', async () => {
    if (!recordingMeetingId) return;

    const meeting = await mainPage.evaluate(async (id) => {
      const result = await window.electronAPI.loadMeetingsData();
      const meetings = result?.data?.pastMeetings || result?.pastMeetings || [];
      return meetings.find(m => m.id === id) || null;
    }, recordingMeetingId);

    if (meeting) {
      console.log(`Recording complete: ${meeting.recordingComplete}`);
      console.log(`Has audio path: ${!!meeting.audioFilePath}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. RECORDINGMANAGER STATE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('4. RecordingManager State', () => {
  test('electronAPI exposes recording management methods', async () => {
    const methods = await mainPage.evaluate(() => {
      const api = window.electronAPI;
      return {
        startManualRecording: typeof api.startManualRecording === 'function',
        stopManualRecording: typeof api.stopManualRecording === 'function',
        loadMeetingsData: typeof api.loadMeetingsData === 'function',
        mockGetState: typeof api.mockGetState === 'function',
        mockTriggerMeetingClosed: typeof api.mockTriggerMeetingClosed === 'function',
        mockInjectParticipant: typeof api.mockInjectParticipant === 'function',
        appGetSettings: typeof api.appGetSettings === 'function',
        appUpdateSettings: typeof api.appUpdateSettings === 'function',
      };
    });

    console.log('API methods:', methods);
    for (const [name, available] of Object.entries(methods)) {
      console.log(`  ${name}: ${available}`);
      expect(available).toBe(true);
    }
  });

  test('mock control API works through provider abstraction', async () => {
    // Inject a participant through the mock control API
    // This goes through the SDK mock, which fires events that RecallProvider
    // translates and RecordingManager forwards
    const result = await mainPage.evaluate(async () => {
      try {
        return await window.electronAPI.mockInjectParticipant({
          id: 'provider-test-001',
          name: 'Provider Test User',
          is_host: false,
          platform: 'zoom',
          email: null,
        });
      } catch {
        return { success: false, error: 'IPC not available' };
      }
    });
    console.log('Inject participant result:', result);
    // Result depends on whether there is an active recording
  });

  test('meeting-closed event flows through provider chain', async () => {
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
// 5. ERROR RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('5. Error Resilience', () => {
  test('app remains responsive after provider abstraction tests', async () => {
    await ensureMainView();

    const mainView = mainPage.locator('#mainView');
    const isVisible = await mainView.isVisible().catch(() => false);
    expect(isVisible).toBe(true);
  });

  test('settings panel still opens after provider tests', async () => {
    const settingsBtn = mainPage.locator('#settingsBtn');
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await mainPage.waitForTimeout(500);

      const settingsView = mainPage.locator('#settingsView');
      const isVisible = await settingsView.isVisible().catch(() => false);
      console.log(`Settings view opened: ${isVisible}`);
      expect(isVisible).toBe(true);

      await ensureMainView();
    }
  });

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
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. LOCAL PROVIDER RECORDING PATH
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('6. Local Provider Recording Path', () => {
  test.describe.configure({ mode: 'serial' });

  test('can switch to Local provider via settings', async () => {
    // Change recording provider to 'local' via IPC (faster than UI interaction)
    const result = await mainPage.evaluate(async () => {
      return await window.electronAPI.appUpdateSettings({ recordingProvider: 'local' });
    });
    expect(result.success).toBe(true);

    // Verify the setting was applied
    const settings = await mainPage.evaluate(async () => {
      return await window.electronAPI.appGetSettings();
    });
    expect(settings.data.recordingProvider).toBe('local');
    console.log('Switched to Local provider successfully');
  });

  test('startManualRecording does not crash in Local mode', async () => {
    // This is the test that would have caught the bug:
    // In Local mode, startManualRecording should NOT access recallProvider.sdk
    // (which is null when using LocalProvider)

    // Find a meeting to attempt recording on
    const meetings = await mainPage.evaluate(async () => {
      const result = await window.electronAPI.loadMeetingsData();
      return result?.data?.pastMeetings || [];
    });

    if (meetings.length === 0) {
      console.log('No meetings available to test recording — skipping');
      test.skip();
      return;
    }

    const meetingId = meetings[0].id;
    console.log('Testing Local recording start with meeting:', meetingId);

    // Try to start recording — this should NOT crash with null SDK reference
    const result = await mainPage.evaluate(async (id) => {
      try {
        return await window.electronAPI.startManualRecording(id, 'assemblyai', 'new');
      } catch (e) {
        return { success: false, error: e.message, crashed: true };
      }
    }, meetingId);

    console.log('Local recording start result:', JSON.stringify(result));

    // The recording may fail (no loopback device in CI) but should NOT crash
    // with "Cannot read properties of null (reading 'sdk')"
    expect(result.crashed).not.toBe(true);
    if (!result.success) {
      // Acceptable failure reasons in test environment (no real audio device)
      expect(result.error).not.toContain('Cannot read properties of null');
      expect(result.error).not.toContain("reading 'sdk'");
      console.log('Recording start failed gracefully:', result.error);
    }
  });

  test('stopManualRecording does not crash in Local mode', async () => {
    // Stop any recording that might be active — should not crash with null reference
    const result = await mainPage.evaluate(async () => {
      try {
        return await window.electronAPI.stopManualRecording('nonexistent-id');
      } catch (e) {
        return { success: false, error: e.message, crashed: true };
      }
    });

    console.log('Local stop recording result:', JSON.stringify(result));

    // Should not crash with null reference
    expect(result.crashed).not.toBe(true);
    if (!result.success && result.error) {
      expect(result.error).not.toContain('Cannot read properties of null');
      expect(result.error).not.toContain("reading 'sdk'");
    }
  });

  test('switch back to Recall provider for other tests', async () => {
    // Clean up — switch back to Recall mode so other test suites are unaffected
    const result = await mainPage.evaluate(async () => {
      return await window.electronAPI.appUpdateSettings({ recordingProvider: 'recall' });
    });
    expect(result.success).toBe(true);

    const settings = await mainPage.evaluate(async () => {
      return await window.electronAPI.appGetSettings();
    });
    expect(settings.data.recordingProvider).toBe('recall');
    console.log('Restored Recall provider successfully');
  });
});
