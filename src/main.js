const {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  Tray,
  Menu,
  globalShortcut,
  shell,
  screen,
  nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('fs');
const { updateElectronApp } = require('update-electron-app');
const RecallAiSdk = require('@recallai/desktop-sdk');
const axios = require('axios');
const sdkLogger = require('./sdk-logger');
const { MeetingsDataSchema, MeetingIdSchema, RecordingIdSchema } = require('./shared/validation');
const { z } = require('zod');
const GoogleAuth = require('./main/integrations/GoogleAuth');
const GoogleCalendar = require('./main/integrations/GoogleCalendar');
const GoogleContacts = require('./main/integrations/GoogleContacts');
const SpeakerMatcher = require('./main/integrations/SpeakerMatcher');
const TemplateManager = require('./main/templates/TemplateManager');
const VaultStructure = require('./main/storage/VaultStructure');
const RoutingEngine = require('./main/routing/RoutingEngine');
const ImportManager = require('./main/import/ImportManager');
const TranscriptParser = require('./main/import/TranscriptParser');
const PatternConfigLoader = require('./main/import/PatternConfigLoader');
const { createLLMServiceFromCredentials } = require('./main/services/llmService');
const transcriptionService = require('./main/services/transcriptionService');
const keyManagementService = require('./main/services/keyManagementService');
const speakerMappingService = require('./main/services/speakerMappingService');
const vocabularyService = require('./main/services/vocabularyService');
const { isGenericSpeakerName } = require('./shared/speakerValidation');

// Wire up keyManagementService to transcriptionService for API key retrieval in packaged builds
transcriptionService.setKeyManagementService(keyManagementService);
const { createIpcHandler } = require('./main/utils/ipcHelpers');
const yaml = require('js-yaml');
// const encryptionService = require('./main/services/encryptionService'); // Not needed - Obsidian requires plain text
const expressApp = require('./server');

// Wire up keyManagementService to server.js for API key retrieval in packaged builds
expressApp.setKeyManagementService(keyManagementService);
const tunnelManager = require('./main/services/tunnelManager');
const log = require('electron-log');
const {
  SERVER_PORT,
  SERVER_HOST,
  WS_STREAMDECK_ENDPOINT,
  WEBHOOK_RECALL_PATH,
} = require('./shared/constants');
// IPC Input Validation - Phase 9 Security Hardening
// ===================================================
// Zod validation schemas protect against malformed IPC data.
// Pattern: ipcMain.handle('name', withValidation(schema, handler))
// Schemas: src/main/validation/ipcSchemas.js
// Currently validated: speaker mapping, vocabulary, patterns, templates, llm, widget
// ===================================================
const {
  withValidation,
  validateIpcInput,
  // Speaker mapping schemas
  speakerMappingGetSuggestionsSchema,
  speakerMappingDeleteSchema,
  speakerMappingExtractSchema,
  speakerMappingDetectDuplicatesSchema,
  speakerMappingApplySchema,
  speakerMappingImportSchema,
  speakerMappingAddSchema,
  speakerMappingApplyToTranscriptSchema,
  // Speaker matching schemas
  speakersMatchSchema,
  speakersUpdateMappingSchema,
  // Google auth schemas
  googleAuthenticateSchema,
  // Routing schemas
  routingAddOrganizationSchema,
  routingAddEmailsSchema,
  routingDeleteOrganizationSchema,
  // Template schemas
  templatesEstimateCostSchema,
  templatesGenerateSummariesSchema,
  // LLM schemas
  llmSwitchProviderSchema,
  // Vocabulary schemas
  vocabularySpellingSchema,
  vocabularyKeywordSchema,
  vocabularyClientSpellingSchema,
  vocabularyClientKeywordSchema,
  vocabularyRemoveSpellingSchema,
  vocabularyRemoveKeywordSchema,
  // Pattern schemas
  patternsTestParseSchema,
  patternsSaveConfigSchema,
  // Import schemas
  importFileSchema,
  importBatchSchema,
  importTranscribeAudioSchema,
  importAudioFileSchema,
  // v1.2: Widget schemas
  widgetStartRecordingSchema,
  widgetToggleAlwaysOnTopSchema,
  widgetMeetingInfoSchema,
  // Simple input schemas
  stringIdSchema,
  optionalStringSchema,
  optionalBooleanSchema,
  hoursAheadSchema,
  // Contact schemas
  contactSchema,
  // Settings/config schemas
  userProfileSchema,
  appSettingsSchema,
  logsOptionsSchema,
  // Key management schemas
  keyNameSchema,
  // Import options schema
  importOptionsSchema,
  // Vocabulary config schema
  vocabularyConfigSchema,
  // Meeting update schemas
  updateMeetingFieldSchema,
  meetingAutoStartSchema,
  // Transcription provider schema
  transcriptionProviderSchema,
} = require('./main/validation/ipcSchemas');
require('dotenv').config();

// Configure electron-log
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

// Create scoped loggers for different modules
const logger = {
  main: log.scope('Main'),
  monitor: log.scope('MeetingMonitor'),
  ipc: log.scope('IPC'),
};

// ===================================================================
// API Key Helper (Phase 10.2)
// ===================================================================
// Helper function to get API keys with automatic fallback:
// 1. Try Windows Credential Manager (via keyManagementService)
// 2. Fall back to process.env if not found
// This allows gradual migration from .env to secure storage
async function getAPIKey(keyName) {
  try {
    // Try credential manager first
    const value = await keyManagementService.getKey(keyName);
    if (value) {
      logger.main.debug(`[APIKey] Retrieved ${keyName} from Credential Manager`);
      return value;
    }

    // Fall back to process.env
    const envValue = process.env[keyName];
    if (envValue) {
      logger.main.debug(`[APIKey] Retrieved ${keyName} from process.env (consider migrating)`);
      return envValue;
    }

    logger.main.warn(`[APIKey] ${keyName} not found in Credential Manager or process.env`);
    return null;
  } catch (error) {
    logger.main.error(`[APIKey] Failed to get ${keyName}:`, error);
    // Fall back to process.env on error
    return process.env[keyName] || null;
  }
}

// Synchronous version for backwards compatibility (uses process.env only)
// New code should use the async version above
function getAPIKeySync(keyName) {
  return process.env[keyName] || null;
}

// Export for use in other modules
global.getAPIKey = getAPIKey;
global.getAPIKeySync = getAPIKeySync;

// Initialize LLM service with auto-detection of available provider
// Priority: Azure OpenAI > Anthropic > OpenAI
// Initialized in app.whenReady() using Windows Credential Manager
let llmService = null;

// Pattern Generation Service removed (Phase 10.8.3 removed)

// Express server instance (for webhook endpoint)
let expressServer = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ===================================================================
// Development Mode: Separate userData from Production
// ===================================================================
// Use a different userData folder in development to avoid conflicts with
// the installed production app. This must be called before app.ready.
if (process.env.NODE_ENV === 'development') {
  const devUserDataPath = path.join(app.getPath('appData'), 'jd-notes-things-dev');
  app.setPath('userData', devUserDataPath);
  log.info(`[Dev Mode] Using separate userData path: ${devUserDataPath}`);
}

/**
 * Create a red-tinted icon for development mode
 * Makes it visually obvious when running the dev version
 * @returns {nativeImage|null} Red dev icon or null if creation fails
 */
function createDevIcon() {
  try {
    // Create a 32x32 red icon with "DEV" indicator
    const size = 32;
    const canvas = Buffer.alloc(size * size * 4); // RGBA

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Create a red rounded square with darker border
        const isEdge = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
        const isCorner =
          (x < 4 && y < 4) ||
          (x < 4 && y >= size - 4) ||
          (x >= size - 4 && y < 4) ||
          (x >= size - 4 && y >= size - 4);

        if (isCorner) {
          // Transparent corners for rounded effect
          canvas[idx] = 0; // R
          canvas[idx + 1] = 0; // G
          canvas[idx + 2] = 0; // B
          canvas[idx + 3] = 0; // A (transparent)
        } else if (isEdge) {
          // Dark red border
          canvas[idx] = 139; // R
          canvas[idx + 1] = 0; // G
          canvas[idx + 2] = 0; // B
          canvas[idx + 3] = 255; // A
        } else {
          // Bright red fill
          canvas[idx] = 220; // R
          canvas[idx + 1] = 53; // G
          canvas[idx + 2] = 69; // B
          canvas[idx + 3] = 255; // A
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  } catch (error) {
    log.error('[Dev Mode] Failed to create dev icon:', error);
    return null;
  }
}

// ===================================================================
// Single Instance Lock (BF-2: Prevent Multiple Instances)
// ===================================================================
// Ensure only one instance of the app is running at a time.
// If a second instance is launched, focus the existing window instead.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running - quit this one
  log.info('[SingleInstance] Another instance is already running, quitting...');
  app.quit();
} else {
  // This is the primary instance - handle second instance attempts
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    log.info('[SingleInstance] Second instance detected, focusing existing window');

    if (mainWindow) {
      // Restore window based on its current state:
      // 1. Hidden (minimized to tray) - show and focus
      // 2. Minimized (to taskbar) - restore and focus
      // 3. Visible but not focused - just focus

      if (!mainWindow.isVisible()) {
        // Window is hidden (in system tray)
        log.info('[SingleInstance] Window was hidden (tray), showing...');
        mainWindow.show();
      } else if (mainWindow.isMinimized()) {
        // Window is minimized to taskbar
        log.info('[SingleInstance] Window was minimized, restoring...');
        mainWindow.restore();
      }

      // Windows requires extra steps to reliably bring window to front
      // Using setAlwaysOnTop trick to force focus
      mainWindow.setAlwaysOnTop(true);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);

      log.info('[SingleInstance] Window should now be focused');
    } else {
      // Window doesn't exist (shouldn't happen, but handle gracefully)
      log.info('[SingleInstance] No main window found, creating one...');
      createWindow();
    }
  });
}

// Store detected meeting information
let detectedMeeting = null;

// Google integration (unified authentication)
let googleAuth = null;
let googleCalendar = null;

// Template Manager for Phase 4
let templateManager = null;

// Obsidian export system (Phase 5)
let vaultStructure = null;
let routingEngine = null;

// Import system (Phase 8)
let importManager = null;

// Speaker recognition system (Phase 6)
let googleContacts = null;
let speakerMatcher = null;

let mainWindow;
let recordingWidget = null; // Floating recording widget window (v1.2)
let tray = null; // System tray icon (Phase 10.7)
let isRecording = false; // Track recording state for UI updates (Phase 10.7)
let sdkReady = false; // Track when SDK is fully initialized (after restart workaround)
let recordingStartTime = null; // Track when recording started for widget timer (v1.2)
let currentRecordingMeetingTitle = null; // Track current meeting title for widget (v1.2)

// Meeting monitor state
const notifiedMeetings = new Set(); // Track meetings we've shown notifications for
const autoStartedMeetings = new Set(); // Track meetings we've auto-started recording
const meetingAutoStartOverrides = new Map(); // v1.2: Per-meeting auto-start overrides (meetingId -> boolean)
let meetingMonitorInterval = null;

// ===================================================================
// Speech Timeline Tracking (SM-1: Speaker Matching)
// ===================================================================
// Stores speech events from SDK to correlate with transcription speaker labels
// Map: windowId -> { participants: Map<participantId, {name, segments: [{start, end}], currentStart}> }
const speechTimelines = new Map();

// App settings storage (Phase 10.7)
let appSettings = {
  notifications: {
    enableToasts: true,
    enableSounds: true,
    minimizeToTray: true,
    showRecordingWidget: true, // v1.2: Show floating widget when meeting detected
    autoStartRecording: false, // v1.2: Auto-start recording when calendar meeting begins
  },
  shortcuts: {
    startStopRecording: 'CommandOrControl+Shift+R',
    quickRecord: 'CommandOrControl+Shift+Q',
    stopRecording: 'CommandOrControl+Shift+S',
  },
  windowBounds: null, // Will store {x, y, width, height, displayId}
  transcriptionProvider: 'assemblyai', // v1.2: Default transcription provider
  streamDeck: {
    enabled: false, // v1.2: Enable Stream Deck WebSocket integration
  },
};

// Settings file path (Phase 10.7) - stored in config/ directory
const SETTINGS_FILE_PATH = () => path.join(app.getPath('userData'), 'config', 'app-settings.json');

// User profile storage (v1.1)
let userProfile = {
  name: '',
  email: '',
  title: '',
  organization: '',
  context: '', // Additional context for LLM summaries
};

const USER_PROFILE_PATH = () => path.join(app.getPath('userData'), 'config', 'user-profile.json');

/**
 * Load app settings from disk (Phase 10.7)
 */
function loadAppSettings() {
  try {
    const settingsPath = SETTINGS_FILE_PATH();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const savedSettings = JSON.parse(data);
      // Merge with defaults to handle new settings added in updates
      appSettings = {
        ...appSettings,
        ...savedSettings,
        notifications: { ...appSettings.notifications, ...savedSettings.notifications },
        shortcuts: { ...appSettings.shortcuts, ...savedSettings.shortcuts },
        streamDeck: { ...appSettings.streamDeck, ...savedSettings.streamDeck },
      };
      logger.main.info('App settings loaded successfully');
    }
  } catch (error) {
    logger.main.error('Failed to load app settings:', error);
  }
}

/**
 * Save app settings to disk (Phase 10.7)
 */
function saveAppSettings() {
  try {
    const settingsPath = SETTINGS_FILE_PATH();
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2), 'utf8');
    logger.main.debug('App settings saved successfully');
  } catch (error) {
    logger.main.error('Failed to save app settings:', error);
  }
}

/**
 * Load user profile from disk (v1.1)
 */
function loadUserProfile() {
  try {
    const profilePath = USER_PROFILE_PATH();
    if (fs.existsSync(profilePath)) {
      const data = fs.readFileSync(profilePath, 'utf8');
      const savedProfile = JSON.parse(data);
      // Merge with defaults to handle new fields added in updates
      userProfile = {
        ...userProfile,
        ...savedProfile,
      };
      logger.main.info('User profile loaded successfully');
    }
  } catch (error) {
    logger.main.error('Failed to load user profile:', error);
  }
}

/**
 * Save user profile to disk (v1.1)
 */
function saveUserProfile() {
  try {
    const profilePath = USER_PROFILE_PATH();
    const dir = path.dirname(profilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(profilePath, JSON.stringify(userProfile, null, 2), 'utf8');
    logger.main.debug('User profile saved successfully');
  } catch (error) {
    logger.main.error('Failed to save user profile:', error);
  }
}

/**
 * Create system tray icon and menu (Phase 10.7)
 */
function createSystemTray() {
  try {
    const isDev = process.env.NODE_ENV === 'development';

    // In dev mode, always use a red icon for easy identification
    if (isDev) {
      logger.main.info('[Tray] Dev mode - using red tray icon');
      const devIcon = createDevIcon();
      if (devIcon) {
        tray = new Tray(devIcon);
        tray.setToolTip('JD Notes Things Dev');
      } else {
        // Fallback: create simple red square
        const canvas = Buffer.alloc(16 * 16 * 4);
        for (let i = 0; i < canvas.length; i += 4) {
          canvas[i] = 220; // R
          canvas[i + 1] = 53; // G
          canvas[i + 2] = 69; // B
          canvas[i + 3] = 255; // A
        }
        tray = new Tray(nativeImage.createFromBuffer(canvas, { width: 16, height: 16 }));
        tray.setToolTip('JD Notes Things Dev');
      }
    } else {
      // Production mode - use normal icon
      let trayIcon = null;

      // Try multiple possible locations for the icon
      const possiblePaths = [
        path.join(__dirname, 'assets', 'tray-icon.png'),
        path.join(__dirname, '..', 'assets', 'tray-icon.png'),
        path.join(__dirname, '..', 'src', 'assets', 'tray-icon.png'),
        path.join(process.cwd(), 'src', 'assets', 'tray-icon.png'),
        path.join(app.getAppPath(), 'src', 'assets', 'tray-icon.png'),
      ];

      logger.main.debug('[Tray] Searching for tray icon in multiple locations...');
      logger.main.debug('[Tray] __dirname:', __dirname);
      logger.main.debug('[Tray] process.cwd():', process.cwd());
      logger.main.debug('[Tray] app.getAppPath():', app.getAppPath());

      // Try custom tray icon from multiple locations
      for (const iconPath of possiblePaths) {
        logger.main.debug(`[Tray] Trying: ${iconPath}`);
        if (fs.existsSync(iconPath)) {
          logger.main.info(`[Tray] Found tray icon at: ${iconPath}`);
          trayIcon = nativeImage.createFromPath(iconPath);
          if (trayIcon && !trayIcon.isEmpty()) {
            logger.main.info('[Tray] Successfully loaded tray icon');
            break;
          } else {
            logger.main.warn(`[Tray] Icon exists but failed to load: ${iconPath}`);
          }
        }
      }

      // Try app icon as fallback
      if (!trayIcon || trayIcon.isEmpty()) {
        logger.main.warn('[Tray] Custom tray icon not found, trying app icon...');
        const appIconPath = path.join(__dirname, 'assets', 'icon.png');
        if (fs.existsSync(appIconPath)) {
          trayIcon = nativeImage.createFromPath(appIconPath);
        }
      }

      // Create a simple colored icon as final fallback
      if (!trayIcon || trayIcon.isEmpty()) {
        logger.main.warn('[Tray] No icon files found, using programmatic fallback icon');
        // Create a simple 16x16 icon programmatically
        const canvas = {
          width: 16,
          height: 16,
          data: Buffer.alloc(16 * 16 * 4), // RGBA
        };

        // Fill with orange color (since user mentioned seeing orange)
        for (let i = 0; i < canvas.data.length; i += 4) {
          canvas.data[i] = 255; // R
          canvas.data[i + 1] = 140; // G
          canvas.data[i + 2] = 0; // B (orange color)
          canvas.data[i + 3] = 255; // A
        }

        trayIcon = nativeImage.createFromBuffer(canvas.data, {
          width: canvas.width,
          height: canvas.height,
        });
      }

      tray = new Tray(trayIcon);
    }

    const appLabel = isDev ? 'JD Notes Things Dev' : 'JD Notes Things';
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Open ${appLabel}`,
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quick Note',
        accelerator: appSettings.shortcuts.quickRecord,
        click: async () => {
          try {
            await startQuickRecord();
          } catch (error) {
            logger.main.error('Quick record failed:', error);
          }
        },
      },
      {
        label: 'Record Meeting',
        accelerator: appSettings.shortcuts.startStopRecording,
        click: async () => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('toggle-recording-shortcut');
            }
          } catch (error) {
            logger.main.error('Toggle recording failed:', error);
          }
        },
      },
      {
        label: 'Stop Recording',
        accelerator: appSettings.shortcuts.stopRecording,
        enabled: false, // Will be enabled when recording is active
        id: 'stop-recording',
        click: async () => {
          try {
            // Trigger stop recording
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('stop-recording-requested');
            }
          } catch (error) {
            logger.main.error('Stop recording failed:', error);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Open Vault Folder',
        click: async () => {
          try {
            // Use the properly initialized vault path from vaultStructure
            const vaultPath = vaultStructure?.vaultBasePath;

            if (!vaultPath) {
              logger.main.error('[Tray] Vault path not configured');
              return;
            }

            logger.main.info('[Tray] Opening vault folder:', vaultPath);
            const result = await shell.openPath(vaultPath);

            if (result) {
              // openPath returns an error string if it fails, empty string on success
              logger.main.error('[Tray] Failed to open vault folder:', result);
            }
          } catch (error) {
            logger.main.error('[Tray] Error opening vault folder:', error);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('open-settings');
          }
        },
      },
      {
        label: 'View Logs',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('open-logs-viewer');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip(appLabel);
    tray.setContextMenu(contextMenu);

    // Double-click to show/hide window
    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });

    logger.main.info('System tray created successfully');
  } catch (error) {
    logger.main.error('Failed to create system tray:', error);
  }
}

/**
 * Update system tray menu state (Phase 10.7)
 * Call this when recording state changes
 */
function updateSystemTrayMenu() {
  if (!tray) return;

  try {
    const isDev = process.env.NODE_ENV === 'development';
    const appLabel = isDev ? 'JD Notes Things Dev' : 'JD Notes Things';
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Open ${appLabel}`,
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quick Note',
        accelerator: appSettings.shortcuts.quickRecord,
        enabled: !isRecording, // Disable when recording
        click: async () => {
          try {
            await startQuickRecord();
          } catch (error) {
            logger.main.error('Quick record failed:', error);
          }
        },
      },
      {
        label: 'Record Meeting',
        accelerator: appSettings.shortcuts.startStopRecording,
        enabled: !isRecording, // Disable when recording
        click: async () => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('toggle-recording-shortcut');
            }
          } catch (error) {
            logger.main.error('Toggle recording failed:', error);
          }
        },
      },
      {
        label: 'Stop Recording',
        accelerator: appSettings.shortcuts.stopRecording,
        enabled: isRecording, // Enable only when recording
        click: async () => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('stop-recording-requested');
            }
          } catch (error) {
            logger.main.error('Stop recording failed:', error);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Open Vault Folder',
        click: async () => {
          try {
            const vaultPath = vaultStructure?.vaultBasePath;
            if (!vaultPath) {
              logger.main.error('[Tray] Vault path not configured');
              return;
            }
            logger.main.info('[Tray] Opening vault folder:', vaultPath);
            const result = await shell.openPath(vaultPath);
            if (result) {
              logger.main.error('[Tray] Failed to open vault folder:', result);
            }
          } catch (error) {
            logger.main.error('[Tray] Error opening vault folder:', error);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('open-settings');
          }
        },
      },
      {
        label: 'View Logs',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('open-logs-viewer');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(isRecording ? `${appLabel} - Recording` : appLabel);
    logger.main.debug('[Tray] Menu updated, recording:', isRecording);
  } catch (error) {
    logger.main.error('[Tray] Failed to update tray menu:', error);
  }
}

/**
 * Update tray menu to reflect recording state (Phase 10.7)
 * Note: Currently unused - tray menu is recreated on each recording state change
 * Kept for potential future dynamic menu updates
 */
// eslint-disable-next-line no-unused-vars
function updateTrayMenu(isRecording) {
  if (!tray) return;

  const menu = tray.getContextMenu();
  if (menu) {
    const stopRecordingItem = menu.getMenuItemById('stop-recording');
    if (stopRecordingItem) {
      stopRecordingItem.enabled = isRecording;
    }
  }
}

/**
 * Quick record function (Phase 10.7)
 * Starts an in-person recording immediately
 */
async function startQuickRecord() {
  logger.main.info('Quick record triggered from tray');

  // Show notification
  if (appSettings.notifications.enableToasts) {
    const notification = new Notification({
      title: 'Quick Record Started',
      body: 'Recording in-person meeting...',
      silent: !appSettings.notifications.enableSounds,
    });
    notification.show();
  }

  // Trigger recording start via IPC
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('quick-record-requested');
  }
}

/**
 * Register global keyboard shortcuts (Phase 10.7)
 */
function registerGlobalShortcuts() {
  try {
    // Start/Stop Recording shortcut
    globalShortcut.register(appSettings.shortcuts.startStopRecording, () => {
      logger.main.debug('Global shortcut triggered: Start/Stop Recording');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toggle-recording-shortcut');
      }
    });

    // Quick Record shortcut
    globalShortcut.register(appSettings.shortcuts.quickRecord, async () => {
      logger.main.debug('Global shortcut triggered: Quick Record');
      await startQuickRecord();
    });

    // Stop Recording shortcut
    globalShortcut.register(appSettings.shortcuts.stopRecording, () => {
      logger.main.debug('Global shortcut triggered: Stop Recording');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stop-recording-requested');
      }
    });

    logger.main.info('Global shortcuts registered successfully');
  } catch (error) {
    logger.main.error('Failed to register global shortcuts:', error);
  }
}

/**
 * Unregister all global shortcuts (Phase 10.7)
 */
function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
  logger.main.debug('Global shortcuts unregistered');
}

/**
 * Meeting monitor - checks for upcoming meetings and auto-starts recording
 */
function startMeetingMonitor() {
  logger.monitor.info('Starting meeting monitor...');

  // Check immediately on start
  checkUpcomingMeetings();

  // Then check every minute
  meetingMonitorInterval = setInterval(() => {
    checkUpcomingMeetings();
  }, 60000); // 60 seconds
}

/**
 * Check for upcoming meetings and auto-start recording if needed
 */
async function checkUpcomingMeetings() {
  try {
    // Only check if calendar is authenticated
    if (!googleCalendar || !googleCalendar.isAuthenticated()) {
      return;
    }

    const meetings = await googleCalendar.getUpcomingMeetings(2); // Next 2 hours
    const now = new Date();

    // v1.2: Find meetings that are starting now (within 2-minute window)
    const meetingsStartingNow = [];

    for (const meeting of meetings) {
      const startTime = new Date(meeting.startTime);
      const timeUntilStart = startTime - now;
      const minutesUntilStart = Math.floor(timeUntilStart / (1000 * 60));

      // Skip if meeting has already started (more than 2 minutes ago)
      if (minutesUntilStart < -2) {
        continue;
      }

      // Show notification 2 minutes before meeting starts
      if (minutesUntilStart <= 2 && minutesUntilStart >= 0 && !notifiedMeetings.has(meeting.id)) {
        logger.monitor.info(
          `Meeting starting soon: ${meeting.title} (in ${minutesUntilStart} minutes)`
        );
        showMeetingNotification(meeting, minutesUntilStart);
        notifiedMeetings.add(meeting.id);
      }

      // Collect meetings starting within the auto-start window
      if (
        minutesUntilStart <= 0 &&
        minutesUntilStart >= -2 &&
        !autoStartedMeetings.has(meeting.id)
      ) {
        meetingsStartingNow.push(meeting);
      }
    }

    // v1.2: Handle meetings starting now based on settings
    if (meetingsStartingNow.length > 0 && !isRecording) {
      const globalAutoStartEnabled =
        appSettings.notifications?.autoStartRecording || appSettings.autoStartRecording;
      // Check both old location (notifications) and new location (top-level) for showRecordingWidget
      const showWidget =
        appSettings.showRecordingWidget !== undefined
          ? appSettings.showRecordingWidget
          : (appSettings.notifications?.showRecordingWidget ?? true);

      if (meetingsStartingNow.length > 1) {
        // Multiple overlapping meetings - show widget with selection
        logger.monitor.info(
          `Multiple meetings starting: ${meetingsStartingNow.map(m => m.title).join(', ')}`
        );
        if (showWidget) {
          showRecordingWidget(meetingsStartingNow);
        }
        // Mark all as prompted so we don't keep prompting
        meetingsStartingNow.forEach(m => autoStartedMeetings.add(m.id));
      } else {
        // Single meeting
        const meeting = meetingsStartingNow[0];

        // v1.2: Check for per-meeting auto-start override
        const meetingOverride = meetingAutoStartOverrides.get(meeting.id);
        const autoStartEnabled =
          meetingOverride !== undefined ? meetingOverride : globalAutoStartEnabled;

        if (autoStartEnabled) {
          // Auto-start recording
          logger.monitor.info(
            `Auto-starting recording for: ${meeting.title} (override: ${meetingOverride !== undefined})`
          );
          await autoStartRecording(meeting);
          autoStartedMeetings.add(meeting.id);

          // Show widget with recording status
          if (showWidget) {
            showRecordingWidget(meeting);
            updateWidgetRecordingState(true, meeting.title);
          }
        } else if (showWidget) {
          // Show widget to prompt user
          logger.monitor.info(`Showing widget prompt for: ${meeting.title}`);
          showRecordingWidget(meeting);
          autoStartedMeetings.add(meeting.id);
        }
      }
    }

    // Clean up old meeting IDs (remove meetings from more than 1 hour ago)
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const meeting of meetings) {
      const startTime = new Date(meeting.startTime);
      if (startTime < oneHourAgo) {
        notifiedMeetings.delete(meeting.id);
        autoStartedMeetings.delete(meeting.id);
      }
    }
  } catch (error) {
    logger.monitor.error('Error checking meetings:', error);
  }
}

/**
 * Show system notification for upcoming meeting
 */
function showMeetingNotification(meeting, minutesUntilStart) {
  const notification = new Notification({
    title: 'Meeting Starting Soon',
    body: `${meeting.title} starts in ${minutesUntilStart} minute${minutesUntilStart !== 1 ? 's' : ''}`,
    icon: null, // You can add an icon path here
    timeoutType: 'default',
  });

  notification.on('click', () => {
    console.log('[Meeting Monitor] Notification clicked');
    // Focus the main window
    if (mainWindow) {
      mainWindow.focus();
    }
  });

  notification.show();
}

/**
 * Auto-start recording for a calendar meeting
 */
async function autoStartRecording(meeting) {
  try {
    console.log(`[Meeting Monitor] Auto-starting recording for meeting: ${meeting.title}`);

    // Create a new meeting entry
    const meetingId = Date.now().toString();
    const newMeeting = {
      id: meetingId,
      type: 'calendar',
      title: meeting.title,
      date: new Date().toISOString().split('T')[0],
      content: `# ${meeting.title}\n\n## Meeting Information\n- Date: ${new Date(meeting.startTime).toLocaleDateString()}\n- Time: ${new Date(meeting.startTime).toLocaleTimeString()}\n- Platform: ${meeting.platform}\n${meeting.meetingLink ? `- Link: ${meeting.meetingLink}\n` : ''}${meeting.organizer ? `- Organizer: ${meeting.organizer.name} (${meeting.organizer.email})\n` : ''}\n\n## Participants\n${meeting.participants.map(p => `- ${p.name} (${p.email})`).join('\n')}\n\n## Recording\nAuto-started at ${new Date().toLocaleTimeString()}\n\n## Transcript\nRecording in progress...\n`,
      recordingStatus: 'pending',
      transcript: [],
      summary: '',
      calendarEventId: meeting.id,
      participantEmails: meeting.participantEmails || [],
    };

    // Save the meeting
    const data = await fileOperationManager.readMeetingsData();
    data.upcomingMeetings.push(newMeeting);
    await fileOperationManager.writeData(data);

    // Start recording
    // Note: You'll need to implement the actual recording start logic here
    // For now, we'll just create the meeting entry
    console.log(`[Meeting Monitor] Created meeting entry: ${meetingId}`);

    // Show notification that recording started
    const recordingNotification = new Notification({
      title: 'Recording Started',
      body: `Auto-recording: ${meeting.title}`,
      icon: null,
    });
    recordingNotification.show();

    // Send update to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting-auto-started', { meetingId, meeting });
    }
  } catch (error) {
    console.error('[Meeting Monitor] Error auto-starting recording:', error);
  }
}

const createWindow = () => {
  // Restore window bounds from settings (Phase 10.7)
  const isDev = process.env.NODE_ENV === 'development';

  const windowOptions = {
    width: 1024,
    height: 768,
    icon: path.join(__dirname, 'assets', 'jd-notes-things.ico'),
    title: isDev ? 'JD Notes Things Dev' : 'JD Notes Things',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    // Custom title bar like Claude Desktop
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: isDev ? '#4a1a1a' : '#1e1e1e', // Red-tinted background for dev mode
  };

  // Use red dev icon in development mode
  if (isDev) {
    // Create a red-tinted icon programmatically for dev mode
    const devIcon = createDevIcon();
    if (devIcon) {
      windowOptions.icon = devIcon;
    }
  }

  // Restore previous window position if available
  if (appSettings.windowBounds) {
    const displays = screen.getAllDisplays();
    const displayStillExists = displays.some(
      display => display.id === appSettings.windowBounds.displayId
    );

    if (displayStillExists) {
      windowOptions.x = appSettings.windowBounds.x;
      windowOptions.y = appSettings.windowBounds.y;
      windowOptions.width = appSettings.windowBounds.width;
      windowOptions.height = appSettings.windowBounds.height;
      logger.main.debug('Restored window bounds from settings');
    } else {
      logger.main.debug('Previous display not found, using default position');
    }
  }

  // Create the browser window.
  mainWindow = new BrowserWindow(windowOptions);

  // Save window bounds when moved or resized (Phase 10.7)
  const saveWindowBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);

    appSettings.windowBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      displayId: display.id,
    };

    saveAppSettings();
  };

  // Throttle save to avoid excessive writes
  let saveTimeout;
  mainWindow.on('resize', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveWindowBounds, 500);
  });

  mainWindow.on('move', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveWindowBounds, 500);
  });

  // Minimize to tray behavior (Phase 10.7)
  mainWindow.on('minimize', event => {
    if (appSettings.notifications.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();

      // Show notification on first minimize
      if (appSettings.notifications.enableToasts) {
        const notification = new Notification({
          title: 'JD Notes Things',
          body: 'App minimized to tray. Double-click tray icon to restore.',
          silent: !appSettings.notifications.enableSounds,
        });
        notification.show();
      }
    }
  });

  // Prevent quit on window close (minimize to tray instead)
  mainWindow.on('close', event => {
    if (!app.isQuitting && appSettings.notifications.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    // If minimizeToTray is disabled, clean up widget and tray before closing
    if (!app.isQuitting && !appSettings.notifications.minimizeToTray) {
      // Close the recording widget if open
      if (recordingWidget && !recordingWidget.isDestroyed()) {
        recordingWidget.close();
        recordingWidget = null;
      }
      // Destroy the tray icon
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
        tray = null;
      }
    }
  });

  // Allow the debug panel header to act as a drag region
  mainWindow.on('ready-to-show', () => {
    try {
      // Set regions that can be used to drag the window
      if (process.platform === 'darwin') {
        // Only needed on macOS
        mainWindow.setWindowButtonVisibility(true);
      }
    } catch (error) {
      console.error('Error setting drag regions:', error);
    }
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools in development
  if (process.env.NODE_ENV === 'development') {
    // mainWindow.webContents.openDevTools();
  }

  // Listen for navigation events
  ipcMain.on('navigate', (event, page) => {
    if (page === 'note-editor') {
      mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY + '/../note-editor/index.html');
    } else if (page === 'home') {
      mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    }
  });
};

// ===================================================================
// Recording Widget Window (v1.2 - Krisp-style floating widget)
// ===================================================================

/**
 * Create the floating recording widget window
 */
function createRecordingWidget() {
  if (recordingWidget && !recordingWidget.isDestroyed()) {
    return recordingWidget;
  }

  // Position widget in bottom-right corner near system tray
  // Widget is 90px but tooltip expands 220px to the left + padding
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const widgetWidth = 350; // Wide enough for tooltip (220px) + widget (90px) + margins
  const widgetHeight = 220;
  const margin = 20;

  recordingWidget = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x: screenWidth - widgetWidth - margin,
    y: screenHeight - widgetHeight - margin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: RECORDING_WIDGET_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the widget HTML using webpack entry
  recordingWidget.loadURL(RECORDING_WIDGET_WEBPACK_ENTRY);

  // Hide widget when it loses focus (optional - can be changed in settings)
  recordingWidget.on('blur', () => {
    // Keep visible if recording
    if (!isRecording) {
      // Don't auto-hide, let user close manually
    }
  });

  recordingWidget.on('closed', () => {
    recordingWidget = null;
  });

  return recordingWidget;
}

/**
 * Show the recording widget with meeting info
 * v1.2: Enhanced to support standalone mode (no meeting info required)
 * @param {Object|Array|null} meetingInfo - Single meeting, array of meetings, or null for standalone mode
 */
function showRecordingWidget(meetingInfo = null) {
  // In standalone mode, always allow showing widget regardless of settings
  // Only check settings when triggered by meeting detection
  if (meetingInfo && !appSettings.notifications?.showRecordingWidget) {
    logger.main.debug('[Widget] Recording widget disabled in settings');
    return;
  }

  const widget = createRecordingWidget();

  const sendUpdate = () => {
    if (meetingInfo === null) {
      // v1.2: Standalone mode - widget is ready but no meeting selected
      widget.webContents.send('widget:update', {
        type: 'show-standalone',
      });
    } else if (Array.isArray(meetingInfo) && meetingInfo.length > 1) {
      widget.webContents.send('widget:update', {
        type: 'show',
        meetings: meetingInfo,
      });
    } else {
      const meeting = Array.isArray(meetingInfo) ? meetingInfo[0] : meetingInfo;
      widget.webContents.send('widget:update', {
        type: 'show',
        meeting: meeting,
      });
    }
  };

  if (widget.isVisible()) {
    // Widget already visible, just update content
    sendUpdate();
  } else {
    // Wait for ready-to-show event before displaying
    widget.once('ready-to-show', () => {
      widget.show();
      sendUpdate();
    });
  }
}

/**
 * Hide the recording widget
 * Note: We destroy instead of hide to avoid Windows transparency flash on re-show
 */
function hideRecordingWidget() {
  if (recordingWidget && !recordingWidget.isDestroyed()) {
    recordingWidget.close();
    recordingWidget = null;
  }
}

/**
 * Update widget with recording state
 */
function updateWidgetRecordingState(recording, meetingTitle = null) {
  if (recordingWidget && !recordingWidget.isDestroyed()) {
    if (recording) {
      recordingStartTime = Date.now();
      currentRecordingMeetingTitle = meetingTitle;
      recordingWidget.webContents.send('widget:update', {
        type: 'recording-started',
        startTime: recordingStartTime,
        meetingTitle: meetingTitle,
      });
    } else {
      recordingWidget.webContents.send('widget:update', {
        type: 'recording-stopped',
      });
      recordingStartTime = null;
      currentRecordingMeetingTitle = null;
    }
  }
}

/**
 * Initialize default config files on first launch (both dev and prod)
 * Copies missing config files from bundled defaults, never overwrites existing files
 *
 * Config location: userData/config/
 * - Dev: AppData/Roaming/jd-notes-things-dev/config/
 * - Prod: AppData/Roaming/jd-notes-things/config/
 */
async function initializeDefaultConfigFiles() {
  const userDataPath = app.getPath('userData');
  const configDir = path.join(userDataPath, 'config');
  const templatesDir = path.join(configDir, 'templates');

  // Bundled config source location
  // Development: config/ in project root
  // Production: resources/config/ (via extraResource in forge.config.js)
  const bundledConfigDir = app.isPackaged
    ? path.join(process.resourcesPath, 'config')
    : path.join(__dirname, '..', '..', 'config');

  logger.main.info('[Config] Initializing config files...');
  logger.main.info('[Config] User config directory:', configDir);
  logger.main.info('[Config] Bundled config source:', bundledConfigDir);

  try {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      logger.main.info('[Config] Created config directory:', configDir);
    }

    // Create templates directory if it doesn't exist
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      logger.main.info('[Config] Created templates directory:', templatesDir);
    }

    // Migrate files from root to config/ (one-time migration for existing installs)
    const filesToMigrate = ['app-settings.json', 'speaker-mappings.json'];
    for (const filename of filesToMigrate) {
      const oldPath = path.join(userDataPath, filename);
      const newPath = path.join(configDir, filename);

      // Only migrate if old location exists and new location doesn't
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        fs.renameSync(oldPath, newPath);
        logger.main.info('[Config] Migrated to config/:', filename);
      }
    }

    // List of config files to copy (if missing)
    const configFiles = ['routing.yaml', 'transcript-patterns.yaml', 'vocabulary.yaml'];

    // Copy each config file if it doesn't exist
    for (const filename of configFiles) {
      const sourcePath = path.join(bundledConfigDir, filename);
      const destPath = path.join(configDir, filename);

      if (!fs.existsSync(destPath)) {
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          logger.main.info('[Config] Copied default config:', filename);
        } else {
          logger.main.warn('[Config] Bundled config not found:', filename);
        }
      } else {
        logger.main.debug('[Config] Config already exists (not overwriting):', filename);
      }
    }

    // Copy default templates from bundled source
    const bundledTemplatesDir = path.join(bundledConfigDir, 'templates');

    if (fs.existsSync(bundledTemplatesDir)) {
      const templateFiles = fs.readdirSync(bundledTemplatesDir);
      for (const filename of templateFiles) {
        const sourcePath = path.join(bundledTemplatesDir, filename);
        const destPath = path.join(templatesDir, filename);

        // Only copy if destination doesn't exist and source is a file
        if (!fs.existsSync(destPath) && fs.statSync(sourcePath).isFile()) {
          fs.copyFileSync(sourcePath, destPath);
          logger.main.info('[Config] Copied default template:', filename);
        }
      }
    } else {
      logger.main.warn('[Config] Bundled templates directory not found:', bundledTemplatesDir);
    }

    logger.main.info('[Config] Config initialization complete');
  } catch (error) {
    logger.main.error('[Config] Error initializing default config files:', error);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  logger.main.info('Application ready, initializing...');
  logger.ipc.debug('Registering IPC handlers...');
  logger.ipc.debug('Registered IPC handlers:', Object.keys(ipcMain._invokeHandlers));

  // Set up SDK logger IPC handlers
  ipcMain.on('sdk-log', (event, logEntry) => {
    // Forward logs from renderer to any open windows
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sdk-log', logEntry);
    }
  });

  // Set up logger event listener to send logs from main to renderer
  sdkLogger.onLog(logEntry => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sdk-log', logEntry);
    }
  });

  // Create recordings directory if it doesn't exist
  try {
    if (!fs.existsSync(RECORDING_PATH)) {
      fs.mkdirSync(RECORDING_PATH, { recursive: true });
      logger.main.info('Created recordings directory:', RECORDING_PATH);
    }
  } catch (e) {
    logger.main.error("Couldn't create the recording path:", e);
  }

  // Create meetings file if it doesn't exist
  try {
    if (!fs.existsSync(meetingsFilePath)) {
      const initialData = { upcomingMeetings: [], pastMeetings: [] };
      fs.writeFileSync(meetingsFilePath, JSON.stringify(initialData, null, 2));
      logger.main.info('Created meetings data file:', meetingsFilePath);
    }
  } catch (e) {
    logger.main.error("Couldn't create the meetings file:", e);
  }

  // Load app settings from disk (Phase 10.7)
  loadAppSettings();

  // Load user profile (v1.1)
  loadUserProfile();

  // Initialize LLM service from Windows Credential Manager (with .env fallback)
  try {
    llmService = await createLLMServiceFromCredentials(keyManagementService);
    logger.main.info(`LLM Service initialized with provider: ${llmService.getProviderName()}`);
  } catch (error) {
    logger.main.warn('LLM Service not initialized - no API keys configured yet:', error.message);
    logger.main.info('User will need to configure LLM API keys in settings');
  }

  // Initialize the Recall.ai SDK
  await initSDK();

  // Note: EncryptionService initialization removed (Phase 10.2)
  // Vault file encryption not needed - Obsidian requires plain text files
  // Service kept for potential future use (audio files, temp files, etc.)

  // Initialize Unified Google Authentication (Calendar + Contacts)
  // Uses initializeAndValidate() to ensure stale tokens from previous installs are cleared
  console.log('[GoogleAuth] Initializing unified Google authentication...');
  googleAuth = new GoogleAuth(null, keyManagementService);
  const authInitialized = await googleAuth.initializeAndValidate();

  if (authInitialized) {
    console.log('[GoogleAuth] Authenticated and validated successfully - initializing services');
    // Use centralized initialization to prevent race conditions
    await initializeGoogleServices();
  } else {
    console.log('[GoogleAuth] Not authenticated - user needs to sign in');
    console.log('[GoogleAuth] Calendar and Contacts features will be disabled until authenticated');
  }

  // Initialize Template Manager (Phase 4)
  console.log('[TemplateManager] Initializing template system...');
  templateManager = new TemplateManager();

  // Always use userData/config/templates (both dev and prod)
  templateManager.templatesPath = path.join(app.getPath('userData'), 'config', 'templates');
  console.log('[TemplateManager] Using templates path:', templateManager.templatesPath);

  const templateCount = templateManager.scanTemplates();
  console.log(`[TemplateManager] Loaded ${templateCount} templates`);

  // Initialize Obsidian Export System (Phase 5)
  console.log('[ObsidianExport] Initializing vault and routing system...');

  // Read vault path from saved settings first, then fall back to environment variable
  let vaultPath = appSettings.vaultPath || process.env.VAULT_PATH || './vault';

  // If path is relative, resolve it from project root
  if (!path.isAbsolute(vaultPath)) {
    const projectRoot = path.join(__dirname, '..', '..');
    vaultPath = path.resolve(projectRoot, vaultPath);
  }

  console.log('[ObsidianExport] Vault path:', vaultPath);
  vaultStructure = new VaultStructure(vaultPath);

  // Always use userData/config for routing config (both dev and prod)
  // Dev uses jd-notes-things-dev, prod uses jd-notes-things
  const configPath = path.join(app.getPath('userData'), 'config', 'routing.yaml');

  // Initialize default config files on first launch (copies missing files, never overwrites)
  await initializeDefaultConfigFiles();

  console.log('[ObsidianExport] Using routing config:', configPath);

  try {
    routingEngine = new RoutingEngine(configPath);
    console.log('[ObsidianExport] Routing engine initialized successfully');

    // Initialize vault structure
    vaultStructure.initializeVault();
    console.log('[ObsidianExport] Vault structure initialized at:', vaultPath);

    // Initialize import manager (Phase 8)
    importManager = new ImportManager({
      routingEngine,
      llmService,
      vaultStructure,
      fileOperationManager,
      templateManager,
      exportFunction: exportMeetingToObsidian, // Share export logic with recordings
      summaryFunction: generateTemplateSummaries, // Share template generation with recordings
      autoSummaryFunction: generateMeetingSummary, // Share auto-summary generation with recordings
      // v1.1: Auto-label single speakers as user before summary generation
      autoLabelFunction: async meeting => {
        if (!userProfile?.name || !meeting.transcript) {
          return { applied: false };
        }
        const result = speakerMappingService.autoApplyUserProfileMapping(
          meeting.transcript,
          userProfile
        );
        if (result.applied) {
          return {
            applied: true,
            transcript: result.transcript,
            userProfile: userProfile,
          };
        }
        return { applied: false };
      },
      // v1.1: Google Contacts for participant name lookup
      googleContacts,
    });
    console.log('[Import] Import manager initialized successfully');

    // Initialize speaker mapping service (SM-2)
    await speakerMappingService.initialize();
    console.log('[SpeakerMapping] Speaker mapping service initialized');
  } catch (error) {
    console.error('[ObsidianExport] Failed to initialize:', error.message);
    console.log('[ObsidianExport] Obsidian export will be disabled');
  }

  // Note: Speaker Recognition System (Phase 6) is initialized within initializeGoogleServices()
  // This ensures all Google services (Calendar, Contacts, Speaker Matcher) are initialized together
  if (!googleAuth || !googleAuth.isAuthenticated()) {
    console.log(
      '[SpeakerRecognition] Google not authenticated - speaker matching will use fallback'
    );
    console.log('[SpeakerRecognition] Speaker names will fall back to email-based extraction');
  }

  // Start meeting monitor for auto-recording (only after all services initialized)
  startMeetingMonitor();

  // Start Express server for webhook endpoint
  // Security: explicitly bind to localhost only (not 0.0.0.0)
  expressServer = expressApp.listen(SERVER_PORT, SERVER_HOST, async () => {
    console.log(`[Webhook Server] Listening on http://${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`[Webhook Server] Endpoint: http://localhost:${SERVER_PORT}${WEBHOOK_RECALL_PATH}`);

    // Tunnel disabled - webhooks not currently used
    // To re-enable, uncomment the tunnelManager.start() call below
    console.log('[Webhook Server] Tunnel disabled - webhooks not in use');
    /*
    try {
      const webhookUrl = await tunnelManager.start(SERVER_PORT);
      global.webhookUrl = `${webhookUrl}${WEBHOOK_RECALL_PATH}`;
      console.log(`Public Webhook URL: ${global.webhookUrl}`);
    } catch (error) {
      console.log('Tunnel not available:', error.message);
    }
    */
  });

  // v1.2: Configure Stream Deck WebSocket integration
  expressApp.configureStreamDeck({
    onStartRecording: async () => {
      try {
        // Check if we have a detected meeting to record
        if (detectedMeeting) {
          // Use the same logic as the record button for detected meetings
          mainWindow.webContents.send('start-recording-from-calendar', {
            title: detectedMeeting.window?.title || 'Meeting',
            platform: detectedMeeting.window?.platform || 'unknown',
          });
          return { success: true, meetingTitle: detectedMeeting.window?.title };
        } else {
          // No meeting detected - start a quick meeting using the same function as tray menu
          await startQuickRecord();
          return { success: true, meetingTitle: 'Quick Meeting' };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    onStopRecording: async () => {
      try {
        // Stop recording via IPC to renderer
        mainWindow.webContents.send('stop-recording-requested');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    getStatus: () => ({
      isRecording,
      meetingTitle: currentRecordingMeetingTitle,
      meetingDetected: detectedMeeting !== null,
      platform: detectedMeeting?.window?.platform || null,
    }),
  });

  // v1.2: Handle WebSocket upgrade for Stream Deck
  expressServer.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/streamdeck')) {
      expressApp.handleStreamDeckUpgrade(request, socket, head);
    }
  });

  // v1.2: Enable/disable Stream Deck based on settings (will be loaded after loadAppSettings)
  // Initial state will be set after loadAppSettings() is called below

  // Phase 10.7: Desktop App Polish
  // Load app settings from disk
  loadAppSettings();
  logger.main.info('[Phase 10.7] App settings loaded');

  // v1.2: Enable Stream Deck based on loaded settings
  expressApp.setStreamDeckEnabled(appSettings.streamDeck?.enabled || false);
  if (appSettings.streamDeck?.enabled) {
    logger.main.info('[v1.2] Stream Deck WebSocket integration enabled');
  }

  // v1.1: Load user profile
  loadUserProfile();
  logger.main.info('[v1.1] User profile loaded');

  // Make mainWindow available to server.js for IPC communication
  // This allows server.js to send webhook events to the main process
  global.mainWindow = null; // Will be set after createWindow()

  createWindow();

  // Set global reference after window is created
  global.mainWindow = mainWindow;

  // Phase 10.7: Create system tray and register shortcuts (after window creation)
  createSystemTray();
  registerGlobalShortcuts();

  // Initialize auto-updater (only in production)
  if (!process.env.ELECTRON_IS_DEV && app.isPackaged) {
    logger.main.info('[AutoUpdater] Initializing auto-updater...');
    try {
      updateElectronApp({
        repo: 'jdbrucecpa/jd-notes-things',
        updateInterval: '1 hour',
        notifyUser: true,
        logger: {
          log: (...args) => logger.main.info('[AutoUpdater]', ...args),
          info: (...args) => logger.main.info('[AutoUpdater]', ...args),
          warn: (...args) => logger.main.warn('[AutoUpdater]', ...args),
          error: (...args) => logger.main.error('[AutoUpdater]', ...args),
        },
      });
      logger.main.info('[AutoUpdater] Auto-updater initialized successfully');
    } catch (error) {
      logger.main.error('[AutoUpdater] Failed to initialize auto-updater:', error);
    }
  } else {
    logger.main.info('[AutoUpdater] Skipping auto-updater in development mode');
  }

  // When the window is ready, send the initial meeting detection status
  mainWindow.webContents.on('did-finish-load', () => {
    // Send the initial meeting detection status with platform info
    mainWindow.webContents.send('meeting-detection-status', {
      detected: detectedMeeting !== null,
      platform: detectedMeeting?.window?.platform || null,
    });
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Phase 10.7: Don't quit when window closed if minimizeToTray is enabled
  if (process.platform !== 'darwin' && !appSettings.notifications.minimizeToTray) {
    app.quit();
  }
});

// Cleanup resources when app quits (Phase 9: Memory Leak Prevention)
app.on('before-quit', async () => {
  console.log('[App] Cleaning up resources before quit...');

  // Destroy tray icon to prevent ghost icon in system tray
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
    console.log('[Tray] Destroyed tray icon');
  }

  // Stop meeting monitor
  if (meetingMonitorInterval) {
    clearInterval(meetingMonitorInterval);
    console.log('[Meeting Monitor] Stopped meeting monitor');
  }

  // Stop tunnel
  await tunnelManager.stop();

  // Close Express server
  if (expressServer) {
    expressServer.close(() => {
      console.log('[Webhook Server] Server closed');
    });
  }

  // Phase 10.7: Unregister global shortcuts
  unregisterGlobalShortcuts();
  console.log('[Phase 10.7] Global shortcuts unregistered');

  // Note: IPC listeners are automatically cleaned up by Electron on app quit
  // Event listeners on individual windows (like auth window) must be cleaned up manually
  // See google:openAuthWindow handler for proper event listener cleanup pattern
  console.log('[App Security] All resources cleaned up successfully');
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Path to meetings data file in the user's Application Support directory
const meetingsFilePath = path.join(app.getPath('userData'), 'meetings.json');

// Path for RecallAI SDK recordings
const RECORDING_PATH = path.join(app.getPath('userData'), 'recordings');

// Global state to track active recordings
const activeRecordings = {
  // Map of recordingId -> {noteId, platform, state}
  recordings: {},

  // Register a new recording
  addRecording: function (recordingId, noteId, platform = 'unknown') {
    this.recordings[recordingId] = {
      noteId,
      platform,
      state: 'recording',
      startTime: new Date(),
    };
    console.log(`Recording registered in global state: ${recordingId} for note ${noteId}`);
  },

  // Update a recording's state
  updateState: function (recordingId, state) {
    if (this.recordings[recordingId]) {
      this.recordings[recordingId].state = state;
      console.log(`Recording ${recordingId} state updated to: ${state}`);
      return true;
    }
    return false;
  },

  // Remove a recording
  removeRecording: function (recordingId) {
    if (this.recordings[recordingId]) {
      delete this.recordings[recordingId];
      console.log(`Recording ${recordingId} removed from global state`);
      return true;
    }
    return false;
  },

  // Get active recording for a note
  getForNote: function (noteId) {
    for (const [recordingId, info] of Object.entries(this.recordings)) {
      if (info.noteId === noteId) {
        return { recordingId, ...info };
      }
    }
    return null;
  },

  // Get all active recordings
  getAll: function () {
    return { ...this.recordings };
  },

  // Check if a recording exists for a given windowId/recordingId
  hasActiveRecording: function (recordingId) {
    return !!this.recordings[recordingId];
  },
};

// File operation manager to prevent race conditions on both reads and writes
const fileOperationManager = {
  isProcessing: false,
  pendingOperations: [],
  readWaiters: [],
  cachedData: null,
  lastReadTime: 0,

  // Read the meetings data with caching to reduce file I/O
  readMeetingsData: async function (skipWait = false) {
    // If a write is in progress, wait for it to complete (unless called internally)
    if (!skipWait && (this.isProcessing || this.pendingOperations.length > 0)) {
      await new Promise(resolve => {
        this.readWaiters.push(resolve);
      });
    }

    // If we have cached data that's recent (less than 500ms old), use it
    const now = Date.now();
    if (this.cachedData && now - this.lastReadTime < 500) {
      return JSON.parse(JSON.stringify(this.cachedData)); // Deep clone
    }

    try {
      // Read from file
      const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      const data = JSON.parse(fileData);

      // Update cache
      this.cachedData = data;
      this.lastReadTime = now;

      return data;
    } catch (error) {
      console.error('Error reading meetings data:', error);
      // If file doesn't exist or is invalid, return empty structure
      return { upcomingMeetings: [], pastMeetings: [] };
    }
  },

  // Schedule an operation that needs to update the meetings data
  scheduleOperation: async function (operationFn) {
    return new Promise((resolve, reject) => {
      // Add this operation to the queue
      this.pendingOperations.push({
        operationFn, // This function will receive the current data and return updated data
        resolve,
        reject,
      });

      // Process the queue if not already processing
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  },

  // Process the operation queue sequentially
  processQueue: async function () {
    if (this.pendingOperations.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get the next operation
      const nextOp = this.pendingOperations.shift();

      // Read the latest data (skipWait = true to avoid deadlock)
      const currentData = await this.readMeetingsData(true);

      try {
        // Execute the operation function with the current data
        const updatedData = await nextOp.operationFn(currentData);

        // If the operation returned data, write it
        if (updatedData) {
          // Update cache immediately
          this.cachedData = updatedData;
          this.lastReadTime = Date.now();

          // Write to file
          await fs.promises.writeFile(meetingsFilePath, JSON.stringify(updatedData, null, 2));
        }

        // Resolve the operation's promise
        nextOp.resolve({ success: true });
      } catch (opError) {
        console.error('Error in file operation:', opError);
        nextOp.reject(opError);
      }
    } catch (error) {
      console.error('Error in file operation manager:', error);

      // If there was an operation that failed, reject its promise
      if (this.pendingOperations.length > 0) {
        const failedOp = this.pendingOperations.shift();
        failedOp.reject(error);
      }
    } finally {
      this.isProcessing = false;

      // Notify any waiting readers that the write is complete
      if (this.readWaiters.length > 0) {
        const waiters = this.readWaiters.splice(0); // Get all and clear
        waiters.forEach(resolve => resolve());
      }

      // Check if more operations were added while we were processing
      if (this.pendingOperations.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  },

  // Helper to write data directly - internally uses scheduleOperation
  writeData: async function (data) {
    return this.scheduleOperation(() => data); // Simply return the data to write
  },
};

// ===================================================================
// Recall.ai Storage Management
// ===================================================================

/**
 * List all SDK uploads from Recall.ai
 * @returns {Promise<Array>} List of SDK uploads
 */
async function listRecallRecordings() {
  try {
    const RECALLAI_API_URL =
      (await keyManagementService.getKey('RECALLAI_API_URL')) ||
      process.env.RECALLAI_API_URL ||
      'https://api.recall.ai';
    const RECALLAI_API_KEY =
      (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

    if (!RECALLAI_API_KEY) {
      console.error('[Recall Storage] API key not configured');
      return { error: 'RECALLAI_API_KEY is not configured' };
    }

    const allUploads = [];
    let nextUrl = `${RECALLAI_API_URL}/api/v1/sdk_upload/`;

    // Paginate through all results
    while (nextUrl) {
      console.log(`[Recall Storage] Fetching: ${nextUrl}`);
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Token ${RECALLAI_API_KEY}` },
        timeout: 30000,
      });

      if (response.data.results) {
        allUploads.push(...response.data.results);
      }
      nextUrl = response.data.next; // Next page URL, or null if done
    }

    console.log(`[Recall Storage] Found ${allUploads.length} SDK uploads`);
    return { success: true, uploads: allUploads };
  } catch (error) {
    console.error('[Recall Storage] Error listing uploads:', error.response?.data || error.message);
    return { error: error.message };
  }
}

/**
 * Delete a recording from Recall.ai
 * @param {string} recordingId - The recording ID to delete
 * @returns {Promise<Object>} Result of deletion
 */
async function deleteRecallRecording(recordingId) {
  try {
    const RECALLAI_API_URL =
      (await keyManagementService.getKey('RECALLAI_API_URL')) ||
      process.env.RECALLAI_API_URL ||
      'https://api.recall.ai';
    const RECALLAI_API_KEY =
      (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

    if (!RECALLAI_API_KEY) {
      return { error: 'RECALLAI_API_KEY is not configured' };
    }

    const url = `${RECALLAI_API_URL}/api/v1/recording/${recordingId}/`;
    console.log(`[Recall Storage] Deleting recording: ${recordingId}`);

    await axios.delete(url, {
      headers: { Authorization: `Token ${RECALLAI_API_KEY}` },
      timeout: 30000,
    });

    console.log(`[Recall Storage] ✓ Deleted recording: ${recordingId}`);
    return { success: true, recordingId };
  } catch (error) {
    // 404 means already deleted, which is fine
    if (error.response?.status === 404) {
      console.log(`[Recall Storage] Recording ${recordingId} already deleted or not found`);
      return { success: true, recordingId, alreadyDeleted: true };
    }
    console.error(
      `[Recall Storage] Error deleting ${recordingId}:`,
      error.response?.data || error.message
    );
    return { error: error.message, recordingId };
  }
}

/**
 * Delete all recordings from Recall.ai to avoid storage charges
 * @returns {Promise<Object>} Summary of deletion results
 */
async function deleteAllRecallRecordings() {
  console.log('[Recall Storage] Starting cleanup of all recordings...');

  const listResult = await listRecallRecordings();
  if (listResult.error) {
    return listResult;
  }

  const uploads = listResult.uploads || [];
  if (uploads.length === 0) {
    console.log('[Recall Storage] No recordings found to delete');
    return { success: true, deleted: 0, total: 0 };
  }

  console.log(`[Recall Storage] Found ${uploads.length} recordings to delete`);

  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const upload of uploads) {
    // SDK uploads have recording_id field
    const recordingId = upload.recording_id;
    if (!recordingId) {
      console.log(`[Recall Storage] Skipping upload ${upload.id} - no recording_id`);
      continue;
    }

    const result = await deleteRecallRecording(recordingId);
    if (result.success) {
      deleted++;
    } else {
      failed++;
      errors.push({ recordingId, error: result.error });
    }

    // Small delay to avoid rate limiting (300 req/min = 5 req/sec)
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  console.log(`[Recall Storage] Cleanup complete: ${deleted} deleted, ${failed} failed`);
  return { success: true, deleted, failed, total: uploads.length, errors };
}

// Create a desktop SDK upload token directly (no separate server needed)
async function createDesktopSdkUpload() {
  try {
    const RECALLAI_API_URL =
      (await keyManagementService.getKey('RECALLAI_API_URL')) ||
      process.env.RECALLAI_API_URL ||
      'https://api.recall.ai';
    const RECALLAI_API_KEY =
      (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

    if (!RECALLAI_API_KEY) {
      console.error('RECALLAI_API_KEY is missing! Configure it in Settings > Security');
      return { error: 'RECALLAI_API_KEY is not configured. Please add it in Settings > Security.' };
    }

    const url = `${RECALLAI_API_URL}/api/v1/sdk_upload/`;

    // Note: Webhook URL is configured in Recall.ai dashboard, not in the request
    // Dashboard configuration: https://api.recall.ai/dashboard/webhooks/
    console.log('[Upload Token] Creating upload token (webhook configured in dashboard)');

    const requestBody = {
      recording_config: {
        // Audio-only recording - must EXPLICITLY set video to null to disable it
        // Per docs: video_mixed_mp4 is enabled by DEFAULT if not set to null
        video_mixed_mp4: null, // ← THIS IS REQUIRED to disable video
        audio_mixed_mp3: {},

        // Retention policy: 7 days (168 hours) - free tier, then auto-delete
        // This prevents storage charges ($0.05/hr for recordings kept > 7 days)
        retention: {
          type: 'timed',
          hours: 168, // 7 days
        },

        // No real-time transcription - we'll use Recall.ai async API after recording
        // This gives us better quality and proper speaker diarization
        realtime_endpoints: [
          {
            type: 'desktop_sdk_callback',
            events: [
              'participant_events.join', // Track participant info
              'participant_events.speech_on', // Track when participants start speaking (SM-1)
              'participant_events.speech_off', // Track when participants stop speaking (SM-1)
            ],
          },
        ],
      },
    };

    console.log('[Upload Token] Request body:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(url, requestBody, {
      headers: { Authorization: `Token ${RECALLAI_API_KEY}` },
      timeout: 9000,
    });

    console.log('[Upload Token] Response:', JSON.stringify(response.data, null, 2));
    console.log(
      'Upload token created successfully:',
      response.data.upload_token?.substring(0, 8) + '...'
    );
    return response.data;
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('Error creating upload token:', errorDetails);
    return { error: `API Error: ${JSON.stringify(errorDetails)}` };
  }
}

// Initialize the Recall.ai SDK
async function initSDK() {
  console.log('Initializing Recall.ai SDK');

  // Retrieve API URL from Windows Credential Manager (with .env fallback)
  const RECALLAI_API_URL =
    (await keyManagementService.getKey('RECALLAI_API_URL')) ||
    process.env.RECALLAI_API_URL ||
    'https://api.recall.ai';

  console.log('[SDK] Using Recall.ai API URL:', RECALLAI_API_URL);

  // Log the SDK initialization
  sdkLogger.logApiCall('init', {
    apiUrl: RECALLAI_API_URL,
    acquirePermissionsOnStartup: ['accessibility', 'screen-capture', 'microphone'],
    restartOnError: true,
    config: {
      recording_path: RECORDING_PATH,
    },
  });

  const sdkConfig = {
    apiUrl: RECALLAI_API_URL,
    acquirePermissionsOnStartup: ['accessibility', 'screen-capture', 'microphone'],
    restartOnError: true,
    config: {
      recording_path: RECORDING_PATH,
    },
  };

  RecallAiSdk.init(sdkConfig);

  // Workaround for detecting already-open meetings
  // The SDK is event-driven and only fires meeting-detected when a window opens
  // For meetings already open before the SDK initialized, we need to trigger a re-scan
  // We do this by shutting down and re-initializing the SDK
  setTimeout(async () => {
    try {
      logger.main.info('[SDK] Attempting to detect already-open meetings via SDK restart...');

      // Temporarily suppress console errors from the SDK during shutdown
      // The SDK logs "Failed to send log to Desktop SDK" when shutting down, which is harmless
      const originalConsoleError = console.error;
      console.error = (...args) => {
        const message = args.join(' ');
        if (!message.includes('Failed to send log to Desktop SDK')) {
          originalConsoleError.apply(console, args);
        }
      };

      // Shutdown the SDK
      await RecallAiSdk.shutdown();
      logger.main.info('[SDK] Shutdown complete');

      // Wait a moment for SDK process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restore console.error
      console.error = originalConsoleError;

      // Re-initialize the SDK with same config
      RecallAiSdk.init(sdkConfig);
      logger.main.info('[SDK] Re-initialized - should now detect any open meetings');

      // The meeting-detected event listener should fire if there are any open meetings
    } catch (error) {
      logger.main.error('[SDK] Error during SDK restart:', error);
    } finally {
      // Mark SDK as fully ready and notify renderer
      sdkReady = true;
      logger.main.info('[SDK] Initialization complete - recording enabled');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sdk-ready');
      }
    }
  }, 3000); // Wait 3 seconds after initial SDK init

  // SDK event listeners are now registered below

  // Listen for meeting detected events
  RecallAiSdk.addEventListener('meeting-detected', evt => {
    console.log('Meeting detected:', evt);

    // Log the meeting detected event
    sdkLogger.logEvent('meeting-detected', {
      platform: evt.window.platform,
      windowId: evt.window.id,
    });

    detectedMeeting = evt;

    // Map platform codes to readable names
    const platformNames = {
      zoom: 'Zoom',
      'google-meet': 'Google Meet',
      slack: 'Slack',
      teams: 'Microsoft Teams',
    };

    // Get a user-friendly platform name, or use the raw platform name if not in our map
    const platformName = platformNames[evt.window.platform] || evt.window.platform;

    // Send the meeting detected status to the renderer process with toast notification
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting-detection-status', {
        detected: true,
        platform: evt.window.platform, // Include platform for UI icon updates
      });
      // Send toast notification to renderer
      mainWindow.webContents.send('show-toast', {
        message: `${platformName} meeting detected`,
        type: 'info',
      });
    }

    // v1.2: Auto-show widget when meeting detected (if setting enabled and not already visible)
    const showWidgetOnDetection =
      appSettings.showRecordingWidget !== undefined
        ? appSettings.showRecordingWidget
        : (appSettings.notifications?.showRecordingWidget ?? true);

    if (showWidgetOnDetection && !isRecording) {
      // Check if widget is already visible to avoid re-popping
      const widgetAlreadyVisible =
        recordingWidget && !recordingWidget.isDestroyed() && recordingWidget.isVisible();

      if (!widgetAlreadyVisible) {
        logger.main.info(`[Widget] Auto-showing widget for detected ${platformName} meeting`);

        // Create a meeting-like object for the widget with platform info
        const detectedMeetingInfo = {
          id: `detected-${evt.window.id}`,
          title: `${platformName} Meeting`,
          platform: evt.window.platform,
          startTime: new Date().toISOString(),
          isDetectedMeeting: true, // Flag to distinguish from calendar meetings
        };

        showRecordingWidget(detectedMeetingInfo);
      } else {
        logger.main.debug('[Widget] Widget already visible, not re-showing for detected meeting');
      }
    }
  });

  // Listen for meeting closed events
  RecallAiSdk.addEventListener('meeting-closed', evt => {
    console.log('Meeting closed:', evt);

    // Log the SDK meeting-closed event
    sdkLogger.logEvent('meeting-closed', {
      windowId: evt.window.id,
    });

    const windowId = evt.window?.id;

    // Automatically stop recording when meeting ends
    // NOTE: WindowId might have changed during recording, so check both the event windowId
    // AND all active recordings to ensure we catch everything
    let recordingToStop = null;

    if (windowId && activeRecordings.hasActiveRecording(windowId)) {
      // Direct match - use the event's windowId
      recordingToStop = windowId;
      console.log(`Meeting ended - found recording with matching windowId: ${windowId}`);
    } else {
      // No direct match - windowId may have changed during recording
      // Check if there's ANY active recording (there should only be one at a time)
      const allRecordings = activeRecordings.getAll();
      const recordingIds = Object.keys(allRecordings);

      if (recordingIds.length > 0) {
        recordingToStop = recordingIds[0];
        console.log(
          `Meeting ended - windowId mismatch! Event: ${windowId}, Active: ${recordingToStop}`
        );
        console.log(`Using active recording windowId to stop: ${recordingToStop}`);
      }
    }

    if (recordingToStop) {
      console.log(`Stopping recording for window: ${recordingToStop}`);

      try {
        // Stop the recording
        RecallAiSdk.stopRecording({ windowId: recordingToStop });
        activeRecordings.updateState(recordingToStop, 'stopping');
        console.log(`✓ Stop recording command sent successfully`);

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recording-state-change', {
            windowId: recordingToStop,
            state: 'stopping',
          });
        }
      } catch (error) {
        // SDK may throw errors if the meeting is already closed, but recording will still stop
        // This is expected behavior, not a critical error
        console.warn(
          `Warning: SDK reported error when stopping recording (recording may have already stopped):`,
          error.message
        );

        // Still update our internal state
        activeRecordings.updateState(recordingToStop, 'stopping');
      }
    } else {
      console.log(`No active recording found to stop (windowId: ${windowId})`);
    }

    // Clean up the global tracking when a meeting ends
    if (windowId && global.activeMeetingIds && global.activeMeetingIds[windowId]) {
      console.log(`Cleaning up meeting tracking for: ${windowId}`);
      delete global.activeMeetingIds[windowId];
    }

    // Also clean up any other windowIds in activeMeetingIds (in case of mismatch)
    if (global.activeMeetingIds) {
      Object.keys(global.activeMeetingIds).forEach(id => {
        console.log(`Also cleaning up meeting tracking for: ${id}`);
        delete global.activeMeetingIds[id];
      });
    }

    detectedMeeting = null;

    // Send the meeting closed status to the renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting-detection-status', {
        detected: false,
        platform: null,
      });
    }
  });

  // Listen for recording ended events
  RecallAiSdk.addEventListener('recording-ended', async evt => {
    console.log('Recording ended:', evt);

    // Log the SDK recording-ended event
    sdkLogger.logEvent('recording-ended', {
      windowId: evt.window.id,
    });

    const windowId = evt.window.id;

    try {
      // Update the note with recording information (marks as complete)
      await updateNoteWithRecordingInfo(windowId);
      console.log('Recording processing complete - preparing for transcription');

      // Get the meeting ID, transcription provider, and participant emails for vocabulary
      let transcriptionProvider = 'assemblyai'; // Default (recallai SDK upload is broken)
      let meetingId = null;
      let participantEmails = [];
      try {
        const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
        const meetingsData = JSON.parse(fileData);
        const meeting = meetingsData.pastMeetings.find(m => m.recordingId === windowId);
        if (meeting) {
          meetingId = meeting.id;
          if (meeting.transcriptionProvider) {
            transcriptionProvider = meeting.transcriptionProvider;
            console.log(`[Transcription] Using provider: ${transcriptionProvider}`);
          }
          // VC-3.5: Capture participant emails for vocabulary lookup
          participantEmails = meeting.participantEmails || [];
          console.log(
            `[Transcription] VC-3: Found ${participantEmails.length} participant emails for vocabulary lookup`
          );
        }
      } catch (error) {
        console.error(
          '[Transcription] Error reading transcription provider, using default:',
          error
        );
      }

      // Immediately notify renderer that recording has ended (update UI right away)
      if (mainWindow && !mainWindow.isDestroyed() && meetingId) {
        console.log(
          '[Recording] Notifying renderer that recording ended - updating UI immediately'
        );
        mainWindow.webContents.send('recording-ended', {
          windowId: windowId,
          meetingId: meetingId,
        });
      }

      // Clean up active recording state immediately
      activeRecordings.removeRecording(windowId);
      console.log(`[Recording] Cleaned up active recording: ${windowId}`);

      // Update recording state and tray menu (Phase 10.7)
      isRecording = false;
      updateSystemTrayMenu();

      // v1.2: Update widget with recording state
      updateWidgetRecordingState(false);

      // v1.2: Notify Stream Deck clients
      expressApp.updateStreamDeckRecordingState(false, null);

      // Wait for file to be fully written before starting transcription
      setTimeout(async () => {
        console.log('[Transcription] Starting transcription after 3 second delay...');
        console.log('[Transcription] Window ID:', windowId);
        console.log('[Transcription] Provider:', transcriptionProvider);

        // Check if recording file exists (SDK always creates MP3)
        const fs = require('fs');
        const recordingPath = path.join(RECORDING_PATH, `windows-desktop-${windowId}.mp3`);
        console.log('[Transcription] Checking for recording file:', recordingPath);

        if (fs.existsSync(recordingPath)) {
          const stats = fs.statSync(recordingPath);
          console.log('[Transcription] ✓ File exists, size:', (stats.size / 1024).toFixed(2), 'KB');
        } else {
          console.error('[Transcription] ✗ Recording file NOT found!');
          return;
        }

        try {
          if (transcriptionProvider === 'recallai') {
            // Recall.ai: Upload via SDK for async webhook-based transcription
            console.log('[Upload] Calling uploadRecording() with ONLY windowId (per docs)...');
            const result = await RecallAiSdk.uploadRecording({
              windowId: windowId,
            });
            console.log('[Upload] uploadRecording() completed with result:', result);
            console.log('[Upload] Waiting for webhook notification...');
          } else {
            // AssemblyAI or Deepgram: Direct transcription
            console.log(`[Transcription] Starting ${transcriptionProvider} transcription...`);
            console.log(`[Transcription] Audio file path: ${recordingPath}`);

            // Notify renderer of upload progress (simulate progress for UI)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('recording-state-change', {
                windowId: windowId,
                state: 'uploading',
                progress: 10,
              });
            }

            // VC-3.5 & VC-3.6: Determine client vocabulary from participants
            let vocabularyOptions = {};
            try {
              let clientSlug = null;
              if (participantEmails.length > 0 && routingEngine) {
                const routingDecision = routingEngine.route({
                  participantEmails,
                  meetingTitle: 'Vocabulary Lookup', // Title not used for vocabulary
                  meetingDate: new Date(),
                });
                // Get client slug from first route if it's a client type
                const clientRoute = routingDecision.routes.find(r => r.type === 'client');
                if (clientRoute) {
                  clientSlug = clientRoute.slug;
                  console.log(
                    `[Transcription] VC-3: Matched client "${clientSlug}" from participants`
                  );
                }
              }
              // Get vocabulary formatted for the provider (includes global + client-specific)
              vocabularyOptions = vocabularyService.getVocabularyForProvider(
                transcriptionProvider,
                clientSlug
              );
              const vocabCount =
                vocabularyOptions.custom_spelling?.length ||
                vocabularyOptions.keywords?.length ||
                0;
              console.log(
                `[Transcription] VC-3: Using ${vocabCount} vocabulary entries for ${transcriptionProvider}`
              );
            } catch (vocabError) {
              console.warn(
                '[Transcription] VC-3: Failed to load vocabulary, continuing without:',
                vocabError.message
              );
            }

            console.log(`[Transcription] Calling transcriptionService.transcribe()...`);
            const transcript = await transcriptionService.transcribe(
              transcriptionProvider,
              recordingPath,
              vocabularyOptions
            );

            console.log(`[Transcription] ✓ ${transcriptionProvider} transcription complete`);
            console.log(`[Transcription] Transcript object:`, JSON.stringify(transcript, null, 2));
            console.log(
              `[Transcription] Entries: ${transcript.entries ? transcript.entries.length : 'undefined'}`
            );

            // Update the meeting with the transcript
            console.log('[Transcription] Reading meetings data to save transcript...');
            const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
            const meetingsData = JSON.parse(fileData);
            const meetingIndex = meetingsData.pastMeetings.findIndex(
              m => m.recordingId === windowId
            );

            console.log(`[Transcription] Meeting index: ${meetingIndex}`);
            if (meetingIndex !== -1) {
              console.log(
                `[Transcription] Updating meeting: ${meetingsData.pastMeetings[meetingIndex].id}`
              );
              const meeting = meetingsData.pastMeetings[meetingIndex];

              // Check if we need to append to previous transcript
              if (meeting.recordingAction === 'append' && meeting.previousTranscript) {
                console.log(
                  `[Transcription] Appending ${transcript.entries.length} new entries to ${meeting.previousTranscript.length} existing entries`
                );
                meetingsData.pastMeetings[meetingIndex].transcript = [
                  ...meeting.previousTranscript,
                  ...transcript.entries,
                ];
                // Clean up temporary fields
                delete meetingsData.pastMeetings[meetingIndex].previousTranscript;
                delete meetingsData.pastMeetings[meetingIndex].recordingAction;
              } else {
                // Overwrite or new transcript
                meetingsData.pastMeetings[meetingIndex].transcript = transcript.entries;
                // Clean up temporary fields
                delete meetingsData.pastMeetings[meetingIndex].recordingAction;
              }

              meetingsData.pastMeetings[meetingIndex].transcriptProvider = transcript.provider;
              meetingsData.pastMeetings[meetingIndex].transcriptConfidence = transcript.confidence;
              // Save duration if available from transcription provider
              if (transcript.audio_duration) {
                meetingsData.pastMeetings[meetingIndex].duration = transcript.audio_duration;
                console.log(`[Transcription] Duration: ${transcript.audio_duration} seconds`);
              }

              console.log('[Transcription] Writing updated meeting data...');
              await fileOperationManager.writeData(meetingsData);
              console.log(
                `[Transcription] ✓ Transcript saved with ${meetingsData.pastMeetings[meetingIndex].transcript.length} total entries`
              );

              // SM-1: Apply speaker matching immediately after transcription
              const meetingForMatching = meetingsData.pastMeetings[meetingIndex];
              if (
                speakerMatcher &&
                meetingForMatching.transcript &&
                meetingForMatching.transcript.length > 0
              ) {
                try {
                  console.log('[Transcription] SM-1: Starting speaker matching...');

                  // Get participants from meeting data (prefer email, fall back to name)
                  const participants = meetingForMatching.participants || [];
                  const participantEmails = participants.map(p => p.email).filter(email => email);
                  const participantNames = participants.map(p => p.name).filter(name => name);

                  console.log(
                    `[Transcription] SM-1: Found ${participantEmails.length} participant emails, ${participantNames.length} participant names`
                  );
                  console.log(
                    '[Transcription] SM-1: Participants:',
                    JSON.stringify(participants, null, 2)
                  );

                  // Get speech timeline if available
                  const speechTimeline = windowId ? getSpeechTimeline(windowId) : null;
                  if (speechTimeline) {
                    console.log(
                      `[Transcription] SM-1: Found speech timeline with ${speechTimeline.participants.length} SDK participants`
                    );
                  } else {
                    console.log(
                      '[Transcription] SM-1: No speech timeline available, using heuristics only'
                    );
                  }

                  // Use emails if available, otherwise use names for matching
                  const matchIdentifiers =
                    participantEmails.length > 0 ? participantEmails : participantNames;

                  if (matchIdentifiers.length > 0) {
                    // Match speakers to participants
                    const speakerMapping = await speakerMatcher.matchSpeakers(
                      meetingForMatching.transcript,
                      matchIdentifiers,
                      {
                        includeOrganizer: true,
                        useWordCount: true,
                        speechTimeline,
                        participantData: participants, // Pass full participant data for name-based matching
                      }
                    );

                    // Apply mapping to transcript
                    if (Object.keys(speakerMapping).length > 0) {
                      meetingsData.pastMeetings[meetingIndex].transcript =
                        speakerMatcher.applyMappingToTranscript(
                          meetingForMatching.transcript,
                          speakerMapping
                        );

                      // Save the speaker mapping for future reference
                      meetingsData.pastMeetings[meetingIndex].speakerMapping = speakerMapping;

                      // Write updated data with speaker names
                      await fileOperationManager.writeData(meetingsData);
                      console.log(
                        '[Transcription] SM-1: ✓ Speaker matching complete, transcript updated with names'
                      );
                    } else {
                      console.log('[Transcription] SM-1: No speaker matches found');
                    }
                  } else {
                    console.log(
                      '[Transcription] SM-1: No participant identifiers available for matching'
                    );
                  }

                  // Clean up speech timeline
                  if (windowId) {
                    cleanupSpeechTimeline(windowId);
                  }
                } catch (matchError) {
                  console.error(
                    '[Transcription] SM-1: Speaker matching failed:',
                    matchError.message
                  );
                }
              }

              // v1.1: Auto-apply user profile mapping for single-speaker transcripts
              const transcriptForAutoLabel = meetingsData.pastMeetings[meetingIndex].transcript;
              if (transcriptForAutoLabel && userProfile?.name) {
                const autoResult = speakerMappingService.autoApplyUserProfileMapping(
                  transcriptForAutoLabel,
                  userProfile
                );
                if (autoResult.applied) {
                  meetingsData.pastMeetings[meetingIndex].transcript = autoResult.transcript;
                  // Replace participants with user (single-speaker = user)
                  // This replaces generic "Speaker A" with actual user info
                  meetingsData.pastMeetings[meetingIndex].participants = [
                    {
                      name: userProfile.name,
                      email: userProfile.email || null,
                      isHost: true,
                    },
                  ];
                  await fileOperationManager.writeData(meetingsData);
                  logger.main.info(
                    '[Transcription] Auto-labeled single speaker as user:',
                    userProfile.name
                  );
                }
              }

              // Notify renderer of completion
              if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('[Transcription] Notifying renderer of completion...');
                mainWindow.webContents.send('recording-state-change', {
                  windowId: windowId,
                  state: 'completed',
                  progress: 100,
                });
                mainWindow.webContents.send(
                  'transcript-updated',
                  meetingsData.pastMeetings[meetingIndex].id
                );
                console.log('[Transcription] ✓ Renderer notified');
              }

              // Generate auto-summary for AssemblyAI/Deepgram transcriptions
              const updatedMeeting = meetingsData.pastMeetings[meetingIndex];
              if (updatedMeeting) {
                await generateAndSaveAutoSummary(updatedMeeting.id, '[Auto-Summary]');
              }

              // Note: Recording cleanup and UI notification already happened immediately after recording ended
              // (see recording-ended event handler above)
            } else {
              console.error('[Transcription] ✗ Meeting not found with recordingId:', windowId);
            }
          }
        } catch (error) {
          console.error('[Transcription] ERROR during transcription:', error);
          console.error('[Transcription] Error stack:', error.stack);

          // Notify renderer of error
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recording-state-change', {
              windowId: windowId,
              state: 'failed',
              error: error.message,
            });
          }
        }
      }, 3000); // 3 second delay to ensure file is fully written
    } catch (error) {
      console.error('Error handling recording ended:', error);
    }
  });

  // Track last logged progress to avoid spam
  const lastLoggedProgress = new Map();

  // Track upload progress
  RecallAiSdk.addEventListener('upload-progress', async evt => {
    const { progress, window } = evt;
    const windowId = window?.id;

    // Only log when progress changes (not on every event)
    const lastProgress = lastLoggedProgress.get(windowId);
    if (lastProgress !== progress) {
      // Round to nearest integer for cleaner display
      const roundedProgress = Math.round(progress);
      console.log(`Upload progress: ${roundedProgress.toFixed(1)}% for window ${windowId}`);

      lastLoggedProgress.set(windowId, progress);

      // Log upload progress
      sdkLogger.logEvent('upload-progress', {
        windowId: windowId,
        progress: roundedProgress,
      });
    }

    // Notify renderer of upload progress (send all updates to UI)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-state-change', {
        windowId: windowId,
        state: 'uploading',
        progress: Math.round(progress),
      });
    }
  });

  // Note: upload-complete is a webhook event, not an SDK event
  // Desktop apps can't receive webhooks, so we poll the API instead
  // See pollForUploadCompletion() function below

  RecallAiSdk.addEventListener('permissions-granted', async _evt => {
    logger.main.info('[SDK] Permissions granted');
  });

  // Track SDK state changes
  RecallAiSdk.addEventListener('sdk-state-change', async evt => {
    const {
      sdk: {
        state: { code },
      },
      window,
    } = evt;
    console.log('Recording state changed:', code, 'for window:', window?.id);

    // Log the SDK sdk-state-change event
    sdkLogger.logEvent('sdk-state-change', {
      state: code,
      windowId: window?.id,
    });

    // Update recording state in our global tracker
    if (window && window.id) {
      // Get the meeting note ID associated with this window
      let noteId = null;
      if (global.activeMeetingIds && global.activeMeetingIds[window.id]) {
        noteId = global.activeMeetingIds[window.id].noteId;
      }

      // Update the recording state in our tracker
      if (code === 'recording') {
        console.log('Recording in progress...');
        if (noteId) {
          // If recording started, add it to our active recordings
          activeRecordings.addRecording(window.id, noteId, window.platform || 'unknown');
        }
      } else if (code === 'paused') {
        console.log('Recording paused');
        activeRecordings.updateState(window.id, 'paused');
      } else if (code === 'idle') {
        console.log('Recording stopped');
        activeRecordings.removeRecording(window.id);
      }

      // Notify renderer process about recording state change
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording-state-change', {
          recordingId: window.id,
          state: code,
          noteId,
        });
      }
    }
  });

  // Listen for real-time events (participant joins and video frames)
  // Note: No longer processing real-time transcripts - we use async transcription after recording
  RecallAiSdk.addEventListener('realtime-event', async evt => {
    // Only log non-video frame events to prevent flooding the logger
    if (evt.event !== 'video_separate_png.data') {
      console.log('Received realtime event:', evt.event);

      // Log the SDK realtime-event event
      sdkLogger.logEvent('realtime-event', {
        eventType: evt.event,
        windowId: evt.window?.id,
      });
    }

    // Handle participant join events (needed for speaker matching later)
    if (evt.event === 'participant_events.join' && evt.data && evt.data.data) {
      await processParticipantJoin(evt);
    } else if (evt.event === 'participant_events.speech_on' && evt.data && evt.data.data) {
      // SM-1: Track when participants start speaking
      processSpeechOn(evt);
    } else if (evt.event === 'participant_events.speech_off' && evt.data && evt.data.data) {
      // SM-1: Track when participants stop speaking
      processSpeechOff(evt);
    } else if (evt.event === 'video_separate_png.data' && evt.data && evt.data.data) {
      await processVideoFrame(evt);
    }
    // Real-time transcript events removed - using async transcription instead
  });

  // Handle errors
  RecallAiSdk.addEventListener('error', async evt => {
    console.error('RecallAI SDK Error:', evt);
    const { type, message } = evt;

    // Log the SDK error event
    sdkLogger.logEvent('error', {
      errorType: type,
      errorMessage: message,
    });

    // Show notification for errors
    const notification = new Notification({
      title: 'Recording Error',
      body: `Error: ${type} - ${message}`,
    });
    notification.show();
  });
}

// ============================================================================
// Obsidian Export Functions (Phase 5)
// ============================================================================

/**
 * Populate participants array from speaker mapping and Google Contacts
 * @param {Object} meeting - Meeting object
 * @param {Array<string>} participantEmails - Array of participant emails
 * @param {Object} speakerMapping - Speaker mapping from SpeakerMatcher
 */
async function populateParticipantsFromSpeakerMapping(meeting, participantEmails, speakerMapping) {
  try {
    if (!googleContacts || !speakerMapping) {
      console.log('[ParticipantPopulation] Skipping - Google Contacts not available');
      return;
    }

    // Get contact info for all participant emails
    const contactsMap = await googleContacts.findContactsByEmails(participantEmails);

    // Initialize participants array if it doesn't exist
    if (!meeting.participants) {
      meeting.participants = [];
    }

    // Initialize participantEmails if it doesn't exist
    if (!meeting.participantEmails) {
      meeting.participantEmails = [...participantEmails];
    }

    // Create participants from speaker mapping
    for (const [_speakerLabel, speakerInfo] of Object.entries(speakerMapping)) {
      if (speakerInfo.email) {
        // Speaker has email - look up contact by email
        const contact = contactsMap.get(speakerInfo.email);

        // Check if participant already exists
        const existingIndex = meeting.participants.findIndex(
          p => p.email && p.email.toLowerCase() === speakerInfo.email.toLowerCase()
        );

        const participantData = {
          name: speakerInfo.name || (contact ? contact.name : speakerInfo.email),
          email: speakerInfo.email,
        };

        if (existingIndex !== -1) {
          // Update existing participant with email
          meeting.participants[existingIndex] = {
            ...meeting.participants[existingIndex],
            ...participantData,
          };
        } else {
          // Add new participant
          meeting.participants.push(participantData);
        }
      } else if (speakerInfo.name && typeof googleContacts.findContactByName === 'function') {
        // v1.1: Speaker has name but no email - try name-based contact lookup
        try {
          const contact = await googleContacts.findContactByName(speakerInfo.name);
          if (contact && contact.emails && contact.emails.length > 0) {
            const email = contact.emails[0];

            // Check if participant already exists by email
            const existingIndex = meeting.participants.findIndex(
              p => p.email && p.email.toLowerCase() === email.toLowerCase()
            );

            const participantData = {
              name: contact.name || speakerInfo.name,
              email: email,
              organization: contact.organization || null,
              matchedByName: true,
            };

            if (existingIndex !== -1) {
              // Update existing participant
              meeting.participants[existingIndex] = {
                ...meeting.participants[existingIndex],
                ...participantData,
              };
            } else {
              // Add new participant
              meeting.participants.push(participantData);
            }

            // Add email to participantEmails for routing if not present
            if (!meeting.participantEmails.includes(email)) {
              meeting.participantEmails.push(email);
            }

            console.log(
              `[ParticipantPopulation] Matched "${speakerInfo.name}" to contact "${contact.name}" (${email})`
            );
          }
        } catch (nameError) {
          console.warn(
            `[ParticipantPopulation] Failed to lookup contact by name "${speakerInfo.name}":`,
            nameError.message
          );
        }
      }
    }

    console.log(
      `[ParticipantPopulation] Populated ${meeting.participants.length} participants with contact info`
    );
  } catch (error) {
    console.error('[ParticipantPopulation] Error populating participants:', error);
  }
}

/**
 * Deduplicate participants by email (primary) or name (fallback)
 * @param {Array<Object>} participants - Array of participant objects
 * @returns {Array<Object>} Deduplicated array
 */
function deduplicateParticipants(participants) {
  const seen = new Map();
  const result = [];

  for (const participant of participants) {
    // Use email as primary key (case-insensitive)
    const key = participant.email
      ? participant.email.toLowerCase()
      : participant.name?.toLowerCase() || `unknown-${result.length}`;

    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(participant);
    }
  }

  const duplicatesRemoved = participants.length - result.length;
  if (duplicatesRemoved > 0) {
    console.log(`[Deduplication] Removed ${duplicatesRemoved} duplicate participant(s)`);
  }

  return result;
}

/**
 * Export a meeting to Obsidian vault with two-file structure
 * @param {Object} meeting - Meeting object with transcript and summaries
 * @param {Object|null} routingOverride - CS-4.4: Optional manual routing override
 * @returns {Promise<Object>} Export result with paths created
 */
async function exportMeetingToObsidian(meeting, routingOverride = null) {
  if (!vaultStructure || !routingEngine) {
    console.log('[ObsidianExport] Export system not initialized - skipping export');
    return { success: false, error: 'Export system not initialized' };
  }

  try {
    console.log(`[ObsidianExport] Starting export for meeting: ${meeting.title}`);

    // Check if manual override path exists
    if (meeting.obsidianLink) {
      console.log(`[ObsidianExport] Using manual override path: ${meeting.obsidianLink}`);
    }

    // Extract participant emails for routing
    const participantEmails = meeting.participantEmails || [];
    if (participantEmails.length === 0 && !meeting.obsidianLink) {
      console.warn('[ObsidianExport] No participant emails found - routing to unfiled');
    }

    // Perform speaker matching if available (Phase 6)
    if (
      speakerMatcher &&
      meeting.transcript &&
      meeting.transcript.length > 0 &&
      participantEmails.length > 0
    ) {
      try {
        console.log('[ObsidianExport] Attempting speaker matching...');

        // SM-1: Get speech timeline for high-confidence matching
        const speechTimeline = meeting.recordingId ? getSpeechTimeline(meeting.recordingId) : null;
        if (speechTimeline) {
          console.log(
            `[ObsidianExport] SM-1: Found speech timeline with ${speechTimeline.participants.length} SDK participants`
          );
        }

        // Match speakers to participants
        const speakerMapping = await speakerMatcher.matchSpeakers(
          meeting.transcript,
          participantEmails,
          { includeOrganizer: true, useWordCount: true, speechTimeline }
        );

        // Apply mapping to transcript
        meeting.transcript = speakerMatcher.applyMappingToTranscript(
          meeting.transcript,
          speakerMapping
        );

        // Store mapping in meeting object for future reference
        meeting.speakerMapping = speakerMapping;

        // Populate participants array from speaker mapping and contacts
        await populateParticipantsFromSpeakerMapping(meeting, participantEmails, speakerMapping);

        console.log('[ObsidianExport] Speaker matching completed successfully');

        // SM-1: Clean up speech timeline after speaker matching is done
        if (meeting.recordingId) {
          cleanupSpeechTimeline(meeting.recordingId);
        }
      } catch (error) {
        console.warn(
          '[ObsidianExport] Speaker matching failed, continuing without:',
          error.message
        );
        // SM-1: Still clean up the speech timeline on error
        if (meeting.recordingId) {
          cleanupSpeechTimeline(meeting.recordingId);
        }
      }
    } else if (meeting.transcript && meeting.transcript.length > 0) {
      console.log(
        '[ObsidianExport] Speaker matching skipped - speaker matcher not available or no participants'
      );
      // SM-1: Clean up speech timeline even if speaker matching was skipped
      if (meeting.recordingId) {
        cleanupSpeechTimeline(meeting.recordingId);
      }
    }

    // Deduplicate participants if they exist
    if (meeting.participants && meeting.participants.length > 0) {
      meeting.participants = deduplicateParticipants(meeting.participants);
    }

    // Get routing decisions (or use manual override)
    let routes;
    if (routingOverride) {
      // CS-4.4: Use manual routing override from template modal
      // Build proper fullPath with /meetings/ subfolder like the routing engine does
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0];
      const titleSlug = meeting.title
        ? meeting.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : 'meeting';
      const folderName = `${dateStr}-${titleSlug}`;
      const fullPath = path.join(routingOverride.path, 'meetings', folderName);

      routes = [
        {
          fullPath,
          organizationName: routingOverride.organization || 'Manual Override',
          type: routingOverride.type,
          slug: routingOverride.slug,
        },
      ];
      console.log(
        `[ObsidianExport] CS-4.4: Using routing override: ${fullPath} (${routingOverride.type})`
      );
    } else if (meeting.obsidianLink) {
      // Manual override - use existing path
      // Extract folder path from obsidianLink (remove filename)
      const linkPath = meeting.obsidianLink.replace(/[^/]+\.md$/, '');
      routes = [
        {
          fullPath: linkPath,
          organizationName: 'Manual Override',
          type: 'override',
        },
      ];
      console.log(`[ObsidianExport] Using manual override path: ${meeting.obsidianLink}`);
    } else {
      // Use routing engine
      const routingDecision = routingEngine.route({
        participantEmails,
        meetingTitle: meeting.title || 'Untitled Meeting',
        meetingDate: meeting.date ? new Date(meeting.date) : new Date(),
      });
      routes = routingDecision.routes;
      console.log(`[ObsidianExport] Found ${routes.length} routing destination(s)`);
    }

    const createdPaths = [];

    // Process each route (may have multiple for multi-org meetings)
    for (const route of routes) {
      console.log(`[ObsidianExport] Exporting to: ${route.fullPath}`);

      // Generate file slug from title and date
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const titleSlug = meeting.title
        ? meeting.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : 'meeting';
      let baseFilename = `${dateStr}-${titleSlug}`;

      // Create meeting folder path
      const meetingFolder = vaultStructure.getAbsolutePath(route.fullPath);
      vaultStructure.ensureDirectory(meetingFolder);

      // Check for existing files and find unique filename
      let summaryPath = path.join(meetingFolder, `${baseFilename}.md`);
      let transcriptPath = path.join(meetingFolder, `${baseFilename}-transcript.md`);

      if (fs.existsSync(summaryPath) || fs.existsSync(transcriptPath)) {
        console.log(`[ObsidianExport] File already exists: ${baseFilename}.md`);

        // Find next available number
        let counter = 2;
        let uniqueFilename;
        do {
          uniqueFilename = `${baseFilename}-${counter}`;
          summaryPath = path.join(meetingFolder, `${uniqueFilename}.md`);
          transcriptPath = path.join(meetingFolder, `${uniqueFilename}-transcript.md`);
          counter++;
        } while (fs.existsSync(summaryPath) || fs.existsSync(transcriptPath));

        console.log(`[ObsidianExport] Using unique filename: ${uniqueFilename}.md`);
        baseFilename = uniqueFilename;
      }

      // Generate summary markdown (primary file)
      const summaryContent = generateSummaryMarkdown(meeting, baseFilename);
      fs.writeFileSync(summaryPath, summaryContent, 'utf8');
      console.log(`[ObsidianExport] Created summary: ${summaryPath}`);

      // Generate transcript markdown (secondary file)
      const transcriptContent = generateTranscriptMarkdown(meeting, baseFilename);
      fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
      console.log(`[ObsidianExport] Created transcript: ${transcriptPath}`);

      createdPaths.push({
        organization: route.organizationName || route.type,
        summaryPath,
        transcriptPath,
      });
    }

    console.log(
      `[ObsidianExport] Successfully exported meeting to ${createdPaths.length} location(s)`
    );

    // CS-3.5/CS-3.6: Auto-create contact and company pages for participants
    await autoCreateContactAndCompanyPages(meeting, routes);

    // Generate obsidianLink from first created path (relative to vault)
    const obsidianLink =
      createdPaths.length > 0
        ? createdPaths[0].summaryPath
            .replace(vaultStructure.getAbsolutePath(''), '')
            .replace(/\\/g, '/')
            .replace(/^\//, '')
        : null;

    return {
      success: true,
      paths: createdPaths,
      routeCount: routes.length,
      obsidianLink, // Return the vault-relative path to save in meeting object
    };
  } catch (error) {
    console.error('[ObsidianExport] Export failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate summary markdown file with rich frontmatter
 */
function generateSummaryMarkdown(meeting, baseFilename) {
  const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
  const dateStr = meetingDate.toISOString().split('T')[0];
  const title = meeting.title || 'Untitled Meeting';

  // Build participants as simple list of wiki-links for clean Obsidian display
  // Obsidian Properties view displays simple string lists as nice pills/tags
  const participantNames = [];
  const participantEmails = [];

  // Use meeting.participants (from participant join events) if available
  if (meeting.participants && meeting.participants.length > 0) {
    for (const participant of meeting.participants) {
      if (participant.name) {
        // Use wiki-link format so participants link to contact pages
        participantNames.push(`"[[${participant.name}]]"`);
      }
      if (participant.email) {
        participantEmails.push(`"${participant.email}"`);
      }
    }
  }
  // Fallback to participantEmails if participants array doesn't exist
  else if (meeting.participantEmails && meeting.participantEmails.length > 0) {
    for (const email of meeting.participantEmails) {
      participantEmails.push(`"${email}"`);
      // Try to get name from speaker mapping
      if (meeting.speakerMapping) {
        const mapping = Object.values(meeting.speakerMapping).find(m => m.email === email);
        if (mapping && mapping.name) {
          participantNames.push(`"[[${mapping.name}]]"`);
        }
      }
    }
  }

  // Extract tags from meeting metadata
  const tags = ['meeting'];
  if (meeting.platform) tags.push(meeting.platform.toLowerCase());

  // Build frontmatter with simple lists that Obsidian displays nicely
  // RS-2: Include meeting_id for stale link detection
  let markdown = `---
title: "${title}"
date: ${dateStr}
meeting_id: "${meeting.id || ''}"
platform: "${meeting.platform || 'unknown'}"
transcript_file: "${baseFilename}-transcript.md"
participants: [${participantNames.join(', ')}]
participant_emails: [${participantEmails.join(', ')}]
tags: [${tags.join(', ')}]
meeting_type: "external"
---

# ${title}

**Date:** ${meetingDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Platform:** ${meeting.platform || 'Unknown'}

---

## Meeting Summary

`;

  // Add summaries if they exist
  if (meeting.summaries && meeting.summaries.length > 0) {
    for (const summary of meeting.summaries) {
      markdown += `### ${summary.templateName || 'Summary'}\n\n`;
      markdown += summary.content || '*No content*';
      markdown += '\n\n---\n\n';
    }
  } else if (meeting.summary) {
    // Legacy: single summary field
    markdown += meeting.summary;
    markdown += '\n\n---\n\n';
  } else {
    markdown += '*No summary generated yet*\n\n---\n\n';
  }

  // Add link to transcript
  markdown += `\n**Full Transcript:** [[${baseFilename}-transcript]]\n\n`;
  markdown += `*Generated by jd-notes-things*\n`;

  return markdown;
}

/**
 * Generate transcript markdown file
 */
function generateTranscriptMarkdown(meeting, baseFilename) {
  const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
  const dateStr = meetingDate.toISOString().split('T')[0];
  const title = meeting.title || 'Untitled Meeting';

  // RS-2: Include meeting_id for stale link detection
  let markdown = `---
title: "${title} - Full Transcript"
date: ${dateStr}
meeting_id: "${meeting.id || ''}"
summary_file: "${baseFilename}.md"
---

# Full Transcript: ${title}

**Back to summary:** [[${baseFilename}]]

**Date:** ${meetingDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Platform:** ${meeting.platform || 'Unknown'}

---

`;

  // Add speaker directory if we have participants with emails
  // CS-3.7: Use wiki-links for participant names to enable Obsidian backlinks
  if (meeting.participants && meeting.participants.length > 0) {
    const participantsWithEmail = meeting.participants.filter(p => p.email);
    if (participantsWithEmail.length > 0) {
      markdown += `## Participants\n\n`;
      participantsWithEmail.forEach(participant => {
        // Use wiki-link for participant name
        const nameLink = participant.name ? `[[${participant.name}]]` : 'Unknown';
        markdown += `- **${nameLink}**: ${participant.email}\n`;
      });
      markdown += `\n---\n\n`;
    }
  }

  markdown += `## Transcript\n\n`;

  // Add transcript
  if (meeting.transcript) {
    if (Array.isArray(meeting.transcript)) {
      // Transcript is array of segments with timestamps
      for (const segment of meeting.transcript) {
        if (typeof segment === 'object') {
          // Use speaker name from Phase 6 matching if available, otherwise fall back to raw label
          let speaker = segment.speakerName || segment.speaker || 'Speaker';
          const timestamp = segment.timestamp || '';
          const text = segment.text || '';

          // CS-3.7: Use wiki-link for speaker name if it's a real name (not a speaker label)
          // This enables Obsidian backlinks - meetings will show up on contact pages
          const isRealName =
            segment.speakerName &&
            !segment.speakerName.match(/^(Speaker\s*[A-Z0-9]|SPK[-_]|spk_|SPEAKER_)/i);
          if (isRealName) {
            speaker = `[[${segment.speakerName}]]`;
          }

          // Add confidence indicator for low-confidence matches (optional)
          const confidenceNote =
            segment.speakerConfidence === 'low' || segment.speakerConfidence === 'none'
              ? ' *(uncertain)*'
              : '';

          markdown += `### ${timestamp} - ${speaker}${confidenceNote}\n${text}\n\n`;
        } else {
          markdown += `${segment}\n\n`;
        }
      }
    } else if (typeof meeting.transcript === 'string') {
      // Transcript is plain string
      markdown += meeting.transcript;
    }
  } else {
    markdown += '*No transcript available*\n';
  }

  markdown += `\n---\n\n`;
  markdown += `*Generated by jd-notes-things*\n`;

  return markdown;
}

/**
 * CS-3.5/CS-3.6: Auto-create contact and company pages in Obsidian vault
 * Called after exporting a meeting to automatically create People and Companies pages
 * @param {Object} meeting - Meeting object with participants
 * @param {Array} routes - Routing decisions (contains organization info)
 */
async function autoCreateContactAndCompanyPages(meeting, routes) {
  if (!vaultStructure) {
    console.log('[AutoCreate] Vault structure not initialized, skipping page creation');
    return;
  }

  const createdPages = { contacts: [], companies: [] };

  try {
    // CS-3.5: Auto-create contact pages for participants
    // ONLY create pages for validated Google Contacts (must have email)
    if (meeting.participants && meeting.participants.length > 0) {
      console.log(
        `[AutoCreate] Checking ${meeting.participants.length} participants for contact pages`
      );

      for (const participant of meeting.participants) {
        if (!participant.name) continue;

        // Only auto-create for validated contacts with email
        // Skip unknown speakers, single names without email, and header content
        if (!participant.email) {
          console.log(`[AutoCreate] Skipping (no email): ${participant.name}`);
          continue;
        }

        // Skip "Unknown Speaker" variants
        if (participant.name.toLowerCase().includes('unknown')) {
          console.log(`[AutoCreate] Skipping (unknown speaker): ${participant.name}`);
          continue;
        }

        // Skip header content like "Summary", "Notes", etc.
        const headerPatterns = [
          'summary',
          'notes',
          'agenda',
          'introduction',
          'conclusion',
          'action items',
        ];
        if (headerPatterns.some(h => participant.name.toLowerCase().includes(h))) {
          console.log(`[AutoCreate] Skipping (header content): ${participant.name}`);
          continue;
        }

        // Skip if contact page already exists
        if (vaultStructure.contactPageExists(participant.name)) {
          console.log(`[AutoCreate] Contact page exists: ${participant.name}`);
          continue;
        }

        // Create contact page
        const contactData = {
          name: participant.name,
          emails: [participant.email],
          phones: [],
          organization: participant.organization || '',
          title: participant.title || '',
          resourceName: participant.googleContactId || '',
        };

        const result = vaultStructure.createContactPage(contactData, {
          linkedCompany: participant.organization || null,
        });

        if (result.created) {
          createdPages.contacts.push(participant.name);
          console.log(`[AutoCreate] Created contact page: ${participant.name}`);
        }
      }
    }

    // Also check speaker mapping for additional contacts - same validation rules
    if (meeting.speakerMapping) {
      for (const [_speakerId, mapping] of Object.entries(meeting.speakerMapping)) {
        if (!mapping.name) continue;

        // Only auto-create for validated contacts with email
        if (!mapping.email) {
          console.log(`[AutoCreate] Skipping speaker mapping (no email): ${mapping.name}`);
          continue;
        }

        // Skip "Unknown Speaker" variants
        if (mapping.name.toLowerCase().includes('unknown')) {
          continue;
        }

        // Skip if already processed or page exists
        if (vaultStructure.contactPageExists(mapping.name)) {
          continue;
        }

        const contactData = {
          name: mapping.name,
          emails: [mapping.email],
          phones: [],
          organization: mapping.organization || '',
        };

        const result = vaultStructure.createContactPage(contactData);

        if (result.created) {
          createdPages.contacts.push(mapping.name);
          console.log(`[AutoCreate] Created contact page from speaker mapping: ${mapping.name}`);
        }
      }
    }

    // CS-3.6: Auto-create company pages for organizations in routes
    for (const route of routes) {
      if (route.type !== 'client' && route.type !== 'industry') continue;

      // Get organization name from routing config
      const config = routingEngine ? routingEngine.getConfig() : null;
      if (!config) continue;

      let orgConfig, orgName;
      if (route.type === 'client' && config.clients && config.clients[route.slug]) {
        orgConfig = config.clients[route.slug];
        orgName = orgConfig.name || route.slug;
      } else if (route.type === 'industry' && config.industry && config.industry[route.slug]) {
        orgConfig = config.industry[route.slug];
        orgName = orgConfig.name || route.slug;
      }

      if (!orgName) continue;

      // Skip if company page already exists
      if (vaultStructure.companyPageExists(orgName)) {
        console.log(`[AutoCreate] Company page exists: ${orgName}`);
        continue;
      }

      // Create company page
      // Find contacts associated with this organization by checking email domains
      const orgDomains = orgConfig?.domains || [];
      const associatedContacts = [];

      if (meeting.participants && meeting.participants.length > 0) {
        for (const participant of meeting.participants) {
          if (!participant.name) continue;

          // Check if participant's email matches any org domain
          const email = participant.email || '';
          const emailDomain = email.split('@')[1]?.toLowerCase() || '';

          const matchesDomain = orgDomains.some(d => emailDomain === d.toLowerCase());
          const matchesOrg = participant.organization?.toLowerCase() === orgName.toLowerCase();

          if (matchesDomain || matchesOrg) {
            associatedContacts.push(participant.name);
          }
        }
      }

      // Also check speaker mappings for contacts
      if (meeting.speakerMapping) {
        for (const [_speakerId, mapping] of Object.entries(meeting.speakerMapping)) {
          if (!mapping.name || associatedContacts.includes(mapping.name)) continue;

          const email = mapping.email || '';
          const emailDomain = email.split('@')[1]?.toLowerCase() || '';

          const matchesDomain = orgDomains.some(d => emailDomain === d.toLowerCase());
          if (matchesDomain) {
            associatedContacts.push(mapping.name);
          }
        }
      }

      const companyData = {
        name: orgName,
        domain: orgConfig?.domains?.[0] || '',
        industry: route.type === 'industry' ? orgName : '',
        routingFolder: route.fullPath,
        contacts: associatedContacts,
      };

      console.log(
        `[AutoCreate] Creating company page ${orgName} with contacts:`,
        associatedContacts
      );
      const result = vaultStructure.createCompanyPage(companyData);

      if (result.created) {
        createdPages.companies.push(orgName);
        console.log(`[AutoCreate] Created company page: ${orgName}`);
      }
    }

    // Log summary
    if (createdPages.contacts.length > 0 || createdPages.companies.length > 0) {
      console.log(
        `[AutoCreate] Created ${createdPages.contacts.length} contact page(s) and ${createdPages.companies.length} company page(s)`
      );
    }
  } catch (error) {
    console.error('[AutoCreate] Error creating pages:', error.message);
    // Don't throw - this is a non-critical operation
  }

  return createdPages;
}

/**
 * Execute a single section task with LLM call
 * Defined at module level to avoid closure memory issues
 */
async function executeTemplateSectionTask(llmService, task, transcriptText) {
  try {
    // Use prompt caching: separate transcript (static) from instructions (dynamic)
    // This saves ~90% on input costs for 2nd+ calls (Azure/OpenAI/Anthropic all support this)
    // Example savings: 20 sections × 37k tokens = 740k tokens
    //   Without caching: 740k × $0.25/1M = $0.185
    //   With caching: 37k × $0.25/1M + (19 × 37k × $0.025/1M) = $0.027 (~85% savings)
    const result = await llmService.generateCompletion({
      systemPrompt:
        'You are a helpful assistant that analyzes meeting transcripts and creates structured summaries.',
      userPrompt: task.sectionPrompt,
      cacheableContext: transcriptText, // This will be cached across all section calls
      temperature: 0.7,
      maxTokens: 15000, // Safe limit for all models (OpenAI max: 16384, Azure/Anthropic higher)
    });

    console.log(
      `[TemplateSummary] LLM result type: ${typeof result}, content type: ${typeof result?.content}`
    );
    console.log(`[TemplateSummary] LLM result keys:`, result ? Object.keys(result) : 'null');
    console.log(`[TemplateSummary] Content length:`, result?.content?.length || 0);

    // Check if content exists
    if (!result || !result.content) {
      console.warn(
        `[TemplateSummary] No content in LLM response for ${task.sectionTitle}:`,
        JSON.stringify(result)
      );
      return {
        success: false,
        content: '*LLM returned empty response*',
      };
    }

    return {
      success: true,
      content: result.content,
    };
  } catch (error) {
    console.error(`[TemplateSummary] Error generating section ${task.sectionTitle}:`, error);
    throw error; // Re-throw for retry logic
  }
}

/**
 * Generate template-based summaries for a meeting (shared function)
 * @param {Object} meeting - Meeting object with transcript
 * @param {Array<string>} templateIds - Template IDs to use (or null for all)
 * @returns {Promise<Array>} Generated summaries
 */
async function generateTemplateSummaries(meeting, templateIds = null) {
  if (!templateManager || !llmService) {
    throw new Error('Template manager or LLM service not available');
  }

  return await withProviderSwitch(
    'template',
    async () => {
      // Use all templates if none specified
      if (!templateIds) {
        const allTemplates = templateManager.getAllTemplates();
        templateIds = allTemplates.map(t => t.id);
      }

      // Convert transcript to text format
      let transcriptText = '';
      if (Array.isArray(meeting.transcript)) {
        transcriptText = meeting.transcript
          .map(segment => {
            if (typeof segment === 'object') {
              // Use mapped speaker name if available (v1.1), fall back to original speaker
              const speakerName =
                segment.speakerName || segment.speakerDisplayName || segment.speaker || 'Speaker';
              return `${speakerName}: ${segment.text}`;
            }
            return String(segment);
          })
          .join('\n');
      } else if (typeof meeting.transcript === 'string') {
        transcriptText = meeting.transcript;
      } else {
        transcriptText = String(meeting.transcript);
      }

      console.log(`[TemplateSummary] Transcript length: ${transcriptText.length} characters`);

      // v1.1: Add user profile context to transcript for personalized summaries
      if (userProfile?.name) {
        const contextParts = [];
        contextParts.push(`The person reading this summary is ${userProfile.name}.`);
        if (userProfile.title) {
          contextParts.push(`Their role is ${userProfile.title}.`);
        }
        if (userProfile.organization) {
          contextParts.push(`They work at ${userProfile.organization}.`);
        }
        if (userProfile.context) {
          contextParts.push(userProfile.context);
        }
        const userContextText = 'User Context: ' + contextParts.join(' ');
        transcriptText = userContextText + '\n\n' + transcriptText;
        logger.main.debug('[TemplateSummary] Including user profile context');
      }

      // Collect section metadata only - NO FUNCTIONS to avoid memory issues
      const sectionTasks = [];

      for (const templateId of templateIds) {
        const template = templateManager.getTemplate(templateId);
        if (!template) {
          console.warn('[TemplateSummary] Template not found:', templateId);
          continue;
        }

        console.log('[TemplateSummary] Generating summary with template:', template.name);

        for (const section of template.sections) {
          console.log(`[TemplateSummary] Queuing section: ${section.title}`);

          // Store ONLY data - no functions (functions capture context and cause OOM)
          sectionTasks.push({
            templateId: template.id,
            templateName: template.name,
            sectionTitle: section.title,
            sectionPrompt: section.prompt,
            name: `${template.name} - ${section.title}`,
          });
        }
      }

      // Estimate tokens per request (rough estimate: 1 token ≈ 4 chars)
      const estimatedTokensPerRequest = Math.ceil(transcriptText.length / 4) + 200; // +200 for prompts

      // Azure limit: 200k tokens/min. Use 70% to be safe
      const tokenBudgetPerMinute = 140000;

      // Calculate safe concurrency based on token budget
      const safeConcurrency = Math.max(
        1,
        Math.floor(tokenBudgetPerMinute / estimatedTokensPerRequest)
      );
      const _actualConcurrency = Math.min(3, safeConcurrency); // Cap at 3 for safety (reserved for future use)

      console.log(`[TemplateSummary] Transcript: ~${estimatedTokensPerRequest} tokens/request`);
      console.log(
        `[TemplateSummary] Processing ${sectionTasks.length} sections SEQUENTIALLY to avoid memory issues...`
      );
      const startTime = Date.now();

      // Process completely sequentially - NO concurrency, NO closures
      // This is slower but avoids OOM with large transcripts
      const sectionResults = new Array(sectionTasks.length);

      for (let i = 0; i < sectionTasks.length; i++) {
        const task = sectionTasks[i];
        let retries = 0;
        const maxRetries = 3;

        console.log(`[TemplateSummary] Processing ${i + 1}/${sectionTasks.length}: ${task.name}`);

        while (retries <= maxRetries) {
          try {
            const result = await executeTemplateSectionTask(llmService, task, transcriptText);
            sectionResults[i] = result;
            break; // Success, move to next task
          } catch (error) {
            if (error.status === 429 && retries < maxRetries) {
              const retryAfter = error.headers?.get?.('retry-after') || 60;
              const delayMs = (parseInt(retryAfter) + 1) * 1000;
              console.log(
                `[RateLimit] Hit rate limit. Retry ${retries + 1}/${maxRetries} after ${delayMs}ms`
              );
              await new Promise(resolve => setTimeout(resolve, delayMs));
              retries++;
            } else {
              console.error(`[RateLimit] Failed after ${retries} retries:`, error.message);
              sectionResults[i] = { success: false, content: '*Error generating this section*' };
              break; // Give up, move to next task
            }
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[TemplateSummary] All API calls completed in ${duration}s`);

      // Group results by template and reconstruct summaries
      const summaries = [];
      const templateMap = new Map();

      // Initialize template summaries
      for (const templateId of templateIds) {
        const template = templateManager.getTemplate(templateId);
        if (!template) continue;

        templateMap.set(template.id, {
          templateId: template.id,
          templateName: template.name,
          sections: [],
        });
      }

      // Add section results to their templates
      sectionTasks.forEach((task, index) => {
        const result = sectionResults[index];
        const templateData = templateMap.get(task.templateId);

        if (templateData) {
          templateData.sections.push({
            title: task.sectionTitle,
            content: result.content,
          });
        }
      });

      // Build final markdown for each template
      for (const [_templateId, templateData] of templateMap) {
        let summaryMarkdown = `# ${meeting.title}\n\n`;
        summaryMarkdown += `Generated using template: **${templateData.templateName}**\n\n`;
        summaryMarkdown += `---\n\n`;

        for (const section of templateData.sections) {
          summaryMarkdown += `## ${section.title}\n\n${section.content}\n\n`;
        }

        summaries.push({
          templateId: templateData.templateId,
          templateName: templateData.templateName,
          content: summaryMarkdown,
        });
      }

      console.log(`[TemplateSummary] Generated ${summaries.length} template-based summaries`);
      return summaries;
    },
    '[TemplateSummary]'
  );
}

// ============================================================================
// IPC Handlers
// ============================================================================

// Handle saving meetings data
ipcMain.handle('saveMeetingsData', async (event, data) => {
  console.log('[IPC] saveMeetingsData called with data:', {
    upcomingCount: data?.upcomingMeetings?.length,
    pastCount: data?.pastMeetings?.length,
  });
  try {
    // Validate input data
    console.log('[IPC] Validating meetings data...');
    const validatedData = MeetingsDataSchema.parse(data);
    console.log('[IPC] Validation successful');

    // CRITICAL: Merge with current data to prevent losing fields managed by main process
    // The renderer has stale data, so we need to preserve fields like recordingId, uploadToken, transcript
    console.log('[IPC] Merging with current file data to preserve main-process-managed fields...');
    await fileOperationManager.scheduleOperation(async currentData => {
      // Merge upcoming meetings (renderer manages these)
      const mergedData = {
        upcomingMeetings: validatedData.upcomingMeetings,
        pastMeetings: validatedData.pastMeetings.map(rendererMeeting => {
          // Find the corresponding meeting in current data
          const currentMeeting = currentData.pastMeetings.find(m => m.id === rendererMeeting.id);

          if (currentMeeting) {
            // Merge: keep main-process-managed fields from current, UI fields from renderer
            return {
              ...rendererMeeting, // Start with renderer data (has UI updates like title, content, transcript, participants)
              // Preserve ONLY main-process-managed fields (not transcript/participants which are edited in renderer)
              recordingId: currentMeeting.recordingId || rendererMeeting.recordingId,
              uploadToken: currentMeeting.uploadToken || rendererMeeting.uploadToken,
              recordingComplete:
                currentMeeting.recordingComplete || rendererMeeting.recordingComplete,
              recordingEndTime: currentMeeting.recordingEndTime || rendererMeeting.recordingEndTime,
              summaries: currentMeeting.summaries || rendererMeeting.summaries,
              // Preserve transcription provider and SDK IDs
              transcriptionProvider:
                currentMeeting.transcriptionProvider || rendererMeeting.transcriptionProvider,
              sdkUploadId: currentMeeting.sdkUploadId || rendererMeeting.sdkUploadId,
              recallRecordingId:
                currentMeeting.recallRecordingId || rendererMeeting.recallRecordingId,
              transcriptProvider:
                currentMeeting.transcriptProvider || rendererMeeting.transcriptProvider,
              transcriptConfidence:
                currentMeeting.transcriptConfidence || rendererMeeting.transcriptConfidence,
              // UI-1: Preserve platform (can be set by SDK or updateMeetingField IPC)
              platform: currentMeeting.platform || rendererMeeting.platform,
            };
          }

          // New meeting from renderer - use as-is
          return rendererMeeting;
        }),
      };

      console.log('[IPC] Merge complete');
      return mergedData;
    });

    console.log('[IPC] File write complete');
    return { success: true };
  } catch (error) {
    console.error('[IPC] Caught error during save:', error);
    console.error('[IPC] Error type:', error.constructor.name);
    console.error('[IPC] Error instanceof ZodError:', error instanceof z.ZodError);

    if (error instanceof z.ZodError) {
      console.error('[IPC] Zod validation errors:', error.errors);
      console.error('[IPC] Full Zod error:', JSON.stringify(error, null, 2));
      return {
        success: false,
        error: `Validation failed: ${JSON.stringify(error.errors, null, 2)}`,
      };
    }
    console.error('[IPC] Non-Zod error:', error.message, error.stack);
    return { success: false, error: error.message };
  }
});

// Update a single field on a meeting (UI-1: Platform changes in metadata tab)
ipcMain.handle('updateMeetingField', async (event, meetingId, field, value) => {
  // Validate inputs
  try {
    validateIpcInput(updateMeetingFieldSchema, { meetingId, field, value });
  } catch (validationError) {
    console.error('[IPC] Validation failed for updateMeetingField:', validationError.message);
    return { success: false, error: validationError.message };
  }

  console.log(
    `[IPC] updateMeetingField called: meetingId=${meetingId}, field=${field}, value=${value}`
  );

  try {
    await fileOperationManager.scheduleOperation(async currentData => {
      // Find and update the meeting in pastMeetings
      const meetingIndex = currentData.pastMeetings.findIndex(m => m.id === meetingId);
      if (meetingIndex === -1) {
        console.warn(`[IPC] Meeting ${meetingId} not found in pastMeetings`);
        return currentData; // Return unchanged
      }

      // Update the field
      currentData.pastMeetings[meetingIndex][field] = value;
      console.log(`[IPC] Updated meeting ${meetingId} field '${field}' to '${value}'`);

      return currentData;
    });

    return { success: true };
  } catch (error) {
    console.error('[IPC] Error updating meeting field:', error);
    return { success: false, error: error.message };
  }
});

// Debug handler to check if IPC handlers are registered
ipcMain.handle('debugGetHandlers', async () => {
  console.log('Checking registered IPC handlers...');
  const handlers = Object.keys(ipcMain._invokeHandlers);
  console.log('Registered handlers:', handlers);
  return handlers;
});

// Check if SDK is fully initialized (after restart workaround)
ipcMain.handle('sdk:isReady', async () => {
  return sdkReady;
});

// ===================================================================
// Recall.ai Storage Management IPC Handlers
// ===================================================================

// List all recordings stored on Recall.ai
ipcMain.handle('recall:listRecordings', async () => {
  console.log('[Recall IPC] Listing all recordings...');
  return await listRecallRecordings();
});

// Delete all recordings to avoid storage charges
ipcMain.handle('recall:deleteAllRecordings', async () => {
  console.log('[Recall IPC] Deleting all recordings...');
  return await deleteAllRecallRecordings();
});

// Delete a specific recording
ipcMain.handle(
  'recall:deleteRecording',
  withValidation(stringIdSchema, async (_event, recordingId) => {
    console.log(`[Recall IPC] Deleting recording: ${recordingId}`);
    return await deleteRecallRecording(recordingId);
  })
);

// ===================================================================
// Centralized Google Services Initialization
// ===================================================================

/**
 * Initialize or reinitialize Google services (Calendar, Contacts, Speaker Matcher)
 * Prevents race conditions by checking if services are already initialized.
 *
 * @param {boolean} forceReinitialize - If true, recreate services even if they exist
 * @returns {Promise<boolean>} True if initialization successful
 */
async function initializeGoogleServices(forceReinitialize = false) {
  if (!googleAuth || !googleAuth.isAuthenticated()) {
    console.log('[Google Services] Not authenticated - skipping service initialization');
    return false;
  }

  try {
    // Initialize Calendar service
    if (!googleCalendar || forceReinitialize) {
      console.log('[Google Services] Initializing Calendar service...');
      googleCalendar = new GoogleCalendar(googleAuth);
      googleCalendar.initialize();
    } else {
      console.log('[Google Services] Calendar service already initialized');
    }

    // Initialize Contacts service
    if (!googleContacts || forceReinitialize) {
      console.log('[Google Services] Initializing Contacts service...');
      googleContacts = new GoogleContacts(googleAuth);
      googleContacts.initialize();
    } else {
      console.log('[Google Services] Contacts service already initialized');
    }

    // Initialize Speaker Matcher
    if (googleContacts && (!speakerMatcher || forceReinitialize)) {
      console.log('[Google Services] Initializing Speaker Matcher...');
      speakerMatcher = new SpeakerMatcher(googleContacts);
    } else if (googleContacts) {
      console.log('[Google Services] Speaker Matcher already initialized');
    }

    // Preload contacts (runs in background, doesn't block)
    if (googleContacts) {
      try {
        await googleContacts.fetchAllContacts();
        console.log('[Google Services] Contacts preloaded successfully');
      } catch (err) {
        console.error('[Google Services] Failed to preload contacts:', err.message);
      }
    }

    console.log('[Google Services] All services initialized successfully');
    return true;
  } catch (error) {
    console.error('[Google Services] Initialization failed:', error.message);
    return false;
  }
}

// ===================================================================
// Unified Google Authentication IPC Handlers (Calendar + Contacts)
// ===================================================================

// Get Google OAuth authorization URL (for both Calendar + Contacts)
ipcMain.handle(
  'google:getAuthUrl',
  createIpcHandler(async () => {
    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }
    const authUrl = googleAuth.getAuthUrl();
    return { success: true, authUrl };
  })
);

// Authenticate with authorization code (with CSRF protection)
ipcMain.handle(
  'google:authenticate',
  withValidation(googleAuthenticateSchema, async (_event, { code, state }) => {
    console.log('[Google IPC] Authenticating with code and state');
    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }

    try {
      // Pass state parameter for CSRF validation
      await googleAuth.getTokenFromCode(code, state);

      // Use centralized initialization to prevent race conditions
      if (googleAuth.isAuthenticated()) {
        await initializeGoogleServices();
        console.log('[Google IPC] Successfully authenticated Google Calendar + Contacts');
      }

      return { success: true };
    } catch (error) {
      console.error('[Google IPC] Authentication error:', error);
      return { success: false, error: error.message };
    }
  })
);

// Check if user is authenticated
ipcMain.handle(
  'google:isAuthenticated',
  createIpcHandler(async () => {
    if (!googleAuth) {
      return { success: true, authenticated: false };
    }
    const authenticated = googleAuth.isAuthenticated();
    return { success: true, authenticated };
  })
);

// Get authentication status (includes contact count, etc.)
ipcMain.handle(
  'google:getStatus',
  createIpcHandler(async () => {
    const authenticated = googleAuth && googleAuth.isAuthenticated();
    const contactCount = googleContacts ? googleContacts.contactCount : 0;
    const calendarReady = googleCalendar && googleCalendar.isAuthenticated();
    const contactsReady = googleContacts && googleContacts.isAuthenticated();

    return {
      success: true,
      authenticated,
      calendarReady,
      contactsReady,
      contactCount,
    };
  })
);

// Sign out and clear tokens
ipcMain.handle(
  'google:signOut',
  createIpcHandler(async () => {
    console.log('[Google IPC] Signing out');
    if (googleAuth) {
      await googleAuth.revokeAuthentication();
    }

    // Reset services
    googleCalendar = null;
    googleContacts = null;
    speakerMatcher = null;

    return { success: true };
  })
);

// Open OAuth window for Google authentication
ipcMain.handle('google:openAuthWindow', async () => {
  let authWindow = null;
  let timeout = null;
  let redirectHandler = null;
  let closedHandler = null;

  // Helper function to safely clean up the auth window and all listeners
  const cleanup = () => {
    // Clear timeout if it exists
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    // Remove event listeners to prevent memory leaks
    if (authWindow && !authWindow.isDestroyed()) {
      if (redirectHandler) {
        authWindow.webContents.removeListener('will-redirect', redirectHandler);
        redirectHandler = null;
      }
      if (closedHandler) {
        authWindow.removeListener('closed', closedHandler);
        closedHandler = null;
      }
      authWindow.destroy();
    }
    authWindow = null;
    console.log('[Google OAuth Security] Auth window and listeners cleaned up');
  };

  try {
    console.log('[Google IPC] Opening OAuth window');

    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }

    const authUrl = googleAuth.getAuthUrl();

    authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWindow.loadURL(authUrl);

    return new Promise(resolve => {
      // Timeout after 5 minutes to prevent hanging and memory leaks
      timeout = setTimeout(
        () => {
          if (authWindow && !authWindow.isDestroyed()) {
            console.log('[Google OAuth] Authentication timeout');
            cleanup();
            resolve({ success: false, error: 'Authentication timeout (5 minutes)' });
          }
        },
        5 * 60 * 1000
      );

      // Define redirect handler
      redirectHandler = async (event, url) => {
        if (url.startsWith('http://localhost:3000/oauth2callback')) {
          event.preventDefault();

          const parsedUrl = new URL(url);
          const code = parsedUrl.searchParams.get('code');
          const state = parsedUrl.searchParams.get('state');

          if (code) {
            try {
              // Pass state parameter for CSRF validation
              await googleAuth.getTokenFromCode(code, state);

              // Use centralized initialization to prevent race conditions
              await initializeGoogleServices();
              console.log('[Google OAuth] Services initialized successfully');

              cleanup();
              resolve({ success: true });
            } catch (error) {
              cleanup();
              resolve({ success: false, error: error.message });
            }
          } else {
            const error = parsedUrl.searchParams.get('error');
            cleanup();
            resolve({ success: false, error: error || 'No authorization code received' });
          }
        }
      };

      // Define closed handler
      closedHandler = () => {
        cleanup();
        resolve({ success: false, error: 'Authentication window closed' });
      };

      // Attach event listeners
      authWindow.webContents.on('will-redirect', redirectHandler);
      authWindow.on('closed', closedHandler);
    });
  } catch (error) {
    console.error('[Google IPC] Failed to open auth window:', error);
    cleanup();
    return { success: false, error: error.message };
  }
});

// ===================================================================
// Google Calendar Service-Specific IPC Handlers
// ===================================================================

// Get upcoming calendar meetings
ipcMain.handle(
  'calendar:getUpcomingMeetings',
  withValidation(hoursAheadSchema, async (event, hoursAhead = 24) => {
    try {
      console.log(`[Calendar IPC] Fetching upcoming meetings (${hoursAhead} hours ahead)`);

      // Check if calendar is initialized and authenticated
      if (!googleCalendar || !googleCalendar.isAuthenticated()) {
        console.log('[Calendar IPC] Calendar not authenticated - returning empty array');
        return { success: true, meetings: [] };
      }

      const meetings = await googleCalendar.getUpcomingMeetings(hoursAhead);
      console.log(`[Calendar IPC] Found ${meetings.length} upcoming meetings`);
      return { success: true, meetings };
    } catch (error) {
      console.error('[Calendar IPC] Failed to fetch meetings:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// Google Contacts & Speaker Matching Service-Specific IPC Handlers
// ===================================================================

// Fetch/refresh contacts from Google
ipcMain.handle(
  'contacts:fetchContacts',
  withValidation(optionalBooleanSchema, async (event, forceRefresh = false) => {
    try {
      console.log('[Contacts IPC] Fetching contacts (forceRefresh:', forceRefresh, ')');
      if (!googleContacts || !googleContacts.isAuthenticated()) {
        throw new Error('Google Contacts not authenticated');
      }

      const contacts = await googleContacts.fetchAllContacts(forceRefresh);
      return {
        success: true,
        contactCount: contacts.length,
        lastFetch: googleContacts.lastFetch,
      };
    } catch (error) {
      console.error('[Contacts IPC] Failed to fetch contacts:', error);
      return { success: false, error: error.message };
    }
  })
);

// Search contacts by query string (name or email)
ipcMain.handle(
  'contacts:searchContacts',
  withValidation(optionalStringSchema, async (event, query) => {
    try {
      console.log('[Contacts IPC] Searching contacts for:', query);
      if (!googleContacts || !googleContacts.isAuthenticated()) {
        throw new Error('Google Contacts not authenticated');
      }

      if (!query || query.trim().length === 0) {
        return { success: true, contacts: [] };
      }

      // Fetch all contacts (uses cache if available)
      const allContacts = await googleContacts.fetchAllContacts(false);
      const normalizedQuery = query.toLowerCase().trim();

      // Filter contacts by name or email matching query
      const matchingContacts = allContacts.filter(contact => {
        const nameMatch = contact.name && contact.name.toLowerCase().includes(normalizedQuery);
        const emailMatch =
          contact.emails &&
          contact.emails.some(email => email.toLowerCase().includes(normalizedQuery));
        return nameMatch || emailMatch;
      });

      console.log(`[Contacts IPC] Found ${matchingContacts.length} contacts matching "${query}"`);
      return {
        success: true,
        contacts: matchingContacts.slice(0, 50), // Limit to 50 results
      };
    } catch (error) {
      console.error('[Contacts IPC] Failed to search contacts:', error);
      return { success: false, error: error.message };
    }
  })
);

// Get all contacts with full data (CS-1)
ipcMain.handle(
  'contacts:getAllContacts',
  withValidation(optionalBooleanSchema, async (event, forceRefresh = false) => {
    try {
      console.log('[Contacts IPC] Getting all contacts (forceRefresh:', forceRefresh, ')');
      if (!googleContacts || !googleContacts.isAuthenticated()) {
        throw new Error('Google Contacts not authenticated');
      }

      const allContacts = await googleContacts.fetchAllContacts(forceRefresh);

      // Sort by name
      allContacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      console.log(`[Contacts IPC] Returning ${allContacts.length} contacts`);
      return {
        success: true,
        contacts: allContacts,
        lastFetch: googleContacts.lastFetch,
      };
    } catch (error) {
      console.error('[Contacts IPC] Failed to get all contacts:', error);
      return { success: false, error: error.message };
    }
  })
);

// Get meetings for a specific contact (CS-1)
ipcMain.handle(
  'contacts:getMeetingsForContact',
  withValidation(optionalStringSchema, async (event, contactEmail) => {
    try {
      console.log('[Contacts IPC] Getting meetings for contact:', contactEmail);

      if (!contactEmail) {
        return { success: true, meetings: [] };
      }

    // Load meetings from storage
    const meetingsPath = require('path').join(app.getPath('userData'), 'meetings.json');
    let meetings = [];

    if (require('fs').existsSync(meetingsPath)) {
      const data = require('fs').readFileSync(meetingsPath, 'utf8');
      const parsed = JSON.parse(data);
      // Meetings file stores { upcomingMeetings: [...], pastMeetings: [...] }
      const upcomingMeetings = parsed.upcomingMeetings || [];
      const pastMeetings = parsed.pastMeetings || [];
      meetings = [...upcomingMeetings, ...pastMeetings];
    }

    const normalizedEmail = contactEmail.toLowerCase().trim();
    console.log(
      `[Contacts IPC] Searching ${meetings.length} meetings for email: ${normalizedEmail}`
    );

    // Filter meetings where contact participated
    const contactMeetings = meetings.filter(meeting => {
      // Check participantEmails
      if (meeting.participantEmails && Array.isArray(meeting.participantEmails)) {
        const hasEmail = meeting.participantEmails.some(
          email => email && email.toLowerCase().trim() === normalizedEmail
        );
        if (hasEmail) return true;
      }

      // Check participants array
      if (meeting.participants && Array.isArray(meeting.participants)) {
        const hasParticipant = meeting.participants.some(
          p => p && p.email && p.email.toLowerCase().trim() === normalizedEmail
        );
        if (hasParticipant) return true;
      }

      // Check attendees array (from calendar events)
      if (meeting.attendees && Array.isArray(meeting.attendees)) {
        const hasAttendee = meeting.attendees.some(
          a => a && a.email && a.email.toLowerCase().trim() === normalizedEmail
        );
        if (hasAttendee) return true;
      }

      return false;
    });

    // Sort by date descending
    contactMeetings.sort((a, b) => new Date(b.date) - new Date(a.date));

    console.log(`[Contacts IPC] Found ${contactMeetings.length} meetings for ${contactEmail}`);
    return {
      success: true,
      meetings: contactMeetings.map(m => ({
        id: m.id,
        title: m.title,
        date: m.date,
        platform: m.platform,
        obsidianLink: m.obsidianLink,
      })),
    };
    } catch (error) {
      console.error('[Contacts IPC] Failed to get meetings for contact:', error);
      return { success: false, error: error.message };
    }
  })
);

// CS-3: Create contact page in Obsidian
ipcMain.handle(
  'contacts:createContactPage',
  withValidation(contactSchema, async (event, contact) => {
    try {
      console.log('[Contacts IPC] Creating contact page for:', contact.name);

      if (!vaultStructure || !vaultStructure.vaultBasePath) {
        return { success: false, error: 'Vault path not configured' };
      }

      const result = vaultStructure.createContactPage(contact, {});
      return result;
    } catch (error) {
      console.error('[Contacts IPC] Failed to create contact page:', error);
      return { success: false, error: error.message };
    }
  })
);

// CS-3: Check if contact page exists
ipcMain.handle(
  'contacts:contactPageExists',
  withValidation(stringIdSchema, async (event, contactName) => {
    try {
      if (!vaultStructure || !vaultStructure.vaultBasePath) {
        return { success: false, exists: false, error: 'Vault path not configured' };
      }

      const exists = vaultStructure.contactPageExists(contactName);
      return { success: true, exists };
    } catch (error) {
      console.error('[Contacts IPC] Failed to check contact page:', error);
      return { success: false, exists: false, error: error.message };
    }
  })
);

// CS-3: Create company page in Obsidian
ipcMain.handle(
  'contacts:createCompanyPage',
  withValidation(contactSchema, async (event, company) => {
    try {
      console.log('[Contacts IPC] Creating company page for:', company.name);

      if (!vaultStructure || !vaultStructure.vaultBasePath) {
        return { success: false, error: 'Vault path not configured' };
      }

      const result = vaultStructure.createCompanyPage(company, {});
      return result;
    } catch (error) {
      console.error('[Contacts IPC] Failed to create company page:', error);
      return { success: false, error: error.message };
    }
  })
);

// CS-3: Check if company page exists
ipcMain.handle(
  'contacts:companyPageExists',
  withValidation(stringIdSchema, async (event, companyName) => {
    try {
      if (!vaultStructure || !vaultStructure.vaultBasePath) {
        return { success: false, exists: false, error: 'Vault path not configured' };
      }

      const exists = vaultStructure.companyPageExists(companyName);
      return { success: true, exists };
    } catch (error) {
      console.error('[Contacts IPC] Failed to check company page:', error);
      return { success: false, exists: false, error: error.message };
    }
  })
);

// Match speakers to participants
ipcMain.handle(
  'speakers:matchSpeakers',
  withValidation(speakersMatchSchema, async (event, { transcript, participantEmails, options, recordingId }) => {
    try {
      console.log('[Speakers IPC] Matching speakers to participants');
      if (!speakerMatcher) {
        throw new Error('Speaker matcher not initialized');
      }

      // SM-1: Get speech timeline for high-confidence matching if recordingId provided
      const speechTimeline = recordingId ? getSpeechTimeline(recordingId) : null;
      if (speechTimeline) {
        console.log(
          `[Speakers IPC] SM-1: Found speech timeline with ${speechTimeline.participants.length} SDK participants`
        );
      }

      // Perform speaker matching
      const speakerMapping = await speakerMatcher.matchSpeakers(transcript, participantEmails, {
        ...options,
        speechTimeline,
      });

      // Apply mapping to transcript
      const updatedTranscript = speakerMatcher.applyMappingToTranscript(transcript, speakerMapping);

      // Get speaker statistics
      const speakerStats = speakerMatcher.analyzeSpeakers(transcript);
      const speakerSummary = speakerMatcher.getSpeakerSummary(speakerStats);

      return {
        success: true,
        speakerMapping,
        updatedTranscript,
        speakerSummary,
      };
    } catch (error) {
      console.error('[Speakers IPC] Failed to match speakers:', error);
      return { success: false, error: error.message };
    }
  })
);

// Update speaker mapping manually (for corrections)
ipcMain.handle(
  'speakers:updateMapping',
  withValidation(speakersUpdateMappingSchema, async (event, { meetingId, speakerLabel, participantEmail }) => {
    try {
      console.log(
        `[Speakers IPC] Updating speaker mapping: ${speakerLabel} -> ${participantEmail}`
      );

      // Load meeting data
      const data = await fileOperationManager.readMeetingsData();

      // Find meeting in either upcomingMeetings or pastMeetings
      let meeting = data.upcomingMeetings?.find(m => m.id === meetingId);
      if (!meeting) {
        meeting = data.pastMeetings?.find(m => m.id === meetingId);
      }

      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found`);
      }

      if (!meeting.transcript) {
        throw new Error(`Meeting ${meetingId} has no transcript`);
      }

      // Update the speaker mapping
      if (!meeting.speakerMapping) {
        meeting.speakerMapping = {};
      }

      // Find contact info for the participant email
      let participantName = participantEmail;
      if (googleContacts && googleContacts.isAuthenticated()) {
        const contact = await googleContacts.findContactByEmail(participantEmail);
        if (contact) {
          participantName = contact.name;
        }
      }

      meeting.speakerMapping[speakerLabel] = {
        email: participantEmail,
        name: participantName,
        confidence: 'manual',
        method: 'user-correction',
      };

      // Apply the updated mapping to transcript
      if (speakerMatcher) {
        meeting.transcript = speakerMatcher.applyMappingToTranscript(
          meeting.transcript,
          meeting.speakerMapping
        );
      }

      // Save updated meeting data
      await fileOperationManager.writeData(data);

      return { success: true, speakerMapping: meeting.speakerMapping };
    } catch (error) {
      console.error('[Speakers IPC] Failed to update mapping:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// Speaker Mapping IPC Handlers (SM-2)
// ===================================================================

// Get all speaker mappings
ipcMain.handle('speakerMapping:getAll', async () => {
  try {
    const mappings = speakerMappingService.getAllMappings();
    return { success: true, mappings };
  } catch (error) {
    console.error('[SpeakerMapping IPC] Failed to get mappings:', error);
    return { success: false, error: error.message };
  }
});

// Get suggestions for speaker IDs (auto-suggest from known mappings)
ipcMain.handle(
  'speakerMapping:getSuggestions',
  withValidation(speakerMappingGetSuggestionsSchema, async (event, { speakerIds }) => {
    try {
      const suggestions = speakerMappingService.getSuggestions(speakerIds);
      return { success: true, suggestions };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to get suggestions:', error);
      return { success: false, error: error.message };
    }
  })
);

// Add or update a speaker mapping
ipcMain.handle(
  'speakerMapping:addMapping',
  withValidation(speakerMappingAddSchema, async (event, { speakerId, contact, sourceContext }) => {
    try {
      const mapping = await speakerMappingService.addMapping(speakerId, contact, sourceContext);
      return { success: true, mapping };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to add mapping:', error);
      return { success: false, error: error.message };
    }
  })
);

// Delete a speaker mapping
ipcMain.handle(
  'speakerMapping:deleteMapping',
  withValidation(speakerMappingDeleteSchema, async (event, { speakerId }) => {
    try {
      const deleted = await speakerMappingService.deleteMapping(speakerId);
      return { success: true, deleted };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to delete mapping:', error);
      return { success: false, error: error.message };
    }
  })
);

// Extract unique speaker IDs from a transcript
ipcMain.handle(
  'speakerMapping:extractSpeakerIds',
  withValidation(speakerMappingExtractSchema, async (event, { transcript }) => {
    try {
      const result = speakerMappingService.extractUniqueSpeakerIds(transcript);
      const { speakerIds, existingMappings, speakerStats } = result;

      // v1.1: Get auto-suggestions from user profile (single speaker = user)
      const profileSuggestions = speakerMappingService.getAutoSuggestionsFromProfile(
        speakerIds,
        userProfile
      );

      return {
        success: true,
        speakerIds,
        existingMappings, // New: mappings already in the transcript (speaker → speakerName)
        profileSuggestions, // Suggestions based on user profile
        speakerStats, // v1.2: Talk time % and sample quote per speaker
      };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to extract speaker IDs:', error);
      return { success: false, error: error.message };
    }
  })
);

// Detect duplicate speakers
ipcMain.handle(
  'speakerMapping:detectDuplicates',
  withValidation(speakerMappingDetectDuplicatesSchema, async (event, { speakers }) => {
    try {
      const duplicates = speakerMappingService.detectDuplicateSpeakers(speakers);
      return { success: true, ...duplicates };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to detect duplicates:', error);
      return { success: false, error: error.message };
    }
  })
);

// Apply mappings to a transcript
ipcMain.handle(
  'speakerMapping:applyToTranscript',
  withValidation(speakerMappingApplyToTranscriptSchema, async (event, { transcript, mappings, options }) => {
    try {
      const updatedTranscript = speakerMappingService.applyMappingsToTranscript(
        transcript,
        mappings,
        options
      );
      return { success: true, transcript: updatedTranscript };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to apply mappings:', error);
      return { success: false, error: error.message };
    }
  })
);

// Apply mappings to a meeting and save
ipcMain.handle(
  'speakerMapping:applyToMeeting',
  withValidation(speakerMappingApplySchema, async (event, { meetingId, mappings, options }) => {
    try {
      console.log(`[SpeakerMapping IPC] Applying mappings to meeting ${meetingId}`);

    // Load meeting data
    const data = await fileOperationManager.readMeetingsData();

    // Find meeting in either upcomingMeetings or pastMeetings
    let meeting = data.upcomingMeetings?.find(m => m.id === meetingId);
    let meetingList = 'upcomingMeetings';

    if (!meeting) {
      meeting = data.pastMeetings?.find(m => m.id === meetingId);
      meetingList = 'pastMeetings';
    }

    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }

    if (!meeting.transcript) {
      throw new Error(`Meeting ${meetingId} has no transcript`);
    }

    // Apply mappings to transcript
    console.log(`[SpeakerMapping IPC] Mappings to apply:`, JSON.stringify(mappings, null, 2));
    console.log(
      `[SpeakerMapping IPC] Transcript before (first 2):`,
      meeting.transcript?.slice(0, 2)
    );

    meeting.transcript = speakerMappingService.applyMappingsToTranscript(
      meeting.transcript,
      mappings,
      options
    );

    console.log(
      `[SpeakerMapping IPC] Transcript after (first 2):`,
      meeting.transcript?.slice(0, 2)
    );

    // Store the applied mappings for reference
    meeting.appliedSpeakerMappings = mappings;

    // Update participants list - replace speaker IDs with mapped contacts and deduplicate
    if (mappings) {
      // Initialize participants array if it doesn't exist
      if (!meeting.participants) {
        meeting.participants = [];
      }
      if (!meeting.participantEmails) {
        meeting.participantEmails = [];
      }

      // First pass: Collect all "from" speakers that should be removed (merged into others)
      const speakersToRemove = new Set();
      for (const [speakerId, mapping] of Object.entries(mappings)) {
        // If this is a merge (speakerId maps to another speaker name that's different),
        // mark the speakerId for removal
        if (mapping.merged || mapping.autoMerged) {
          speakersToRemove.add(speakerId);
        }
      }

      // Second pass: Remove merged speakers from participants
      if (speakersToRemove.size > 0) {
        meeting.participants = meeting.participants.filter(p => {
          if (speakersToRemove.has(p.name)) {
            console.log(`[SpeakerMapping IPC] Removing merged participant: ${p.name}`);
            return false;
          }
          return true;
        });
      }

      // Third pass: Update/add participants based on mappings
      for (const [speakerId, mapping] of Object.entries(mappings)) {
        const contactName = mapping.contactName;
        const contactEmail = mapping.contactEmail;

        // Skip if this speaker was merged into another (already removed)
        if (speakersToRemove.has(speakerId)) {
          continue;
        }

        // Find existing participant with this speaker ID as name and replace it
        const existingIndex = meeting.participants.findIndex(p => p.name === speakerId);

        if (existingIndex !== -1) {
          // Replace the speaker ID participant with the contact
          meeting.participants[existingIndex] = {
            name: contactName,
            email: contactEmail || meeting.participants[existingIndex].email || null,
            mappedFromSpeakerId: speakerId,
          };
          console.log(`[SpeakerMapping IPC] Replaced participant ${speakerId} with ${contactName}`);
        } else {
          // Check if contact already exists (by name or email)
          const contactExists = meeting.participants.find(
            p => p.name === contactName || (contactEmail && p.email === contactEmail)
          );

          if (!contactExists) {
            // Add as new participant
            meeting.participants.push({
              name: contactName,
              email: contactEmail || null,
              mappedFromSpeakerId: speakerId,
            });
            console.log(`[SpeakerMapping IPC] Added participant: ${contactName}`);
          }
        }

        // Add email to participantEmails if not already present
        if (contactEmail && !meeting.participantEmails.includes(contactEmail)) {
          meeting.participantEmails.push(contactEmail);
        }
      }

      // Final pass: Deduplicate participants by name (case-insensitive)
      // Keep the entry with the most information (email, longer name)
      const seenNames = new Map();
      const deduped = [];

      for (const p of meeting.participants) {
        const normalizedName = p.name?.toLowerCase().trim();
        if (!normalizedName) continue;

        if (seenNames.has(normalizedName)) {
          const existingIdx = seenNames.get(normalizedName);
          const existing = deduped[existingIdx];
          // Prefer entry with email, or longer original name
          if (
            (!existing.email && p.email) ||
            (p.name.length > existing.name.length && !existing.email)
          ) {
            deduped[existingIdx] = p;
            console.log(`[SpeakerMapping IPC] Dedup: replaced "${existing.name}" with "${p.name}"`);
          } else {
            console.log(`[SpeakerMapping IPC] Dedup: skipping duplicate "${p.name}"`);
          }
        } else {
          seenNames.set(normalizedName, deduped.length);
          deduped.push(p);
        }
      }

      meeting.participants = deduped;
      console.log(`[SpeakerMapping IPC] Final participant count: ${meeting.participants.length}`);

      // Deduplicate participantEmails
      if (meeting.participantEmails?.length > 0) {
        meeting.participantEmails = [
          ...new Set(meeting.participantEmails.map(e => e?.toLowerCase().trim()).filter(Boolean)),
        ];
      }
    }

    // Update summary content if it exists - replace speaker IDs with names
    if (meeting.content && mappings) {
      let updatedContent = meeting.content;
      for (const [speakerId, mapping] of Object.entries(mappings)) {
        // Replace speaker ID with contact name in summary
        const regex = new RegExp(speakerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        updatedContent = updatedContent.replace(regex, mapping.contactName);
      }
      meeting.content = updatedContent;
    }

    // Save updated meeting data
    await fileOperationManager.writeData(data);

    // Persist each mapping to the service for future auto-suggest
    // But skip generic speaker IDs like "Speaker A", "Speaker B" which are not consistent across transcripts
    if (mappings) {
      for (const [speakerId, mapping] of Object.entries(mappings)) {
        // Skip saving mappings for generic speaker IDs
        if (isGenericSpeakerName(speakerId)) {
          console.log(`[SpeakerMapping IPC] Not persisting mapping for generic speaker: ${speakerId}`);
          continue;
        }
        await speakerMappingService.addMapping(
          speakerId,
          {
            name: mapping.contactName,
            email: mapping.contactEmail,
          },
          {
            meetingId,
            meetingTitle: meeting.title,
          }
        );
      }
    }

    console.log(
      `[SpeakerMapping IPC] Applied ${Object.keys(mappings || {}).length} mappings to meeting (in ${meetingList})`
    );

    // SM-3.5/SM-3.6: Update Obsidian files if meeting was already exported
    let obsidianUpdated = false;
    if (meeting.obsidianLink && vaultStructure) {
      try {
        const vaultBasePath = vaultStructure.getAbsolutePath('');

        // Derive file paths from obsidianLink
        // obsidianLink is vault-relative path to summary file (e.g., "clients/acme/meetings/2024-01-15-meeting.md")
        const summaryPath = path.join(vaultBasePath, meeting.obsidianLink);
        const transcriptPath = summaryPath.replace(/\.md$/, '-transcript.md');

        // Extract base filename for markdown generation
        const baseFilename = path.basename(meeting.obsidianLink, '.md');

        // Check if files exist before updating
        if (fs.existsSync(summaryPath)) {
          console.log(`[SpeakerMapping IPC] Updating Obsidian summary: ${summaryPath}`);
          const summaryContent = generateSummaryMarkdown(meeting, baseFilename);
          fs.writeFileSync(summaryPath, summaryContent, 'utf8');
          obsidianUpdated = true;
        }

        if (fs.existsSync(transcriptPath)) {
          console.log(`[SpeakerMapping IPC] Updating Obsidian transcript: ${transcriptPath}`);
          const transcriptContent = generateTranscriptMarkdown(meeting, baseFilename);
          fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
          obsidianUpdated = true;
        }

        if (obsidianUpdated) {
          console.log(
            `[SpeakerMapping IPC] Successfully updated Obsidian files for meeting ${meetingId}`
          );
        }
      } catch (obsidianError) {
        // Log error but don't fail the whole operation - meeting data was already saved
        console.error('[SpeakerMapping IPC] Failed to update Obsidian files:', obsidianError);
      }
    }

    return { success: true, meeting, obsidianUpdated };
  } catch (error) {
    console.error('[SpeakerMapping IPC] Failed to apply mappings to meeting:', error);
    return { success: false, error: error.message };
  }
  })
);

// Get statistics about speaker mappings
ipcMain.handle('speakerMapping:getStats', async () => {
  try {
    const stats = speakerMappingService.getStats();
    return { success: true, stats };
  } catch (error) {
    console.error('[SpeakerMapping IPC] Failed to get stats:', error);
    return { success: false, error: error.message };
  }
});

// Export mappings for backup
ipcMain.handle('speakerMapping:export', async () => {
  try {
    const data = speakerMappingService.exportMappings();
    return { success: true, data };
  } catch (error) {
    console.error('[SpeakerMapping IPC] Failed to export mappings:', error);
    return { success: false, error: error.message };
  }
});

// Import mappings from backup
ipcMain.handle(
  'speakerMapping:import',
  withValidation(speakerMappingImportSchema, async (event, { data, merge }) => {
    try {
      await speakerMappingService.importMappings(data, merge);
      return { success: true };
    } catch (error) {
      console.error('[SpeakerMapping IPC] Failed to import mappings:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// End Google Integration IPC Handlers
// ===================================================================

// ===================================================================
// Template System IPC Handlers (Phase 4)
// ===================================================================

// Get all available templates
ipcMain.handle('templates:getAll', async () => {
  try {
    console.log('[Template IPC] Getting all templates');
    const templates = templateManager.getAllTemplates();
    return { success: true, templates };
  } catch (error) {
    console.error('[Template IPC] Failed to get templates:', error);
    return { success: false, error: error.message };
  }
});

// Get template by ID
ipcMain.handle(
  'templates:getById',
  withValidation(stringIdSchema, async (event, templateId) => {
    try {
      console.log('[Template IPC] Getting template:', templateId);
      const template = templateManager.getTemplate(templateId);
      if (!template) {
        return { success: false, error: 'Template not found' };
      }
      return { success: true, template };
    } catch (error) {
      console.error('[Template IPC] Failed to get template:', error);
      return { success: false, error: error.message };
    }
  })
);

// Get template raw file content for editing (Phase 10.3)
ipcMain.handle(
  'templates:getContent',
  withValidation(stringIdSchema, async (event, templateId) => {
    try {
      console.log('[Template IPC] Getting template content:', templateId);
      const template = templateManager.getTemplate(templateId);
      if (!template) {
        return { success: false, error: 'Template not found' };
      }

      // Read raw file content
      const filePath =
        template.filePath ||
        path.join(templateManager.templatesPath, `${templateId}${template.format}`);
      const content = fs.readFileSync(filePath, 'utf8');

      return { success: true, content };
    } catch (error) {
      console.error('[Template IPC] Failed to get template content:', error);
      return { success: false, error: error.message };
    }
  })
);

// Estimate cost for templates
ipcMain.handle(
  'templates:estimateCost',
  withValidation(templatesEstimateCostSchema, async (event, { templateIds, transcript, provider }) => {
    try {
      console.log(
        '[Template IPC] Estimating cost for',
        templateIds.length,
        'templates',
        'with provider:',
        provider
      );
      const estimate = templateManager.estimateCost(templateIds, transcript, provider);
      return { success: true, estimate };
    } catch (error) {
      console.error('[Template IPC] Failed to estimate cost:', error);
      return { success: false, error: error.message };
    }
  })
);

// Generate summaries using multiple templates
ipcMain.handle(
  'templates:generateSummaries',
  withValidation(
    templatesGenerateSummariesSchema,
    async (event, { meetingId, templateIds, routingOverride }) => {
      try {
        console.log(
          '[Template IPC] Generating summaries for meeting:',
          meetingId,
          'with',
          templateIds.length,
          'templates'
        );
        if (routingOverride) {
          console.log('[Template IPC] Using routing override:', routingOverride);
        }

        // Load meeting data
        const data = await fileOperationManager.readMeetingsData();
        const meeting = [...data.upcomingMeetings, ...data.pastMeetings].find(
          m => m.id === meetingId
        );

        if (!meeting) {
          return { success: false, error: 'Meeting not found' };
        }

        if (!meeting.transcript) {
          return { success: false, error: 'Meeting has no transcript' };
        }

        // Use shared template generation function
        console.log('[Template IPC] Using shared generateTemplateSummaries function');
        const summaries = await generateTemplateSummaries(meeting, templateIds);

        // Save summaries to meeting object
        meeting.summaries = summaries;
        await fileOperationManager.writeData(data);
        console.log('[Template IPC] Saved summaries to meeting object');

        // Auto-trigger export to Obsidian after template generation
        console.log('[Template IPC] Auto-triggering Obsidian export...');
        const exportResult = await exportMeetingToObsidian(meeting, routingOverride);

        if (exportResult.success && exportResult.obsidianLink) {
          meeting.obsidianLink = exportResult.obsidianLink;
          await fileOperationManager.writeData(data);
          console.log(
            '[Template IPC] Auto-export successful, obsidianLink saved:',
            exportResult.obsidianLink
          );
        } else if (!exportResult.success) {
          console.warn('[Template IPC] Auto-export failed:', exportResult.error);
        }

        return {
          success: true,
          summaries,
          exported: exportResult.success,
          obsidianLink: exportResult.obsidianLink || null,
        };
      } catch (error) {
        console.error('[Template IPC] Failed to generate summaries:', error);
        return { success: false, error: error.message };
      }
    }
  )
);

// Reload templates from disk
ipcMain.handle('templates:reload', async () => {
  try {
    console.log('[Template IPC] Reloading templates');
    const count = templateManager.reload();
    return { success: true, count };
  } catch (error) {
    console.error('[Template IPC] Failed to reload templates:', error);
    return { success: false, error: error.message };
  }
});

// ===================================================================
// End Template System IPC Handlers
// ===================================================================

// ===================================================================
// Routing Configuration IPC Handlers (Phase 10.4)
// ===================================================================

// Helper function to get routing config path - always uses userData/config/
function getRoutingConfigPath() {
  return path.join(app.getPath('userData'), 'config', 'routing.yaml');
}

// Get routing configuration
ipcMain.handle(
  'routing:getConfig',
  createIpcHandler(async () => {
    console.log('[Routing IPC] Getting routing configuration');

    const routingPath = getRoutingConfigPath();
    console.log('[Routing IPC] Using config path:', routingPath);

    if (!fs.existsSync(routingPath)) {
      throw new Error('Routing configuration file not found at: ' + routingPath);
    }

    const content = fs.readFileSync(routingPath, 'utf8');
    const config = yaml.load(content);

    return {
      config,
      content,
      path: routingPath,
    };
  })
);

// Save routing configuration
ipcMain.handle(
  'routing:saveConfig',
  createIpcHandler(async (event, content) => {
    console.log('[Routing IPC] Saving routing configuration');

    const routingPath = getRoutingConfigPath();
    const backupPath = routingPath.replace('.yaml', '.backup.yaml');

    // Create backup before saving
    if (fs.existsSync(routingPath)) {
      fs.copyFileSync(routingPath, backupPath);
      console.log('[Routing IPC] Created backup at:', backupPath);
    }

    // Validate YAML before saving
    try {
      yaml.load(content);
    } catch (yamlError) {
      throw new Error(`Invalid YAML: ${yamlError.message}`);
    }

    // Save the new configuration
    fs.writeFileSync(routingPath, content, 'utf8');
    console.log('[Routing IPC] Routing configuration saved successfully');

    // Reload routing engine
    if (routingEngine) {
      routingEngine.reloadConfig();
      console.log('[Routing IPC] Routing engine reloaded');
    }

    return {};
  })
);

// Validate routing configuration
ipcMain.handle(
  'routing:validateConfig',
  createIpcHandler(async (event, content) => {
    console.log('[Routing IPC] Validating routing configuration');

    // Parse YAML
    const config = yaml.load(content);
    const errors = [];

    // Validate structure
    if (!config) {
      errors.push('Configuration is empty');
      return { valid: false, errors };
    }

    // Check for required sections
    if (!config.clients && !config.industry && !config.internal) {
      errors.push('At least one routing section (clients, industry, or internal) is required');
    }

    // Validate clients
    if (config.clients) {
      Object.keys(config.clients).forEach(key => {
        const client = config.clients[key];
        if (!client.vault_path) {
          errors.push(`Client "${key}" is missing vault_path`);
        }
      });
    }

    // Validate industry
    if (config.industry) {
      Object.keys(config.industry).forEach(key => {
        const ind = config.industry[key];
        if (!ind.vault_path) {
          errors.push(`Industry contact "${key}" is missing vault_path`);
        }
      });
    }

    // Validate internal
    if (config.internal && !config.internal.vault_path) {
      errors.push('Internal section is missing vault_path');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  })
);

// Test routing with given emails
ipcMain.handle(
  'routing:testEmails',
  createIpcHandler(async (event, emails) => {
    console.log('[Routing IPC] Testing routing with emails:', emails);

    if (!routingEngine) {
      throw new Error('Routing engine not initialized');
    }

    // Use the testRoute method which is designed for this purpose
    const decision = routingEngine.testRoute(emails);

    // Get the primary route
    const primaryRoute = decision.routes[0] || {};

    return {
      vaultPath: primaryRoute.fullPath || '_unfiled/',
      reason: decision.multiOrg
        ? `Multi-org meeting with ${decision.orgCount} organizations`
        : primaryRoute.type
          ? `Routed to ${primaryRoute.type}${primaryRoute.slug ? ` (${primaryRoute.slug})` : ''}`
          : 'No match found - routed to unfiled',
      matchedOrganizations: decision.routes.map(r => r.slug || r.type).filter(Boolean),
      matchedEmails: emails.filter(email => {
        return routingEngine.emailMatcher.match(email) !== null;
      }),
    };
  })
);

// CS-4: Preview routing for a meeting (used in template modal)
ipcMain.handle(
  'routing:previewMeetingRoute',
  withValidation(stringIdSchema, async (event, meetingId) => {
    try {
      console.log('[Routing IPC] Preview routing for meeting:', meetingId);

    if (!routingEngine) {
      console.error('[Routing IPC] Routing engine not initialized');
      // Return a fallback unfiled route instead of throwing
      return {
        routes: [
          {
            path: '_unfiled/',
            type: 'unfiled',
            organization: null,
            reason: 'Routing engine not initialized - defaulting to unfiled',
          },
        ],
        multiOrg: false,
        orgCount: 0,
        participantEmails: [],
        matchResults: { clients: [], industry: [], internal: 0, unfiled: 0 },
      };
    }

    // Load meeting from storage
    const meetingsPath = require('path').join(app.getPath('userData'), 'meetings.json');
    let meetings = [];

    if (fs.existsSync(meetingsPath)) {
      const data = fs.readFileSync(meetingsPath, 'utf8');
      const parsed = JSON.parse(data);
      // Meetings file stores { upcomingMeetings: [...], pastMeetings: [...] }
      const upcomingMeetings = parsed.upcomingMeetings || [];
      const pastMeetings = parsed.pastMeetings || [];
      meetings = [...upcomingMeetings, ...pastMeetings];
    }

    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) {
      console.error('[Routing IPC] Meeting not found:', meetingId);
      return {
        routes: [
          {
            path: '_unfiled/',
            type: 'unfiled',
            organization: null,
            reason: 'Meeting not found - defaulting to unfiled',
          },
        ],
        multiOrg: false,
        orgCount: 0,
        participantEmails: [],
        matchResults: { clients: [], industry: [], internal: 0, unfiled: 0 },
      };
    }

    // Get participant emails from various possible sources
    const participantEmails = [];

    // Check participantEmails array
    if (meeting.participantEmails && Array.isArray(meeting.participantEmails)) {
      meeting.participantEmails.forEach(email => {
        if (email && !participantEmails.includes(email)) {
          participantEmails.push(email);
        }
      });
    }

    // Check participants array
    if (meeting.participants && Array.isArray(meeting.participants)) {
      meeting.participants.forEach(p => {
        if (p && p.email && !participantEmails.includes(p.email)) {
          participantEmails.push(p.email);
        }
      });
    }

    // Check attendees array (from calendar events)
    if (meeting.attendees && Array.isArray(meeting.attendees)) {
      meeting.attendees.forEach(a => {
        if (a && a.email && !participantEmails.includes(a.email)) {
          participantEmails.push(a.email);
        }
      });
    }

    console.log('[Routing IPC] Found participant emails:', participantEmails);

    // Create meeting data for routing
    const routingData = {
      participantEmails,
      meetingTitle: meeting.title,
      meetingDate: new Date(meeting.date),
    };

    // Get routing decision
    const decision = routingEngine.route(routingData);

    // Get config to look up organization names
    const routingConfig = routingEngine.getConfig();

    // Helper to get organization name from config
    const getOrgName = route => {
      if (route.type === 'client' && route.slug && routingConfig.clients?.[route.slug]) {
        return routingConfig.clients[route.slug].name || route.slug;
      }
      if (route.type === 'industry' && route.slug && routingConfig.industry?.[route.slug]) {
        return routingConfig.industry[route.slug].name || route.slug;
      }
      if (route.type === 'internal') {
        return 'Internal';
      }
      return null;
    };

    // Build preview info
    const preview = {
      routes: decision.routes.map(r => {
        const orgName = getOrgName(r);
        return {
          path: r.fullPath || r.folderPath,
          type: r.type,
          organization: orgName,
          reason: buildRoutingReason(r, decision.matchResults, participantEmails, orgName),
        };
      }),
      multiOrg: decision.multiOrg,
      orgCount: decision.orgCount,
      participantEmails,
      matchResults: {
        clients: Object.keys(decision.matchResults.clients || {}),
        industry: Object.keys(decision.matchResults.industry || {}),
        internal: decision.matchResults.internal?.length || 0,
        unfiled: decision.matchResults.unfiled?.length || 0,
      },
    };

    return preview;
  } catch (error) {
    console.error('[Routing IPC] Error previewing route:', error);
    // Return a fallback unfiled route on any error
    return {
      routes: [
        {
          path: '_unfiled/',
          type: 'unfiled',
          organization: null,
          reason: `Error: ${error.message || 'Unknown error'} - defaulting to unfiled`,
        },
      ],
      multiOrg: false,
      orgCount: 0,
      participantEmails: [],
      matchResults: { clients: [], industry: [], internal: 0, unfiled: 0 },
      };
    }
  })
);

// CS-4.4: Get all available destinations for manual override
ipcMain.handle('routing:getAllDestinations', async () => {
  try {
    console.log('[Routing IPC] Getting all destinations');

    if (!routingEngine) {
      console.error('[Routing IPC] Routing engine not initialized');
      return { destinations: [] };
    }

    const config = routingEngine.getConfig();
    const destinations = [];

    // Add clients
    if (config.clients) {
      Object.entries(config.clients).forEach(([slug, data]) => {
        destinations.push({
          type: 'client',
          slug,
          name: data.name || slug,
          path: data.vault_path || `clients/${slug}`,
        });
      });
    }

    // Add industry
    if (config.industry) {
      Object.entries(config.industry).forEach(([slug, data]) => {
        destinations.push({
          type: 'industry',
          slug,
          name: data.name || slug,
          path: data.vault_path || `industry/${slug}`,
        });
      });
    }

    // Add internal
    if (config.internal) {
      destinations.push({
        type: 'internal',
        slug: 'internal',
        name: 'Internal',
        path: config.internal.vault_path || 'internal/meetings',
      });
    }

    // Add unfiled
    destinations.push({
      type: 'unfiled',
      slug: 'unfiled',
      name: 'Unfiled',
      path: config.settings?.unfiled_path || '_unfiled',
    });

    // Sort: clients first, then industry, then internal, then unfiled
    const typeOrder = { client: 0, industry: 1, internal: 2, unfiled: 3 };
    destinations.sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.name.localeCompare(b.name);
    });

    return { destinations };
  } catch (error) {
    console.error('[Routing IPC] Error getting destinations:', error);
    return { destinations: [], error: error.message };
  }
});

// Helper function to build human-readable routing reason
function buildRoutingReason(route, matchResults, participantEmails, orgName) {
  switch (route.type) {
    case 'client': {
      const clientEmails = matchResults.clients[route.slug] || [];
      return `Client match: ${clientEmails.join(', ')} matched "${orgName || route.slug}"`;
    }
    case 'industry': {
      const industryEmails = matchResults.industry[route.slug] || [];
      return `Industry match: ${industryEmails.join(', ')} matched "${orgName || route.slug}"`;
    }
    case 'internal': {
      const internalEmails = matchResults.internal || [];
      return `Internal meeting: ${internalEmails.join(', ')} are internal team members`;
    }
    case 'unfiled':
      if (participantEmails.length === 0) {
        return 'No participants found - routing to unfiled';
      }
      return `No matching routing rules for: ${participantEmails.join(', ')}`;
    default:
      return 'Unknown routing type';
  }
}

// Add new organization to routing config
ipcMain.handle(
  'routing:addOrganization',
  withValidation(routingAddOrganizationSchema, async (event, { type, id, vaultPath, emails, contacts }) => {
    console.log('[Routing IPC] Adding new organization:', type, id);

    const routingPath = getRoutingConfigPath();

    if (!fs.existsSync(routingPath)) {
      throw new Error('Routing configuration file not found');
    }

    const content = fs.readFileSync(routingPath, 'utf8');
    const config = yaml.load(content);

    // Validate inputs
    if (!type || !id || !vaultPath) {
      throw new Error('Type, ID, and vault path are required');
    }

    // Map type names (handle both singular and plural forms)
    // Schema sends: 'client', 'industry', 'internal'
    // YAML uses: 'clients', 'industry', 'internal'
    const typeKey = type === 'client' ? 'clients' : type;

    if (!['clients', 'industry', 'internal'].includes(typeKey)) {
      throw new Error('Type must be "client", "industry", or "internal"');
    }

    // Check if organization already exists
    if (config[typeKey] && config[typeKey][id]) {
      throw new Error(`Organization "${id}" already exists in ${typeKey}`);
    }

    // Initialize section if it doesn't exist
    if (!config[typeKey]) {
      config[typeKey] = {};
    }

    // Add the new organization
    config[typeKey][id] = {
      vault_path: vaultPath,
      emails: emails || [],
      contacts: contacts || [],
    };

    // Create backup before saving
    const backupPath = routingPath.replace('.yaml', '.backup.yaml');
    if (fs.existsSync(routingPath)) {
      fs.copyFileSync(routingPath, backupPath);
      console.log('[Routing IPC] Created backup at:', backupPath);
    }

    // Convert back to YAML and save
    const newContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(routingPath, newContent, 'utf8');
    console.log('[Routing IPC] Organization added successfully');

    // Reload routing engine
    if (routingEngine) {
      routingEngine.reloadConfig();
      console.log('[Routing IPC] Routing engine reloaded');
    }

    return { success: true, content: newContent };
  })
);

// CS-4.5: Add emails/domains to existing organization
ipcMain.handle(
  'routing:addEmailsToOrganization',
  withValidation(routingAddEmailsSchema, async (event, { type, slug, emails, contacts }) => {
    console.log('[Routing IPC] Adding emails to organization:', type, slug);

    const routingPath = getRoutingConfigPath();

    if (!fs.existsSync(routingPath)) {
      throw new Error('Routing configuration file not found');
    }

    const content = fs.readFileSync(routingPath, 'utf8');
    const config = yaml.load(content);

    // Validate inputs
    if (!type || !slug) {
      throw new Error('Type and slug are required');
    }

    // Map type names (handle both singular and plural)
    const typeKey = type === 'client' ? 'clients' : type === 'industry' ? 'industry' : type;

    // Check if organization exists
    if (!config[typeKey] || !config[typeKey][slug]) {
      throw new Error(`Organization "${slug}" not found in ${typeKey}`);
    }

    const org = config[typeKey][slug];

    // Add new emails (deduplicate)
    if (emails && emails.length > 0) {
      const existingEmails = org.emails || [];
      const newEmails = emails.filter(e => !existingEmails.includes(e));
      org.emails = [...existingEmails, ...newEmails];
      console.log(`[Routing IPC] Added ${newEmails.length} new email domains:`, newEmails);
    }

    // Add new contacts (deduplicate)
    if (contacts && contacts.length > 0) {
      const existingContacts = org.contacts || [];
      const newContacts = contacts.filter(c => !existingContacts.includes(c));
      org.contacts = [...existingContacts, ...newContacts];
      console.log(`[Routing IPC] Added ${newContacts.length} new contacts:`, newContacts);
    }

    // Create backup before saving
    const backupPath = routingPath.replace('.yaml', '.backup.yaml');
    if (fs.existsSync(routingPath)) {
      fs.copyFileSync(routingPath, backupPath);
      console.log('[Routing IPC] Created backup at:', backupPath);
    }

    // Convert back to YAML and save
    const newContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(routingPath, newContent, 'utf8');
    console.log('[Routing IPC] Emails added successfully');

    // Reload routing engine
    if (routingEngine) {
      routingEngine.reloadConfig();
      console.log('[Routing IPC] Routing engine reloaded');
    }

    return { success: true, content: newContent };
  })
);

// Delete organization from routing config
ipcMain.handle(
  'routing:deleteOrganization',
  withValidation(routingDeleteOrganizationSchema, async (event, { type, id }) => {
    console.log('[Routing IPC] Deleting organization:', type, id);

    const routingPath = getRoutingConfigPath();

    if (!fs.existsSync(routingPath)) {
      throw new Error('Routing configuration file not found');
    }

    const content = fs.readFileSync(routingPath, 'utf8');
    const config = yaml.load(content);

    // Validate inputs
    if (!type || !id) {
      throw new Error('Type and ID are required');
    }

    // Map type names (handle both singular and plural forms)
    // Schema sends: 'client', 'industry', 'internal'
    // YAML uses: 'clients', 'industry', 'internal'
    const typeKey = type === 'client' ? 'clients' : type;

    // Prevent deleting internal (it's special)
    if (typeKey === 'internal') {
      throw new Error('Cannot delete internal organization');
    }

    // Check if organization exists
    if (!config[typeKey] || !config[typeKey][id]) {
      throw new Error(`Organization "${id}" not found in ${typeKey}`);
    }

    // Create backup before deleting
    const backupPath = routingPath.replace('.yaml', '.backup.yaml');
    if (fs.existsSync(routingPath)) {
      fs.copyFileSync(routingPath, backupPath);
      console.log('[Routing IPC] Created backup at:', backupPath);
    }

    // Delete the organization
    delete config[typeKey][id];

    // Keep the section even if empty (don't delete it)
    // This ensures the routing engine doesn't fail on reload

    // Convert back to YAML and save
    const newContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(routingPath, newContent, 'utf8');
    console.log('[Routing IPC] Organization deleted successfully');

    // Reload routing engine
    if (routingEngine) {
      routingEngine.reloadConfig();
      console.log('[Routing IPC] Routing engine reloaded');
    }

    return { success: true, content: newContent };
  })
);

// Restore routing configuration from backup
ipcMain.handle(
  'routing:restoreBackup',
  createIpcHandler(async () => {
    console.log('[Routing IPC] Restoring routing configuration from backup');

    const routingPath = getRoutingConfigPath();
    const backupPath = routingPath.replace('.yaml', '.backup.yaml');

    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file not found. No backup available to restore.');
    }

    // Read the backup file
    const backupContent = fs.readFileSync(backupPath, 'utf8');

    // Validate the backup is valid YAML
    try {
      yaml.load(backupContent);
    } catch (yamlError) {
      throw new Error(`Backup file is corrupted: ${yamlError.message}`);
    }

    // Restore the backup by copying it to the main config
    fs.copyFileSync(backupPath, routingPath);
    console.log('[Routing IPC] Routing configuration restored from backup');

    // Reload routing engine
    if (routingEngine) {
      routingEngine.reloadConfig();
      console.log('[Routing IPC] Routing engine reloaded');
    }

    return {};
  })
);

// ===================================================================
// End Routing Configuration IPC Handlers
// ===================================================================

// ===================================================================
// Vocabulary Management IPC Handlers (VC-2)
// ===================================================================

// Get vocabulary configuration
ipcMain.handle('vocabulary:getConfig', async () => {
  try {
    const config = vocabularyService.getConfig(true); // Force reload
    return { success: true, data: config };
  } catch (error) {
    console.error('[Vocabulary IPC] Error getting config:', error);
    return { success: false, error: error.message };
  }
});

// Get vocabulary statistics
ipcMain.handle('vocabulary:getStats', async () => {
  try {
    const stats = vocabularyService.getStats();
    return { success: true, data: stats };
  } catch (error) {
    console.error('[Vocabulary IPC] Error getting stats:', error);
    return { success: false, error: error.message };
  }
});

// Get client slugs from routing config (for client selector)
ipcMain.handle('vocabulary:getClientSlugs', async () => {
  try {
    // Get client slugs from routing config
    const routingPath = getRoutingConfigPath();
    if (fs.existsSync(routingPath)) {
      const content = fs.readFileSync(routingPath, 'utf8');
      const config = yaml.load(content);
      const clientSlugs = Object.keys(config?.clients || {});
      return { success: true, data: clientSlugs };
    }
    return { success: true, data: [] };
  } catch (error) {
    console.error('[Vocabulary IPC] Error getting client slugs:', error);
    return { success: false, error: error.message };
  }
});

// Add global spelling correction
ipcMain.handle(
  'vocabulary:addGlobalSpelling',
  withValidation(vocabularySpellingSchema, async (event, { from, to }) => {
    try {
      vocabularyService.addGlobalSpellingCorrection(from, to);
      return { success: true };
    } catch (error) {
      console.error('[Vocabulary IPC] Error adding global spelling:', error);
      return { success: false, error: error.message };
    }
  })
);

// Add global keyword boost
ipcMain.handle(
  'vocabulary:addGlobalKeyword',
  withValidation(vocabularyKeywordSchema, async (event, { word, intensifier }) => {
    try {
      vocabularyService.addGlobalKeywordBoost(word, intensifier || 5);
      return { success: true };
    } catch (error) {
      console.error('[Vocabulary IPC] Error adding global keyword:', error);
      return { success: false, error: error.message };
    }
  })
);

// Add client spelling correction
ipcMain.handle(
  'vocabulary:addClientSpelling',
  withValidation(vocabularyClientSpellingSchema, async (event, { clientSlug, from, to }) => {
    try {
      vocabularyService.addClientSpellingCorrection(clientSlug, from, to);
      return { success: true };
    } catch (error) {
      console.error('[Vocabulary IPC] Error adding client spelling:', error);
      return { success: false, error: error.message };
    }
  })
);

// Add client keyword boost
ipcMain.handle(
  'vocabulary:addClientKeyword',
  withValidation(vocabularyClientKeywordSchema, async (event, { clientSlug, word, intensifier }) => {
    try {
      vocabularyService.addClientKeywordBoost(clientSlug, word, intensifier || 5);
      return { success: true };
    } catch (error) {
      console.error('[Vocabulary IPC] Error adding client keyword:', error);
      return { success: false, error: error.message };
    }
  })
);

// Remove global spelling correction
ipcMain.handle(
  'vocabulary:removeGlobalSpelling',
  withValidation(vocabularyRemoveSpellingSchema, async (event, { to }) => {
    try {
      const removed = vocabularyService.removeGlobalSpellingCorrection(to);
      return { success: true, removed };
    } catch (error) {
      console.error('[Vocabulary IPC] Error removing global spelling:', error);
      return { success: false, error: error.message };
    }
  })
);

// Remove global keyword boost
ipcMain.handle(
  'vocabulary:removeGlobalKeyword',
  withValidation(vocabularyRemoveKeywordSchema, async (event, { word }) => {
    try {
      const removed = vocabularyService.removeGlobalKeywordBoost(word);
      return { success: true, removed };
    } catch (error) {
      console.error('[Vocabulary IPC] Error removing global keyword:', error);
      return { success: false, error: error.message };
    }
  })
);

// Save full vocabulary configuration (for bulk updates)
ipcMain.handle(
  'vocabulary:saveConfig',
  withValidation(vocabularyConfigSchema, async (event, config) => {
    try {
      vocabularyService.save(config);
      return { success: true };
    } catch (error) {
      console.error('[Vocabulary IPC] Error saving config:', error);
      return { success: false, error: error.message };
    }
  })
);

// Reload vocabulary from disk
ipcMain.handle('vocabulary:reload', async () => {
  try {
    vocabularyService.reload();
    return { success: true };
  } catch (error) {
    console.error('[Vocabulary IPC] Error reloading:', error);
    return { success: false, error: error.message };
  }
});

// ===================================================================
// End Vocabulary IPC Handlers
// ===================================================================

// ===================================================================
// LLM Provider Management
// ===================================================================

// Get current LLM provider
ipcMain.handle('llm:getProvider', async () => {
  try {
    if (!llmService) {
      return {
        success: false,
        error: 'LLM service not configured - please add API keys in settings',
      };
    }
    return {
      success: true,
      provider: llmService.getProviderName(),
    };
  } catch (error) {
    console.error('[LLM] Error getting provider:', error);
    return { success: false, error: error.message };
  }
});

// Switch LLM provider
ipcMain.handle(
  'llm:switchProvider',
  withValidation(llmSwitchProviderSchema, async (event, { provider }) => {
    try {
      if (!llmService) {
        return {
          success: false,
          error: 'LLM service not configured - please add API keys in settings',
        };
      }

      console.log(`[LLM] Switching provider to: ${provider}`);

      // Validation is now handled by Zod schema

      llmService.switchProvider(provider);

      return {
        success: true,
        provider: llmService.getProviderName(),
      };
    } catch (error) {
      console.error('[LLM] Error switching provider:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// End LLM Provider Management
// ===================================================================

// ===================================================================
// Obsidian Export IPC Handlers (Phase 5)
// ===================================================================

// Export a meeting to Obsidian vault
ipcMain.handle(
  'obsidian:exportMeeting',
  withValidation(stringIdSchema, async (event, meetingId) => {
    try {
      console.log('[Obsidian IPC] Export requested for meeting:', meetingId);

    // Load meeting data
    const data = await fileOperationManager.readMeetingsData();
    const meeting = [...data.upcomingMeetings, ...data.pastMeetings].find(m => m.id === meetingId);

    if (!meeting) {
      return { success: false, error: 'Meeting not found' };
    }

    // Export to Obsidian
    const result = await exportMeetingToObsidian(meeting);

    // If successful, save obsidianLink back to meeting object
    if (result.success && result.obsidianLink) {
      meeting.obsidianLink = result.obsidianLink;
      console.log('[Obsidian IPC] Saved obsidianLink to meeting:', result.obsidianLink);

      // Save updated meeting data
      await fileOperationManager.writeData(data);
    }

      return result;
    } catch (error) {
      console.error('[Obsidian IPC] Export failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// Get export status/configuration
ipcMain.handle('obsidian:getStatus', async () => {
  return {
    initialized: !!(vaultStructure && routingEngine),
    vaultPath: vaultStructure ? vaultStructure.vaultBasePath : null,
    routingConfigured: !!routingEngine,
  };
});

// RS-2: Refresh Obsidian links for meetings whose notes may have been moved
ipcMain.handle('obsidian:refreshLinks', async () => {
  try {
    console.log('[Obsidian IPC] Refresh links requested');

    if (!vaultStructure) {
      return { success: false, error: 'Vault not configured' };
    }

    // Load all meeting data
    const data = await fileOperationManager.readMeetingsData();
    const allMeetings = [...data.upcomingMeetings, ...data.pastMeetings];

    // Filter to only meetings that have been synced to Obsidian
    const syncedMeetings = allMeetings.filter(m => m.obsidianLink);

    if (syncedMeetings.length === 0) {
      return {
        success: true,
        message: 'No synced meetings to refresh',
        updated: 0,
        stale: [],
        refreshed: [],
        missing: [],
      };
    }

    // Refresh links using VaultStructure's scan method
    const result = vaultStructure.refreshObsidianLinks(syncedMeetings);

    // Log detailed datasync information for each change
    log.info(`[datasync] ========== Link Refresh Started ==========`);
    log.info(`[datasync] Scanned ${syncedMeetings.length} synced meetings`);

    if (result.stale.length > 0) {
      log.info(`[datasync] Found ${result.stale.length} stale link(s):`);
      for (const item of result.stale) {
        log.info(`[datasync] Meeting ID: ${item.id}`);
        log.info(`[datasync]   Title: ${item.title}`);
        log.info(`[datasync]   Old path: ${item.previousPath}`);
        log.info(`[datasync]   New path: ${item.newPath}`);
      }
    }

    if (result.missing.length > 0) {
      log.info(`[datasync] Found ${result.missing.length} missing note(s):`);
      for (const item of result.missing) {
        log.info(`[datasync] Meeting ID: ${item.id}`);
        log.info(`[datasync]   Title: ${item.title}`);
        log.info(`[datasync]   Expected path: ${item.previousPath}`);
      }
    }

    if (result.updated === 0 && result.missing.length === 0) {
      log.info(`[datasync] All ${syncedMeetings.length} links are up to date`);
    }

    log.info(`[datasync] Summary: ${result.updated} updated, ${result.missing.length} missing`);
    log.info(`[datasync] ========== Link Refresh Complete ==========`);

    // If any links were updated, save the meeting data
    if (result.updated > 0) {
      await fileOperationManager.writeData(data);
      log.info(`[datasync] Saved ${result.updated} updated meeting links to database`);
    }

    return {
      success: true,
      message: `Refreshed ${result.updated} stale links`,
      ...result,
    };
  } catch (error) {
    console.error('[Obsidian IPC] Refresh links failed:', error);
    return { success: false, error: error.message };
  }
});

// ===================================================================
// End Obsidian Export IPC Handlers
// ===================================================================

// ===================================================================
// Import Transcripts IPC Handlers (Phase 8)
// ===================================================================

// Import a single file
ipcMain.handle(
  'import:importFile',
  withValidation(importFileSchema, async (event, { filePath, options }) => {
    if (!importManager) {
      return { success: false, error: 'Import manager not initialized' };
    }

  try {
    const result = await importManager.importFile(filePath, {
      ...options,
      onProgress: progress => {
        event.sender.send('import:progress', progress);
      },
    });

    // If successful, add meeting to meetings.json
    // Note: Auto-labeling of single speakers is now handled inside ImportManager
    // before summary generation (v1.1)
    if (result.success) {
      const data = await fileOperationManager.readMeetingsData();
      data.pastMeetings.unshift(result.meeting);
      await fileOperationManager.writeData(data);
    }

    return result;
  } catch (error) {
    console.error('[Import] Import file failed:', error);
    return { success: false, error: error.message };
  }
  })
);

// Import multiple files in batch
ipcMain.handle(
  'import:importBatch',
  withValidation(importBatchSchema, async (event, { filePaths, options }) => {
    if (!importManager) {
      return {
        success: false,
        error: 'Import manager not initialized',
        total: filePaths.length,
      successful: 0,
      failed: filePaths.length,
      meetings: [],
      errors: filePaths.map(fp => ({ file: fp, error: 'Import manager not initialized' })),
    };
  }

  // Only switch provider if we're actually generating summaries
  if (options.generateAutoSummary) {
    return await withProviderSwitch(
      'auto',
      async () => {
        const result = await importManager.importBatch(filePaths, {
          ...options,
          onProgress: progress => {
            event.sender.send('import:progress', progress);
          },
        });

        // Add all successful meetings to meetings.json
        // Note: Auto-labeling of single speakers is now handled inside ImportManager
        // before summary generation (v1.1)
        if (result.meetings.length > 0) {
          const data = await fileOperationManager.readMeetingsData();
          result.meetings.forEach(meeting => {
            data.pastMeetings.unshift(meeting);
          });
          await fileOperationManager.writeData(data);
        }

        return result;
      },
      '[Import]'
    ).catch(error => {
      console.error('[Import] Batch import failed:', error);
      return {
        success: false,
        error: error.message,
        total: filePaths.length,
        successful: 0,
        failed: filePaths.length,
        meetings: [],
        errors: [],
      };
    });
  } else {
    // No provider switching needed if not generating summaries
    try {
      const result = await importManager.importBatch(filePaths, {
        ...options,
        onProgress: progress => {
          event.sender.send('import:progress', progress);
        },
      });

      // Add all successful meetings to meetings.json
      // Note: Auto-labeling of single speakers is now handled inside ImportManager
      // before summary generation (v1.1)
      if (result.meetings.length > 0) {
        const data = await fileOperationManager.readMeetingsData();
        result.meetings.forEach(meeting => {
          data.pastMeetings.unshift(meeting);
        });
        await fileOperationManager.writeData(data);
      }

      return result;
    } catch (error) {
      console.error('[Import] Batch import failed:', error);
      return {
        success: false,
        error: error.message,
        total: filePaths.length,
        successful: 0,
        failed: filePaths.length,
        meetings: [],
        errors: [],
      };
    }
  }
  })
);

// Get import manager status (IM-1: updated to include audio formats)
ipcMain.handle('import:getStatus', async () => {
  return {
    initialized: !!importManager,
    supportedFormats: ['.txt', '.md', '.vtt', '.srt'],
    audioFormats: ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac', '.aac'],
  };
});

// IM-1.4: Transcribe audio file using selected provider
ipcMain.handle(
  'import:transcribeAudio',
  withValidation(importTranscribeAudioSchema, async (event, { filePath, provider, options = {} }) => {
    console.log(`[Import] Transcribing audio file: ${filePath} with provider: ${provider}`);

    if (!transcriptionService) {
      return { success: false, error: 'Transcription service not initialized' };
    }

  // Validate provider
  const validProviders = ['assemblyai', 'deepgram'];
  if (!validProviders.includes(provider)) {
    return {
      success: false,
      error: `Invalid provider: ${provider}. Use one of: ${validProviders.join(', ')}`,
    };
  }

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  try {
    // Send progress update
    event.sender.send('import:progress', {
      step: 'transcribing',
      file: path.basename(filePath),
      provider,
    });

    // VC-3: Get vocabulary for transcription (user can specify clientSlug in options)
    let vocabularyOptions = {};
    try {
      const clientSlug = options.clientSlug || null;
      vocabularyOptions = vocabularyService.getVocabularyForProvider(provider, clientSlug);
      const vocabCount =
        vocabularyOptions.custom_spelling?.length || vocabularyOptions.keywords?.length || 0;
      if (vocabCount > 0) {
        console.log(
          `[Import] VC-3: Using ${vocabCount} vocabulary entries for ${provider}${clientSlug ? ` (client: ${clientSlug})` : ' (global)'}`
        );
      }
    } catch (vocabError) {
      console.warn('[Import] VC-3: Failed to load vocabulary:', vocabError.message);
    }

    // Transcribe the audio file with vocabulary
    const transcribeOptions = { ...options, ...vocabularyOptions };
    const transcript = await transcriptionService.transcribe(provider, filePath, transcribeOptions);

    console.log(
      `[Import] Transcription complete. Got ${transcript.utterances?.length || 0} utterances`
    );

    return {
      success: true,
      transcript: transcript.utterances || [],
      metadata: {
        provider,
        duration: transcript.audio_duration || null,
        confidence: transcript.confidence || null,
        words: transcript.words?.length || 0,
      },
    };
  } catch (error) {
    console.error('[Import] Audio transcription failed:', error);
    return { success: false, error: error.message };
  }
  })
);

// IM-1.5: Import audio file (transcribe then import as meeting)
ipcMain.handle(
  'import:importAudioFile',
  withValidation(importAudioFileSchema, async (event, { filePath, provider, options = {} }) => {
  console.log(`[Import] Importing audio file: ${filePath}`);

  if (!importManager) {
    return { success: false, error: 'Import manager not initialized' };
  }

  if (!transcriptionService) {
    return { success: false, error: 'Transcription service not initialized' };
  }

  const {
    generateAutoSummary = false,
    templateIds = null,
    autoExport = false,
    clientSlug = null, // VC-3: Optional client for vocabulary
    platform = 'unknown', // UI-1.6: Meeting platform
  } = options;

  try {
    // Step 1: Transcribe the audio file
    event.sender.send('import:progress', {
      step: 'transcribing',
      file: path.basename(filePath),
      provider,
    });

    // VC-3: Get vocabulary for transcription
    let vocabularyOptions = {};
    try {
      vocabularyOptions = vocabularyService.getVocabularyForProvider(provider, clientSlug);
      const vocabCount =
        vocabularyOptions.custom_spelling?.length || vocabularyOptions.keywords?.length || 0;
      if (vocabCount > 0) {
        console.log(
          `[Import] VC-3: Using ${vocabCount} vocabulary entries for ${provider}${clientSlug ? ` (client: ${clientSlug})` : ' (global)'}`
        );
      }
    } catch (vocabError) {
      console.warn('[Import] VC-3: Failed to load vocabulary:', vocabError.message);
    }

    const transcriptResult = await transcriptionService.transcribe(
      provider,
      filePath,
      vocabularyOptions
    );

    // Transcription service returns 'entries' not 'utterances'
    const entries = transcriptResult.entries || transcriptResult.utterances || [];
    if (entries.length === 0) {
      return { success: false, error: 'Transcription returned no content' };
    }

    console.log(`[Import] Transcription complete. Got ${entries.length} entries`);

    // Step 2: Create a meeting object from the transcription
    event.sender.send('import:progress', {
      step: 'creating-meeting',
      file: path.basename(filePath),
    });

    const meetingId = 'imported-audio-' + Date.now();
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileStats = fs.statSync(filePath);

    // Extract metadata from filename (basic parsing)
    const dateMatch = fileName.match(/(\d{4}[-_]\d{2}[-_]\d{2})/);
    const meetingDate = dateMatch ? new Date(dateMatch[1].replace(/_/g, '-')) : fileStats.mtime;

    // Detect UUID-like filenames (e.g., windows-desktop-032c0723-9059-4218-956e-68b6654d3ebd)
    const isUuidFilename =
      /^[a-z-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileName) ||
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(fileName);

    // Generate a friendly title
    const dateStr = meetingDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timeStr = meetingDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const friendlyTitle = isUuidFilename
      ? `Imported Recording - ${dateStr} ${timeStr}`
      : fileName.replace(/[-_]/g, ' ').trim() || 'Imported Audio';

    // Convert entries to transcript format
    const transcript = entries.map(u => ({
      speaker: u.speaker || 'Speaker',
      speakerName: u.speaker || 'Speaker',
      text: u.text || '',
      timestamp: formatTimestamp(u.timestamp || u.start || 0),
      start: u.timestamp || u.start || 0,
      end: u.end || 0,
      confidence: u.confidence || null,
    }));

    // Build participants list from unique speakers
    const uniqueSpeakers = [...new Set(transcript.map(t => t.speaker))];
    const participants = uniqueSpeakers.map(speaker => ({
      name: speaker,
      email: null,
    }));

    const meeting = {
      id: meetingId,
      type: 'document',
      title: friendlyTitle,
      date: meetingDate.toISOString(),
      participants,
      participantEmails: [],
      transcript,
      content: `# ${friendlyTitle}\n\n**Source:** Imported from audio file\n**Duration:** ${formatDuration(transcriptResult.audio_duration || 0)}\n`,
      platform, // UI-1.6: Use selected platform from options
      duration: transcriptResult.audio_duration || null,
      source: 'audio-import',
      importedFrom: path.basename(filePath),
      importedAt: new Date().toISOString(),
      status: 'needs_verification',
      metadata: {
        originalFormat: 'audio',
        hasSpeakers: true,
        hasTimestamps: true,
        transcriptionProvider: provider,
        audioConfidence: transcriptResult.confidence || null,
      },
    };

    // Step 3: Auto-label single speakers as user
    if (importManager.autoLabelFunction && meeting.transcript && meeting.transcript.length > 0) {
      try {
        const labelResult = await importManager.autoLabelFunction(meeting);
        if (labelResult?.applied) {
          meeting.transcript = labelResult.transcript;
          if (labelResult.userProfile) {
            meeting.participants = [
              {
                name: labelResult.userProfile.name,
                email: labelResult.userProfile.email || null,
                isHost: true,
              },
            ];
          }
          console.log('[Import] Auto-labeled single speaker as:', labelResult.userProfile?.name);
        }
      } catch (labelError) {
        console.warn('[Import] Auto-label failed:', labelError.message);
      }
    }

    // Step 4: Generate auto-summary if requested
    if (generateAutoSummary && meeting.transcript.length > 0) {
      event.sender.send('import:progress', {
        step: 'generating-auto-summary',
        file: path.basename(filePath),
      });
      try {
        await importManager.generateSummary(meeting);
      } catch (err) {
        console.warn('[Import] Auto-summary generation failed:', err.message);
      }
    }

    // Step 5: Generate template summaries if requested
    if (templateIds && templateIds.length > 0 && meeting.transcript.length > 0) {
      event.sender.send('import:progress', {
        step: 'generating-template-summaries',
        file: path.basename(filePath),
      });
      try {
        await importManager.generateTemplateSummaries(meeting, templateIds);
      } catch (err) {
        console.warn('[Import] Template summary generation failed:', err.message);
      }
    }

    // Step 6: Export to Obsidian if requested
    if (autoExport) {
      event.sender.send('import:progress', { step: 'exporting', file: path.basename(filePath) });
      try {
        await importManager.exportToObsidian(meeting);
      } catch (err) {
        console.warn('[Import] Export to Obsidian failed:', err.message);
      }
    }

    // Step 7: Save to meetings.json
    event.sender.send('import:progress', { step: 'saving', file: path.basename(filePath) });
    const data = await fileOperationManager.readMeetingsData();
    data.pastMeetings.unshift(meeting);
    await fileOperationManager.writeData(data);

    return {
      success: true,
      meeting,
      metadata: {
        provider,
        duration: transcriptResult.audio_duration,
        utteranceCount: entries.length,
      },
    };
  } catch (error) {
    console.error('[Import] Audio import failed:', error);
    return { success: false, error: error.message };
  }
  })
);

/**
 * Format seconds to HH:MM:SS timestamp
 */
function formatTimestamp(seconds) {
  if (!seconds && seconds !== 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins} minutes`;
}

// IM-1: Audio file extensions for import
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac', 'aac'];
const TRANSCRIPT_EXTENSIONS = ['txt', 'md', 'vtt', 'srt'];

/**
 * Check if a file is an audio file based on extension
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if audio file
 */
function isAudioFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Check if a file is a transcript file based on extension
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if transcript file
 */
function _isTranscriptFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return TRANSCRIPT_EXTENSIONS.includes(ext);
}

// Select files for import using Electron dialog (IM-1: now includes audio files)
ipcMain.handle('import:selectFiles', async () => {
  const { dialog } = require('electron');
  const fs = require('fs').promises;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Files to Import',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Supported Files', extensions: [...TRANSCRIPT_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      { name: 'Transcript Files', extensions: TRANSCRIPT_EXTENSIONS },
      { name: 'Audio Files', extensions: AUDIO_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return [];
  }

  // Get file stats to include file sizes and detect file type
  const filesWithStats = await Promise.all(
    result.filePaths.map(async filePath => {
      try {
        const stats = await fs.stat(filePath);
        const isAudio = isAudioFile(filePath);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
          type: isAudio ? 'audio' : 'transcript',
          isAudio,
        };
      } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: 0,
          type: isAudioFile(filePath) ? 'audio' : 'transcript',
          isAudio: isAudioFile(filePath),
        };
      }
    })
  );

  return filesWithStats;
});

// Select folder for import and return all transcript files recursively
ipcMain.handle('import:selectFolder', async () => {
  const { dialog } = require('electron');
  const fs = require('fs').promises;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Folder with Transcripts',
    properties: ['openDirectory'],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return [];
  }

  const folderPath = result.filePaths[0];
  const supportedExtensions = ['.txt', '.md', '.vtt', '.srt'];

  // Recursively find all transcript files in folder
  async function findTranscriptFiles(dir) {
    const files = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          const subFiles = await findTranscriptFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          // Check if file has supported extension
          const ext = path.extname(entry.name).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              files.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
              });
            } catch (error) {
              console.error(`Error getting stats for ${fullPath}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
    }

    return files;
  }

  const transcriptFiles = await findTranscriptFiles(folderPath);
  console.log(`[Import] Found ${transcriptFiles.length} transcript files in folder: ${folderPath}`);

  return transcriptFiles;
});

// ===================================================================
// End Import IPC Handlers
// ===================================================================

// ===================================================================
// Pattern Testing IPC Handlers (Phase 10.8.2)
// ===================================================================

// Read transcript file content (for import preview)
ipcMain.handle(
  'patterns:readFile',
  withValidation(stringIdSchema, async (event, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    } catch (error) {
      logger.main.error('[Patterns] Failed to read file:', error);
      return { success: false, error: error.message };
    }
  })
);

// Test parsing with given patterns and sample text
ipcMain.handle(
  'patterns:testParse',
  withValidation(patternsTestParseSchema, async (event, { content, filePath }) => {
    try {
      const parser = new TranscriptParser();

    // Parse the content (determine format from file extension or content)
    let result;
    if (filePath && filePath.endsWith('.md')) {
      result = await parser.parseMarkdown(content, filePath);
    } else {
      result = await parser.parsePlainText(content, filePath || 'sample.txt');
    }

    // Calculate statistics
    const speakers = parser.getSpeakers(result);
    const totalEntries = result.entries.length;
    const unknownCount = result.entries.filter(e => e.speaker === 'Unknown').length;
    const matchRate = totalEntries > 0 ? ((totalEntries - unknownCount) / totalEntries) * 100 : 0;

    // Get speaker distribution
    const speakerDistribution = speakers.map(speaker => ({
      speaker,
      count: result.entries.filter(e => e.speaker === speaker).length,
    }));

    return {
      success: true,
      result: {
        format: result.format,
        entries: result.entries,
        totalEntries,
        speakers,
        speakerDistribution,
        matchRate: matchRate.toFixed(1),
        unknownCount,
        hasSpeakers: result.hasSpeakers,
        hasTimestamps: result.hasTimestamps,
      },
    };
  } catch (error) {
    logger.main.error('[Patterns] Failed to test parse:', error);
    return { success: false, error: error.message };
  }
  })
);

// Get current pattern configuration
ipcMain.handle('patterns:getConfig', async () => {
  try {
    // PatternConfigLoader is exported as a singleton instance, not a class
    const config = await PatternConfigLoader.loadConfig();

    return {
      success: true,
      config,
    };
  } catch (error) {
    logger.main.error('[Patterns] Failed to load config:', error);
    return { success: false, error: error.message };
  }
});

// Get current pattern configuration as YAML string (for Monaco editor)
ipcMain.handle('patterns:getConfigYaml', async () => {
  try {
    const userConfigPath = path.join(app.getPath('userData'), 'config', 'transcript-patterns.yaml');

    // Read YAML file directly from user config if it exists
    if (fs.existsSync(userConfigPath)) {
      const yamlContent = fs.readFileSync(userConfigPath, 'utf8');
      return {
        success: true,
        yaml: yamlContent,
      };
    } else {
      // If user config doesn't exist, read the default YAML from project
      // In development, app.getAppPath() points to project root
      // In production, it points to app.asar
      const appPath = app.getAppPath();
      const defaultConfigPath = path.join(appPath, 'config', 'transcript-patterns.yaml');

      logger.main.info(`[Patterns] Looking for default config at: ${defaultConfigPath}`);

      if (fs.existsSync(defaultConfigPath)) {
        const yamlContent = fs.readFileSync(defaultConfigPath, 'utf8');
        logger.main.info('[Patterns] Loaded default config from project');
        return {
          success: true,
          yaml: yamlContent,
        };
      } else {
        logger.main.warn('[Patterns] Default config not found at:', defaultConfigPath);
        // Fallback: minimal YAML config
        const fallbackYaml = `# Transcript Pattern Configuration
# Default patterns not found - please create config/transcript-patterns.yaml

patterns: []
settings:
  skipEmptyLines: true
  stripQuotes: true
  combineConsecutiveSpeaker: false
  defaultSpeaker: "Unknown"
  headerStopPatterns:
    emptyLine: true
    nextSpeakerHeader: true
    nextInlineSpeaker: true
    nextTimestamp: true
`;
        return {
          success: true,
          yaml: fallbackYaml,
        };
      }
    }
  } catch (error) {
    logger.main.error('[Patterns] Failed to load config YAML:', error);
    return { success: false, error: error.message };
  }
});

// Save pattern configuration with validation
ipcMain.handle(
  'patterns:saveConfig',
  withValidation(patternsSaveConfigSchema, async (event, { configYaml }) => {
    try {
      const configPath = path.join(app.getPath('userData'), 'config', 'transcript-patterns.yaml');

    // Parse YAML to validate syntax
    let parsedConfig;
    try {
      parsedConfig = yaml.load(configYaml);
    } catch (yamlError) {
      return {
        success: false,
        error: `Invalid YAML syntax: ${yamlError.message}`,
      };
    }

    // Validate structure using PatternConfigLoader
    try {
      // Validate each pattern
      if (parsedConfig.patterns && Array.isArray(parsedConfig.patterns)) {
        for (const pattern of parsedConfig.patterns) {
          PatternConfigLoader.validatePattern(pattern);
        }
      } else {
        return {
          success: false,
          error: 'Config must have a "patterns" array',
        };
      }
    } catch (validationError) {
      return {
        success: false,
        error: `Validation failed: ${validationError.message}`,
      };
    }

    // Ensure config directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write the file
    fs.writeFileSync(configPath, configYaml, 'utf8');

    // Force reload the config
    await PatternConfigLoader.loadConfig(true);

    logger.main.info('[Patterns] Saved pattern configuration');
    return { success: true };
  } catch (error) {
    logger.main.error('[Patterns] Failed to save config:', error);
    return { success: false, error: error.message };
  }
  })
);

// AI Pattern Generation removed (Phase 10.8.3 removed)

// ===================================================================
// End Pattern Testing IPC Handlers
// ===================================================================

// ===================================================================
// Settings IPC Handlers (Phase 10.1)
// ===================================================================

// Get app version information
ipcMain.handle('settings:getAppVersion', async () => {
  return {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    app: app.getVersion(),
  };
});

// Check for updates manually
ipcMain.handle('settings:checkForUpdates', async () => {
  logger.main.info('[AutoUpdater] Manual update check requested');

  if (process.env.ELECTRON_IS_DEV || !app.isPackaged) {
    return {
      success: false,
      message: 'Auto-updates are not available in development mode',
    };
  }

  try {
    // Use electron's autoUpdater to check for updates
    const { autoUpdater: electronAutoUpdater } = require('electron');

    // Set the feed URL for Squirrel.Windows
    const feedURL = `https://update.electronjs.org/jdbrucecpa/jd-notes-things/${process.platform}-${process.arch}/${app.getVersion()}`;
    electronAutoUpdater.setFeedURL({ url: feedURL });

    // Wrap the event-based check in a Promise
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, message: 'Update check timed out' });
      }, 30000);

      const onUpdateAvailable = () => {
        cleanup();
        resolve({
          success: true,
          message: 'Update available! It will be downloaded automatically.',
        });
      };

      const onUpdateNotAvailable = () => {
        cleanup();
        resolve({ success: true, message: 'You are running the latest version' });
      };

      const onError = error => {
        cleanup();
        resolve({ success: false, message: error?.message || 'Update check failed' });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        electronAutoUpdater.removeListener('update-available', onUpdateAvailable);
        electronAutoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        electronAutoUpdater.removeListener('error', onError);
      };

      electronAutoUpdater.on('update-available', onUpdateAvailable);
      electronAutoUpdater.on('update-not-available', onUpdateNotAvailable);
      electronAutoUpdater.on('error', onError);

      electronAutoUpdater.checkForUpdates();
    });
  } catch (error) {
    logger.main.error('[AutoUpdater] Manual update check failed:', error);
    return {
      success: false,
      message: error.message,
    };
  }
});

// Get vault path
ipcMain.handle('settings:getVaultPath', async () => {
  return vaultStructure?.vaultBasePath || null;
});

// Choose vault path with directory picker
ipcMain.handle('settings:chooseVaultPath', async () => {
  const { dialog } = require('electron');

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Obsidian Vault Directory',
    properties: ['openDirectory'],
    buttonLabel: 'Select Vault',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, path: null };
  }

  const selectedPath = result.filePaths[0];

  // Validate that the directory exists
  if (!fs.existsSync(selectedPath)) {
    logger.main.error(`[Settings] Selected vault path does not exist: ${selectedPath}`);
    return { success: false, path: null, error: 'Selected directory does not exist' };
  }

  try {
    // Update vault structure
    if (vaultStructure) {
      vaultStructure.setVaultPath(selectedPath);
    }

    // Save to app settings
    appSettings.vaultPath = selectedPath;
    saveAppSettings();

    logger.main.info(`[Settings] Vault path updated to: ${selectedPath}`);
    return { success: true, path: selectedPath };
  } catch (error) {
    logger.main.error('[Settings] Failed to update vault path:', error);
    return { success: false, path: null, error: error.message };
  }
});

// Get AI provider preferences (Phase 10.3)
ipcMain.handle('settings:getProviderPreferences', async event => {
  // Get settings from renderer's localStorage via webContents
  const preferences = await event.sender.executeJavaScript(`
    (function() {
      try {
        const settings = JSON.parse(localStorage.getItem('jd-notes-settings') || '{}');
        return {
          autoSummaryProvider: settings.autoSummaryProvider || 'azure-gpt-5-mini',
          templateSummaryProvider: settings.templateSummaryProvider || 'azure-gpt-5-mini',
          patternGenerationProvider: settings.patternGenerationProvider || 'openai-gpt-4o-mini'
        };
      } catch (e) {
        return {
          autoSummaryProvider: 'azure-gpt-5-mini',
          templateSummaryProvider: 'azure-gpt-5-mini',
          patternGenerationProvider: 'openai-gpt-4o-mini'
        };
      }
    })()
  `);
  return preferences;
});

// Get user profile (v1.1)
ipcMain.handle('settings:getUserProfile', async () => {
  try {
    return { success: true, profile: userProfile };
  } catch (error) {
    logger.ipc.error('[IPC] settings:getUserProfile failed:', error);
    return { success: false, error: error.message };
  }
});

// Save user profile (v1.1)
ipcMain.handle(
  'settings:saveUserProfile',
  withValidation(userProfileSchema, async (event, profile) => {
    try {
      // Update profile with validated fields
      userProfile = {
        name: String(profile.name || '').trim(),
        email: String(profile.email || '').trim(),
        title: String(profile.title || '').trim(),
        organization: String(profile.organization || '').trim(),
        context: String(profile.context || '').trim(),
      };

      // Save to disk
      saveUserProfile();

      logger.main.info('[v1.1] User profile saved:', {
        name: userProfile.name,
        email: userProfile.email,
        title: userProfile.title,
        organization: userProfile.organization,
        hasContext: !!userProfile.context,
      });

      return { success: true, profile: userProfile };
    } catch (error) {
      logger.ipc.error('[IPC] settings:saveUserProfile failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// Phase 10.7: Desktop App Polish IPC Handlers
// ===================================================================

// Get all app settings
ipcMain.handle('app:getSettings', async () => {
  try {
    return { success: true, data: appSettings };
  } catch (error) {
    logger.ipc.error('[IPC] app:getSettings failed:', error);
    return { success: false, error: error.message };
  }
});

// Update app settings
ipcMain.handle(
  'app:updateSettings',
  withValidation(appSettingsSchema, async (event, updates) => {
    try {
      // Merge updates into current settings
      if (updates.recordingQuality) {
      appSettings.recordingQuality = {
        ...appSettings.recordingQuality,
        ...updates.recordingQuality,
      };
    }
    if (updates.notifications) {
      appSettings.notifications = { ...appSettings.notifications, ...updates.notifications };
    }
    if (updates.shortcuts) {
      // Unregister old shortcuts
      unregisterGlobalShortcuts();

      // Update shortcuts
      appSettings.shortcuts = { ...appSettings.shortcuts, ...updates.shortcuts };

      // Register new shortcuts
      registerGlobalShortcuts();
    }
    // v1.2: Stream Deck settings
    if (updates.streamDeck) {
      appSettings.streamDeck = { ...appSettings.streamDeck, ...updates.streamDeck };
      // Enable/disable Stream Deck WebSocket integration
      expressApp.setStreamDeckEnabled(appSettings.streamDeck.enabled);
      logger.ipc.info(
        `[IPC] Stream Deck integration ${appSettings.streamDeck.enabled ? 'enabled' : 'disabled'}`
      );
    }

    // v1.2: Top-level boolean settings (from General settings tab)
    if (updates.showRecordingWidget !== undefined) {
      appSettings.showRecordingWidget = updates.showRecordingWidget;
    }
    if (updates.autoStartRecording !== undefined) {
      appSettings.autoStartRecording = updates.autoStartRecording;
    }

    // Save to disk
    saveAppSettings();
    logger.ipc.info('[IPC] app:updateSettings - Settings updated successfully');

      return { success: true, data: appSettings };
    } catch (error) {
      logger.ipc.error('[IPC] app:updateSettings failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// v1.2: Get Stream Deck status
ipcMain.handle('app:getStreamDeckStatus', async () => {
  try {
    const status = expressApp.getStreamDeckStatus();
    return {
      success: true,
      data: {
        enabled: status.enabled,
        connectedClients: status.connectedClients,
        port: SERVER_PORT,
        wsEndpoint: WS_STREAMDECK_ENDPOINT,
      },
    };
  } catch (error) {
    logger.ipc.error('[IPC] app:getStreamDeckStatus failed:', error);
    return { success: false, error: error.message };
  }
});

// v1.2: Per-meeting auto-start settings
ipcMain.handle('app:setMeetingAutoStart', async (event, meetingId, enabled) => {
  try {
    // Validate inputs
    validateIpcInput(meetingAutoStartSchema, { meetingId, enabled });

    if (enabled === null) {
      // Remove override (use global setting)
      meetingAutoStartOverrides.delete(meetingId);
    } else {
      meetingAutoStartOverrides.set(meetingId, enabled);
    }
    logger.ipc.info(`[IPC] Per-meeting auto-start set for ${meetingId}: ${enabled}`);
    return { success: true };
  } catch (error) {
    logger.ipc.error('[IPC] app:setMeetingAutoStart failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  'app:getMeetingAutoStart',
  withValidation(stringIdSchema, async (event, meetingId) => {
    try {
      const override = meetingAutoStartOverrides.get(meetingId);
      return { success: true, data: { hasOverride: override !== undefined, enabled: override } };
    } catch (error) {
      logger.ipc.error('[IPC] app:getMeetingAutoStart failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// Get application logs (Phase 10.7)
ipcMain.handle(
  'app:getLogs',
  withValidation(logsOptionsSchema, async (event, options = {}) => {
    try {
      const { limit = 1000, level = 'all' } = options || {};

    // Read log file
    const logPath = log.transports.file.getFile().path;

    if (!fs.existsSync(logPath)) {
      return { success: true, data: { logs: [], logPath } };
    }

    const logContent = fs.readFileSync(logPath, 'utf8');
    const logLines = logContent.split('\n').filter(line => line.trim().length > 0);

    // Filter by level if specified
    let filteredLogs = logLines;
    if (level !== 'all') {
      filteredLogs = logLines.filter(line => line.includes(`[${level}]`));
    }

    // Get last N lines
    const recentLogs = filteredLogs.slice(-limit);

    return {
      success: true,
      data: {
        logs: recentLogs,
        logPath,
        totalLines: logLines.length,
        filteredLines: filteredLogs.length,
      },
    };
    } catch (error) {
      logger.ipc.error('[IPC] app:getLogs failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// Clear logs (Phase 10.7)
ipcMain.handle('app:clearLogs', async () => {
  try {
    const logPath = log.transports.file.getFile().path;

    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '', 'utf8');
      logger.ipc.info('[IPC] app:clearLogs - Log file cleared');
    }

    return { success: true };
  } catch (error) {
    logger.ipc.error('[IPC] app:clearLogs failed:', error);
    return { success: false, error: error.message };
  }
});

// Open log file in default editor (Phase 10.7)
ipcMain.handle('app:openLogFile', async () => {
  try {
    const logPath = log.transports.file.getFile().path;
    await shell.openPath(logPath);
    return { success: true };
  } catch (error) {
    logger.ipc.error('[IPC] app:openLogFile failed:', error);
    return { success: false, error: error.message };
  }
});

// Settings Export - SE-1
ipcMain.handle('settings:exportPreview', async () => {
  try {
    const settingsExportService = require('./main/services/settingsExportService');
    const preview = await settingsExportService.getExportPreview();
    return { success: true, data: preview };
  } catch (error) {
    logger.ipc.error('[IPC] settings:exportPreview failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:export', async () => {
  try {
    const { dialog } = require('electron');
    const settingsExportService = require('./main/services/settingsExportService');

    // Generate default filename
    const defaultFilename = settingsExportService.generateExportFilename();

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Settings',
      defaultPath: defaultFilename,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    // Export to the selected path
    const exportResult = await settingsExportService.exportToZip(result.filePath);
    return exportResult;
  } catch (error) {
    logger.ipc.error('[IPC] settings:export failed:', error);
    return { success: false, error: error.message };
  }
});

// Settings Import - SE-2
ipcMain.handle(
  'settings:importValidate',
  withValidation(stringIdSchema, async (event, zipPath) => {
    try {
      const settingsExportService = require('./main/services/settingsExportService');
      const validation = await settingsExportService.validateImportFile(zipPath);
      return { success: true, data: validation };
    } catch (error) {
      logger.ipc.error('[IPC] settings:importValidate failed:', error);
      return { success: false, error: error.message };
    }
  })
);

ipcMain.handle(
  'settings:import',
  withValidation(importOptionsSchema, async (event, options = {}) => {
    try {
      const { dialog } = require('electron');
      const settingsExportService = require('./main/services/settingsExportService');

    // Show open dialog
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Settings',
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const zipPath = result.filePaths[0];

    // Validate before import
    const validation = await settingsExportService.validateImportFile(zipPath);
    if (!validation.valid) {
      return { success: false, error: `Invalid settings file: ${validation.error}` };
    }

      // Import with provided options
      const importResult = await settingsExportService.importFromZip(zipPath, options || {});
      return importResult;
    } catch (error) {
      logger.ipc.error('[IPC] settings:import failed:', error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// End Settings IPC Handlers
// ===================================================================

// ===================================================================
// Key Management IPC Handlers (Phase 10.2)
// ===================================================================

// List all API keys (returns obfuscated values)
ipcMain.handle('keys:list', async () => {
  try {
    const keys = await keyManagementService.listKeys();

    // Get obfuscated values for keys that exist
    const keysWithValues = await Promise.all(
      keys.map(async key => {
        if (key.hasValue) {
          const value = await keyManagementService.getKey(key.key);
          return {
            ...key,
            obfuscatedValue: keyManagementService.obfuscateKey(value),
          };
        }
        return { ...key, obfuscatedValue: null };
      })
    );

    return { success: true, data: keysWithValues };
  } catch (error) {
    log.error('[IPC] keys:list failed:', error);
    return { success: false, error: error.message };
  }
});

// Get a specific API key
ipcMain.handle(
  'keys:get',
  withValidation(keyNameSchema, async (event, keyName) => {
    try {
      const value = await keyManagementService.getKey(keyName);
      return { success: true, data: value };
    } catch (error) {
      log.error(`[IPC] keys:get failed for ${keyName}:`, error);
      return { success: false, error: error.message };
    }
  })
);

// Set an API key
ipcMain.handle(
  'keys:set',
  withValidation(keyNameSchema, async (event, keyName, value) => {
    try {
      // Validate key format
      const validation = keyManagementService.validateKey(keyName, value);
      if (!validation.valid) {
        return { success: false, error: validation.message };
      }

      await keyManagementService.setKey(keyName, value);
      return { success: true };
    } catch (error) {
      log.error(`[IPC] keys:set failed for ${keyName}:`, error);
      return { success: false, error: error.message };
    }
  })
);

// Delete an API key
ipcMain.handle(
  'keys:delete',
  withValidation(keyNameSchema, async (event, keyName) => {
    try {
      const deleted = await keyManagementService.deleteKey(keyName);
      return { success: true, data: deleted };
    } catch (error) {
      log.error(`[IPC] keys:delete failed for ${keyName}:`, error);
      return { success: false, error: error.message };
    }
  })
);

// Migrate keys from .env to Credential Manager
ipcMain.handle('keys:migrate', async () => {
  try {
    const envVars = process.env;
    const results = await keyManagementService.migrateFromEnv(envVars);
    return { success: true, data: results };
  } catch (error) {
    log.error('[IPC] keys:migrate failed:', error);
    return { success: false, error: error.message };
  }
});

// Test an API key by making a test request
ipcMain.handle(
  'keys:test',
  withValidation(keyNameSchema, async (event, keyName) => {
    try {
      // This is a placeholder - actual implementation would test the key with the service
      // For now, we just validate format
      const value = await keyManagementService.getKey(keyName);
      if (!value) {
        return { success: false, error: 'Key not found' };
      }

      const validation = keyManagementService.validateKey(keyName, value);
      return { success: validation.valid, message: validation.message };
    } catch (error) {
      log.error(`[IPC] keys:test failed for ${keyName}:`, error);
      return { success: false, error: error.message };
    }
  })
);

// ===================================================================
// End Key Management IPC Handlers
// ===================================================================

// ===================================================================
// Encryption IPC Handlers (Phase 10.2) - REMOVED
// ===================================================================
// Vault file encryption removed per user request - Obsidian needs plain text files
// EncryptionService kept for potential future use (audio files, temp files, etc.)
// ===================================================================

// Handle open-external IPC (for opening URLs in default browser)
ipcMain.on('open-external', (event, url) => {
  console.log('[IPC] open-external called with url:', url);
  require('electron').shell.openExternal(url);
});

// Handle toggle-dev-tools IPC (for custom titlebar menu)
ipcMain.on('toggle-dev-tools', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.webContents.toggleDevTools();
  }
});

// ===================================================================
// Window Control IPC Handlers (Custom Title Bar)
// ===================================================================
ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window:isMaximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

// ===================================================================
// Recording Widget IPC Handlers (v1.2)
// ===================================================================

// Hide the recording widget
ipcMain.on('widget:hide', () => {
  hideRecordingWidget();
});

// Open meeting in main app from widget
ipcMain.on('widget:open-meeting', (_event, meetingId) => {
  // Validate input - meetingId should be a non-empty string
  if (typeof meetingId !== 'string' || !meetingId.trim()) {
    logger.main.warn('[Widget] Invalid meetingId for open-meeting:', meetingId);
    return;
  }
  logger.main.info('[Widget] Open meeting requested:', meetingId);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Show and focus the main window
    mainWindow.show();
    mainWindow.focus();
    // Tell renderer to open the meeting note
    mainWindow.webContents.send('open-meeting-note', meetingId);
  }
});

// Request state sync from widget
ipcMain.on('widget:request-sync', _event => {
  if (recordingWidget && !recordingWidget.isDestroyed()) {
    recordingWidget.webContents.send('widget:update', {
      type: 'sync-state',
      isRecording: isRecording,
      startTime: recordingStartTime,
      meetingTitle: currentRecordingMeetingTitle,
    });
  }
});

// Start recording from widget
ipcMain.handle('widget:start-recording', async (event, meetingId) => {
  // Validate meetingId - can be null/undefined (for new recordings) or a valid string
  try {
    validateIpcInput(widgetStartRecordingSchema, meetingId);
  } catch (validationError) {
    logger.main.warn('[Widget] Invalid meetingId:', validationError.message);
    return { success: false, error: validationError.message };
  }

  logger.main.info('[Widget] Start recording requested for meeting:', meetingId);

  try {
    // Get transcription provider from settings
    const transcriptionProvider = appSettings.transcriptionProvider || 'assemblyai';

    // Use the existing manual recording flow
    // First, we need to create a meeting note if meetingId is a calendar event ID
    const result = await new Promise(resolve => {
      // Emit to main window to create meeting and start recording
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('widget:create-and-record', {
          calendarMeetingId: meetingId,
          transcriptionProvider: transcriptionProvider,
        });

        // Listen for response
        ipcMain.once('widget:recording-result', (e, res) => {
          resolve(res);
        });

        // Timeout after 30 seconds
        setTimeout(
          () => resolve({ success: false, error: 'Timeout waiting for recording to start' }),
          30000
        );
      } else {
        resolve({ success: false, error: 'Main window not available' });
      }
    });

    if (result.success) {
      updateWidgetRecordingState(true, result.meetingTitle);
    }

    return result;
  } catch (error) {
    logger.main.error('[Widget] Failed to start recording:', error);
    return { success: false, error: error.message };
  }
});

// Stop recording from widget - just tells renderer to click the stop button
ipcMain.handle('widget:stop-recording', async () => {
  logger.main.info('[Widget] Stop recording requested');

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Tell renderer to stop recording using its existing logic
      mainWindow.webContents.send('widget:stop-recording-request');

      const result = await new Promise(resolve => {
        ipcMain.once('widget:stop-recording-result', (e, res) => {
          resolve(res);
        });
        // Timeout after 30 seconds
        setTimeout(() => resolve({ success: false, error: 'Timeout' }), 30000);
      });

      if (result.success) {
        updateWidgetRecordingState(false);
      }

      return result;
    }

    return { success: false, error: 'Main window not available' };
  } catch (error) {
    logger.main.error('[Widget] Failed to stop recording:', error);
    return { success: false, error: error.message };
  }
});

// Show recording widget (called from main window or auto-start logic)
ipcMain.on('widget:show', (event, meetingInfo) => {
  // Validate meetingInfo if provided
  if (meetingInfo !== null && meetingInfo !== undefined) {
    try {
      validateIpcInput(widgetMeetingInfoSchema, meetingInfo);
    } catch (validationError) {
      logger.main.warn('[Widget] Invalid meetingInfo, showing without context:', validationError.message);
      showRecordingWidget(null);
      return;
    }
  }
  showRecordingWidget(meetingInfo);
});

// v1.2: Toggle widget visibility (show/hide)
ipcMain.handle('widget:toggle', () => {
  if (recordingWidget && !recordingWidget.isDestroyed() && recordingWidget.isVisible()) {
    hideRecordingWidget();
    return { success: true, visible: false };
  } else {
    showRecordingWidget(null); // Show in standalone mode
    return { success: true, visible: true };
  }
});

// v1.2: Toggle always-on-top setting for widget
ipcMain.handle('widget:toggleAlwaysOnTop', (event, enabled) => {
  // Validate input - must be a boolean
  try {
    validateIpcInput(widgetToggleAlwaysOnTopSchema, enabled);
  } catch (validationError) {
    logger.main.warn('[Widget] Invalid enabled value:', validationError.message);
    return { success: false, error: validationError.message };
  }

  if (recordingWidget && !recordingWidget.isDestroyed()) {
    const newState = enabled;
    recordingWidget.setAlwaysOnTop(newState);
    logger.main.info(`[Widget] Always-on-top ${newState ? 'enabled' : 'disabled'}`);

    // Notify widget of the change
    recordingWidget.webContents.send('widget:update', {
      type: 'always-on-top-changed',
      enabled: newState,
    });

    return { success: true, alwaysOnTop: newState };
  }
  return { success: false, error: 'Widget not available' };
});

// v1.2: Get widget state (visibility, always-on-top)
ipcMain.handle('widget:getState', () => {
  if (recordingWidget && !recordingWidget.isDestroyed()) {
    return {
      success: true,
      visible: recordingWidget.isVisible(),
      alwaysOnTop: recordingWidget.isAlwaysOnTop(),
    };
  }
  return { success: true, visible: false, alwaysOnTop: true };
});

// Handler to get active recording ID for a note
ipcMain.handle(
  'getActiveRecordingId',
  withValidation(optionalStringSchema, async (event, noteId) => {
    console.log(`getActiveRecordingId called for note: ${noteId}`);

    try {
      // If noteId is provided, get recording for that specific note
      if (noteId) {
        const recordingInfo = activeRecordings.getForNote(noteId);
        return {
          success: true,
          data: recordingInfo,
        };
      }

      // Otherwise return all active recordings
      return {
        success: true,
        data: activeRecordings.getAll(),
      };
    } catch (error) {
      console.error('Error getting active recording ID:', error);
      return { success: false, error: error.message };
    }
  })
);

// Handle deleting a meeting
ipcMain.handle('deleteMeeting', async (event, meetingId) => {
  try {
    // Validate meetingId
    const validatedId = MeetingIdSchema.parse(meetingId);
    console.log(`Deleting meeting with ID: ${validatedId}`);

    // Read current data
    const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
    const meetingsData = JSON.parse(fileData);

    // Find the meeting
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(
      meeting => meeting.id === validatedId
    );
    const upcomingMeetingIndex = meetingsData.upcomingMeetings.findIndex(
      meeting => meeting.id === validatedId
    );

    let meetingDeleted = false;
    let recordingId = null;

    // Remove from past meetings if found
    if (pastMeetingIndex !== -1) {
      // Store the recording ID for later cleanup if needed
      recordingId = meetingsData.pastMeetings[pastMeetingIndex].recordingId;

      // Remove the meeting
      meetingsData.pastMeetings.splice(pastMeetingIndex, 1);
      meetingDeleted = true;
    }

    // Remove from upcoming meetings if found
    if (upcomingMeetingIndex !== -1) {
      // Store the recording ID for later cleanup if needed
      recordingId = meetingsData.upcomingMeetings[upcomingMeetingIndex].recordingId;

      // Remove the meeting
      meetingsData.upcomingMeetings.splice(upcomingMeetingIndex, 1);
      meetingDeleted = true;
    }

    if (!meetingDeleted) {
      return { success: false, error: 'Meeting not found' };
    }

    // Save the updated data
    await fileOperationManager.writeData(meetingsData);

    // If the meeting had a recording, cleanup the reference in the global tracking
    if (recordingId && global.activeMeetingIds && global.activeMeetingIds[recordingId]) {
      console.log(`Cleaning up tracking for deleted meeting with recording ID: ${recordingId}`);
      delete global.activeMeetingIds[recordingId];
    }

    console.log(`Successfully deleted meeting: ${validatedId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Invalid meeting ID format:', error.message);
      return { success: false, error: `Invalid meeting ID format: ${error.message}` };
    }
    console.error('Error deleting meeting:', error);
    return { success: false, error: error.message };
  }
});

// Handle generating AI summary for a meeting (non-streaming)
ipcMain.handle('generateMeetingSummary', async (event, meetingId) => {
  // Validate meetingId
  try {
    validateIpcInput(stringIdSchema, meetingId);
  } catch (validationError) {
    return { success: false, error: validationError.message };
  }

  console.log(`Manual summary generation requested for meeting: ${meetingId}`);

  return await withProviderSwitch(
    'auto',
    async () => {
      // Read current data
      const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      const meetingsData = JSON.parse(fileData);

      // Find the meeting
      const pastMeetingIndex = meetingsData.pastMeetings.findIndex(
        meeting => meeting.id === meetingId
      );

      if (pastMeetingIndex === -1) {
        return { success: false, error: 'Meeting not found' };
      }

      const meeting = meetingsData.pastMeetings[pastMeetingIndex];

      // Check if there's a transcript to summarize
      if (!meeting.transcript || meeting.transcript.length === 0) {
        return {
          success: false,
          error: 'No transcript available for this meeting',
        };
      }

      // Log summary generation to console instead of showing a notification
      console.log('Generating AI summary for meeting: ' + meetingId);

      // Generate the summary
      const summary = await generateMeetingSummary(meeting);

      // Get meeting title for use in the new content
      const meetingTitle = meeting.title || 'Meeting Notes';

      // Get recording ID
      const recordingId = meeting.recordingId;

      // Check for different possible video file patterns
      const possibleFilePaths = recordingId
        ? [
            path.join(RECORDING_PATH, `${recordingId}.mp4`),
            path.join(RECORDING_PATH, `macos-desktop-${recordingId}.mp4`),
            path.join(RECORDING_PATH, `macos-desktop${recordingId}.mp4`),
            path.join(RECORDING_PATH, `desktop-${recordingId}.mp4`),
          ]
        : [];

      // Find the first video file that exists
      let videoExists = false;
      let videoFilePath = null;

      try {
        for (const filePath of possibleFilePaths) {
          if (fs.existsSync(filePath)) {
            videoExists = true;
            videoFilePath = filePath;
            console.log(`Found video file at: ${videoFilePath}`);
            break;
          }
        }
      } catch (err) {
        console.error('Error checking for video files:', err);
      }

      // Create content with the AI-generated summary
      meeting.content = `# ${meetingTitle}\n\n${summary}`;

      // If video exists, store the path separately but don't add it to the content
      if (videoExists) {
        meeting.videoPath = videoFilePath; // Store the path for future reference
        console.log(`Stored video path in meeting object: ${videoFilePath}`);
      } else {
        console.log('Video file not found or no recording ID');
      }

      meeting.hasSummary = true;

      // Save the updated data with summary
      await fileOperationManager.writeData(meetingsData);

      console.log('Updated meeting note with AI summary');

      // Notify the renderer to refresh the note if it's open
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('summary-generated', meetingId);
      }

      return {
        success: true,
        summary,
      };
    },
    '[RegenerateSummary]'
  ).catch(error => {
    console.error('Error generating meeting summary:', error);
    return { success: false, error: error.message };
  });
});

// Handle starting a manual desktop recording
ipcMain.handle(
  'startManualRecording',
  async (event, meetingId, transcriptionProvider = 'assemblyai', action = 'new') => {
    try {
      // Validate meetingId
      const validatedId = MeetingIdSchema.parse(meetingId);
      console.log(`Starting manual desktop recording for meeting: ${validatedId}`);
      console.log(`Using transcription provider: ${transcriptionProvider}`);
      console.log(`Recording action: ${action}`);

      // Read current data using the file operation manager to ensure we get the latest cached data
      const meetingsData = await fileOperationManager.readMeetingsData();

      // Find the meeting
      const pastMeetingIndex = meetingsData.pastMeetings.findIndex(
        meeting => meeting.id === validatedId
      );

      if (pastMeetingIndex === -1) {
        return { success: false, error: 'Meeting not found' };
      }

      const meeting = meetingsData.pastMeetings[pastMeetingIndex];

      // If action is 'append', save the existing transcript
      if (action === 'append' && meeting.transcript && meeting.transcript.length > 0) {
        console.log(
          `[Recording] Saving ${meeting.transcript.length} existing transcript entries for append`
        );
        meeting.previousTranscript = meeting.transcript;
        meeting.recordingAction = 'append';
      } else if (action === 'overwrite') {
        console.log('[Recording] Will overwrite existing transcript');
        meeting.recordingAction = 'overwrite';
      } else {
        console.log('[Recording] New recording (no existing transcript)');
        meeting.recordingAction = 'new';
      }

      try {
        // Prepare desktop audio recording - this is the key difference from our previous implementation
        // It returns a key that we use as the window ID

        // Log the prepareDesktopAudioRecording API call
        sdkLogger.logApiCall('prepareDesktopAudioRecording');

        const key = await RecallAiSdk.prepareDesktopAudioRecording();
        console.log(
          'Prepared desktop audio recording with key:',
          typeof key === 'string' ? key.substring(0, 8) + '...' : key
        );

        // Create a recording token
        const uploadData = await createDesktopSdkUpload();
        if (!uploadData || !uploadData.upload_token) {
          const errorMsg = uploadData?.error || 'Failed to create recording token';
          console.error('[Recording] Upload token creation failed:', errorMsg);
          return { success: false, error: errorMsg };
        }

        // Store the recording ID and upload token in the meeting
        meeting.recordingId = key;
        meeting.uploadToken = uploadData.upload_token; // Store for later matching
        meeting.sdkUploadId = uploadData.id; // Store SDK Upload ID for webhook matching
        meeting.recallRecordingId = uploadData.recording_id; // Store Recall Recording ID
        meeting.transcriptionProvider = transcriptionProvider; // Store transcription provider
        console.log(`[Upload] Saving IDs for manual recording ${validatedId}:`);
        console.log(`  - recordingId (SDK window): ${key.substring(0, 8)}...`);
        console.log(`  - uploadToken: ${uploadData.upload_token.substring(0, 8)}...`);
        console.log(`  - sdkUploadId: ${uploadData.id}`);
        console.log(`  - recallRecordingId: ${uploadData.recording_id}`);
        console.log(`  - transcriptionProvider: ${transcriptionProvider}`);

        // Initialize transcript array if not present
        if (!meeting.transcript) {
          meeting.transcript = [];
        }

        // UI-1: Set platform from detected meeting if available, otherwise default to in-person
        if (!meeting.platform) {
          if (detectedMeeting?.window?.platform) {
            meeting.platform = detectedMeeting.window.platform;
            console.log(
              `[Recording] UI-1: Setting platform from detected meeting: ${meeting.platform}`
            );
          } else {
            meeting.platform = 'in-person';
            console.log('[Recording] UI-1: No detected meeting, defaulting to in-person');
          }
        }

        // Store tracking info for the recording
        global.activeMeetingIds = global.activeMeetingIds || {};
        global.activeMeetingIds[key] = {
          platformName: 'Desktop Recording',
          noteId: validatedId,
        };

        // Register the recording in our active recordings tracker
        activeRecordings.addRecording(key, validatedId, 'Desktop Recording');

        // Save the updated data
        console.log(`[Upload] Writing meetingsData with uploadToken for meeting ${validatedId}...`);
        await fileOperationManager.writeData(meetingsData);
        console.log(`[Upload] ✓ Completed writing meetingsData for meeting ${validatedId}`);

        // Start recording with the key from prepareDesktopAudioRecording
        console.log(
          'Starting desktop recording with key:',
          typeof key === 'string' ? key.substring(0, 8) + '...' : key
        );

        // Log the startRecording API call
        sdkLogger.logApiCall('startRecording', {
          windowId: key,
          uploadToken: `${uploadData.upload_token.substring(0, 8)}...`, // Log truncated token for security
        });

        try {
          // Await the startRecording call to catch errors (e.g., 401 authentication failures)
          await RecallAiSdk.startRecording({
            windowId: key,
            uploadToken: uploadData.upload_token,
          });

          console.log('✓ RecallAI SDK startRecording succeeded');

          // SM-1: Initialize speech timeline for speaker matching
          initializeSpeechTimeline(key, Date.now());

          // Update recording state and tray menu (Phase 10.7)
          isRecording = true;
          updateSystemTrayMenu();

          // v1.2: Update widget with recording state
          updateWidgetRecordingState(true, meeting.title);

          // v1.2: Notify Stream Deck clients
          expressApp.updateStreamDeckRecordingState(true, meeting.title);

          return {
            success: true,
            recordingId: key,
            meetingTitle: meeting.title,
          };
        } catch (startRecordingError) {
          console.error('✗ RecallAI SDK startRecording failed:', startRecordingError);
          return {
            success: false,
            error: `Failed to start recording: ${startRecordingError.message || startRecordingError}`,
          };
        }
      } catch (sdkError) {
        console.error('RecallAI SDK error:', sdkError);
        return {
          success: false,
          error: 'Failed to prepare desktop recording: ' + sdkError.message,
        };
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('Invalid meeting ID format:', error.message);
        return { success: false, error: `Invalid meeting ID format: ${error.message}` };
      }
      console.error('Error starting manual recording:', error);
      return { success: false, error: error.message };
    }
  }
);

// Handle stopping a manual desktop recording
ipcMain.handle('stopManualRecording', async (event, recordingId) => {
  try {
    // Validate recordingId
    const validatedId = RecordingIdSchema.parse(recordingId);
    console.log(`Stopping manual desktop recording: ${validatedId}`);

    // Stop the recording - using the windowId property as shown in the reference

    // Log the stopRecording API call
    sdkLogger.logApiCall('stopRecording', {
      windowId: validatedId,
    });

    // Update our active recordings tracker
    activeRecordings.updateState(validatedId, 'stopping');

    try {
      RecallAiSdk.stopRecording({
        windowId: validatedId,
      });

      // The recording-ended event will be triggered automatically,
      // which will handle uploading and generating the summary

      return { success: true };
    } catch (sdkError) {
      // If recording doesn't exist in SDK, it may have already been stopped
      // This can happen when using AssemblyAI/Deepgram where recording ends automatically
      console.warn(
        `SDK stopRecording failed: ${sdkError.message} - recording may have already ended`
      );

      // Clean up our tracking
      activeRecordings.removeRecording(validatedId);

      // Return success since the recording is already stopped
      return { success: true, warning: 'Recording was already stopped' };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Invalid recording ID format:', error.message);
      return { success: false, error: `Invalid recording ID format: ${error.message}` };
    }
    console.error('Error stopping manual recording:', error);
    return { success: false, error: error.message };
  }
});

// ===== WEBHOOK EVENT HANDLERS =====

// Export webhook handlers for server.js to call directly
// (server.js runs in main process, so we can call these directly instead of using IPC)
global.webhookHandlers = {
  handleUploadComplete: async ({ recordingId, sdkUploadId }) => {
    console.log(
      `[Webhook] Upload complete - SDK Upload ID: ${sdkUploadId}, Recording ID: ${recordingId}`
    );

    try {
      // Find the meeting by matching the SDK Upload ID
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.sdkUploadId === sdkUploadId);

      if (!meeting) {
        console.error(`[Webhook] No meeting found for SDK Upload ID: ${sdkUploadId}`);
        console.error(`[Webhook] Checked ${meetingsData.pastMeetings.length} past meetings`);
        return;
      }

      console.log(`[Webhook] Found meeting: ${meeting.id} (${meeting.title})`);

      // Verify the recording ID matches (it should since we stored it)
      if (meeting.recallRecordingId !== recordingId) {
        console.warn(
          `[Webhook] Recording ID mismatch! Stored: ${meeting.recallRecordingId}, Webhook: ${recordingId}`
        );
      }

      await fileOperationManager.writeData(meetingsData);
      console.log(`[Webhook] Confirmed upload complete for meeting ${meeting.id}`);

      // Start async transcription
      await startRecallAIAsyncTranscription(recordingId, meeting.recordingId);
    } catch (error) {
      console.error('[Webhook] Error handling upload complete:', error);
    }
  },

  handleTranscriptDone: async ({ transcriptId, recordingId }) => {
    console.log(`[Webhook] Transcript ready. ID: ${transcriptId}, Recording: ${recordingId}`);

    try {
      const RECALLAI_API_URL =
        (await keyManagementService.getKey('RECALLAI_API_URL')) ||
        process.env.RECALLAI_API_URL ||
        'https://api.recall.ai';
      const RECALLAI_API_KEY =
        (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

      // Fetch the transcript
      const response = await axios.get(`${RECALLAI_API_URL}/api/v1/transcript/${transcriptId}/`, {
        headers: { Authorization: `Token ${RECALLAI_API_KEY}` },
      });

      const transcript = response.data;
      console.log(`[Webhook] Fetched transcript. Status: ${transcript.status?.code}`);

      // Find the meeting
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.recallRecordingId === recordingId);

      if (!meeting) {
        console.error(`[Webhook] No meeting found for recording: ${recordingId}`);
        return;
      }

      // Process the transcript
      if (transcript.words && transcript.words.length > 0) {
        console.log(`[Webhook] Processing transcript with ${transcript.words.length} words`);
        await processRecallAITranscript(transcript, meeting.id, meeting.recordingId);
      } else if (transcript.data?.download_url) {
        console.log(`[Webhook] Downloading transcript from URL`);
        const transcriptData = await axios.get(transcript.data.download_url);
        await processRecallAITranscript(transcriptData.data, meeting.id, meeting.recordingId);
      } else {
        throw new Error('Transcript has no words data or download URL');
      }

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcript-ready', {
          meetingId: meeting.id,
          transcriptId,
        });
      }

      console.log(`[Webhook] ✓ Transcript processed successfully for meeting ${meeting.id}`);
    } catch (error) {
      console.error('[Webhook] Error handling transcript done:', error);
    }
  },

  handleTranscriptFailed: async ({ transcriptId: _transcriptId, recordingId, error }) => {
    console.error(`[Webhook] Transcript failed for recording: ${recordingId}`, error);

    try {
      // Find the meeting and update status
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.recallRecordingId === recordingId);

      if (meeting) {
        meeting.transcriptError = error;
        meeting.transcriptStatus = 'failed';
        await fileOperationManager.writeData(meetingsData);

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transcript-failed', {
            meetingId: meeting.id,
            error,
          });
        }
      }
    } catch (err) {
      console.error('[Webhook] Error handling transcript failed:', err);
    }
  },
};

// Keep old IPC handlers for backwards compatibility (in case renderer sends events)
ipcMain.on('webhook-upload-complete', async (event, data) => {
  await global.webhookHandlers.handleUploadComplete(data);
});

// Handle transcript done webhook
ipcMain.on('webhook-transcript-done', async (event, { transcriptId, recordingId }) => {
  console.log(`[Webhook] Transcript ready. ID: ${transcriptId}, Recording: ${recordingId}`);

  try {
    const RECALLAI_API_URL =
      (await keyManagementService.getKey('RECALLAI_API_URL')) ||
      process.env.RECALLAI_API_URL ||
      'https://api.recall.ai';
    const RECALLAI_API_KEY =
      (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

    // Fetch the transcript
    const response = await axios.get(`${RECALLAI_API_URL}/api/v1/transcript/${transcriptId}/`, {
      headers: { Authorization: `Token ${RECALLAI_API_KEY}` },
    });

    const transcript = response.data;
    console.log(`[Webhook] Fetched transcript. Status: ${transcript.status?.code}`);

    // Find the meeting
    const meetingsData = await fileOperationManager.readMeetingsData();
    const meeting = meetingsData.pastMeetings.find(m => m.recallRecordingId === recordingId);

    if (!meeting) {
      console.error(`[Webhook] No meeting found for recording: ${recordingId}`);
      return;
    }

    // Process the transcript
    if (transcript.words && transcript.words.length > 0) {
      console.log(`[Webhook] Processing transcript with ${transcript.words.length} words`);
      await processRecallAITranscript(transcript, meeting.id, meeting.recordingId);
    } else if (transcript.data?.download_url) {
      console.log(`[Webhook] Downloading transcript from URL`);
      const transcriptData = await axios.get(transcript.data.download_url);
      await processRecallAITranscript(transcriptData.data, meeting.id, meeting.recordingId);
    } else {
      throw new Error('Transcript has no words data or download URL');
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcript-ready', {
        meetingId: meeting.id,
        transcriptId,
      });
    }

    console.log(`[Webhook] ✓ Transcript processed successfully for meeting ${meeting.id}`);
  } catch (error) {
    console.error('[Webhook] Error handling transcript done:', error);
  }
});

// Handle transcript failed webhook
ipcMain.on(
  'webhook-transcript-failed',
  async (event, { transcriptId: _transcriptId, recordingId, error }) => {
    console.error(`[Webhook] Transcript failed for recording: ${recordingId}`, error);

    try {
      // Find the meeting and update status
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.recallRecordingId === recordingId);

      if (meeting) {
        meeting.transcriptError = error;
        meeting.transcriptStatus = 'failed';
        await fileOperationManager.writeData(meetingsData);

        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transcript-failed', {
            meetingId: meeting.id,
            error,
          });
        }
      }
    } catch (err) {
      console.error('[Webhook] Error handling transcript failure:', err);
    }
  }
);

// Handle upload failed webhook
ipcMain.on('webhook-upload-failed', async (event, { recordingId, error }) => {
  console.error(`[Webhook] Upload failed for recording: ${recordingId}`, error);

  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('upload-failed', {
      recordingId,
      error,
    });
  }
});

// Handle generating AI summary with streaming
ipcMain.handle(
  'generateMeetingSummaryStreaming',
  withValidation(stringIdSchema, async (event, meetingId) => {
    try {
      console.log(`Streaming summary generation requested for meeting: ${meetingId}`);

    // Read current data
    const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
    const meetingsData = JSON.parse(fileData);

    // Find the meeting
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(
      meeting => meeting.id === meetingId
    );

    if (pastMeetingIndex === -1) {
      return { success: false, error: 'Meeting not found' };
    }

    const meeting = meetingsData.pastMeetings[pastMeetingIndex];

    // Check if there's a transcript to summarize
    if (!meeting.transcript || meeting.transcript.length === 0) {
      return {
        success: false,
        error: 'No transcript available for this meeting',
      };
    }

    // Log summary generation to console instead of showing a notification
    console.log('Generating streaming summary for meeting: ' + meetingId);

    // Get meeting title for use in the new content
    const meetingTitle = meeting.title || 'Meeting Notes';

    // Initial content with placeholders
    meeting.content = `# ${meetingTitle}\n\nGenerating summary...`;

    // Update the note on the frontend right away
    mainWindow.webContents.send('summary-update', {
      meetingId,
      content: meeting.content,
    });

    // Create progress callback for streaming updates
    const streamProgress = currentText => {
      // Update content with current streaming text
      meeting.content = `# ${meetingTitle}\n\n## AI-Generated Meeting Summary\n${currentText}`;

      // Send immediate update to renderer - don't debounce or delay this
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          // Force immediate send of the update
          mainWindow.webContents.send('summary-update', {
            meetingId,
            content: meeting.content,
            timestamp: Date.now(), // Add timestamp to ensure uniqueness
          });
        } catch (err) {
          console.error('Error sending streaming update to renderer:', err);
        }
      }
    };

    // Generate summary with streaming
    const summary = await generateMeetingSummary(meeting, streamProgress);

    // Make sure the final content is set correctly
    meeting.content = `# ${meetingTitle}\n\n${summary}`;
    meeting.hasSummary = true;

    // Save the updated data with summary
    await fileOperationManager.writeData(meetingsData);

    console.log('Updated meeting note with AI summary (streaming)');

    // Final notification to renderer
    mainWindow.webContents.send('summary-generated', meetingId);

      return {
        success: true,
        summary,
      };
    } catch (error) {
      console.error('Error generating streaming summary:', error);
      return { success: false, error: error.message };
    }
  })
);

// Handle manual transcript fetch for a meeting
ipcMain.handle(
  'fetchTranscript',
  withValidation(stringIdSchema, async (event, meetingId) => {
  try {
    console.log(`[IPC] Manual transcript fetch requested for meeting: ${meetingId}`);

    // Read current meetings data
    const data = await fileOperationManager.readMeetingsData();

    // Find the meeting
    const meeting = data.pastMeetings.find(m => m.id === meetingId);

    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    if (!meeting.recordingId) {
      throw new Error('Meeting does not have a recording ID - no recording was made');
    }

    if (!meeting.uploadToken) {
      throw new Error('Meeting does not have an upload token - upload not completed');
    }

    // Check if transcript already exists
    if (meeting.transcript && meeting.transcript.length > 0) {
      console.log('[IPC] Transcript already exists for this meeting');
      return {
        success: true,
        message: 'Transcript already exists',
        hasTranscript: true,
      };
    }

    console.log(`[IPC] Starting transcript fetch for recordingId: ${meeting.recordingId}`);

    // Start polling for transcript in background
    // We don't await this - let it run async
    pollRecallAITranscript(meeting.recordingId, meeting.recordingId, meetingId)
      .then(() => {
        console.log(`[IPC] Transcript fetch completed for meeting: ${meetingId}`);
      })
      .catch(error => {
        console.error(`[IPC] Transcript fetch failed for meeting ${meetingId}:`, error);
      });

    return {
      success: true,
      message: 'Transcript fetch started - check logs for progress',
    };
    } catch (error) {
      console.error('[IPC] Error starting transcript fetch:', error);
      return { success: false, error: error.message };
    }
  })
);

// Handle loading meetings data
ipcMain.handle('loadMeetingsData', async () => {
  try {
    // Use our file operation manager to safely read the data
    const data = await fileOperationManager.readMeetingsData();

    // Return the data
    return {
      success: true,
      data: data,
    };
  } catch (error) {
    console.error('Failed to load meetings data:', error);
    return { success: false, error: error.message };
  }
});

// Function to create a new meeting note and start recording
async function createMeetingNoteAndRecord(platformName, transcriptionProvider = 'assemblyai') {
  console.log('Creating meeting note for platform:', platformName);
  console.log('Using transcription provider:', transcriptionProvider);
  try {
    if (!detectedMeeting) {
      console.error('No active meeting detected');
      return;
    }
    console.log(
      'Detected meeting info:',
      detectedMeeting.window.id,
      detectedMeeting.window.platform
    );

    // Store the meeting window ID for later reference with transcript events
    global.activeMeetingIds = global.activeMeetingIds || {};
    global.activeMeetingIds[detectedMeeting.window.id] = { platformName };

    // Read the current meetings data
    let meetingsData;
    try {
      const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      meetingsData = JSON.parse(fileData);
    } catch (error) {
      console.error('Error reading meetings data:', error);
      meetingsData = { upcomingMeetings: [], pastMeetings: [] };
    }

    // Generate a unique ID for the new meeting
    const id = 'meeting-' + Date.now();

    // Current date and time
    const now = new Date();

    // Create a template for the note content
    const template = `# ${platformName} Meeting Notes\nRecording: In Progress...`;

    // Create a new meeting object
    // UI-1: Use SDK platform code (e.g., "zoom") not display name (e.g., "Zoom") for icon matching
    const sdkPlatform = detectedMeeting.window.platform || 'unknown';
    console.log(
      `[Meeting Creation] Creating meeting for detected ${platformName}, windowId: ${detectedMeeting.window.id}, sdkPlatform: ${sdkPlatform}`
    );
    const newMeeting = {
      id: id,
      type: 'document',
      title: `${platformName} Meeting - ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      subtitle: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      hasDemo: false,
      date: now.toISOString(),
      participants: [],
      content: template,
      recordingId: detectedMeeting.window.id,
      platform: sdkPlatform, // UI-1: Use SDK platform code for icon matching
      transcript: [], // Initialize an empty array for transcript data
      transcriptionProvider: transcriptionProvider, // Save the transcription provider
    };
    console.log(
      `[Meeting Creation] ✓ Created meeting object - id: ${id}, recordingId: ${newMeeting.recordingId}, transcriptionProvider: ${transcriptionProvider}`
    );

    // Update the active meeting tracking with the note ID
    if (global.activeMeetingIds && global.activeMeetingIds[detectedMeeting.window.id]) {
      global.activeMeetingIds[detectedMeeting.window.id].noteId = id;
    }

    // Register this meeting in our active recordings tracker (even before starting)
    // This ensures the UI knows about it immediately
    activeRecordings.addRecording(detectedMeeting.window.id, id, platformName);

    // Add to pastMeetings
    meetingsData.pastMeetings.unshift(newMeeting);

    // Save the updated data
    console.log(`Saving meeting data to ${meetingsFilePath} with ID: ${id}`);
    await fileOperationManager.writeData(meetingsData);

    // Verify the file was written by reading it back
    try {
      const verifyData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      const parsedData = JSON.parse(verifyData);
      const verifyMeeting = parsedData.pastMeetings.find(m => m.id === id);

      if (verifyMeeting) {
        console.log(`[Meeting Creation] ✓ Verified meeting ${id} was saved to file`);
        console.log(
          `[Meeting Creation] ✓ Verified recordingId in file: ${verifyMeeting.recordingId}`
        );
        if (!verifyMeeting.recordingId) {
          console.error(`[Meeting Creation] ✗ ERROR: Meeting saved but recordingId is missing!`);
        } else if (verifyMeeting.recordingId !== detectedMeeting.window.id) {
          console.error(
            `[Meeting Creation] ✗ ERROR: recordingId mismatch! Expected: ${detectedMeeting.window.id}, Got: ${verifyMeeting.recordingId}`
          );
        }

        // Tell the renderer to open the new note
        if (mainWindow && !mainWindow.isDestroyed()) {
          // We need a significant delay to make sure the file is fully processed and loaded
          // This ensures the renderer has time to process the file and recognize the new meeting
          setTimeout(async () => {
            try {
              // Force a file reload before sending the message
              await fs.promises.readFile(meetingsFilePath, 'utf8');

              console.log(`Sending IPC message to open meeting note: ${id}`);
              mainWindow.webContents.send('open-meeting-note', id);

              // Send another message after 2 seconds as a backup
              setTimeout(() => {
                console.log(`Sending backup IPC message to open meeting note: ${id}`);
                mainWindow.webContents.send('open-meeting-note', id);
              }, 2000);
            } catch (error) {
              console.error('Error before sending open-meeting-note message:', error);
            }
          }, 1500); // Increased delay for safety
        }
      } else {
        console.error(`Meeting ${id} not found in saved data!`);
      }
    } catch (verifyError) {
      console.error('Error verifying saved data:', verifyError);
    }

    // Start recording with upload token
    // IMPORTANT: Re-check detectedMeeting right before recording, as the window may have changed
    if (!detectedMeeting || !detectedMeeting.window) {
      console.error('[Recording Start] ✗ No active meeting detected at recording time!');
      throw new Error('Meeting window disappeared before recording could start');
    }

    // Use the CURRENT windowId (may have changed since meeting creation)
    const currentWindowId = detectedMeeting.window.id;
    console.log(
      `[Recording Start] Starting recording for meeting ${id}, windowId: ${currentWindowId}`
    );

    // If the windowId changed, update the meeting object and activeRecordings
    if (currentWindowId !== newMeeting.recordingId) {
      console.log(
        `[Recording Start] ⚠ Window ID changed! Old: ${newMeeting.recordingId}, New: ${currentWindowId}`
      );

      // Update the meeting's recordingId in the file
      await fileOperationManager.scheduleOperation(async data => {
        const meetingIndex = data.pastMeetings.findIndex(m => m.id === id);
        if (meetingIndex !== -1) {
          data.pastMeetings[meetingIndex].recordingId = currentWindowId;
          console.log(`[Recording Start] ✓ Updated recordingId to ${currentWindowId}`);
        }
        return data;
      });

      // Update activeRecordings with new windowId
      activeRecordings.removeRecording(newMeeting.recordingId);
      activeRecordings.addRecording(currentWindowId, id, platformName);

      // Update global tracking
      if (global.activeMeetingIds) {
        delete global.activeMeetingIds[newMeeting.recordingId];
        global.activeMeetingIds[currentWindowId] = { noteId: id, platformName };
      }
    }

    try {
      // Get upload token
      const uploadData = await createDesktopSdkUpload();

      if (!uploadData || !uploadData.upload_token) {
        console.error('Failed to get upload token. Recording without upload token.');

        // Log the startRecording API call (no token fallback)
        sdkLogger.logApiCall('startRecording', {
          windowId: currentWindowId,
        });

        try {
          RecallAiSdk.startRecording({
            windowId: currentWindowId,
          });
          console.log('[Recording Start] ✓ Recording started successfully (no token)');
        } catch (sdkError) {
          console.error('[Recording Start] ✗ SDK failed to start recording:', sdkError);
          throw new Error(`Failed to start recording: ${sdkError.message}`);
        }
      } else {
        console.log(
          'Starting recording with upload token:',
          uploadData.upload_token.substring(0, 8) + '...'
        );

        // Save the upload token to the meeting for later matching
        console.log(
          `[Upload] Attempting to save uploadToken for meeting ${id}, token: ${uploadData.upload_token.substring(0, 8)}...`
        );
        await fileOperationManager.scheduleOperation(async data => {
          console.log(
            `[Upload] scheduleOperation executing, pastMeetings count: ${data.pastMeetings.length}`
          );
          const meetingIndex = data.pastMeetings.findIndex(m => m.id === id);
          if (meetingIndex !== -1) {
            data.pastMeetings[meetingIndex].uploadToken = uploadData.upload_token;
            console.log(`[Upload] ✓ Saved uploadToken to meeting ${id} at index ${meetingIndex}`);
          } else {
            console.error(
              `[Upload] ✗ Could not find meeting ${id} in pastMeetings to save uploadToken!`
            );
            console.error(
              `[Upload] Available meeting IDs:`,
              data.pastMeetings.map(m => m.id).join(', ')
            );
          }
          return data;
        });
        console.log(`[Upload] scheduleOperation completed for meeting ${id}`);

        // Log the startRecording API call with upload token
        sdkLogger.logApiCall('startRecording', {
          windowId: currentWindowId,
          uploadToken: `${uploadData.upload_token.substring(0, 8)}...`, // Log truncated token for security
        });

        console.log(
          `[Recording Start] ✓ Calling RecallAiSdk.startRecording with windowId: ${currentWindowId}`
        );

        try {
          RecallAiSdk.startRecording({
            windowId: currentWindowId,
            uploadToken: uploadData.upload_token,
          });
          console.log(`[Recording Start] ✓ Recording started successfully with upload token`);
        } catch (sdkError) {
          console.error('[Recording Start] ✗ SDK failed to start recording:', sdkError);
          throw new Error(`Failed to start recording: ${sdkError.message}`);
        }
      }
    } catch (error) {
      console.error('Error starting recording with upload token:', error);

      // Fallback to recording without token
      console.log('[Recording Start] Attempting fallback recording without token...');

      // Log the startRecording API call (error fallback)
      sdkLogger.logApiCall('startRecording', {
        windowId: currentWindowId,
        error: 'Fallback after error',
      });

      try {
        RecallAiSdk.startRecording({
          windowId: currentWindowId,
        });
        console.log('[Recording Start] ✓ Fallback recording started successfully');
      } catch (sdkError) {
        console.error('[Recording Start] ✗ Fallback recording also failed:', sdkError);
        // Don't throw here - meeting note already created, just log the error
      }
    }

    return id;
  } catch (error) {
    console.error('Error creating meeting note:', error);
  }
}

// Function to process video frames
async function processVideoFrame(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) {
      console.error('Missing window ID in video frame event');
      return;
    }

    // Check if we have this meeting in our active meetings
    if (!global.activeMeetingIds || !global.activeMeetingIds[windowId]) {
      console.log(`No active meeting found for window ID: ${windowId}`);
      return;
    }

    const noteId = global.activeMeetingIds[windowId].noteId;
    if (!noteId) {
      console.log(`No note ID found for window ID: ${windowId}`);
      return;
    }

    // Extract the video data
    const frameData = evt.data.data;
    if (!frameData || !frameData.buffer) {
      console.log('No video frame data in event');
      return;
    }

    // Get data from the event
    const frameBuffer = frameData.buffer; // base64 encoded PNG
    const frameTimestamp = frameData.timestamp;
    const frameType = frameData.type; // 'webcam' or 'screenshare'
    const participantData = frameData.participant;

    // Extract participant info
    const participantId = participantData?.id;
    const participantName = participantData?.name || 'Unknown';

    // Log minimal info to avoid flooding the console
    // console.log(`Received ${frameType} frame from ${participantName} (ID: ${participantId}) at ${frameTimestamp.absolute}`);

    // Send the frame to the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video-frame', {
        noteId,
        participantId,
        participantName,
        frameType,
        buffer: frameBuffer,
        timestamp: frameTimestamp,
      });
    }
  } catch (error) {
    console.error('Error processing video frame:', error);
  }
}

// Function to process participant join events
async function processParticipantJoin(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) {
      console.error('Missing window ID in participant join event');
      return;
    }

    // Check if we have this meeting in our active meetings
    if (!global.activeMeetingIds || !global.activeMeetingIds[windowId]) {
      console.log(`No active meeting found for window ID: ${windowId}`);
      return;
    }

    const noteId = global.activeMeetingIds[windowId].noteId;
    if (!noteId) {
      console.log(`No note ID found for window ID: ${windowId}`);
      return;
    }

    // Extract the participant data
    const participantData = evt.data.data.participant;
    if (!participantData) {
      console.log('No participant data in event');
      return;
    }

    const participantName = participantData.name || 'Unknown Participant';
    const participantId = participantData.id;
    const isHost = participantData.is_host;
    const platform = participantData.platform;
    let participantEmail = participantData.email || null;
    let contactMatched = false;
    let organization = null;

    // SM-1: Log full participant data to see what SDK provides
    console.log(
      `Participant joined: ${participantName} (ID: ${participantId}, Host: ${isHost}, Email: ${participantEmail || 'none'})`
    );
    console.log('[SM-1 Debug] Full participant data:', JSON.stringify(participantData, null, 2));

    // Skip "Host" and "Guest" generic names
    if (
      participantName === 'Host' ||
      participantName === 'Guest' ||
      participantName.includes('others') ||
      participantName.split(' ').length > 3
    ) {
      console.log(`Skipping generic participant name: ${participantName}`);
      return;
    }

    // v1.1: If no email from SDK, try to look up contact by name
    if (
      !participantEmail &&
      participantName &&
      participantName !== 'Unknown Participant' &&
      googleContacts &&
      typeof googleContacts.findContactByName === 'function'
    ) {
      try {
        const contact = await googleContacts.findContactByName(participantName);
        if (contact && contact.emails && contact.emails.length > 0) {
          participantEmail = contact.emails[0];
          organization = contact.organization || null;
          contactMatched = true;
          console.log(
            `[ParticipantJoin] Matched "${participantName}" to contact "${contact.name}" (${participantEmail})`
          );
        }
      } catch (contactError) {
        console.warn(
          `[ParticipantJoin] Contact lookup failed for "${participantName}":`,
          contactError.message
        );
      }
    }

    // Use the file operation manager to safely update the meetings data
    await fileOperationManager.scheduleOperation(async meetingsData => {
      // Find the meeting note with this ID
      const noteIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === noteId);
      if (noteIndex === -1) {
        console.log(`No meeting note found with ID: ${noteId}`);
        return null; // Return null to indicate no changes needed
      }

      // Get the meeting and initialize participants array if needed
      const meeting = meetingsData.pastMeetings[noteIndex];
      if (!meeting.participants) {
        meeting.participants = [];
      }

      // Check if participant already exists (based on ID)
      const existingParticipantIndex = meeting.participants.findIndex(p => p.id === participantId);

      const participantObj = {
        id: participantId,
        name: participantName,
        email: participantEmail,
        isHost: isHost,
        platform: platform,
        joinTime: new Date().toISOString(),
        status: 'active',
        ...(organization && { organization }),
        ...(contactMatched && { matchedByName: true }),
      };

      if (existingParticipantIndex !== -1) {
        // Update existing participant
        meeting.participants[existingParticipantIndex] = participantObj;
      } else {
        // Add new participant
        meeting.participants.push(participantObj);
      }

      // v1.1: Add email to participantEmails for routing if matched from contact
      if (participantEmail && contactMatched) {
        if (!meeting.participantEmails) {
          meeting.participantEmails = [];
        }
        if (!meeting.participantEmails.includes(participantEmail)) {
          meeting.participantEmails.push(participantEmail);
          console.log(
            `[ParticipantJoin] Added ${participantEmail} to participantEmails for routing`
          );
        }
      }

      console.log(`Added/updated participant data for meeting: ${noteId}`);

      // Notify the renderer if this note is currently being edited
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('participants-updated', noteId);
      }

      // Return the updated data to be written
      return meetingsData;
    });

    console.log(`Processed participant join event for meeting: ${noteId}`);
  } catch (error) {
    console.error('Error processing participant join event:', error);
  }
}

// ===================================================================
// Speech Timeline Event Handlers (SM-1: Speaker Matching)
// ===================================================================

/**
 * Initialize speech timeline for a new recording
 * @param {string} windowId - SDK window ID
 * @param {number} recordingStartTime - Timestamp when recording started
 */
function initializeSpeechTimeline(windowId, recordingStartTime) {
  speechTimelines.set(windowId, {
    recordingStartTime,
    participants: new Map(),
  });
  console.log(`[SpeechTimeline] Initialized for window: ${windowId}`);
}

/**
 * Process speech_on event - participant started speaking
 * @param {Object} evt - SDK realtime event
 */
function processSpeechOn(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) return;

    const participantData = evt.data?.data?.participant;
    if (!participantData) {
      console.log('[SpeechTimeline] No participant data in speech_on event');
      return;
    }

    const participantId = participantData.id;
    const participantName = participantData.name || 'Unknown';
    const timestamp = Date.now();

    // Get or create timeline for this window
    let timeline = speechTimelines.get(windowId);
    if (!timeline) {
      // Recording might have started before we could initialize
      initializeSpeechTimeline(windowId, timestamp);
      timeline = speechTimelines.get(windowId);
    }

    // Get or create participant entry
    if (!timeline.participants.has(participantId)) {
      timeline.participants.set(participantId, {
        id: participantId,
        name: participantName,
        segments: [],
        currentStart: null,
      });
    }

    const participant = timeline.participants.get(participantId);

    // Update name if we have a better one
    if (participantName !== 'Unknown' && participant.name === 'Unknown') {
      participant.name = participantName;
    }

    // Record speech start (relative to recording start)
    const relativeTime = timestamp - timeline.recordingStartTime;
    participant.currentStart = relativeTime;

    console.log(`[SpeechTimeline] ${participantName} started speaking at ${relativeTime}ms`);
  } catch (error) {
    console.error('[SpeechTimeline] Error processing speech_on:', error);
  }
}

/**
 * Process speech_off event - participant stopped speaking
 * @param {Object} evt - SDK realtime event
 */
function processSpeechOff(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) return;

    const participantData = evt.data?.data?.participant;
    if (!participantData) {
      console.log('[SpeechTimeline] No participant data in speech_off event');
      return;
    }

    const participantId = participantData.id;
    const timestamp = Date.now();

    const timeline = speechTimelines.get(windowId);
    if (!timeline) {
      console.log(`[SpeechTimeline] No timeline found for window: ${windowId}`);
      return;
    }

    const participant = timeline.participants.get(participantId);
    if (!participant || participant.currentStart === null) {
      console.log(`[SpeechTimeline] No active speech segment for participant: ${participantId}`);
      return;
    }

    // Record completed speech segment
    const relativeTime = timestamp - timeline.recordingStartTime;
    participant.segments.push({
      start: participant.currentStart,
      end: relativeTime,
    });
    participant.currentStart = null;

    console.log(
      `[SpeechTimeline] ${participant.name} stopped speaking at ${relativeTime}ms (segment: ${participant.segments.length})`
    );
  } catch (error) {
    console.error('[SpeechTimeline] Error processing speech_off:', error);
  }
}

/**
 * Get speech timeline for a recording window
 * @param {string} windowId - SDK window ID
 * @returns {Object|null} Speech timeline data or null if not found
 */
function getSpeechTimeline(windowId) {
  const timeline = speechTimelines.get(windowId);
  if (!timeline) return null;

  // Convert to array format for easier processing
  const participants = [];
  for (const [participantId, data] of timeline.participants) {
    // Close any open speech segments
    if (data.currentStart !== null) {
      data.segments.push({
        start: data.currentStart,
        end: Date.now() - timeline.recordingStartTime,
      });
      data.currentStart = null;
    }

    participants.push({
      id: participantId,
      name: data.name,
      segments: data.segments,
      totalSpeakingTime: data.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0),
    });
  }

  return {
    recordingStartTime: timeline.recordingStartTime,
    participants,
  };
}

/**
 * Clean up speech timeline when recording ends
 * @param {string} windowId - SDK window ID
 */
function cleanupSpeechTimeline(windowId) {
  if (speechTimelines.has(windowId)) {
    console.log(`[SpeechTimeline] Cleaned up timeline for window: ${windowId}`);
    speechTimelines.delete(windowId);
  }
}

// Store speaker labels per window (AssemblyAI speaker diarization)
const windowSpeakerLabels = new Map(); // windowId -> latest speaker label

/**
 * Match speaker labels to participant names using simple heuristics
 * @param {Object} meeting - Meeting object with transcript and participants
 * Note: Currently unused - replaced by SpeakerMatcher service
 */
// eslint-disable-next-line no-unused-vars
async function matchSpeakersToParticipants(meeting) {
  if (!meeting.transcript || !meeting.participants) {
    return;
  }

  // Analyze speakers in transcript - count words per speaker label
  const speakerStats = new Map();
  for (const entry of meeting.transcript) {
    if (entry.speakerLabel !== undefined) {
      if (!speakerStats.has(entry.speakerLabel)) {
        speakerStats.set(entry.speakerLabel, {
          label: entry.speakerLabel,
          wordCount: 0,
          utteranceCount: 0,
          firstAppearance: entry.timestamp,
        });
      }
      const stats = speakerStats.get(entry.speakerLabel);
      stats.wordCount += entry.text.split(/\s+/).length;
      stats.utteranceCount++;
    }
  }

  if (speakerStats.size === 0) {
    console.log('[Speaker Matching] No speaker labels found in transcript');
    return;
  }

  console.log(
    `[Speaker Matching] Found ${speakerStats.size} unique speakers and ${meeting.participants.length} participants`
  );

  // Sort speakers by word count (most talkative first)
  const sortedSpeakers = Array.from(speakerStats.values()).sort(
    (a, b) => b.wordCount - a.wordCount
  );

  // Sort participants (host first if available, then by join order)
  const sortedParticipants = [...meeting.participants].sort((a, b) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    return 0;
  });

  // Create speaker mapping
  const speakerMapping = new Map();

  // Simple heuristic: match speakers to participants in order
  // Most talkative speaker -> host (or first participant)
  // Second most talkative -> second participant, etc.
  for (let i = 0; i < Math.min(sortedSpeakers.length, sortedParticipants.length); i++) {
    speakerMapping.set(sortedSpeakers[i].label, sortedParticipants[i].name);
    console.log(
      `[Speaker Matching] Speaker ${String.fromCharCode(65 + sortedSpeakers[i].label)} -> ${sortedParticipants[i].name}`
    );
  }

  // Update transcript entries with matched names
  let matchedCount = 0;
  for (const entry of meeting.transcript) {
    if (entry.speakerLabel !== undefined && speakerMapping.has(entry.speakerLabel)) {
      const matchedName = speakerMapping.get(entry.speakerLabel);
      const oldSpeaker = entry.speaker;
      entry.speaker = matchedName;
      entry.speakerMatched = true;
      if (matchedCount < 3) {
        // Only log first few to avoid spam
        console.log(`[Speaker Matching] Updated "${oldSpeaker}" -> "${matchedName}"`);
      }
      matchedCount++;
    }
  }
  console.log(
    `[Speaker Matching] Updated ${matchedCount} transcript entries with matched speaker names`
  );

  // Store the mapping in the meeting object for reference
  meeting.speakerMapping = Object.fromEntries(
    Array.from(speakerMapping.entries()).map(([label, name]) => [
      `Speaker ${String.fromCharCode(65 + label)}`,
      { name, email: null, confidence: 'medium', method: 'participant-match' },
    ])
  );
}

// ============================================================================
// Recall.ai Async Transcription (Phase 6 - Better Quality than Real-Time)
// ============================================================================

/**
 * Poll Recall.ai API to check if upload is complete
 * (Webhooks don't work for desktop apps, so we poll instead)
 * @param {string} windowId - Window ID from Desktop SDK
 * Note: Currently unused - using webhook-based transcription instead
 */
// eslint-disable-next-line no-unused-vars
async function pollForUploadCompletion(windowId) {
  const RECALLAI_API_URL =
    (await keyManagementService.getKey('RECALLAI_API_URL')) ||
    process.env.RECALLAI_API_URL ||
    'https://api.recall.ai';
  const RECALLAI_API_KEY =
    (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

  if (!RECALLAI_API_KEY) {
    throw new Error('RECALLAI_API_KEY not configured. Set it in Settings > Security');
  }

  console.log(`[Upload] Polling for upload completion: ${windowId}`);

  // Poll every 5 seconds for up to 5 minutes
  const maxAttempts = 60; // 5 minutes
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      attempts++;

      // Query SDK uploads API to find our recording
      const url = `${RECALLAI_API_URL}/api/v1/sdk_upload/`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Token ${RECALLAI_API_KEY}`,
        },
      });

      // Debug: Log the raw API response on first attempt
      if (attempts === 1) {
        console.log(
          '[Upload] API Response structure:',
          JSON.stringify(response.data, null, 2).substring(0, 2000)
        );
      }

      // Find the upload with our windowId
      const uploads = response.data.results || [];
      console.log(`[Upload] Found ${uploads.length} total uploads in API response`);

      if (uploads.length > 0 && attempts === 1) {
        console.log(
          '[Upload] First upload example:',
          JSON.stringify(uploads[0], null, 2).substring(0, 500)
        );
      }

      // Get the upload_token for this recording from the meeting data
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.recordingId === windowId);

      if (!meeting) {
        console.log(`[Upload] Could not find meeting with recordingId: ${windowId}`);
        console.log(
          `[Upload] Available recordingIds in pastMeetings:`,
          meetingsData.pastMeetings.map(m => m.recordingId || 'none').join(', ')
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // Debug: Show what fields the meeting has
      if (attempts === 1) {
        console.log(
          `[Upload] Meeting found! ID: ${meeting.id}, has uploadToken: ${!!meeting.uploadToken}`
        );
        console.log(`[Upload] Meeting fields:`, Object.keys(meeting));
        if (meeting.uploadToken) {
          console.log(`[Upload] uploadToken value: ${meeting.uploadToken.substring(0, 8)}...`);
        }
      }

      if (!meeting.uploadToken) {
        console.log(
          `[Upload] Meeting ${meeting.id} found but no uploadToken field yet (attempt ${attempts}/${maxAttempts})`
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      console.log(`[Upload] Looking for upload_token: ${meeting.uploadToken.substring(0, 8)}...`);
      const ourUpload = uploads.find(upload => upload.upload_token === meeting.uploadToken);

      if (ourUpload) {
        const statusCode = ourUpload.status?.code;
        console.log(`[Upload] Upload status: ${statusCode}`);

        if (statusCode === 'complete') {
          const recordingId = ourUpload.recording_id;
          console.log(`[Upload] Upload complete! Recording ID: ${recordingId}`);

          // Start async transcription
          try {
            await startRecallAIAsyncTranscription(recordingId, windowId);
            return; // Success - exit polling loop
          } catch (transcriptionError) {
            console.error(
              '[Upload] Failed to start transcription:',
              transcriptionError.response?.data || transcriptionError.message
            );
            // Stop retrying - transcription errors are usually permanent (e.g., missing video)
            throw new Error(`Transcription failed: ${transcriptionError.message}`);
          }
        } else if (statusCode === 'failed') {
          throw new Error(`Upload failed for window ${windowId}`);
        }
      } else {
        console.log(`[Upload] Upload not found yet (attempt ${attempts}/${maxAttempts})`);
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('[Upload] Polling error:', error.response?.data || error.message);
      // Continue polling even on errors (might be transient)
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  throw new Error(`Upload polling timed out after ${maxAttempts} attempts for window ${windowId}`);
}

/**
 * Start async transcription through Recall.ai after upload completes
 * @param {string} recordingId - Recall.ai recording ID from upload-complete webhook
 * @param {string} windowId - Window ID from Desktop SDK
 */
async function startRecallAIAsyncTranscription(recordingId, windowId) {
  console.log(`[Recall.ai] Starting async transcription for recording: ${recordingId}`);

  const RECALLAI_API_URL =
    (await keyManagementService.getKey('RECALLAI_API_URL')) ||
    process.env.RECALLAI_API_URL ||
    'https://api.recall.ai';
  const RECALLAI_API_KEY =
    (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

  if (!RECALLAI_API_KEY) {
    throw new Error('RECALLAI_API_KEY not configured. Set it in Settings > Security');
  }

  try {
    // Find the meeting for this recording
    const meetingsData = await fileOperationManager.readMeetingsData();
    const meeting = meetingsData.pastMeetings.find(m => m.recordingId === windowId);

    if (!meeting) {
      throw new Error(`No meeting found for window ID: ${windowId}`);
    }

    // Get expected speaker count from participants
    const _speakersExpected = meeting.participants ? meeting.participants.length : null;

    // Call Recall.ai API to create async transcript with built-in provider
    const url = `${RECALLAI_API_URL}/api/v1/recording/${recordingId}/create_transcript/`;

    const transcriptConfig = {
      provider: {
        recallai_async: {
          // Use Recall.ai's built-in async transcription
          language_code: 'en',
        },
      },
      diarization: {
        use_separate_streams_when_available: true, // Enable perfect diarization
      },
    };

    console.log(
      `[Recall.ai] Requesting transcript with config:`,
      JSON.stringify(transcriptConfig, null, 2)
    );

    const response = await axios.post(url, transcriptConfig, {
      headers: {
        Authorization: `Token ${RECALLAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const transcriptId = response.data.id;
    console.log(
      `[Recall.ai] Transcript request submitted successfully. Transcript ID: ${transcriptId}`
    );
    console.log(`[Recall.ai] Waiting for transcript.done webhook...`);

    // No polling needed - we'll receive a transcript.done webhook when ready
  } catch (error) {
    console.error(
      '[Recall.ai] Failed to start async transcription:',
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Poll Recall.ai for transcript completion
 * @param {string} recordingId - Recall.ai recording ID
 * @param {string} transcriptId - Transcript ID returned from create_transcript
 * @param {string} windowId - Window ID from Desktop SDK
 * @param {string} meetingId - Our meeting ID
 */
async function pollRecallAITranscript(recordingId, transcriptId, windowId, meetingId) {
  const RECALLAI_API_URL =
    (await keyManagementService.getKey('RECALLAI_API_URL')) ||
    process.env.RECALLAI_API_URL ||
    'https://api.recall.ai';
  const RECALLAI_API_KEY =
    (await keyManagementService.getKey('RECALLAI_API_KEY')) || process.env.RECALLAI_API_KEY;

  // Poll the specific transcript endpoint
  const pollingEndpoint = `${RECALLAI_API_URL}/api/v1/transcript/${transcriptId}/`;

  console.log(
    `[Recall.ai] Polling for transcript completion. Recording: ${recordingId}, Transcript: ${transcriptId}`
  );

  while (true) {
    try {
      const response = await axios.get(pollingEndpoint, {
        headers: {
          Authorization: `Token ${RECALLAI_API_KEY}`,
        },
      });

      const transcript = response.data;
      const transcriptStatus = transcript.status?.code;

      console.log(`[Recall.ai] Transcript status: ${transcriptStatus || 'unknown'}`);

      if (transcriptStatus === 'done') {
        console.log('[Recall.ai] Transcript is ready - fetching data');

        // The transcript data should be in the response
        // Check if we have words array or need to fetch from URL
        if (transcript.words && transcript.words.length > 0) {
          console.log(`[Recall.ai] Transcript data retrieved (${transcript.words.length} words)`);

          // Process and save the transcript
          await processRecallAITranscript(transcript, meetingId, windowId);
          break; // Exit polling loop
        } else if (transcript.data?.download_url) {
          // If data is in a separate URL, fetch it
          console.log(`[Recall.ai] Fetching transcript from download URL`);
          const transcriptResponse = await axios.get(transcript.data.download_url);
          await processRecallAITranscript(transcriptResponse.data, meetingId, windowId);
          break;
        } else {
          throw new Error('Transcript is done but has no words data or download URL');
        }
      } else if (transcriptStatus === 'error' || transcriptStatus === 'failed') {
        throw new Error(
          `Transcript generation failed for recording ${recordingId}: ${transcript.status?.message || 'Unknown error'}`
        );
      } else {
        console.log(
          `[Recall.ai] Transcript still processing (status: ${transcriptStatus}) - continuing to poll`
        );
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      // If it's a 404, the transcript might not be available yet
      if (error.response?.status === 404) {
        console.log('[Recall.ai] Transcript not found yet (404) - continuing to poll');
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      // For other errors, log and throw
      if (error.message && error.message.includes('Transcript generation failed')) {
        throw error;
      }
      console.error('[Recall.ai] Polling error:', error.response?.data || error.message);
      throw error;
    }
  }
}

/**
 * Process Recall.ai transcript and match speakers to participants
 * @param {Object} transcript - Recall.ai transcript response
 * @param {string} meetingId - Our meeting ID
 * @param {string} windowId - Window ID
 */
async function processRecallAITranscript(transcript, meetingId, _windowId) {
  console.log('[Recall.ai] Processing transcript with speaker labels');

  try {
    // Get the meeting with participants
    const meetingsData = await fileOperationManager.readMeetingsData();
    const meeting = meetingsData.pastMeetings.find(m => m.id === meetingId);

    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    const participants = meeting.participants || [];

    // Recall.ai transcript format: array of participants, each with words array
    const utterances = [];

    // Handle array format (each element is a participant object with words)
    const participantSegments = Array.isArray(transcript) ? transcript : [transcript];

    for (const segment of participantSegments) {
      const participantName = segment.participant?.name || 'Unknown Speaker';
      const participantId = segment.participant?.id;
      const isHost = segment.participant?.is_host || false;
      const words = segment.words || [];

      if (words.length === 0) continue;

      // Group words into utterances by pauses (> 1 second gap)
      let currentUtterance = null;

      words.forEach((word, index) => {
        const startTime = word.start_timestamp?.relative || 0;
        const endTime = word.end_timestamp?.relative || 0;

        // Start new utterance if first word or long pause
        const isNewUtterance =
          !currentUtterance || (index > 0 && startTime - currentUtterance.end > 1.0);

        if (isNewUtterance) {
          if (currentUtterance) {
            utterances.push(currentUtterance);
          }
          currentUtterance = {
            speaker: participantName,
            participantId: participantId,
            isHost: isHost,
            text: word.text,
            start: startTime,
            end: endTime,
          };
        } else {
          // Add to current utterance
          currentUtterance.text += ' ' + word.text;
          currentUtterance.end = endTime;
        }
      });

      // Add final utterance
      if (currentUtterance) {
        utterances.push(currentUtterance);
      }
    }

    console.log(`[Recall.ai] Grouped into ${utterances.length} utterances`);

    // Get unique speakers
    const speakerLabels = [...new Set(utterances.map(u => u.speaker))].sort();
    console.log(`[Recall.ai] Found ${speakerLabels.length} unique speakers:`, speakerLabels);

    // Match speakers to participants
    const speakerMap = {};
    speakerLabels.forEach((label, index) => {
      if (index < participants.length) {
        const participant = participants[index];
        speakerMap[label] = {
          name: participant.name,
          email: participant.email || null,
          confidence: participants.length === 1 ? 'high' : 'medium',
        };
      } else {
        speakerMap[label] = {
          name: `Unknown Speaker (${label})`,
          email: null,
          confidence: 'none',
        };
      }
    });

    console.log('[Recall.ai] Speaker mapping:', speakerMap);

    // Convert to our transcript format
    const processedTranscript = utterances.map(utterance => {
      const speakerInfo = speakerMap[utterance.speaker] || {
        name: utterance.speaker,
        email: null,
        confidence: 'none',
      };

      return {
        speaker: speakerInfo.name,
        speakerLabel: utterance.speaker,
        speakerEmail: speakerInfo.email,
        speakerConfidence: speakerInfo.confidence,
        participantId: utterance.participantId,
        isHost: utterance.isHost,
        text: utterance.text,
        start: utterance.start,
        end: utterance.end,
      };
    });

    // Update the meeting with transcript
    await fileOperationManager.scheduleOperation(async data => {
      const meetingIndex = data.pastMeetings.findIndex(m => m.id === meetingId);
      if (meetingIndex !== -1) {
        const meeting = data.pastMeetings[meetingIndex];

        // Check if we need to append to previous transcript
        if (meeting.recordingAction === 'append' && meeting.previousTranscript) {
          console.log(
            `[Recall.ai] Appending ${processedTranscript.length} new utterances to ${meeting.previousTranscript.length} existing utterances`
          );
          data.pastMeetings[meetingIndex].transcript = [
            ...meeting.previousTranscript,
            ...processedTranscript,
          ];
          // Clean up temporary fields
          delete data.pastMeetings[meetingIndex].previousTranscript;
          delete data.pastMeetings[meetingIndex].recordingAction;
        } else {
          // Overwrite or new transcript
          data.pastMeetings[meetingIndex].transcript = processedTranscript;
          // Clean up temporary fields
          delete data.pastMeetings[meetingIndex].recordingAction;
        }

        data.pastMeetings[meetingIndex].transcriptComplete = true;
        console.log(
          `[Recall.ai] Updated meeting with ${data.pastMeetings[meetingIndex].transcript.length} total utterances`
        );
      }
      return data;
    });

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcript-updated', meetingId);
    }

    // Generate AI summary using shared function (eliminates 35 lines of duplication)
    console.log(`[Recall.ai] Starting AI summary generation`);
    try {
      await generateAndSaveAutoSummary(meetingId, '[Recall.ai]');
    } catch (summaryError) {
      console.error('[Recall.ai] Failed to generate AI summary:', summaryError);
    }

    console.log(`[Recall.ai] Async transcription workflow complete`);
  } catch (error) {
    console.error('[Recall.ai] Error processing transcript:', error);
    throw error;
  }
}

// Function to process transcript data and store it with the meeting note
// Note: Currently unused - using webhook-based processing instead
// eslint-disable-next-line no-unused-vars
async function processTranscriptData(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) {
      console.error('Missing window ID in transcript event');
      return;
    }

    // Check if we have this meeting in our active meetings
    if (!global.activeMeetingIds || !global.activeMeetingIds[windowId]) {
      console.log(`No active meeting found for window ID: ${windowId}`);
      return;
    }

    const noteId = global.activeMeetingIds[windowId].noteId;
    if (!noteId) {
      console.log(`No note ID found for window ID: ${windowId}`);
      return;
    }

    // Extract the transcript data
    const words = evt.data.data.words || [];
    if (words.length === 0) {
      return; // No words to process
    }

    // Get speaker information from AssemblyAI diarization
    const speakerLabel = windowSpeakerLabels.get(windowId);
    let speaker;
    let speakerLabelStored = null;

    // Debug: Log participant data from RecallAI
    const participantName = evt.data.data.participant?.name;
    const participantId = evt.data.data.participant?.id;
    console.log(
      `[Transcript] Participant from RecallAI: "${participantName}" (ID: ${participantId}), Speaker label from AssemblyAI: ${speakerLabel}`
    );

    // Try to match participant to stored participants in meeting.participants array
    // This is more reliable than the participant info from transcript events
    let matchedParticipant = null;
    await fileOperationManager.scheduleOperation(async meetingsData => {
      const noteIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === noteId);
      if (noteIndex !== -1) {
        const meeting = meetingsData.pastMeetings[noteIndex];
        if (meeting.participants && meeting.participants.length > 0) {
          // Try to find participant by ID first
          matchedParticipant = meeting.participants.find(p => p.id === participantId);

          // If not found and we have exactly one non-host participant, use that
          if (!matchedParticipant) {
            const nonHostParticipants = meeting.participants.filter(
              p => !p.isHost && p.name !== 'Host' && p.name !== 'Guest'
            );
            if (nonHostParticipants.length === 1) {
              matchedParticipant = nonHostParticipants[0];
              console.log(`[Transcript] Matched to stored participant: ${matchedParticipant.name}`);
            }
          }
        }
      }
      return null; // No changes to data
    });

    // Determine speaker name
    if (matchedParticipant) {
      speaker = matchedParticipant.name;
      console.log(`[Transcript] Using matched participant: ${speaker}`);
    } else if (participantName && participantName !== 'Host' && participantName !== 'Guest') {
      speaker = participantName;
      console.log(`[Transcript] Using RecallAI participant name: ${speaker}`);
    } else if (speakerLabel !== undefined && speakerLabel !== null) {
      // Use AssemblyAI speaker label (rarely available in streaming)
      speaker = `Speaker ${String.fromCharCode(65 + speakerLabel)}`; // Convert 0->A, 1->B, etc.
      speakerLabelStored = speakerLabel;
      console.log(`[Transcript] Using AssemblyAI speaker label: ${speaker}`);
    } else {
      speaker = 'Unknown Speaker';
      console.log(`[Transcript] No speaker info available - using Unknown Speaker`);
    }

    // Combine all words into a single text
    const text = words.map(word => word.text).join(' ');

    console.log(`[Transcript] Final: ${speaker}: "${text.substring(0, 50)}..."`);

    // Use the file operation manager to safely update the meetings data
    await fileOperationManager.scheduleOperation(async meetingsData => {
      // Find the meeting note with this ID
      const noteIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === noteId);
      if (noteIndex === -1) {
        console.log(`No meeting note found with ID: ${noteId}`);
        return null; // Return null to indicate no changes needed
      }

      // Add the transcript data
      const meeting = meetingsData.pastMeetings[noteIndex];

      // Initialize transcript array if it doesn't exist
      if (!meeting.transcript) {
        meeting.transcript = [];
      }

      // Add the new transcript entry with speaker label for later matching
      const transcriptEntry = {
        text,
        speaker,
        timestamp: new Date().toISOString(),
      };

      // Include AssemblyAI speaker label if available (for speaker matching)
      if (speakerLabelStored !== null) {
        transcriptEntry.speakerLabel = speakerLabelStored;
      }

      meeting.transcript.push(transcriptEntry);

      console.log(`Added transcript data for meeting: ${noteId}`);

      // Notify the renderer if this note is currently being edited
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcript-updated', noteId);
      }

      // Return the updated data to be written
      return meetingsData;
    });

    console.log(`Processed transcript data for meeting: ${noteId}`);
  } catch (error) {
    console.error('Error processing transcript data:', error);
  }
}

// ============================================================================
// Shared Auto-Summary Function (Phase 10 Refactoring)
// ============================================================================

/**
 * Map provider preference value to simple provider name
 * @param {string} providerValue - Value from settings (e.g., 'azure-gpt-5-mini', 'claude-haiku-4-5', 'openai-gpt-4o-mini')
 * @returns {string} Provider name for llmService.switchProvider() (e.g., 'azure', 'anthropic', 'openai')
 */
function mapProviderValue(providerValue) {
  if (providerValue.startsWith('azure-')) return 'azure';
  if (providerValue.startsWith('claude-')) return 'anthropic';
  if (providerValue.startsWith('openai-')) return 'openai';

  // Fallback to azure if unknown
  console.warn(`[LLM] Unknown provider value: ${providerValue}, falling back to azure`);
  return 'azure';
}

/**
 * Execute an async operation with automatic LLM provider switching
 * Switches to the user's preferred provider for the operation type, executes the callback,
 * then restores the original provider (even if callback throws)
 *
 * @param {'auto' | 'template' | 'pattern'} providerType - Which provider preference to use ('auto' for autoSummaryProvider, 'template' for templateSummaryProvider, 'pattern' for patternGenerationProvider)
 * @param {Function} callback - Async function to execute with the switched provider
 * @param {string} logContext - Context string for logging (e.g., '[Import]', '[RegenerateSummary]')
 * @returns {Promise<any>} Result of the callback function
 */
async function withProviderSwitch(providerType, callback, logContext = '[LLM]') {
  const preferences = await getProviderPreferences();
  const preferenceKey =
    providerType === 'auto'
      ? 'autoSummaryProvider'
      : providerType === 'template'
        ? 'templateSummaryProvider'
        : 'patternGenerationProvider';
  const desiredProvider = mapProviderValue(preferences[preferenceKey]);
  const originalProvider = llmService.config.provider;

  if (desiredProvider !== originalProvider) {
    console.log(
      `${logContext} Switching LLM provider from ${originalProvider} to ${desiredProvider} (${providerType} preference: ${preferences[preferenceKey]})`
    );
    llmService.switchProvider(desiredProvider);
  }

  try {
    return await callback();
  } finally {
    if (desiredProvider !== originalProvider) {
      console.log(
        `${logContext} Restoring LLM provider from ${desiredProvider} back to ${originalProvider}`
      );
      llmService.switchProvider(originalProvider);
    }
  }
}

/**
 * Get provider preferences from renderer's localStorage
 * @returns {Promise<{autoSummaryProvider: string, templateSummaryProvider: string, patternGenerationProvider: string}>}
 */
async function getProviderPreferences() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[LLM] Main window not available, using default providers');
    return {
      autoSummaryProvider: 'azure-gpt-5-mini',
      templateSummaryProvider: 'azure-gpt-5-mini',
      patternGenerationProvider: 'openai-gpt-4o-mini',
    };
  }

  try {
    const preferences = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          const settings = JSON.parse(localStorage.getItem('jd-notes-settings') || '{}');
          return {
            autoSummaryProvider: settings.autoSummaryProvider || 'azure-gpt-5-mini',
            templateSummaryProvider: settings.templateSummaryProvider || 'azure-gpt-5-mini',
            patternGenerationProvider: settings.patternGenerationProvider || 'openai-gpt-4o-mini'
          };
        } catch (e) {
          return {
            autoSummaryProvider: 'azure-gpt-5-mini',
            templateSummaryProvider: 'azure-gpt-5-mini',
            patternGenerationProvider: 'openai-gpt-4o-mini'
          };
        }
      })()
    `);
    return preferences;
  } catch (error) {
    console.error('[LLM] Error reading provider preferences:', error);
    return {
      autoSummaryProvider: 'azure-gpt-5-mini',
      templateSummaryProvider: 'azure-gpt-5-mini',
      patternGenerationProvider: 'openai-gpt-4o-mini',
    };
  }
}

/**
 * Generate auto-summary, extract title, save everything, notify renderer
 * Works for ALL transcription providers (AssemblyAI, Deepgram, Recall.ai)
 *
 * This eliminates 40+ lines of duplication between transcription paths
 *
 * @param {string} meetingId - Meeting ID to generate summary for
 * @param {string} logPrefix - Prefix for console logs (e.g., '[Auto-Summary]', '[Recall.ai]')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function generateAndSaveAutoSummary(meetingId, logPrefix = '[Auto-Summary]') {
  console.log(`${logPrefix} Starting AI summary generation...`);

  return await withProviderSwitch(
    'auto',
    async () => {
      // Load fresh meeting data
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.pastMeetings.find(m => m.id === meetingId);

      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) {
        console.warn(`${logPrefix} Skipping - no transcript available`);
        return { success: false, error: 'No transcript' };
      }

      // Generate summary (may update meeting.title if generic)
      // Note: Don't stream progress during auto-summary to avoid race condition with title updates
      const summary = await generateMeetingSummary(meeting, null);

      // Save summary, title, and flag to file
      await fileOperationManager.scheduleOperation(async data => {
        const idx = data.pastMeetings.findIndex(m => m.id === meetingId);
        if (idx !== -1) {
          data.pastMeetings[idx].content = `# ${meeting.title}\n\n${summary}`;
          data.pastMeetings[idx].title = meeting.title; // May have been updated by generateMeetingSummary
          data.pastMeetings[idx].summaryGenerated = true;
          console.log(`${logPrefix} ✓ Summary and title saved`);
          console.log(`${logPrefix} ✓ Title: "${data.pastMeetings[idx].title}"`);
        }
        return data;
      });

      // Notify renderer to refresh UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('summary-generated', meetingId);
      }

      console.log(`${logPrefix} ✓ AI summary generation complete`);
      return { success: true };
    },
    logPrefix
  ).catch(error => {
    console.error(`${logPrefix} ✗ Error generating summary:`, error);
    // Don't throw - let caller decide how to handle
    return { success: false, error: error.message };
  });
}

/**
 * Load auto-summary system prompt from template file or use hardcoded fallback
 * Phase 10.3: Auto-Summary Template File
 * @param {boolean} needsTitleSuggestion - Whether to include title suggestion section
 * @returns {string} System prompt for auto-summary generation
 */
function loadAutoSummaryPrompt(needsTitleSuggestion) {
  try {
    // Try to load template file from userData/config/templates
    const templatePath = path.join(
      templateManager
        ? templateManager.templatesPath
        : path.join(app.getPath('userData'), 'config', 'templates'),
      'auto-summary-prompt.txt'
    );

    if (fs.existsSync(templatePath)) {
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Process template: handle {{#if needsTitleSuggestion}} conditional
      let processedTemplate = templateContent;

      if (needsTitleSuggestion) {
        // Include the title suggestion section, remove the handlebars tags
        processedTemplate = processedTemplate.replace(
          /\{\{#if needsTitleSuggestion\}\}\s*([\s\S]*?)\s*\{\{\/if\}\}/,
          '$1'
        );
      } else {
        // Remove the entire title suggestion section including tags
        processedTemplate = processedTemplate.replace(
          /\{\{#if needsTitleSuggestion\}\}\s*[\s\S]*?\s*\{\{\/if\}\}\s*/,
          ''
        );
      }

      console.log('[AutoSummary] Loaded prompt from template file:', templatePath);
      return processedTemplate;
    }
  } catch (error) {
    console.warn(
      '[AutoSummary] Failed to load template file, using hardcoded fallback:',
      error.message
    );
  }

  // Fallback to hardcoded prompt (original behavior)
  let systemMessage =
    'You are an AI assistant that summarizes meeting transcripts. ' +
    'You MUST format your response using the following structure:\n\n';

  if (needsTitleSuggestion) {
    systemMessage +=
      '# Suggested Title\n' +
      '[A concise, descriptive meeting title (5-8 words max) based on the main topic discussed]\n\n';
  }

  systemMessage +=
    '# Participants\n' +
    '- [List all participants mentioned in the transcript]\n\n' +
    '# Summary\n' +
    '- [Key discussion point 1]\n' +
    '- [Key discussion point 2]\n' +
    '- [Key decisions made]\n' +
    '- [Include any important deadlines or dates mentioned]\n\n' +
    '# Action Items\n' +
    '- [Action item 1] - [Responsible person if mentioned]\n' +
    '- [Action item 2] - [Responsible person if mentioned]\n' +
    '- [Add any other action items discussed]\n\n' +
    'Stick strictly to this format with these exact section headers. Keep each bullet point concise but informative.';

  console.log('[AutoSummary] Using hardcoded fallback prompt');
  return systemMessage;
}

// Function to generate AI summary from transcript with streaming support
async function generateMeetingSummary(meeting, progressCallback = null) {
  try {
    if (!meeting.transcript || meeting.transcript.length === 0) {
      console.log('No transcript available to summarize');
      return 'No transcript available to summarize.';
    }

    console.log(`Generating AI summary for meeting: ${meeting.id}`);

    // Check if title is generic and needs suggestion
    const genericTitles = [
      'transcript',
      'meeting',
      'imported',
      'untitled',
      'new meeting',
      'new note',
      'call',
      'zoom',
      'teams',
      'google meet',
      'krisp',
      'recording',
      'audio',
      'video',
    ];
    const currentTitle = (meeting.title || '').toLowerCase().trim();
    const needsTitleSuggestion = genericTitles.some(generic => {
      // Match if title IS the generic word, starts with it (including numbered variants like "transcript2"), or contains it as a word
      return (
        currentTitle === generic ||
        currentTitle.startsWith(generic) || // Matches "transcript", "transcript2", "transcript-foo", etc.
        currentTitle.includes(' ' + generic) ||
        currentTitle.includes(generic + ' ')
      );
    });

    if (needsTitleSuggestion) {
      console.log(
        `[AutoSummary] Generic title detected: "${meeting.title}" - will suggest better title`
      );
    }

    // Format the transcript into a single text for the AI to process
    // Use mapped speaker name if available (v1.1), fall back to original speaker
    const transcriptText = meeting.transcript
      .map(
        entry => `${entry.speakerName || entry.speakerDisplayName || entry.speaker}: ${entry.text}`
      )
      .join('\n');

    // Format detected participants if available
    let participantsText = '';
    if (meeting.participants && meeting.participants.length > 0) {
      participantsText =
        'Detected participants:\n' +
        meeting.participants.map(p => `- ${p.name}${p.isHost ? ' (Host)' : ''}`).join('\n');
    }

    // v1.1: Add user profile context for personalized summaries
    let userContextText = '';
    if (userProfile?.name) {
      const contextParts = [];
      contextParts.push(`The person reading this summary is ${userProfile.name}.`);
      if (userProfile.title) {
        contextParts.push(`Their role is ${userProfile.title}.`);
      }
      if (userProfile.organization) {
        contextParts.push(`They work at ${userProfile.organization}.`);
      }
      if (userProfile.context) {
        contextParts.push(userProfile.context);
      }
      userContextText = '\nUser Context:\n' + contextParts.join(' ');
      logger.main.debug('[AutoSummary] Including user profile context:', userContextText);
    }

    // Load system prompt from template file or use hardcoded fallback (Phase 10.3)
    const systemMessage = loadAutoSummaryPrompt(needsTitleSuggestion);

    // Prepare the user prompt
    const userPrompt = `Summarize the following meeting transcript with the EXACT format specified in your instructions:
${participantsText ? participantsText + '\n\n' : ''}${userContextText ? userContextText + '\n\n' : ''}
Transcript:
${transcriptText}`;

    // If no progress callback provided, use the non-streaming version
    if (!progressCallback) {
      const result = await llmService.generateCompletion({
        systemPrompt: systemMessage,
        userPrompt: userPrompt,
        maxTokens: 15000, // Safe limit for all models (OpenAI max: 16384, Azure/Anthropic higher)
        temperature: 0.7,
      });

      console.log(
        `AI summary generated successfully using ${llmService.getProviderName()} (${result.model})`
      );
      console.log(
        `[AutoSummary] Returning content:`,
        typeof result.content,
        result.content ? `${result.content.length} chars` : 'empty/null'
      );

      // Extract suggested title if present and update meeting
      let finalContent = result.content;
      if (needsTitleSuggestion && result.content) {
        const titleMatch = result.content.match(/# Suggested Title\s*\n([^\n]+)/i);
        if (titleMatch && titleMatch[1]) {
          const suggestedTitle = titleMatch[1].trim();
          console.log(`[AutoSummary] Extracted suggested title: "${suggestedTitle}"`);
          meeting.title = suggestedTitle;
          console.log(`[AutoSummary] Updated meeting title to: "${meeting.title}"`);

          // Remove the "# Suggested Title" section from the content
          finalContent = finalContent.replace(/# Suggested Title\s*\n[^\n]+\n+/i, '');
          console.log(`[AutoSummary] Removed suggested title section from content`);
        }
      }

      return finalContent;
    } else {
      // Use streaming version with progress callback
      const fullText = await llmService.streamCompletion({
        systemPrompt: systemMessage,
        userPrompt: userPrompt,
        maxTokens: 15000, // Safe limit for all models (OpenAI max: 16384, Azure/Anthropic higher)
        temperature: 0.7,
        onChunk: cumulativeText => {
          if (progressCallback) {
            progressCallback(cumulativeText);
          }
        },
      });

      console.log(`AI summary completed - ${fullText.length} characters`);

      if (fullText.length === 0) {
        console.warn('WARNING: AI returned empty summary!');
      }

      // Extract suggested title if present and update meeting
      let finalContent = fullText;
      if (needsTitleSuggestion && fullText) {
        const titleMatch = fullText.match(/# Suggested Title\s*\n([^\n]+)/i);
        if (titleMatch && titleMatch[1]) {
          const suggestedTitle = titleMatch[1].trim();
          console.log(`[AutoSummary] Extracted suggested title: "${suggestedTitle}"`);
          meeting.title = suggestedTitle;
          console.log(`[AutoSummary] Updated meeting title to: "${meeting.title}"`);

          // Remove the "# Suggested Title" section from the content
          finalContent = finalContent.replace(/# Suggested Title\s*\n[^\n]+\n+/i, '');
          console.log(`[AutoSummary] Removed suggested title section from content`);
        }
      }

      return finalContent;
    }
  } catch (error) {
    console.error('Error generating meeting summary:', error);

    // Generic error handling for all LLM providers
    if (error.status) {
      return `Error generating summary: API returned status ${error.status}: ${error.message}`;
    } else if (error.response) {
      // Handle errors with a response object
      return `Error generating summary: ${error.response.status} - ${error.response.data?.error?.message || error.message}`;
    } else {
      // Default error handling
      return `Error generating summary: ${error.message}`;
    }
  }
}

// Function to update a note with recording information when recording ends
// Note: This now only marks the recording as complete
// Transcription and summary generation are handled separately by processAsyncTranscription
async function updateNoteWithRecordingInfo(recordingId) {
  try {
    // Read the current meetings data
    let meetingsData;
    try {
      const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      meetingsData = JSON.parse(fileData);
    } catch (error) {
      console.error('Error reading meetings data:', error);
      return;
    }

    // Find the meeting note with this recording ID
    const noteIndex = meetingsData.pastMeetings.findIndex(
      meeting => meeting.recordingId === recordingId
    );

    if (noteIndex === -1) {
      console.error(`[Recording] ✗ No meeting note found for recordingId: ${recordingId}`);
      console.error(
        `[Recording] Available recordingIds in pastMeetings:`,
        meetingsData.pastMeetings.map(m => m.recordingId || 'none').join(', ')
      );
      console.error(
        `[Recording] Available meeting IDs:`,
        meetingsData.pastMeetings
          .map(m => m.id)
          .slice(0, 5)
          .join(', ')
      );
      return;
    }

    // Format current date
    const now = new Date();
    const formattedDate = now.toLocaleString();

    // Update the meeting note content
    const meeting = meetingsData.pastMeetings[noteIndex];
    const content = meeting.content;

    // Replace the "Recording: In Progress..." line with completed information
    const updatedContent = content.replace(
      'Recording: In Progress...',
      `Recording: Completed at ${formattedDate}\nTranscribing audio...\n`
    );

    // Update the meeting object
    meeting.content = updatedContent;
    meeting.recordingComplete = true;
    meeting.recordingEndTime = now.toISOString();

    // Save the update
    await fileOperationManager.writeData(meetingsData);

    console.log('Recording marked as complete - async transcription will begin');

    // If the note is currently open, notify the renderer to refresh it
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-completed', meeting.id);
    }
  } catch (error) {
    console.error('Error updating note with recording info:', error);
  }
}

// Function to check if there's a detected meeting available
ipcMain.handle('checkForDetectedMeeting', async () => {
  return detectedMeeting !== null;
});

// Function to join the detected meeting
ipcMain.handle(
  'joinDetectedMeeting',
  withValidation(transcriptionProviderSchema, async (event, transcriptionProvider = 'assemblyai') => {
    return joinDetectedMeeting(transcriptionProvider);
  })
);

// Function to handle joining a detected meeting
async function joinDetectedMeeting(transcriptionProvider = 'assemblyai') {
  try {
    console.log('Join detected meeting called');
    console.log('Using transcription provider:', transcriptionProvider);

    if (!detectedMeeting) {
      console.log('No detected meeting available');
      return { success: false, error: 'No active meeting detected' };
    }

    // Map platform codes to readable names
    const platformNames = {
      zoom: 'Zoom',
      'google-meet': 'Google Meet',
      slack: 'Slack',
      teams: 'Microsoft Teams',
    };

    // Get a user-friendly platform name, or use the raw platform name if not in our map
    const platformName =
      platformNames[detectedMeeting.window.platform] || detectedMeeting.window.platform;

    console.log('Joining detected meeting for platform:', platformName);

    // Ensure main window exists and is visible
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('Creating new main window');
      createWindow();
    }

    // Bring window to front with focus
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    // Process with more reliable timing
    return new Promise(resolve => {
      // Wait a moment for the window to be fully focused and ready
      setTimeout(async () => {
        console.log('Window is ready, creating new meeting note');

        try {
          // Create a new meeting note and start recording
          const id = await createMeetingNoteAndRecord(platformName, transcriptionProvider);

          console.log('Created new meeting with ID:', id);
          resolve({ success: true, meetingId: id });
        } catch (err) {
          console.error('Error creating meeting note:', err);
          resolve({ success: false, error: err.message });
        }
      }, 800); // Increased timeout for more reliability
    });
  } catch (error) {
    console.error('Error in joinDetectedMeeting:', error);
    return { success: false, error: error.message };
  }
}
