/**
 * IPC Call Wrapper for Renderer
 *
 * Provides standardized error handling, success/error messages, and toast notifications
 * for IPC calls from the renderer process to the main process.
 *
 * Phase 10.9 Refactoring - Refactor #5
 */

/**
 * Wrapper for IPC calls with standardized error handling
 *
 * @param {string} method - The IPC method name (e.g., 'routingSaveConfig')
 * @param {any|Array} args - Arguments to pass to the IPC method (single value or array)
 * @param {Object} options - Optional configuration
 * @param {string} [options.successMessage] - Message to show on success
 * @param {string} [options.errorMessage='Operation failed'] - Message to show on error
 * @param {boolean} [options.showSuccessToast=false] - Whether to show success toast
 * @param {boolean} [options.showErrorToast=true] - Whether to show error toast
 * @param {string} [options.context='IPC'] - Context label for console logging
 * @returns {Promise<Object>} The IPC response object
 * @throws {Error} If the IPC call fails or returns success: false
 *
 * @example
 * // Simple call with error handling
 * const response = await callIpc('routingGetConfig');
 *
 * @example
 * // Call with arguments and success toast
 * await callIpc('routingSaveConfig', [content], {
 *   successMessage: 'Configuration saved successfully',
 *   errorMessage: 'Failed to save configuration',
 *   showSuccessToast: true,
 *   context: 'RoutingEditor'
 * });
 *
 * @example
 * // Call with multiple arguments
 * await callIpc('routingAddOrganization', [type, id, vaultPath, emails, contacts], {
 *   successMessage: 'Organization added',
 *   showSuccessToast: true
 * });
 */
export async function callIpc(method, args = [], options = {}) {
  const {
    successMessage,
    errorMessage = 'Operation failed',
    showSuccessToast = false,
    showErrorToast = true,
    context = 'IPC'
  } = options;

  // Validate that the method exists
  if (!window.electronAPI || typeof window.electronAPI[method] !== 'function') {
    const error = new Error(`IPC method '${method}' not found`);
    console.error(`[${context}]`, error);
    if (showErrorToast) {
      window.showToast(`${errorMessage}: Method not found`, 'error');
    }
    throw error;
  }

  try {
    // Call the IPC method with the provided arguments
    const argsArray = Array.isArray(args) ? args : [args];
    const response = await window.electronAPI[method](...argsArray);

    // Check if the response indicates failure
    if (!response || !response.success) {
      throw new Error(response?.error || errorMessage);
    }

    // Show success toast if requested
    if (showSuccessToast && successMessage) {
      window.showToast(successMessage, 'success');
    }

    // Return the full response object
    return response;
  } catch (error) {
    // Log the error
    console.error(`[${context}] IPC call '${method}' failed:`, error);

    // Show error toast if requested
    if (showErrorToast) {
      window.showToast(`${errorMessage}: ${error.message}`, 'error');
    }

    // Re-throw the error so callers can handle it if needed
    throw error;
  }
}
