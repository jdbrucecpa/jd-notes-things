/**
 * Button Loading State Helper
 *
 * Provides a standardized way to handle button loading states during async operations.
 * Automatically disables the button, shows loading text, and restores original state.
 *
 * Phase 10.9 Refactoring - Refactor #4
 */

/**
 * Executes an async function while managing button loading state
 *
 * @param {string} buttonId - The ID of the button element
 * @param {string} loadingText - Text to display while loading (e.g., "Saving...", "Loading...")
 * @param {Function} asyncFn - The async function to execute
 * @returns {Promise<any>} The result of the async function
 *
 * @example
 * // Before (8 lines):
 * const btn = document.getElementById('saveBtn');
 * btn.disabled = true;
 * const originalText = btn.textContent;
 * btn.textContent = 'Saving...';
 * try {
 *   await saveConfig();
 * } finally {
 *   btn.disabled = false;
 *   btn.textContent = originalText;
 * }
 *
 * // After (1 line):
 * await withButtonLoading('saveBtn', 'Saving...', async () => {
 *   await saveConfig();
 * });
 */
export async function withButtonLoading(buttonId, loadingText, asyncFn) {
  const btn = document.getElementById(buttonId);

  // If button doesn't exist, just execute the function without loading state
  if (!btn) {
    console.warn(`[ButtonHelper] Button with id "${buttonId}" not found`);
    return await asyncFn();
  }

  // Save original state
  const originalText = btn.textContent;
  const originalDisabled = btn.disabled;

  // Set loading state
  btn.disabled = true;
  btn.textContent = loadingText;

  try {
    // Execute the async function and return its result
    return await asyncFn();
  } finally {
    // Always restore original state, even if function throws
    btn.disabled = originalDisabled;
    btn.textContent = originalText;
  }
}

/**
 * Alternative version that accepts a button element directly instead of an ID
 *
 * @param {HTMLButtonElement} button - The button element
 * @param {string} loadingText - Text to display while loading
 * @param {Function} asyncFn - The async function to execute
 * @returns {Promise<any>} The result of the async function
 *
 * @example
 * const btn = document.getElementById('saveBtn');
 * await withButtonLoadingElement(btn, 'Saving...', async () => {
 *   await saveConfig();
 * });
 */
export async function withButtonLoadingElement(button, loadingText, asyncFn) {
  if (!button) {
    console.warn('[ButtonHelper] Button element is null or undefined');
    return await asyncFn();
  }

  // Save original state
  const originalText = button.textContent;
  const originalDisabled = button.disabled;

  // Set loading state
  button.disabled = true;
  button.textContent = loadingText;

  try {
    // Execute the async function and return its result
    return await asyncFn();
  } finally {
    // Always restore original state, even if function throws
    button.disabled = originalDisabled;
    button.textContent = originalText;
  }
}
