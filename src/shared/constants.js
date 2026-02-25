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

/**
 * Timeouts (ms)
 */
const IPC_RESPONSE_TIMEOUT_MS = 30000; // IPC round-trip timeout for widget recording commands
const RECALL_API_TIMEOUT_MS = 30000; // Recall.ai REST API request timeout
const GITHUB_API_TIMEOUT_MS = 10000; // GitHub release check timeout
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // OAuth authentication flow timeout (5 min)
const WEBSOCKET_TIMEOUT_MS = 9000; // WebSocket connection timeout
const AUTO_UPDATE_CHECK_TIMEOUT_MS = 30000; // Auto-updater check timeout

/**
 * Delays & Intervals (ms)
 */
const WINDOW_BOUNDS_DEBOUNCE_MS = 500; // Throttle window resize/move save
const RECALL_RATE_LIMIT_DELAY_MS = 250; // Recall.ai cleanup rate limit (300 req/min)
const SDK_SHUTDOWN_GRACE_MS = 1000; // Grace period after SDK shutdown
const SDK_INIT_DELAY_MS = 3000; // Delay after SDK initialization
const FILE_WRITE_GRACE_MS = 3000; // Grace period for file writes after recording ends
const TRANSCRIPT_POLL_INTERVAL_MS = 5000; // Recall.ai transcript polling interval
const UPCOMING_MEETINGS_CHECK_MS = 60000; // Upcoming meetings refresh interval
const BACKUP_IPC_DELAY_MS = 2000; // Backup IPC message delay for open-meeting-note
const CACHE_INVALIDATION_MS = 500; // Meetings file cache invalidation threshold

/**
 * Limits & Sizes
 */
const LLM_SECTION_MAX_TOKENS = 15000; // Max tokens per LLM template section summary
const LLM_PROMPT_TOKEN_BUFFER = 200; // Extra token buffer for LLM prompts
const LOG_ENTRIES_DEFAULT_LIMIT = 1000; // Default max log lines returned
const MEETING_PURPOSE_MAX_CHARS = 500; // Max chars extracted for meeting purpose detection

/**
 * Data Thresholds
 */
const OLD_MEETING_CLEANUP_MS = 60 * 60 * 1000; // Cleanup meeting IDs older than 1 hour

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

  // Timeouts
  IPC_RESPONSE_TIMEOUT_MS,
  RECALL_API_TIMEOUT_MS,
  GITHUB_API_TIMEOUT_MS,
  OAUTH_TIMEOUT_MS,
  WEBSOCKET_TIMEOUT_MS,
  AUTO_UPDATE_CHECK_TIMEOUT_MS,

  // Delays & Intervals
  WINDOW_BOUNDS_DEBOUNCE_MS,
  RECALL_RATE_LIMIT_DELAY_MS,
  SDK_SHUTDOWN_GRACE_MS,
  SDK_INIT_DELAY_MS,
  FILE_WRITE_GRACE_MS,
  TRANSCRIPT_POLL_INTERVAL_MS,
  UPCOMING_MEETINGS_CHECK_MS,
  BACKUP_IPC_DELAY_MS,
  CACHE_INVALIDATION_MS,

  // Limits & Sizes
  LLM_SECTION_MAX_TOKENS,
  LLM_PROMPT_TOKEN_BUFFER,
  LOG_ENTRIES_DEFAULT_LIMIT,
  MEETING_PURPOSE_MAX_CHARS,

  // Data Thresholds
  OLD_MEETING_CLEANUP_MS,
};
