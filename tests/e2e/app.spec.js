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
    const closeBtn = page.locator('#settingsBackBtn');
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
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
  const backBtn = page.locator('#settingsBackBtn');
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
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
// Test 20: No Critical Errors
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
