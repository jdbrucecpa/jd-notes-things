/**
 * Shared Constants
 *
 * Central location for configuration values used across main and renderer processes.
 * This helps avoid hardcoded values scattered throughout the codebase.
 *
 * v1.2 Tech Debt Refactoring
 */

/**
 * Server Configuration
 */
const SERVER_PORT = 13373;
const SERVER_HOST = '127.0.0.1';

/**
 * WebSocket Endpoints
 */
const WS_STREAMDECK_PATH = '/streamdeck';
const WS_STREAMDECK_ENDPOINT = `ws://localhost:${SERVER_PORT}${WS_STREAMDECK_PATH}`;

/**
 * Webhook Endpoints
 */
const WEBHOOK_RECALL_PATH = '/webhook/recall';
const WEBHOOK_RECALL_ENDPOINT = `http://localhost:${SERVER_PORT}${WEBHOOK_RECALL_PATH}`;

/**
 * Recording Widget Configuration
 */
const WIDGET_DEFAULT_WIDTH = 64;
const WIDGET_DEFAULT_HEIGHT = 300;
const WIDGET_MIN_WIDTH = 64;
const WIDGET_MIN_HEIGHT = 200;

/**
 * Meeting Monitor Configuration
 */
const MEETING_MONITOR_INTERVAL_MS = 30000; // 30 seconds
const MEETING_START_GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes

module.exports = {
  // Server
  SERVER_PORT,
  SERVER_HOST,

  // WebSocket
  WS_STREAMDECK_PATH,
  WS_STREAMDECK_ENDPOINT,

  // Webhook
  WEBHOOK_RECALL_PATH,
  WEBHOOK_RECALL_ENDPOINT,

  // Widget
  WIDGET_DEFAULT_WIDTH,
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_MIN_WIDTH,
  WIDGET_MIN_HEIGHT,

  // Meeting Monitor
  MEETING_MONITOR_INTERVAL_MS,
  MEETING_START_GRACE_PERIOD_MS,
};
