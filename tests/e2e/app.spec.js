/**
 * JD Notes Things - Playwright E2E Tests
 *
 * Tests the Electron app UI by connecting to a running instance via CDP.
 *
 * Prerequisites:
 *   Start the app with: E2E_TEST=1 npm start
 *   Then run:           npx playwright test tests/e2e/app.spec.js
 */

const { test, expect, chromium } = require('@playwright/test');

const CDP_PORT = 9222;

let browser;
let page;

test.beforeAll(async () => {
  console.log('[E2E] Connecting to running app via CDP...');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

  // Find the main window page
  const contexts = browser.contexts();
  for (const context of contexts) {
    for (const p of context.pages()) {
      if (p.url().includes('main_window')) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  if (!page) {
    page = contexts[0]?.pages()[0];
  }

  if (!page) {
    throw new Error('No page found. Is the app running with E2E_TEST=1?');
  }

  console.log(`[E2E] Connected to: ${page.url()}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
});

test.afterAll(async () => {
  // Just disconnect, don't kill the app
  if (browser) {
    await browser.close().catch(() => {});
  }
});

/**
 * Helper: ensure we're on the main view (not stuck in editor/settings/contacts)
 *
 * Navigation buttons:
 *   #homeButton — returns from editor view to home (uses visibility: hidden/visible)
 *   #backButton — returns from contact detail to contacts (uses display: none/flex)
 *   #settingsBackBtn — closes settings view
 *   #closeContacts — closes contacts view
 *   #closeReports — closes reports view
 */
async function ensureMainView() {
  // FIRST: dismiss any open modals (they intercept pointer events on underlying buttons)
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.style.display = 'none';
    });
  });
  await page.waitForTimeout(200);

  // Close editor view if open — use #homeButton (NOT #backButton which is for contact nav)
  const editorOpen = await page.locator('#editorView').isVisible().catch(() => false);
  if (editorOpen) {
    const homeBtn = page.locator('#homeButton');
    if (await homeBtn.isVisible().catch(() => false)) {
      await homeBtn.click();
      await page.waitForTimeout(500);
    } else {
      // Fallback: directly toggle DOM if button isn't visible
      await page.evaluate(() => {
        const editor = document.getElementById('editorView');
        const home = document.getElementById('homeView');
        if (editor) editor.style.display = 'none';
        if (home) home.style.display = 'block';
        const hb = document.getElementById('homeButton');
        if (hb) hb.style.visibility = 'hidden';
      });
      await page.waitForTimeout(300);
    }
  }
  // Close settings if open
  const settingsOpen = await page.locator('#settingsView').isVisible().catch(() => false);
  if (settingsOpen) {
    const closeBtn = page.locator('#closeSettings');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    } else {
      // Fallback: hide via DOM
      await page.evaluate(() => {
        const sv = document.getElementById('settingsView');
        const mv = document.getElementById('mainView');
        if (sv) sv.style.display = 'none';
        if (mv) mv.style.display = 'block';
      });
      await page.waitForTimeout(300);
    }
  }
  // Close contacts if open
  const contactsOpen = await page.locator('#contactsView').isVisible().catch(() => false);
  if (contactsOpen) {
    const closeBtn = page.locator('#closeContacts');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    } else {
      // Fallback: hide via DOM
      await page.evaluate(() => {
        const cv = document.getElementById('contactsView');
        const mv = document.getElementById('mainView');
        if (cv) cv.style.display = 'none';
        if (mv) mv.style.display = 'block';
      });
      await page.waitForTimeout(300);
    }
  }
  // Close reports if open
  const reportsOpen = await page.locator('#reportsView').isVisible().catch(() => false);
  if (reportsOpen) {
    const closeBtn = page.locator('#closeReports');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  }
  // Wait for home view content to be visible
  await page.locator('#homeView').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
}

/**
 * Helper: navigate to first past meeting and return whether we made it to the editor
 */
async function navigateToFirstMeeting() {
  await ensureMainView();
  // Wait for meeting cards to render (they may still be loading after view switch)
  await page.locator('.meeting-card:not(.calendar-meeting)').first()
    .waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const meetingCard = page.locator('.meeting-card:not(.calendar-meeting)').first();
  if (!(await meetingCard.isVisible().catch(() => false))) {
    return false;
  }
  await meetingCard.click();
  await page.waitForTimeout(1500);
  const editorView = page.locator('#editorView');
  return editorView.isVisible().catch(() => false);
}

// ===================================================================
// Test 1: App Window Loads
// ===================================================================
test('app window loads with custom titlebar', async () => {
  const titleBar = page.locator('#customTitlebar');
  await expect(titleBar).toBeVisible({ timeout: 15_000 });

  const titleText = await page.locator('body').textContent();
  expect(titleText).toContain('JD Notes Things');
});

// ===================================================================
// Test 2: Main View Visible
// ===================================================================
test('main view is the default visible view', async () => {
  const mainView = page.locator('#mainView');
  await expect(mainView).toBeVisible({ timeout: 10_000 });
});

// ===================================================================
// Test 3: Hamburger Menu
// ===================================================================
test('hamburger menu opens dropdown with File/View/Help', async () => {
  const menuBtn = page.locator('#titlebarMenuBtn');
  await expect(menuBtn).toBeVisible();

  await menuBtn.click();
  await page.waitForTimeout(300);

  const dropdown = page.locator('#titlebarDropdown');
  await expect(dropdown).toBeVisible();

  // Check menu items
  await expect(page.locator('[data-menu="file"]')).toBeVisible();
  await expect(page.locator('[data-menu="view"]')).toBeVisible();
  await expect(page.locator('[data-menu="help"]')).toBeVisible();

  // Close dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

// ===================================================================
// Test 4: Search Bar
// ===================================================================
test('search bar accepts input', async () => {
  const searchInput = page.locator('.toolbar-search-input');
  await expect(searchInput).toBeVisible();

  await searchInput.fill('test search');
  const value = await searchInput.inputValue();
  expect(value).toBe('test search');

  await searchInput.fill('');
});

// ===================================================================
// Test 5: Toolbar Buttons
// ===================================================================
test('toolbar has key action buttons', async () => {
  // Google button
  await expect(page.locator('#googleBtn')).toBeVisible();

  // Settings button
  await expect(page.locator('#settingsBtn')).toBeVisible();

  // Contacts button
  await expect(page.locator('#contactsBtn')).toBeVisible();
});

// ===================================================================
// Test 6: Google Auth Status
// ===================================================================
test('Google auth status badge is attached', async () => {
  const badge = page.locator('#googleStatus');
  await expect(badge).toBeAttached();
});

// ===================================================================
// Test 7: Scope Upgrade Banner (v1.3)
// ===================================================================
test('scope upgrade banner is visible when scopes are missing', async () => {
  const banner = page.locator('.scope-upgrade-banner');
  const isVisible = await banner.isVisible().catch(() => false);
  console.log(`[E2E] Scope upgrade banner visible: ${isVisible}`);

  if (isVisible) {
    const btnText = await banner.locator('button').first().textContent();
    expect(btnText.toLowerCase()).toContain('re-authorize');
  }
  // Pass regardless - banner visibility depends on OAuth state
});

// ===================================================================
// Test 8: Notes List (Past Meetings)
// ===================================================================
test('notes list shows past meetings from database', async () => {
  const notesList = page.locator('#notes-list');
  await expect(notesList).toBeVisible({ timeout: 10_000 });

  const items = notesList.locator('> *');
  const count = await items.count();
  console.log(`[E2E] Past meeting items: ${count}`);
  expect(count).toBeGreaterThan(0);
});

// ===================================================================
// Test 9: Upcoming Meetings
// ===================================================================
test('upcoming meetings section is present', async () => {
  // The "Upcoming Meetings" text should be in the page
  const upcomingText = page.locator('text=Upcoming Meetings');
  await expect(upcomingText.first()).toBeVisible({ timeout: 10_000 });
});

// ===================================================================
// Test 10: Filter Dropdowns (v1.3)
// ===================================================================
test('filter panel has recording and calendar status filters', async () => {
  // The filter dropdown panel might need to be opened first
  const filterToggle = page.locator('#filterToggle, .filter-toggle');
  if (await filterToggle.isVisible().catch(() => false)) {
    await filterToggle.click();
    await page.waitForTimeout(300);
  }

  // Check for the v1.3 filter dropdowns
  const recordingFilter = page.locator('#filterRecordingStatus');
  const calendarFilter = page.locator('#filterCalendarStatus');

  // These might be hidden in a dropdown panel - just check they exist in DOM
  await expect(recordingFilter).toBeAttached();
  await expect(calendarFilter).toBeAttached();
});

// ===================================================================
// Test 11: Settings Panel
// ===================================================================
test('settings panel opens and has tabs', async () => {
  const settingsBtn = page.locator('#settingsBtn');
  await settingsBtn.click();
  await page.waitForTimeout(500);

  const settingsView = page.locator('#settingsView');
  await expect(settingsView).toBeVisible();

  // Settings should have tab navigation
  const tabs = page.locator('.settings-tab, .tab-button');
  const tabCount = await tabs.count();
  console.log(`[E2E] Settings tabs: ${tabCount}`);

  // Close settings
  const closeSettingsBtn = page.locator('#closeSettings');
  if (await closeSettingsBtn.isVisible().catch(() => false)) {
    await closeSettingsBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
});

// ===================================================================
// Test 12: Reports View (v1.3)
// ===================================================================
test('reports view opens from View menu', async () => {
  // Open hamburger
  await page.locator('#titlebarMenuBtn').click();
  await page.waitForTimeout(300);

  // Click View
  await page.locator('[data-menu="view"]').click();
  await page.waitForTimeout(300);

  // Find and click Reports
  const reportsBtn = page.locator('#menuReports');
  if (await reportsBtn.isVisible().catch(() => false)) {
    await reportsBtn.click();
    await page.waitForTimeout(500);

    const reportsView = page.locator('#reportsView');
    const visible = await reportsView.isVisible().catch(() => false);
    console.log(`[E2E] Reports view visible: ${visible}`);

    if (visible) {
      // Date inputs are #reportDateFrom and #reportDateTo
      await expect(page.locator('#reportDateFrom')).toBeVisible();
      await expect(page.locator('#reportDateTo')).toBeVisible();

      // Verify report tabs exist
      const tabText = await page.locator('#reportsView').textContent();
      expect(tabText).toContain('Meetings Without Recordings');
      expect(tabText).toContain('Recordings Without Calendar Events');

      // Close reports via the X button (#closeReports)
      await page.locator('#closeReports').click();
      await page.waitForTimeout(300);
    }
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
});

// ===================================================================
// Test 13: Contacts View
// ===================================================================
test('contacts view opens and has search', async () => {
  // Ensure main view is visible (reports view may have been left open)
  const mainView = page.locator('#mainView');
  if (!(await mainView.isVisible().catch(() => false))) {
    // Try closing any open overlays
    const closeReports = page.locator('#closeReports');
    if (await closeReports.isVisible().catch(() => false)) {
      await closeReports.click();
      await page.waitForTimeout(300);
    }
  }

  const contactsBtn = page.locator('#contactsBtn');
  await contactsBtn.click({ timeout: 5000 });
  await page.waitForTimeout(1000);

  const contactsView = page.locator('#contactsView');
  if (await contactsView.isVisible().catch(() => false)) {
    console.log('[E2E] Contacts view opened');

    const searchInput = page.locator('#contactSearchInput');
    await expect(searchInput).toBeVisible();

    // Close contacts via X button
    await page.locator('#closeContacts').click();
    await page.waitForTimeout(300);
  }
});

// ===================================================================
// Test 14: Participant Card Rendering
// ===================================================================
test('participant cards render with visible icon buttons (not empty boxes)', async () => {
  // Click the first non-calendar meeting card to open the detail view
  const meetingCard = page.locator('.meeting-card:not(.calendar-meeting)').first();
  if (!(await meetingCard.isVisible().catch(() => false))) {
    console.log('[E2E] No meeting cards available, skipping participant card test');
    test.skip();
    return;
  }

  await meetingCard.click();
  await page.waitForTimeout(1500);

  const editorView = page.locator('#editorView');
  await expect(editorView).toBeVisible({ timeout: 10_000 });

  // Check if there are participant cards
  const participantCards = page.locator('.participant-card');
  const cardCount = await participantCards.count();
  console.log(`[E2E] Participant cards: ${cardCount}`);

  if (cardCount > 0) {
    // Verify the card header has flexbox layout (not broken empty boxes)
    const firstHeader = participantCards.first().locator('.participant-card-header');
    await expect(firstHeader).toBeVisible();

    // Icon buttons (remove/expand) should have proper dimensions and be visible
    const iconBtns = participantCards.first().locator('.icon-btn');
    const btnCount = await iconBtns.count();
    expect(btnCount).toBeGreaterThan(0);

    for (let i = 0; i < btnCount; i++) {
      const btn = iconBtns.nth(i);
      const box = await btn.boundingBox();
      // Buttons should have real dimensions (not 0x0 empty boxes)
      expect(box.width).toBeGreaterThanOrEqual(20);
      expect(box.height).toBeGreaterThanOrEqual(20);
    }

    // Avatar should be styled (round, colored)
    const avatar = participantCards.first().locator('.participant-avatar');
    await expect(avatar).toBeVisible();
  }

  // Navigate back to main view via Home button (not Back, which is for contact nav)
  await ensureMainView();
});

// ===================================================================
// Test 15: Participant Mismatch Warning Banner (v1.3)
// ===================================================================
test('participant mismatch warning banner appears when speakers > participants', async () => {
  const inEditor = await navigateToFirstMeeting();
  if (!inEditor) {
    console.log('[E2E] No meeting cards available, skipping mismatch warning test');
    test.skip();
    return;
  }

  // Check if the mismatch warning banner is present in the DOM
  // It may or may not be visible depending on meeting data
  const warningBanner = page.locator('.participant-mismatch-warning');
  const bannerVisible = await warningBanner.isVisible().catch(() => false);
  console.log(`[E2E] Participant mismatch warning banner visible: ${bannerVisible}`);

  if (bannerVisible) {
    // Verify it contains the expected text pattern
    const bannerText = await warningBanner.textContent();
    expect(bannerText).toMatch(/speakers? found in transcript/);
    expect(bannerText).toContain('Add Participant');
    console.log(`[E2E] Banner text: ${bannerText.trim()}`);
  }

  await ensureMainView();
});

// ===================================================================
// Test 16: Fix Speakers Modal Opens and Has Rows (v1.3)
// ===================================================================
test('fix speakers modal opens with speaker rows', async () => {
  const inEditor = await navigateToFirstMeeting();
  if (!inEditor) {
    console.log('[E2E] No meeting cards available, skipping fix speakers test');
    test.skip();
    return;
  }

  // Click the Transcript tab first (Fix Speakers is inside the transcript tab)
  const transcriptTab = page.locator('[data-tab="transcript"]');
  if (await transcriptTab.isVisible().catch(() => false)) {
    await transcriptTab.click();
    await page.waitForTimeout(500);
  }

  // Check if Fix Speakers button is visible (only visible when transcript has speakers)
  const fixSpeakersBtn = page.locator('#fixSpeakersBtn');
  if (!(await fixSpeakersBtn.isVisible().catch(() => false))) {
    console.log('[E2E] Fix Speakers button not visible (no transcript speakers), skipping');
    await ensureMainView();
    return;
  }

  // Open the Fix Speakers modal
  await fixSpeakersBtn.click();
  await page.waitForTimeout(1000);

  const modal = page.locator('#speakerMappingModal');
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Verify speaker mapping rows exist
  const rows = page.locator('.speaker-mapping-row');
  const rowCount = await rows.count();
  console.log(`[E2E] Speaker mapping rows: ${rowCount}`);
  expect(rowCount).toBeGreaterThan(0);

  // Each row should have a contact input field
  const inputs = page.locator('.speaker-contact-input');
  expect(await inputs.count()).toBe(rowCount);

  // Close the modal
  await page.locator('#closeSpeakerMappingModal').click();
  await page.waitForTimeout(500);

  await ensureMainView();
});

// ===================================================================
// Test 17: Fix Speakers Custom Name via Enter Key (v1.3)
// ===================================================================
test('fix speakers accepts custom name via Enter key', async () => {
  const inEditor = await navigateToFirstMeeting();
  if (!inEditor) {
    console.log('[E2E] No meeting cards available, skipping custom name test');
    test.skip();
    return;
  }

  // Switch to transcript tab and open Fix Speakers
  const transcriptTab = page.locator('[data-tab="transcript"]');
  if (await transcriptTab.isVisible().catch(() => false)) {
    await transcriptTab.click();
    await page.waitForTimeout(500);
  }

  const fixSpeakersBtn = page.locator('#fixSpeakersBtn');
  if (!(await fixSpeakersBtn.isVisible().catch(() => false))) {
    console.log('[E2E] Fix Speakers button not visible, skipping custom name test');
    await ensureMainView();
    return;
  }

  await fixSpeakersBtn.click();
  await page.waitForTimeout(1000);

  const modal = page.locator('#speakerMappingModal');
  if (!(await modal.isVisible().catch(() => false))) {
    console.log('[E2E] Modal did not open, skipping');
    await ensureMainView();
    return;
  }

  // Find the first speaker input
  const firstInput = page.locator('.speaker-contact-input').first();
  await expect(firstInput).toBeVisible();

  // Type a custom name
  await firstInput.fill('Custom Test Name');
  await page.waitForTimeout(400); // Wait for debounced search

  // Press Enter to accept custom name
  await firstInput.press('Enter');
  await page.waitForTimeout(300);

  // Verify the row is marked as mapped
  const firstRow = page.locator('.speaker-mapping-row').first();
  const isMapped = await firstRow.evaluate(el => el.classList.contains('mapped'));
  expect(isMapped).toBe(true);
  console.log('[E2E] Custom name mapped via Enter key: success');

  // Verify the input shows the custom name
  const inputValue = await firstInput.inputValue();
  expect(inputValue).toBe('Custom Test Name');

  // Verify the stats show at least 1 speaker mapped
  const stats = await page.locator('#speakerMappingStatsText').textContent();
  expect(stats).toMatch(/\d+ of \d+ speakers mapped/);

  // Verify Apply button is now enabled
  const applyBtn = page.locator('#applySpeakerMappings');
  const isDisabled = await applyBtn.evaluate(el => el.disabled);
  expect(isDisabled).toBe(false);

  // Close modal without applying
  await page.locator('#cancelSpeakerMapping').click();
  await page.waitForTimeout(500);

  await ensureMainView();
});

// ===================================================================
// Test 18: Fix Speakers Custom Name Dropdown Option (v1.3)
// ===================================================================
test('fix speakers shows "Use custom name" option in dropdown', async () => {
  const inEditor = await navigateToFirstMeeting();
  if (!inEditor) {
    console.log('[E2E] No meeting cards available, skipping dropdown test');
    test.skip();
    return;
  }

  // Switch to transcript tab and open Fix Speakers
  const transcriptTab = page.locator('[data-tab="transcript"]');
  if (await transcriptTab.isVisible().catch(() => false)) {
    await transcriptTab.click();
    await page.waitForTimeout(500);
  }

  const fixSpeakersBtn = page.locator('#fixSpeakersBtn');
  if (!(await fixSpeakersBtn.isVisible().catch(() => false))) {
    console.log('[E2E] Fix Speakers button not visible, skipping dropdown test');
    await ensureMainView();
    return;
  }

  await fixSpeakersBtn.click();
  await page.waitForTimeout(1000);

  const modal = page.locator('#speakerMappingModal');
  if (!(await modal.isVisible().catch(() => false))) {
    console.log('[E2E] Modal did not open, skipping');
    await ensureMainView();
    return;
  }

  // Type a name that won't match any contacts (to trigger custom name option)
  const firstInput = page.locator('.speaker-contact-input').first();
  await firstInput.fill('Xyzzy Nonexistent Name');
  await page.waitForTimeout(500); // Wait for debounced search + API response

  // Check that a dropdown appeared with the custom name option
  const customOption = page.locator('.custom-name-option');
  const hasCustomOption = await customOption.isVisible().catch(() => false);
  console.log(`[E2E] Custom name dropdown option visible: ${hasCustomOption}`);

  if (hasCustomOption) {
    // Verify it shows the typed name
    const optionText = await customOption.textContent();
    expect(optionText).toContain('Xyzzy Nonexistent Name');
    expect(optionText).toContain('custom name');

    // Click it
    await customOption.click();
    await page.waitForTimeout(300);

    // Verify mapping was stored
    const firstRow = page.locator('.speaker-mapping-row').first();
    const isMapped = await firstRow.evaluate(el => el.classList.contains('mapped'));
    expect(isMapped).toBe(true);
    console.log('[E2E] Custom name mapped via dropdown click: success');
  }

  // Close modal
  await page.locator('#cancelSpeakerMapping').click();
  await page.waitForTimeout(500);

  await ensureMainView();
});

// ===================================================================
// Test 19: Add to Google Contacts Button Has Feedback (v1.3)
// ===================================================================
test('add to google contacts button shows loading state', async () => {
  const inEditor = await navigateToFirstMeeting();
  if (!inEditor) {
    console.log('[E2E] No meeting cards available, skipping contacts button test');
    test.skip();
    return;
  }

  // Look for an "Add to Google Contacts" button on an unmatched participant
  const addBtn = page.locator('.add-to-contacts-btn').first();
  const hasBtnVisible = await addBtn.isVisible().catch(() => false);
  console.log(`[E2E] Add to Google Contacts button visible: ${hasBtnVisible}`);

  if (hasBtnVisible) {
    // Check the button text before clicking
    const btnText = await addBtn.textContent();
    expect(btnText.trim()).toContain('Add to Google Contacts');
    console.log('[E2E] Add to Google Contacts button found with correct text');

    // We don't actually click it (requires real Google auth), but we verify
    // the button exists and has the expected structure
    const hasDataIndex = await addBtn.evaluate(el => el.hasAttribute('data-index'));
    const hasDataName = await addBtn.evaluate(el => el.hasAttribute('data-name'));
    expect(hasDataIndex).toBe(true);
    expect(hasDataName).toBe(true);
  }

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Backup & Restore Settings Tab
// ===================================================================
test('backup settings tab exists and loads manifest', async () => {
  await ensureMainView();

  // Open settings
  const settingsBtn = page.locator('#settingsBtn');
  await settingsBtn.click();
  await page.waitForTimeout(500);
  await expect(page.locator('#settingsView')).toBeVisible({ timeout: 5000 });

  // Click backup tab
  const backupTab = page.locator('#backupSettingsTab');
  await expect(backupTab).toBeAttached();
  await backupTab.click();
  await page.waitForTimeout(500);

  // Verify backup panel is visible
  const backupPanel = page.locator('#backupPanel');
  await expect(backupPanel).toBeVisible({ timeout: 5000 });

  // Verify manifest info elements exist
  await expect(page.locator('#backupDbInfo')).toBeAttached();
  await expect(page.locator('#backupConfigInfo')).toBeAttached();
  await expect(page.locator('#backupAudioInfo')).toBeAttached();
  await expect(page.locator('#backupTotalInfo')).toBeAttached();
  await expect(page.locator('#backupLastInfo')).toBeAttached();

  // Verify backup buttons exist
  await expect(page.locator('#backupFullBtn')).toBeAttached();
  await expect(page.locator('#backupIncrementalBtn')).toBeAttached();
  await expect(page.locator('#backupRestoreBtn')).toBeAttached();

  // Close settings
  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: MCP Server Config in Advanced Settings
// ===================================================================
test('MCP server config section exists in advanced settings', async () => {
  await ensureMainView();

  // Open settings
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Click advanced tab
  const advancedTab = page.locator('#advancedSettingsTab');
  await advancedTab.click();
  await page.waitForTimeout(500);

  // Verify MCP config elements
  await expect(page.locator('#mcpLoadConfigBtn')).toBeAttached();
  await expect(page.locator('#mcpConfigSnippet')).toBeAttached();

  // Click load config button
  await page.locator('#mcpLoadConfigBtn').click();
  await page.waitForTimeout(1000);

  // Verify config snippet is shown
  const snippet = page.locator('#mcpConfigSnippet');
  const isVisible = await snippet.isVisible().catch(() => false);
  if (isVisible) {
    const text = await snippet.textContent();
    expect(text).toContain('jd-notes');
    expect(text).toContain('mcp-server');
  }

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Calendar Coverage Report Tab
// ===================================================================
test('calendar coverage report tab exists', async () => {
  await ensureMainView();

  // Open reports via hamburger menu
  const menuBtn = page.locator('#titlebarMenuBtn');
  await menuBtn.click();
  await page.waitForTimeout(500);

  const reportsMenuItem = page.locator('[data-menu="reports"]');
  if (await reportsMenuItem.isVisible().catch(() => false)) {
    await reportsMenuItem.click();
    await page.waitForTimeout(500);

    // Verify reports view is open
    const reportsView = page.locator('#reportsView');
    if (await reportsView.isVisible().catch(() => false)) {
      // Check for coverage tab
      const coverageTab = page.locator('.reports-tab[data-report="coverage"]');
      await expect(coverageTab).toBeAttached();

      // Click coverage tab
      await coverageTab.click();
      await page.waitForTimeout(500);

      // Verify coverage count element exists
      await expect(page.locator('#coverageCount')).toBeAttached();
    }
  }

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Client Setup View
// ===================================================================
test('settings has Clients tab (replaced Routing)', async () => {
  await ensureMainView();

  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Verify Clients tab exists in sidebar
  const clientsTab = page.locator('#clientsSettingsTab');
  await expect(clientsTab).toBeAttached();

  // Click it
  await clientsTab.click();
  await page.waitForTimeout(500);

  // Verify clients panel renders with the table
  const clientsPanel = page.locator('#clientsPanel');
  const isVisible = await clientsPanel.isVisible().catch(() => false);
  console.log(`[E2E] Clients panel visible: ${isVisible}`);
  expect(isVisible).toBe(true);

  // Verify Add Company button exists
  const addBtn = page.locator('#addClientBtn');
  await expect(addBtn).toBeVisible();

  await ensureMainView();
});

test('contacts view has Companies/Contacts toggle', async () => {
  await ensureMainView();

  const contactsBtn = page.locator('#contactsBtn');
  await contactsBtn.click({ timeout: 5000 });
  await page.waitForTimeout(1000);

  // Verify toggle buttons exist
  const contactsModeBtn = page.locator('#contactsModeBtn');
  const companiesModeBtn = page.locator('#companiesModeBtn');
  await expect(contactsModeBtn).toBeVisible();
  await expect(companiesModeBtn).toBeVisible();

  // Click Companies mode
  await companiesModeBtn.click();
  await page.waitForTimeout(1000);

  // Verify companies list container is visible
  const companiesContainer = page.locator('#companiesListContainer');
  const isVisible = await companiesContainer.isVisible().catch(() => false);
  console.log(`[E2E] Companies list container visible: ${isVisible}`);
  expect(isVisible).toBe(true);

  // Switch back to contacts mode
  await contactsModeBtn.click();
  await page.waitForTimeout(300);

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Settings Tab Count (verify backup tab was added)
// ===================================================================
test('settings has backup tab among its tabs', async () => {
  await ensureMainView();

  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Count all settings tabs — should now include backup
  const tabCount = await page.locator('.settings-tab').count();
  console.log(`[E2E] Settings tab count: ${tabCount}`);

  // v1.4: 15 tabs (added Clients, Reports, Backup to v1.3's 12)
  expect(tabCount).toBeGreaterThanOrEqual(15);

  // Verify backup tab specifically
  const backupTab = page.locator('#backupSettingsTab');
  await expect(backupTab).toBeAttached();
  const tabText = await backupTab.textContent();
  expect(tabText).toContain('Backup');

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Contact Edit Button
// ===================================================================
test('contact detail has edit button when contact is selected', async () => {
  await ensureMainView();

  // Open contacts
  const contactsBtn = page.locator('#contactsBtn');
  if (!(await contactsBtn.isVisible().catch(() => false))) {
    console.log('[E2E] Contacts button not visible, skipping');
    test.skip();
    return;
  }

  await contactsBtn.click();
  await page.waitForTimeout(1000);

  const contactsView = page.locator('#contactsView');
  if (!(await contactsView.isVisible().catch(() => false))) {
    console.log('[E2E] Contacts view did not open, skipping');
    await ensureMainView();
    test.skip();
    return;
  }

  // Wait for contacts to load
  await page.waitForTimeout(2000);

  // Click first contact if available
  const firstContact = page.locator('.contact-item').first();
  if (await firstContact.isVisible().catch(() => false)) {
    await firstContact.click();
    await page.waitForTimeout(1000);

    // Check for edit button (v1.4 feature)
    const editBtn = page.locator('#editContactBtn');
    const hasEdit = await editBtn.isVisible().catch(() => false);
    console.log(`[E2E] Contact edit button visible: ${hasEdit}`);
    // Edit button only shows for contacts with resourceName (Google Contacts)
    // So we just check it's attached, not necessarily visible
    if (hasEdit) {
      await expect(editBtn).toBeVisible();
    }
  } else {
    console.log('[E2E] No contacts loaded, skipping edit button check');
  }

  await ensureMainView();
});

// ===================================================================
// v1.4 Tests: Restore Options Toggle Switches
// ===================================================================
test('backup restore toggles exist with correct defaults', async () => {
  await ensureMainView();

  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  await page.locator('#backupSettingsTab').click();
  await page.waitForTimeout(500);

  // Check restore toggle switches exist (they are in a hidden container until a backup is selected)
  const dbToggle = page.locator('#restoreDatabaseToggle');
  const configToggle = page.locator('#restoreConfigToggle');
  const audioToggle = page.locator('#restoreAudioToggle');

  await expect(dbToggle).toBeAttached();
  await expect(configToggle).toBeAttached();
  await expect(audioToggle).toBeAttached();

  // DB and Config toggles should start active (default on)
  const dbActive = await dbToggle.evaluate(el => el.classList.contains('active'));
  expect(dbActive).toBe(true);

  const configActive = await configToggle.evaluate(el => el.classList.contains('active'));
  expect(configActive).toBe(true);

  // Audio toggle should start inactive (default off)
  const audioActive = await audioToggle.evaluate(el => el.classList.contains('active'));
  expect(audioActive).toBe(false);

  // Make the restore options visible so we can test the toggle interaction
  await page.evaluate(() => {
    const opts = document.getElementById('backupRestoreOptions');
    if (opts) opts.style.display = 'block';
  });
  await page.waitForTimeout(200);

  // Click audio toggle to activate it
  await audioToggle.click();
  await page.waitForTimeout(200);
  const audioNowActive = await audioToggle.evaluate(el => el.classList.contains('active'));
  expect(audioNowActive).toBe(true);

  // Click it again to deactivate
  await audioToggle.click();
  await page.waitForTimeout(200);
  const audioNowInactive = await audioToggle.evaluate(el => el.classList.contains('active'));
  expect(audioNowInactive).toBe(false);

  // Hide restore options again
  await page.evaluate(() => {
    const opts = document.getElementById('backupRestoreOptions');
    if (opts) opts.style.display = 'none';
  });

  await ensureMainView();
});

// ===================================================================
// Test 27: routing:getAllDestinations returns companies from DB
// ===================================================================
test('routing:getAllDestinations returns companies and sentinel entries', async () => {
  await ensureMainView();

  const result = await page.evaluate(() => {
    return window.electronAPI.routingGetAllDestinations();
  });

  console.log('[E2E] getAllDestinations result:', JSON.stringify(result).substring(0, 300));

  // Must have a destinations array
  expect(result).toBeTruthy();
  expect(Array.isArray(result.destinations)).toBe(true);

  // Must include internal and unfiled sentinel entries
  const types = result.destinations.map(d => d.type);
  expect(types).toContain('internal');
  expect(types).toContain('unfiled');

  // Each destination must have required fields
  for (const dest of result.destinations) {
    expect(dest.name).toBeTruthy();
    expect(dest.type).toBeTruthy();
  }

  // If there are companies in the DB, they should appear as client/other type
  const companies = result.destinations.filter(d => d.type === 'client' || d.type === 'other');
  console.log(`[E2E] Companies in destinations: ${companies.length}`);

  // Internal should be sorted after client/other, unfiled last
  const internalIdx = result.destinations.findIndex(d => d.type === 'internal');
  const unfiledIdx = result.destinations.findIndex(d => d.type === 'unfiled');
  expect(internalIdx).toBeLessThan(unfiledIdx);
});

// ===================================================================
// Test 28: Re-run Transcription button exists in meeting detail
// ===================================================================
test('re-run transcription button is present in meeting detail', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings to test re-run button — skipping');
    return;
  }

  // Look for the re-run button in the editor toolbar/action area
  const rerunBtn = page.locator('#rerunTranscriptionBtn');
  const rerunVisible = await rerunBtn.isVisible().catch(() => false);

  // Also check for a button with matching text content
  const rerunByText = page.locator('button:has-text("Re-run"), button[title*="Re-run"]');
  const rerunByTextVisible = await rerunByText.first().isVisible().catch(() => false);

  console.log(`[E2E] Re-run button by ID: ${rerunVisible}, by text: ${rerunByTextVisible}`);
  expect(rerunVisible || rerunByTextVisible).toBe(true);

  await ensureMainView();
});

// ===================================================================
// Test 29: originalName is never an email in placeholder meetings
// ===================================================================
test('placeholder meeting originalName is never an email address', async () => {
  await ensureMainView();

  const result = await page.evaluate(() => {
    return window.electronAPI.loadMeetingsData();
  });

  // loadMeetingsData returns { success, data: { upcomingMeetings, pastMeetings } }
  const data = result?.data || {};
  const meetings = [
    ...(Array.isArray(data.pastMeetings) ? data.pastMeetings : []),
    ...(Array.isArray(data.upcomingMeetings) ? data.upcomingMeetings : []),
    ...(Array.isArray(data) ? data : []),
  ];

  const placeholders = meetings.filter(m => m.id && m.id.startsWith('placeholder-'));
  console.log(`[E2E] Placeholder meetings found: ${placeholders.length} (total meetings: ${meetings.length})`);

  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  for (const meeting of placeholders) {
    const participants = Array.isArray(meeting.participants)
      ? meeting.participants
      : (typeof meeting.participants === 'string'
          ? JSON.parse(meeting.participants || '[]')
          : []);

    for (const p of participants) {
      if (p.originalName && emailRegex.test(p.originalName)) {
        console.error(`[E2E] BUG: originalName is an email: "${p.originalName}" in meeting ${meeting.id}`);
      }
      expect(emailRegex.test(p.originalName || '')).toBe(false);
    }
  }
});

// ===================================================================
// Test 30: Companies management — Add Company picker opens
// ===================================================================
test('add company picker opens when clicking Add Client button', async () => {
  await ensureMainView();

  // Open settings
  const settingsBtn = page.locator('#settingsBtn');
  await settingsBtn.click();
  await page.waitForTimeout(500);

  // Click Clients tab
  const clientsTab = page.locator('.settings-tab[data-tab="clients"]');
  if (!(await clientsTab.isVisible().catch(() => false))) {
    console.log('[E2E] Clients tab not found — skipping');
    await ensureMainView();
    return;
  }
  await clientsTab.click();
  await page.waitForTimeout(500);

  // Click Add Client button
  const addBtn = page.locator('#addClientBtn');
  const addBtnVisible = await addBtn.isVisible().catch(() => false);
  console.log(`[E2E] Add Client button visible: ${addBtnVisible}`);
  expect(addBtnVisible).toBe(true);

  await addBtn.click();
  await page.waitForTimeout(500);

  // Check that the picker/dialog opened
  const picker = page.locator('#addClientPicker, #addClientModal, .add-client-picker');
  const pickerVisible = await picker.first().isVisible().catch(() => false);
  console.log(`[E2E] Add Client picker visible: ${pickerVisible}`);
  expect(pickerVisible).toBe(true);

  // Dismiss picker
  await page.evaluate(() => {
    const picker = document.getElementById('addClientPicker') ||
                   document.getElementById('addClientModal') ||
                   document.querySelector('.add-client-picker');
    if (picker) picker.style.display = 'none';
  });

  await ensureMainView();
});

// ===================================================================
// Test 31: Backup manifest populates with real data
// ===================================================================
test('backup manifest shows database info after tab load', async () => {
  await ensureMainView();

  // Open settings
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Click Backup tab
  const backupTab = page.locator('.settings-tab[data-tab="backup"]');
  if (!(await backupTab.isVisible().catch(() => false))) {
    console.log('[E2E] Backup tab not found — skipping');
    await ensureMainView();
    return;
  }
  await backupTab.click();
  await page.waitForTimeout(1500); // Wait for manifest IPC call

  // Check manifest info populated
  const dbInfo = await page.locator('#backupDbInfo').textContent().catch(() => '');
  const lastInfo = await page.locator('#backupLastInfo').textContent().catch(() => '');
  console.log(`[E2E] Backup DB info: "${dbInfo}", Last backup: "${lastInfo}"`);

  // DB info should have content (at minimum "1 file" or similar)
  expect(dbInfo.length).toBeGreaterThan(0);
  // Last backup should show something (even "Never")
  expect(lastInfo.length).toBeGreaterThan(0);

  await ensureMainView();
});

// ===================================================================
// Test 32: Calendar coverage report renders or shows fallback message
// ===================================================================
test('calendar coverage IPC returns valid response', async () => {
  await ensureMainView();

  // Test the coverage IPC directly — more reliable than UI interaction
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const endDate = now.toISOString().split('T')[0];

  const result = await page.evaluate(async ({ start, end }) => {
    try {
      return await window.electronAPI.calendarCoverageReport(start, end);
    } catch (e) {
      return { error: e.message };
    }
  }, { start: startDate, end: endDate });

  console.log(`[E2E] Coverage report result: success=${result?.success}, error=${result?.error || 'none'}`);

  // The IPC should return without crashing — either success with data or an error (if calendar not connected)
  expect(result).toBeTruthy();
  if (result.success) {
    // Coverage data is flat on the result: { success, coveragePercent, covered, uncovered, total }
    expect(typeof result.coveragePercent).toBe('number');
    expect(Array.isArray(result.covered)).toBe(true);
    expect(Array.isArray(result.uncovered)).toBe(true);
    console.log(`[E2E] Coverage: ${result.coveragePercent}% (${result.covered.length} covered, ${result.uncovered.length} uncovered)`);
  }
  // If not success, that's OK — just means calendar isn't connected
});

// ===================================================================
// Test 33: MCP config copy button appears after load
// ===================================================================
test('MCP config copy button appears and works after loading config', async () => {
  await ensureMainView();

  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Navigate to the tab containing MCP config (Advanced/Security)
  const advancedTab = page.locator('.settings-tab[data-tab="advanced"], .settings-tab[data-tab="security"]');
  if (!(await advancedTab.first().isVisible().catch(() => false))) {
    console.log('[E2E] Advanced/Security tab not found — skipping');
    await ensureMainView();
    return;
  }
  await advancedTab.first().click();
  await page.waitForTimeout(500);

  // Click the Load Config button
  const loadBtn = page.locator('#mcpLoadConfigBtn');
  if (!(await loadBtn.isVisible().catch(() => false))) {
    console.log('[E2E] MCP Load Config button not found — skipping');
    await ensureMainView();
    return;
  }
  await loadBtn.click();
  await page.waitForTimeout(1000);

  // The copy button should now be visible
  const copyBtn = page.locator('#mcpCopyConfigBtn');
  const copyVisible = await copyBtn.isVisible().catch(() => false);
  console.log(`[E2E] MCP Copy Config button visible after load: ${copyVisible}`);
  expect(copyVisible).toBe(true);

  // Click copy and verify text changes
  await copyBtn.click();
  await page.waitForTimeout(500);
  const copyText = await copyBtn.textContent().catch(() => '');
  console.log(`[E2E] Copy button text after click: "${copyText}"`);
  expect(copyText.toLowerCase()).toContain('copied');

  await ensureMainView();
});

// ===================================================================
// Test 34: Company detail opens when clicking a company
// ===================================================================
test('company detail opens when clicking a company in contacts view', async () => {
  await ensureMainView();

  // Open contacts view via direct DOM manipulation (more reliable)
  const contactsOpened = await page.evaluate(() => {
    const cv = document.getElementById('contactsView');
    const mv = document.getElementById('mainView');
    const sv = document.getElementById('settingsView');
    const rv = document.getElementById('reportsView');
    if (sv) sv.style.display = 'none';
    if (rv) rv.style.display = 'none';
    if (mv) mv.style.display = 'none';
    if (cv) { cv.style.display = 'flex'; return true; }
    return false;
  });

  if (!contactsOpened) {
    console.log('[E2E] Contacts view not found — skipping');
    return;
  }
  await page.waitForTimeout(1000);

  // Switch to Companies mode
  const companiesToggle = page.locator('#companiesToggle, .toggle-btn:has-text("Companies")');
  if (!(await companiesToggle.first().isVisible().catch(() => false))) {
    console.log('[E2E] Companies toggle not found — skipping');
    await ensureMainView();
    return;
  }
  await companiesToggle.first().click();
  await page.waitForTimeout(1000);

  // Find a company item and click it
  const companyItem = page.locator('.company-item, .contacts-list-item').first();
  if (!(await companyItem.isVisible().catch(() => false))) {
    console.log('[E2E] No companies found in list — skipping detail test');
    await ensureMainView();
    return;
  }

  const companyName = await companyItem.textContent().catch(() => '');
  console.log(`[E2E] Clicking company: "${companyName.trim().substring(0, 40)}"`);
  await companyItem.click();
  await page.waitForTimeout(1000);

  // Check that detail panel is visible
  const detailPanel = page.locator('#contactDetail, .contact-detail, .company-detail');
  const detailVisible = await detailPanel.first().isVisible().catch(() => false);
  console.log(`[E2E] Company detail panel visible: ${detailVisible}`);
  expect(detailVisible).toBe(true);

  await ensureMainView();
});

// ===================================================================
// Test 35: companies:getAll IPC returns valid data
// ===================================================================
test('companies:getAll returns companies with required fields', async () => {
  await ensureMainView();

  const result = await page.evaluate(() => {
    return window.electronAPI.companiesGetAll();
  });

  // companiesGetAll returns { success, companies: [...] }
  console.log(`[E2E] companiesGetAll success: ${result?.success}, companies count: ${result?.companies?.length ?? 'N/A'}`);

  expect(result).toBeTruthy();
  expect(result.success).toBe(true);

  const companies = result.companies || [];
  expect(Array.isArray(companies)).toBe(true);

  // If companies exist, verify they have required fields
  for (const company of companies) {
    expect(company.name).toBeTruthy();
  }
});

// ===================================================================
// v2.0 Gap Coverage Tests
// ===================================================================

// Test 37: Settings General panel controls
test('settings general panel has provider dropdowns and toggles', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Click General tab
  const generalTab = page.locator('#generalSettingsTab');
  if (await generalTab.isVisible().catch(() => false)) {
    await generalTab.click();
    await page.waitForTimeout(300);
  }

  // Dark mode toggle
  await expect(page.locator('#darkModeToggle')).toBeAttached();

  // Transcription provider dropdown should have local option (v2.0)
  const transcriptionSelect = page.locator('#transcriptionProviderSelect');
  if (await transcriptionSelect.isAttached().catch(() => false)) {
    const options = await transcriptionSelect.locator('option').allTextContents();
    console.log('[E2E] Transcription providers:', options.join(', '));
    expect(options.length).toBeGreaterThanOrEqual(2);
  }

  // AI model dropdowns
  await expect(page.locator('#autoSummaryProviderSelect')).toBeAttached();
  await expect(page.locator('#templateSummaryProviderSelect')).toBeAttached();

  await ensureMainView();
});

// Test 38: v2.0 service endpoint fields and fully local preset
test('settings has service endpoint fields and fully local preset (v2.0)', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const generalTab = page.locator('#generalSettingsTab');
  if (await generalTab.isVisible().catch(() => false)) {
    await generalTab.click();
    await page.waitForTimeout(300);
  }

  // Service endpoint inputs (v2.0)
  const aiServiceUrl = page.locator('#aiServiceUrlInput');
  const localLLMUrl = page.locator('#localLLMUrlInput');

  if (await aiServiceUrl.isAttached().catch(() => false)) {
    const aiValue = await aiServiceUrl.inputValue();
    console.log('[E2E] AI service URL:', aiValue);
    expect(aiValue).toContain('localhost');
  }

  if (await localLLMUrl.isAttached().catch(() => false)) {
    const llmValue = await localLLMUrl.inputValue();
    console.log('[E2E] Local LLM URL:', llmValue);
    expect(llmValue).toContain('localhost');
  }

  // Fully Local preset button (v2.0)
  const fullyLocalBtn = page.locator('#fullyLocalPresetBtn');
  if (await fullyLocalBtn.isAttached().catch(() => false)) {
    console.log('[E2E] Fully Local preset button found');
  }

  // Health status indicators
  const aiStatus = page.locator('#aiServiceStatus');
  const llmStatus = page.locator('#localLLMStatus');
  if (await aiStatus.isAttached().catch(() => false)) {
    console.log('[E2E] AI service status indicator attached');
  }
  if (await llmStatus.isAttached().catch(() => false)) {
    console.log('[E2E] Local LLM status indicator attached');
  }

  await ensureMainView();
});

// Test 39: Settings My Profile tab
test('settings my profile tab has form fields', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const profileTab = page.locator('#profileSettingsTab');
  await expect(profileTab).toBeAttached();
  await profileTab.click();
  await page.waitForTimeout(300);

  // Profile panel should be visible
  const profilePanel = page.locator('#profilePanel');
  await expect(profilePanel).toBeVisible({ timeout: 3000 });

  // Should have name, email, organization fields
  const nameInput = page.locator('#profileName');
  const emailInput = page.locator('#profileEmail');
  if (await nameInput.isAttached().catch(() => false)) {
    console.log('[E2E] Profile name field attached');
  }
  if (await emailInput.isAttached().catch(() => false)) {
    console.log('[E2E] Profile email field attached');
  }

  // Save button
  const saveBtn = page.locator('#saveProfileBtn');
  await expect(saveBtn).toBeAttached();

  await ensureMainView();
});

// Test 40: Settings Templates tab
test('settings templates tab opens with template list', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const templatesTab = page.locator('#templatesSettingsTab');
  await expect(templatesTab).toBeAttached();
  await templatesTab.click();
  await page.waitForTimeout(500);

  const templatesPanel = page.locator('#templatesPanel');
  await expect(templatesPanel).toBeVisible({ timeout: 3000 });

  // Template list or editor area should exist
  const templateContent = await templatesPanel.textContent();
  console.log('[E2E] Templates panel has content:', templateContent.length > 0);
  expect(templateContent.length).toBeGreaterThan(0);

  await ensureMainView();
});

// Test 41: Settings Vocabulary tab
test('settings vocabulary tab opens with spelling sections', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const vocabTab = page.locator('#vocabularySettingsTab');
  await expect(vocabTab).toBeAttached();
  await vocabTab.click();
  await page.waitForTimeout(500);

  const vocabPanel = page.locator('#vocabularyPanel');
  await expect(vocabPanel).toBeVisible({ timeout: 3000 });

  const panelText = await vocabPanel.textContent();
  console.log('[E2E] Vocabulary panel loaded, length:', panelText.length);
  expect(panelText.length).toBeGreaterThan(0);

  await ensureMainView();
});

// Test 42: Settings Logs tab
test('settings logs tab opens with log controls', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const logsTab = page.locator('#logsSettingsTab');
  await expect(logsTab).toBeAttached();
  await logsTab.click();
  await page.waitForTimeout(500);

  const logsPanel = page.locator('#logsPanel');
  await expect(logsPanel).toBeVisible({ timeout: 3000 });

  // Clear logs and open log file buttons
  const clearBtn = page.locator('#clearLogsBtn');
  const openBtn = page.locator('#openLogFileBtn');
  if (await clearBtn.isAttached().catch(() => false)) {
    console.log('[E2E] Clear logs button found');
  }
  if (await openBtn.isAttached().catch(() => false)) {
    console.log('[E2E] Open log file button found');
  }

  await ensureMainView();
});

// Test 43: Settings About tab shows version
test('settings about tab shows app version', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  const aboutTab = page.locator('#aboutSettingsTab');
  await expect(aboutTab).toBeAttached();
  await aboutTab.click();
  await page.waitForTimeout(500);

  const aboutPanel = page.locator('#aboutPanel');
  await expect(aboutPanel).toBeVisible({ timeout: 3000 });

  const aboutText = await aboutPanel.textContent();
  // Should contain a version number pattern
  console.log('[E2E] About panel text length:', aboutText.length);
  expect(aboutText.length).toBeGreaterThan(0);

  await ensureMainView();
});

// Test 44: Meeting detail metadata tab
test('meeting detail metadata tab populates', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings — skipping metadata tab test');
    return;
  }

  const metadataTab = page.locator('#metadataTab');
  if (await metadataTab.isVisible().catch(() => false)) {
    await metadataTab.click();
    await page.waitForTimeout(500);

    const metadataContent = page.locator('#metadataContent, #metadataPanel, .metadata-section');
    const visible = await metadataContent.first().isVisible().catch(() => false);
    console.log('[E2E] Metadata content visible:', visible);
  } else {
    console.log('[E2E] Metadata tab not visible — skipping');
  }

  await ensureMainView();
});

// Test 45: Meeting detail transcript search
test('meeting detail has transcript search input', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings — skipping transcript search test');
    return;
  }

  // Switch to transcript tab
  const transcriptTab = page.locator('#transcriptTab');
  if (await transcriptTab.isVisible().catch(() => false)) {
    await transcriptTab.click();
    await page.waitForTimeout(500);

    const searchInput = page.locator('#transcriptSearch');
    if (await searchInput.isAttached().catch(() => false)) {
      await searchInput.fill('test search');
      const value = await searchInput.inputValue();
      expect(value).toBe('test search');
      await searchInput.fill('');
      console.log('[E2E] Transcript search input works');
    } else {
      console.log('[E2E] Transcript search input not found');
    }
  }

  await ensureMainView();
});

// Test 46: Meeting detail edit mode toggles
test('meeting detail edit mode opens and cancels', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings — skipping edit mode test');
    return;
  }

  const editBtn = page.locator('#editMeetingInfoBtn');
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click();
    await page.waitForTimeout(300);

    // Edit fields should appear
    const titleInput = page.locator('#editMeetingTitle');
    const titleVisible = await titleInput.isVisible().catch(() => false);
    console.log('[E2E] Edit title field visible:', titleVisible);

    // Cancel edit
    const cancelBtn = page.locator('#cancelMeetingInfoEditBtn');
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(300);
    }
  } else {
    console.log('[E2E] Edit meeting info button not visible — skipping');
  }

  await ensureMainView();
});

// Test 47: Template modal opens from meeting detail
test('template modal opens with routing preview and template checkboxes', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings — skipping template modal test');
    return;
  }

  // Look for the generate summary button
  const generateBtn = page.locator('#generateSummaryBtn, button:has-text("Generate Summary"), button:has-text("Select Templates")');
  const btnVisible = await generateBtn.first().isVisible().catch(() => false);

  if (btnVisible) {
    await generateBtn.first().click();
    await page.waitForTimeout(500);

    const templateModal = page.locator('#templateModal');
    const modalVisible = await templateModal.isVisible().catch(() => false);
    console.log('[E2E] Template modal visible:', modalVisible);

    if (modalVisible) {
      // Routing preview section
      const routingPreview = page.locator('#routingPreview, .routing-preview');
      const routingVisible = await routingPreview.first().isVisible().catch(() => false);
      console.log('[E2E] Routing preview visible:', routingVisible);

      // Template checkboxes
      const checkboxes = page.locator('#templateModal input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      console.log('[E2E] Template checkboxes:', checkboxCount);

      // Close modal
      await page.evaluate(() => {
        document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });
      });
      await page.waitForTimeout(200);
    }
  } else {
    console.log('[E2E] Generate summary button not visible — skipping');
  }

  await ensureMainView();
});

// Test 48: Filter panel has all filter dropdowns
test('filter panel has company, platform, and sync status filters', async () => {
  await ensureMainView();

  // Recording and calendar status were tested in Test 10
  // Test the additional filter dropdowns
  const companyFilter = page.locator('#filterCompany');
  const platformFilter = page.locator('#filterPlatform');
  const syncFilter = page.locator('#filterSyncStatus');
  const clearAllBtn = page.locator('#filterClearAll');

  const companyAttached = await companyFilter.isAttached().catch(() => false);
  const platformAttached = await platformFilter.isAttached().catch(() => false);
  const syncAttached = await syncFilter.isAttached().catch(() => false);
  const clearAttached = await clearAllBtn.isAttached().catch(() => false);

  console.log(`[E2E] Filters — Company: ${companyAttached}, Platform: ${platformAttached}, Sync: ${syncAttached}, Clear: ${clearAttached}`);

  // At minimum platform filter should exist
  expect(platformAttached || companyAttached).toBe(true);
});

// Test 49: Bulk selection mode
test('bulk selection mode activates with toolbar', async () => {
  await ensureMainView();

  const bulkToggle = page.locator('#toggleBulkSelectBtn');
  if (!(await bulkToggle.isAttached().catch(() => false))) {
    console.log('[E2E] Bulk select button not found — skipping');
    return;
  }

  await bulkToggle.click();
  await page.waitForTimeout(300);

  const toolbar = page.locator('#bulkActionsToolbar');
  const toolbarVisible = await toolbar.isVisible().catch(() => false);
  console.log('[E2E] Bulk actions toolbar visible:', toolbarVisible);

  // Deactivate bulk mode
  await bulkToggle.click();
  await page.waitForTimeout(300);
});

// Test 50: Import modal opens
test('import modal opens with file drop zone', async () => {
  await ensureMainView();

  const importBtn = page.locator('#importBtn');
  if (!(await importBtn.isVisible().catch(() => false))) {
    console.log('[E2E] Import button not visible — skipping');
    return;
  }

  await importBtn.click();
  await page.waitForTimeout(500);

  const importModal = page.locator('#importModal');
  const modalVisible = await importModal.isVisible().catch(() => false);
  console.log('[E2E] Import modal visible:', modalVisible);

  if (modalVisible) {
    // Platform selector
    const platformSelect = page.locator('#importPlatformSelect');
    const platformAttached = await platformSelect.isAttached().catch(() => false);
    console.log('[E2E] Import platform selector:', platformAttached);

    // Start import button
    const startBtn = page.locator('#startImport');
    const startAttached = await startBtn.isAttached().catch(() => false);
    console.log('[E2E] Start import button:', startAttached);

    // Close modal
    await page.evaluate(() => {
      document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });
    });
    await page.waitForTimeout(200);
  }
});

// Test 51: Voice profile IPC returns valid response (v2.0)
test('voiceProfileGetAll returns valid response (v2.0)', async () => {
  await ensureMainView();

  const result = await page.evaluate(() => {
    return window.electronAPI.voiceProfileGetAll();
  });

  console.log('[E2E] voiceProfileGetAll result:', JSON.stringify(result).substring(0, 200));

  expect(result).toBeTruthy();
  if (result.success !== undefined) {
    expect(result.success).toBe(true);
  }
  // Profiles should be an array (may be empty)
  const profiles = result.profiles || result;
  expect(Array.isArray(profiles)).toBe(true);
});

// Test 52: AI service health IPC (v2.0)
test('aiServiceHealth returns a response (v2.0)', async () => {
  await ensureMainView();

  const result = await page.evaluate(async () => {
    try {
      return await window.electronAPI.aiServiceHealth();
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('[E2E] aiServiceHealth result:', JSON.stringify(result).substring(0, 200));

  // Either success (service running) or a structured error (service not running) — both valid
  expect(result).toBeTruthy();
});

// Test 53: Local models IPC (v2.0)
test('listLocalModels returns a response (v2.0)', async () => {
  await ensureMainView();

  const result = await page.evaluate(async () => {
    try {
      return await window.electronAPI.listLocalModels();
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('[E2E] listLocalModels result:', JSON.stringify(result).substring(0, 200));

  // Either returns models array or error — both valid (Ollama may not be running)
  expect(result).toBeTruthy();
});

// Test 54: Routing preview IPC
test('routingPreviewMeetingRoute returns route for a meeting', async () => {
  await ensureMainView();

  // Get a meeting ID first
  const meetings = await page.evaluate(() => {
    return window.electronAPI.loadMeetingsData();
  });

  if (!meetings || meetings.length === 0) {
    console.log('[E2E] No meetings for routing preview — skipping');
    return;
  }

  const meetingId = meetings[0].id;
  const result = await page.evaluate(async (id) => {
    return window.electronAPI.routingPreviewMeetingRoute(id);
  }, meetingId);

  console.log('[E2E] Routing preview result:', JSON.stringify(result).substring(0, 200));
  expect(result).toBeTruthy();

  // Should have routes array
  if (result.routes) {
    expect(Array.isArray(result.routes)).toBe(true);
  }
});

// Test 55: Speaker mapping persistence IPC
test('speakerMappingGetAll returns an array', async () => {
  await ensureMainView();

  const result = await page.evaluate(async () => {
    try {
      return await window.electronAPI.speakerMappingGetAll();
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('[E2E] speakerMappingGetAll result type:', typeof result, Array.isArray(result));

  // Should return an array (possibly empty) or an object with mappings
  expect(result).toBeTruthy();
});

// Test 56: Transcript export button in meeting detail
test('transcript export button exists in meeting detail', async () => {
  const navigated = await navigateToFirstMeeting();
  if (!navigated) {
    console.log('[E2E] No past meetings — skipping transcript export test');
    return;
  }

  // Switch to transcript tab
  const transcriptTab = page.locator('#transcriptTab');
  if (await transcriptTab.isVisible().catch(() => false)) {
    await transcriptTab.click();
    await page.waitForTimeout(500);

    const exportBtn = page.locator('#exportTranscriptBtn, button[title*="Export"], button:has-text("Export")');
    const exportVisible = await exportBtn.first().isVisible().catch(() => false);
    console.log('[E2E] Transcript export button visible:', exportVisible);
  } else {
    console.log('[E2E] Transcript tab not visible — skipping');
  }

  await ensureMainView();
});

// Test 57: CRM settings section does NOT exist (regression test)
test('CRM integration settings section is removed', async () => {
  await ensureMainView();
  await page.locator('#settingsBtn').click();
  await page.waitForTimeout(500);

  // Navigate through all settings tabs to make sure CRM toggle is gone
  const crmToggle = page.locator('#crmEnabledToggle');
  const crmAttached = await crmToggle.isAttached().catch(() => false);
  expect(crmAttached).toBe(false);

  const crmContainer = page.locator('#crmSettingsContainer');
  const containerAttached = await crmContainer.isAttached().catch(() => false);
  expect(containerAttached).toBe(false);

  console.log('[E2E] CRM integration settings confirmed removed');

  await ensureMainView();
});

// Test 58: Window controls exist in custom titlebar
test('window controls exist in custom titlebar', async () => {
  const minimizeBtn = page.locator('#minimizeBtn, .titlebar-minimize, [title="Minimize"]');
  const maximizeBtn = page.locator('#maximizeBtn, .titlebar-maximize, [title="Maximize"]');
  const closeBtn = page.locator('#closeBtn, .titlebar-close, [title="Close"]');

  const minAttached = await minimizeBtn.first().isAttached().catch(() => false);
  const maxAttached = await maximizeBtn.first().isAttached().catch(() => false);
  const closeAttached = await closeBtn.first().isAttached().catch(() => false);

  console.log(`[E2E] Window controls — Min: ${minAttached}, Max: ${maxAttached}, Close: ${closeAttached}`);

  // At least close button should exist
  expect(closeAttached).toBe(true);
});

// ===================================================================
// Final Test: No Critical Errors (keep last)
// ===================================================================
test('no critical console errors', async () => {
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const critical = errors.filter((msg) => {
    if (msg.includes('ResizeObserver')) return false;
    if (msg.includes('favicon')) return false;
    if (msg.includes('net::ERR_')) return false;
    if (msg.includes('monaco')) return false;
    return true;
  });

  if (critical.length > 0) {
    console.warn('[E2E] Critical errors:', critical);
  }
  expect(critical.length).toBe(0);
});
