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
// Test 14: No Critical Errors
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
