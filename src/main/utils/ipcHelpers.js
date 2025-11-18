/**
 * IPC Handler Helpers
 *
 * Provides standardized error handling and response formatting for IPC handlers.
 * This eliminates the need for repetitive try-catch blocks in every handler.
 *
 * Phase 10.9 Refactoring - Refactor #3
 */

const log = require('electron-log');
const logger = log.scope('IPC');

/**
 * Creates a standardized IPC handler with automatic error handling
 *
 * @param {Function} handlerFn - The async handler function to wrap
 * @returns {Function} Wrapped handler with error handling
 *
 * @example
 * // Before:
 * ipcMain.handle('routing:getConfig', async () => {
 *   try {
 *     const config = await loadConfig();
 *     return { success: true, config };
 *   } catch (error) {
 *     console.error('[IPC] Error:', error);
 *     return { success: false, error: error.message };
 *   }
 * });
 *
 * // After:
 * ipcMain.handle('routing:getConfig', createIpcHandler(async () => {
 *   const config = await loadConfig();
 *   return { config };
 * }));
 */
function createIpcHandler(handlerFn) {
  return async (event, ...args) => {
    try {
      // Execute the handler function
      const result = await handlerFn(event, ...args);

      // If the handler already returns a success/error format, pass it through
      if (result && typeof result === 'object' && 'success' in result) {
        return result;
      }

      // Otherwise, wrap the result in a success response
      return { success: true, ...result };
    } catch (error) {
      // Log the error with the IPC logger
      logger.error('[IPC Handler Error]', error);

      // Return standardized error response
      return {
        success: false,
        error: error.message || 'An unknown error occurred',
      };
    }
  };
}

module.exports = {
  createIpcHandler,
};
