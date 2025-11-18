/**
 * Tab Switching Helper
 *
 * Provides a standardized way to initialize and manage tab switching behavior.
 * Handles tab button clicks, active state management, and content visibility.
 *
 * Phase 10.9 Refactoring - Refactor #6
 */

/**
 * Initializes tab switching functionality for a set of tabs
 *
 * @param {Array<{buttonId: string, contentId: string}>} tabs - Array of tab configurations
 * @param {Function} [onActivate] - Optional callback function called when a tab is activated.
 *                                   Receives the activated tab's buttonId as an argument.
 * @returns {void}
 *
 * @example
 * // Before (20+ lines per implementation):
 * document.getElementById('routingTab').addEventListener('click', () => {
 *   document.getElementById('routingTab').classList.add('active');
 *   document.getElementById('routingContent').classList.remove('hidden');
 *   document.getElementById('testTab').classList.remove('active');
 *   document.getElementById('testContent').classList.add('hidden');
 *   // ... more tabs
 * });
 * // ... repeated for each tab
 *
 * // After (1 function call):
 * initializeTabs([
 *   { buttonId: 'routingTab', contentId: 'routingContent' },
 *   { buttonId: 'testTab', contentId: 'testContent' }
 * ]);
 *
 * @example
 * // With onActivate callback:
 * initializeTabs([
 *   { buttonId: 'generalTab', contentId: 'generalContent' },
 *   { buttonId: 'securityTab', contentId: 'securityContent' }
 * ], (tabId) => {
 *   console.log(`Tab activated: ${tabId}`);
 *   // Custom logic when tab is activated
 * });
 */
export function initializeTabs(tabs, onActivate) {
  // Validate input
  if (!Array.isArray(tabs) || tabs.length === 0) {
    console.warn('[TabHelper] initializeTabs called with invalid tabs array');
    return;
  }

  // Validate that all buttons and content elements exist
  const validTabs = tabs.filter(tab => {
    const button = document.getElementById(tab.buttonId);
    const content = document.getElementById(tab.contentId);

    if (!button) {
      console.warn(`[TabHelper] Tab button '${tab.buttonId}' not found`);
      return false;
    }
    if (!content) {
      console.warn(`[TabHelper] Tab content '${tab.contentId}' not found`);
      return false;
    }

    return true;
  });

  if (validTabs.length === 0) {
    console.error('[TabHelper] No valid tabs found');
    return;
  }

  /**
   * Deactivates all tabs (removes active class from buttons, hides all content)
   */
  function deactivateAllTabs() {
    validTabs.forEach(tab => {
      const button = document.getElementById(tab.buttonId);
      const content = document.getElementById(tab.contentId);

      button.classList.remove('active');
      content.style.display = 'none';
    });
  }

  /**
   * Activates a specific tab (adds active class to button, shows content)
   */
  function activateTab(tab) {
    const button = document.getElementById(tab.buttonId);
    const content = document.getElementById(tab.contentId);

    button.classList.add('active');
    content.style.display = 'block';

    // Call optional callback if provided
    if (onActivate && typeof onActivate === 'function') {
      onActivate(tab.buttonId);
    }
  }

  // Attach click handlers to all tab buttons
  validTabs.forEach(tab => {
    const button = document.getElementById(tab.buttonId);

    button.addEventListener('click', () => {
      deactivateAllTabs();
      activateTab(tab);
    });
  });
}
