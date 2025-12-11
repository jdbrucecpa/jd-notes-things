/**
 * Notification Helper Utility
 *
 * Provides standardized toast notification functions with consistent
 * formatting, error handling, and optional console logging.
 *
 * v1.2 Tech Debt Refactoring
 */

/**
 * Show a success notification
 *
 * @param {string} message - Message to display
 * @param {Object} options - Optional configuration
 * @param {string} [options.context] - Context label for console logging
 * @param {boolean} [options.log=false] - Whether to log to console
 */
export function notifySuccess(message, options = {}) {
  const { context, log = false } = options;

  if (window.showToast) {
    window.showToast(message, 'success');
  }

  if (log && context) {
    console.log(`[${context}] Success:`, message);
  }
}

/**
 * Show an error notification
 *
 * @param {Error|string} error - Error object or message string
 * @param {Object} options - Optional configuration
 * @param {string} [options.context] - Context label for console logging
 * @param {string} [options.prefix] - Prefix to prepend to error message (e.g., "Failed to save:")
 * @param {string} [options.fallbackMessage='Operation failed'] - Message to use if error has no message
 * @param {boolean} [options.log=true] - Whether to log to console
 */
export function notifyError(error, options = {}) {
  const { context, prefix, fallbackMessage = 'Operation failed', log = true } = options;

  const errorMessage = error instanceof Error ? error.message : error || fallbackMessage;
  const displayMessage = prefix ? `${prefix} ${errorMessage}` : errorMessage;

  if (window.showToast) {
    window.showToast(displayMessage, 'error');
  }

  if (log) {
    if (context) {
      console.error(`[${context}] Error:`, error);
    } else {
      console.error('Error:', error);
    }
  }
}

/**
 * Show an info notification
 *
 * @param {string} message - Message to display
 * @param {Object} options - Optional configuration
 * @param {string} [options.context] - Context label for console logging
 * @param {boolean} [options.log=false] - Whether to log to console
 */
export function notifyInfo(message, options = {}) {
  const { context, log = false } = options;

  if (window.showToast) {
    window.showToast(message, 'info');
  }

  if (log && context) {
    console.log(`[${context}] Info:`, message);
  }
}

/**
 * Show a warning notification
 *
 * @param {string} message - Message to display
 * @param {Object} options - Optional configuration
 * @param {string} [options.context] - Context label for console logging
 * @param {boolean} [options.log=false] - Whether to log to console
 */
export function notifyWarning(message, options = {}) {
  const { context, log = false } = options;

  if (window.showToast) {
    window.showToast(message, 'warning');
  }

  if (log && context) {
    console.warn(`[${context}] Warning:`, message);
  }
}

/**
 * Execute an async operation with automatic error notification
 *
 * @param {Function} operation - Async function to execute
 * @param {Object} options - Configuration
 * @param {string} [options.successMessage] - Message to show on success
 * @param {string} [options.errorPrefix] - Prefix for error message
 * @param {string} [options.context] - Context for logging
 * @returns {Promise<any>} Result of the operation, or null on error
 *
 * @example
 * const result = await withNotification(
 *   () => window.electronAPI.saveMeetingsData(data),
 *   {
 *     successMessage: 'Meetings saved',
 *     errorPrefix: 'Failed to save meetings:',
 *     context: 'MeetingSync'
 *   }
 * );
 */
export async function withNotification(operation, options = {}) {
  const { successMessage, errorPrefix, context } = options;

  try {
    const result = await operation();

    if (successMessage) {
      notifySuccess(successMessage, { context });
    }

    return result;
  } catch (error) {
    notifyError(error, { prefix: errorPrefix, context });
    return null;
  }
}
