/**
 * Centralized logging module using electron-log
 *
 * Provides structured logging with file output, console output, and log levels.
 *
 * Usage:
 *   const logger = require('./shared/logger');
 *   logger.info('Application started');
 *   logger.error('Failed to load config:', error);
 *   logger.debug('User data:', userData);
 *
 * Scoped logging:
 *   const myLogger = logger.createLogger('MyModule');
 *   myLogger.info('Module initialized');  // Output: [MyModule] Module initialized
 */

const log = require('electron-log');
const path = require('path');

// Configure transports
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// Set log file location to app data directory
try {
  const { app } = require('electron');
  if (app) {
    const userDataPath = app.getPath('userData');
    log.transports.file.resolvePathFn = () => path.join(userDataPath, 'logs', 'main.log');
  }
} catch {
  // If electron is not available (e.g., in renderer process), use current directory
  log.transports.file.resolvePathFn = () => path.join(process.cwd(), 'logs', 'renderer.log');
}

/**
 * Create a scoped logger with a specific prefix
 * @param {string} scope - The scope/module name to prefix log messages with
 * @returns {Object} Logger instance with scoped methods
 */
function createLogger(scope) {
  return {
    error: (...args) => log.error(`[${scope}]`, ...args),
    warn: (...args) => log.warn(`[${scope}]`, ...args),
    info: (...args) => log.info(`[${scope}]`, ...args),
    verbose: (...args) => log.verbose(`[${scope}]`, ...args),
    debug: (...args) => log.debug(`[${scope}]`, ...args),
    silly: (...args) => log.silly(`[${scope}]`, ...args),
  };
}

// Export both direct log methods and the createLogger function
module.exports = {
  // Direct logging methods
  error: log.error.bind(log),
  warn: log.warn.bind(log),
  info: log.info.bind(log),
  verbose: log.verbose.bind(log),
  debug: log.debug.bind(log),
  silly: log.silly.bind(log),

  // Scoped logger factory
  scope: createLogger,
  createLogger,
};
