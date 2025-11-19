const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, globalShortcut, shell, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('fs');
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
const { createLLMServiceFromEnv } = require('./main/services/llmService');
const transcriptionService = require('./main/services/transcriptionService');
const keyManagementService = require('./main/services/keyManagementService');
const { createIpcHandler } = require('./main/utils/ipcHelpers');
const yaml = require('js-yaml');
// const encryptionService = require('./main/services/encryptionService'); // Not needed - Obsidian requires plain text
const expressApp = require('./server');
const ngrokManager = require('./main/services/ngrokManager');
const log = require('electron-log');
// IPC Input Validation - Phase 9 Security Hardening
// ===================================================
// To add validation to remaining IPC handlers, follow this pattern:
//
// Before:
//   ipcMain.handle('my:handler', async (event, data) => { ... });
//
// After:
//   ipcMain.handle('my:handler', withValidation(myHandlerSchema, async (event, data) => { ... }));
//
// All schemas are defined in src/main/validation/ipcSchemas.js
// Validated handlers: templates:generateSummaries, llm:switchProvider
// Remaining handlers (34): Apply the same pattern using appropriate schemas
// ===================================================
const {
  withValidation,
  saveMeetingsDataSchema,
  googleAuthenticateSchema,
  templatesGenerateSummariesSchema,
  llmSwitchProviderSchema,
  obsidianExportMeetingSchema,
  importFileSchema,
  importBatchSchema,
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
  recording: log.scope('Recording'),
  webhook: log.scope('Webhook'),
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
const llmService = createLLMServiceFromEnv();
logger.main.info(`LLM Service initialized with provider: ${llmService.getProviderName()}`);

// Pattern Generation Service removed (Phase 10.8.3 removed)

// Express server instance (for webhook endpoint)
let expressServer = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
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
let tray = null; // System tray icon (Phase 10.7)
let isRecording = false; // Track recording state for UI updates (Phase 10.7)

// Meeting monitor state
const notifiedMeetings = new Set(); // Track meetings we've shown notifications for
const autoStartedMeetings = new Set(); // Track meetings we've auto-started recording
let meetingMonitorInterval = null;

// App settings storage (Phase 10.7)
let appSettings = {
  notifications: {
    enableToasts: true,
    enableSounds: true,
    minimizeToTray: true,
  },
  shortcuts: {
    startStopRecording: 'CommandOrControl+Shift+R',
    quickRecord: 'CommandOrControl+Shift+Q',
    stopRecording: 'CommandOrControl+Shift+S',
  },
  windowBounds: null, // Will store {x, y, width, height, displayId}
};

// Settings file path (Phase 10.7)
const SETTINGS_FILE_PATH = () => path.join(app.getPath('userData'), 'app-settings.json');

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
 * Create system tray icon and menu (Phase 10.7)
 */
function createSystemTray() {
  try {
    // Create tray icon - try multiple sources
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
        data: Buffer.alloc(16 * 16 * 4) // RGBA
      };

      // Fill with orange color (since user mentioned seeing orange)
      for (let i = 0; i < canvas.data.length; i += 4) {
        canvas.data[i] = 255;     // R
        canvas.data[i + 1] = 140; // G
        canvas.data[i + 2] = 0;   // B (orange color)
        canvas.data[i + 3] = 255; // A
      }

      trayIcon = nativeImage.createFromBuffer(canvas.data, {
        width: canvas.width,
        height: canvas.height
      });
    }

    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open JD Notes Things',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
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
        }
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
        }
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
        }
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
        }
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
        }
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
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('JD Notes Things');
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
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open JD Notes Things',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
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
        }
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
        }
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
        }
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
        }
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
        }
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
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(isRecording ? 'JD Notes Things - Recording' : 'JD Notes Things');
    logger.main.debug('[Tray] Menu updated, recording:', isRecording);
  } catch (error) {
    logger.main.error('[Tray] Failed to update tray menu:', error);
  }
}

/**
 * Update tray menu to reflect recording state (Phase 10.7)
 */
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

      // Auto-start recording when meeting starts (within 1 minute window)
      if (
        minutesUntilStart <= 0 &&
        minutesUntilStart >= -1 &&
        !autoStartedMeetings.has(meeting.id)
      ) {
        logger.monitor.info(`Auto-starting recording for: ${meeting.title}`);
        await autoStartRecording(meeting);
        autoStartedMeetings.add(meeting.id);
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
  let windowOptions = {
    width: 1024,
    height: 768,
    icon: path.join(__dirname, 'assets', 'jd-notes-things.ico'),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f9f9f9',
  };

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
  mainWindow.on('minimize', (event) => {
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
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && appSettings.notifications.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
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

  // Initialize the Recall.ai SDK
  initSDK();

  // Note: EncryptionService initialization removed (Phase 10.2)
  // Vault file encryption not needed - Obsidian requires plain text files
  // Service kept for potential future use (audio files, temp files, etc.)

  // Initialize Unified Google Authentication (Calendar + Contacts)
  console.log('[GoogleAuth] Initializing unified Google authentication...');
  googleAuth = new GoogleAuth();
  const authInitialized = await googleAuth.initialize();

  if (authInitialized) {
    console.log('[GoogleAuth] Authenticated successfully - initializing services');
    // Use centralized initialization to prevent race conditions
    await initializeGoogleServices();
  } else {
    console.log('[GoogleAuth] Not authenticated - user needs to sign in');
    console.log('[GoogleAuth] Calendar and Contacts features will be disabled until authenticated');
  }

  // Initialize Template Manager (Phase 4)
  console.log('[TemplateManager] Initializing template system...');
  templateManager = new TemplateManager();

  // Use project root config/templates during development
  if (process.env.NODE_ENV === 'development') {
    const projectRoot = path.join(__dirname, '..', '..');
    templateManager.templatesPath = path.join(projectRoot, 'config', 'templates');
    console.log('[TemplateManager] Development mode - using:', templateManager.templatesPath);
  }

  const templateCount = templateManager.scanTemplates();
  console.log(`[TemplateManager] Loaded ${templateCount} templates`);

  // Initialize Obsidian Export System (Phase 5)
  console.log('[ObsidianExport] Initializing vault and routing system...');

  // Read vault path from environment variable (supports relative and absolute paths)
  let vaultPath = process.env.VAULT_PATH || './vault';

  // If path is relative, resolve it from project root
  if (!path.isAbsolute(vaultPath)) {
    const projectRoot = path.join(__dirname, '..', '..');
    vaultPath = path.resolve(projectRoot, vaultPath);
  }

  console.log('[ObsidianExport] Vault path:', vaultPath);
  vaultStructure = new VaultStructure(vaultPath);

  // Use project root config/routing.yaml during development
  let configPath;
  if (process.env.NODE_ENV === 'development') {
    const projectRoot = path.join(__dirname, '..', '..');
    configPath = path.join(projectRoot, 'config', 'routing.yaml');
    console.log('[ObsidianExport] Development mode - using routing config:', configPath);
  } else {
    configPath = path.join(app.getPath('userData'), 'config', 'routing.yaml');
  }

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
    });
    console.log('[Import] Import manager initialized successfully');
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
  expressServer = expressApp.listen(13373, async () => {
    console.log('[Webhook Server] Listening on http://localhost:13373');
    console.log('[Webhook Server] Endpoint: http://localhost:13373/webhook/recall');

    // Start ngrok tunnel automatically (if configured)
    try {
      const webhookUrl = await ngrokManager.start(13373);

      // Store webhook URL globally so server.js can access it
      global.webhookUrl = `${webhookUrl}/webhook/recall`;

      console.log('\n' + '='.repeat(70));
      console.log('🌐 NGROK TUNNEL ESTABLISHED');
      console.log('='.repeat(70));
      console.log(`Public Webhook URL: ${global.webhookUrl}`);
      console.log(`\nWebhook URL will be automatically included in upload tokens.`);
      console.log('='.repeat(70) + '\n');
    } catch (error) {
      console.log('\n' + '⚠'.repeat(35));
      console.log('⚠️  NGROK NOT CONFIGURED');
      console.log('⚠'.repeat(35));
      console.log('Webhooks will not work until ngrok is configured.');
      console.log('See docs/WEBHOOK_SETUP.md for setup instructions.');
      console.log('Error:', error.message);
      console.log('⚠'.repeat(35) + '\n');
    }
  });

  // Phase 10.7: Desktop App Polish
  // Load app settings from disk
  loadAppSettings();
  logger.main.info('[Phase 10.7] App settings loaded');

  // Make mainWindow available to server.js for IPC communication
  // This allows server.js to send webhook events to the main process
  global.mainWindow = null; // Will be set after createWindow()

  createWindow();

  // Set global reference after window is created
  global.mainWindow = mainWindow;

  // Phase 10.7: Create system tray and register shortcuts (after window creation)
  createSystemTray();
  registerGlobalShortcuts();

  // When the window is ready, send the initial meeting detection status
  mainWindow.webContents.on('did-finish-load', () => {
    // Send the initial meeting detection status
    mainWindow.webContents.send('meeting-detection-status', { detected: detectedMeeting !== null });
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

  // Stop meeting monitor
  if (meetingMonitorInterval) {
    clearInterval(meetingMonitorInterval);
    console.log('[Meeting Monitor] Stopped meeting monitor');
  }

  // Stop ngrok tunnel
  await ngrokManager.stop();

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

// Create a desktop SDK upload token directly (no separate server needed)
async function createDesktopSdkUpload() {
  try {
    const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
    const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

    if (!RECALLAI_API_KEY) {
      console.error('RECALLAI_API_KEY is missing! Set it in .env file');
      return null;
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

        // No real-time transcription - we'll use Recall.ai async API after recording
        // This gives us better quality and proper speaker diarization
        realtime_endpoints: [
          {
            type: 'desktop_sdk_callback',
            events: [
              'participant_events.join', // Only track participant info
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
    console.error('Error creating upload token:', error.response?.data || error.message);
    return null;
  }
}

// Initialize the Recall.ai SDK
function initSDK() {
  console.log('Initializing Recall.ai SDK');

  // Log the SDK initialization
  sdkLogger.logApiCall('init', {
    apiUrl: process.env.RECALLAI_API_URL,
    acquirePermissionsOnStartup: ['accessibility', 'screen-capture', 'microphone'],
    restartOnError: true,
    config: {
      recording_path: RECORDING_PATH,
    },
  });

  const sdkConfig = {
    apiUrl: process.env.RECALLAI_API_URL,
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
      mainWindow.webContents.send('meeting-detection-status', { detected: true });
      // Send toast notification to renderer
      mainWindow.webContents.send('show-toast', {
        message: `${platformName} meeting detected`,
        type: 'info'
      });
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
      mainWindow.webContents.send('meeting-detection-status', { detected: false });
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

      // Get the meeting ID and transcription provider
      let transcriptionProvider = 'recallai'; // Default
      let meetingId = null;
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
        }
      } catch (error) {
        console.error(
          '[Transcription] Error reading transcription provider, using default:',
          error
        );
      }

      // Immediately notify renderer that recording has ended (update UI right away)
      if (mainWindow && !mainWindow.isDestroyed() && meetingId) {
        console.log('[Recording] Notifying renderer that recording ended - updating UI immediately');
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

            console.log(`[Transcription] Calling transcriptionService.transcribe()...`);
            const transcript = await transcriptionService.transcribe(
              transcriptionProvider,
              recordingPath
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
              meetingsData.pastMeetings[meetingIndex].transcript = transcript.entries;
              meetingsData.pastMeetings[meetingIndex].transcriptProvider = transcript.provider;
              meetingsData.pastMeetings[meetingIndex].transcriptConfidence = transcript.confidence;

              console.log('[Transcription] Writing updated meeting data...');
              await fileOperationManager.writeData(meetingsData);
              console.log('[Transcription] ✓ Transcript saved to meeting');

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

  RecallAiSdk.addEventListener('permissions-granted', async evt => {
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
 * Export a meeting to Obsidian vault with two-file structure
 * @param {Object} meeting - Meeting object with transcript and summaries
 * @returns {Promise<Object>} Export result with paths created
 */
async function exportMeetingToObsidian(meeting) {
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

        // Match speakers to participants
        const speakerMapping = await speakerMatcher.matchSpeakers(
          meeting.transcript,
          participantEmails,
          { includeOrganizer: true, useWordCount: true }
        );

        // Apply mapping to transcript
        meeting.transcript = speakerMatcher.applyMappingToTranscript(
          meeting.transcript,
          speakerMapping
        );

        // Store mapping in meeting object for future reference
        meeting.speakerMapping = speakerMapping;

        console.log('[ObsidianExport] Speaker matching completed successfully');
      } catch (error) {
        console.warn(
          '[ObsidianExport] Speaker matching failed, continuing without:',
          error.message
        );
      }
    } else if (meeting.transcript && meeting.transcript.length > 0) {
      console.log(
        '[ObsidianExport] Speaker matching skipped - speaker matcher not available or no participants'
      );
    }

    // Get routing decisions (or use manual override)
    let routes;
    if (meeting.obsidianLink) {
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

  // Build participants array for frontmatter with speaker mapping (Phase 6)
  let participantsYaml = '';

  // Use meeting.participants (from participant join events) if available
  if (meeting.participants && meeting.participants.length > 0) {
    participantsYaml = meeting.participants
      .map(participant => {
        let participantLine = `  - name: "${participant.name}"`;

        // Include email if available
        if (participant.email) {
          participantLine += `\n    email: "${participant.email}"`;
        }

        // Include host status
        if (participant.isHost) {
          participantLine += `\n    role: "host"`;
        }

        // If we have speaker mapping, include which speaker label(s) map to this participant
        if (meeting.speakerMapping) {
          const speakerLabels = Object.entries(meeting.speakerMapping)
            .filter(([label, info]) => info.name === participant.name)
            .map(([label, info]) => label);

          if (speakerLabels.length > 0) {
            participantLine += `\n    speaker_labels: [${speakerLabels.join(', ')}]`;
          }
        }

        return participantLine;
      })
      .join('\n');
  }
  // Fallback to participantEmails if participants array doesn't exist
  else if (meeting.participantEmails && meeting.participantEmails.length > 0) {
    participantsYaml = meeting.participantEmails
      .map(email => {
        let participantLine = `  - email: "${email}"`;

        // If we have speaker mapping, include which speaker label(s) map to this participant
        if (meeting.speakerMapping) {
          const speakerLabels = Object.entries(meeting.speakerMapping)
            .filter(([label, info]) => info.email === email)
            .map(([label, info]) => label);

          if (speakerLabels.length > 0) {
            participantLine += `\n    name: "${meeting.speakerMapping[speakerLabels[0]].name}"`;
            participantLine += `\n    speaker_labels: [${speakerLabels.join(', ')}]`;
          }
        }

        return participantLine;
      })
      .join('\n');
  }

  // Extract tags from meeting metadata
  const tags = ['meeting'];
  if (meeting.platform) tags.push(meeting.platform.toLowerCase());

  // Build frontmatter
  let markdown = `---
title: "${title}"
date: ${dateStr}
platform: "${meeting.platform || 'unknown'}"
transcript_file: "${baseFilename}-transcript.md"
participants:
${participantsYaml || '  []'}
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

  let markdown = `---
title: "${title} - Full Transcript"
date: ${dateStr}
summary_file: "${baseFilename}.md"
---

# Full Transcript: ${title}

**Back to summary:** [[${baseFilename}]]

**Date:** ${meetingDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
**Platform:** ${meeting.platform || 'Unknown'}

---

`;

  // Add transcript
  if (meeting.transcript) {
    if (Array.isArray(meeting.transcript)) {
      // Transcript is array of segments with timestamps
      for (const segment of meeting.transcript) {
        if (typeof segment === 'object') {
          // Use speaker name from Phase 6 matching if available, otherwise fall back to raw label
          const speaker = segment.speakerName || segment.speaker || 'Speaker';
          const timestamp = segment.timestamp || '';
          const text = segment.text || '';

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
          return `${segment.speaker || 'Speaker'}: ${segment.text}`;
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
    const safeConcurrency = Math.max(1, Math.floor(tokenBudgetPerMinute / estimatedTokensPerRequest));
    const actualConcurrency = Math.min(3, safeConcurrency); // Cap at 3 for safety

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
    for (const [templateId, templateData] of templateMap) {
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

// Debug handler to check if IPC handlers are registered
ipcMain.handle('debugGetHandlers', async () => {
  console.log('Checking registered IPC handlers...');
  const handlers = Object.keys(ipcMain._invokeHandlers);
  console.log('Registered handlers:', handlers);
  return handlers;
});

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
ipcMain.handle('google:getAuthUrl', async () => {
  try {
    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }
    const authUrl = googleAuth.getAuthUrl();
    return { success: true, authUrl };
  } catch (error) {
    console.error('[Google IPC] Failed to get auth URL:', error);
    return { success: false, error: error.message };
  }
});

// Authenticate with authorization code (with CSRF protection)
ipcMain.handle('google:authenticate', async (event, { code, state }) => {
  try {
    console.log('[Google IPC] Authenticating with code and state');
    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }

    // Pass state parameter for CSRF validation
    await googleAuth.getTokenFromCode(code, state);

    // Use centralized initialization to prevent race conditions
    if (googleAuth.isAuthenticated()) {
      await initializeGoogleServices();
      console.log('[Google IPC] Successfully authenticated Google Calendar + Contacts');
    }

    return { success: true };
  } catch (error) {
    console.error('[Google IPC] Authentication failed:', error);
    return { success: false, error: error.message };
  }
});

// Check if user is authenticated
ipcMain.handle('google:isAuthenticated', async () => {
  try {
    if (!googleAuth) {
      return { success: true, authenticated: false };
    }
    const authenticated = googleAuth.isAuthenticated();
    return { success: true, authenticated };
  } catch (error) {
    console.error('[Google IPC] Error checking authentication:', error);
    return { success: false, error: error.message };
  }
});

// Get authentication status (includes contact count, etc.)
ipcMain.handle('google:getStatus', async () => {
  try {
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
  } catch (error) {
    console.error('[Google IPC] Error getting status:', error);
    return { success: false, error: error.message };
  }
});

// Sign out and clear tokens
ipcMain.handle('google:signOut', async () => {
  try {
    console.log('[Google IPC] Signing out');
    if (googleAuth) {
      await googleAuth.revokeAuthentication();
    }

    // Reset services
    googleCalendar = null;
    googleContacts = null;
    speakerMatcher = null;

    return { success: true };
  } catch (error) {
    console.error('[Google IPC] Failed to sign out:', error);
    return { success: false, error: error.message };
  }
});

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
ipcMain.handle('calendar:getUpcomingMeetings', async (event, hoursAhead = 24) => {
  try {
    console.log(`[Calendar IPC] Fetching upcoming meetings (${hoursAhead} hours ahead)`);
    const meetings = await googleCalendar.getUpcomingMeetings(hoursAhead);
    console.log(`[Calendar IPC] Found ${meetings.length} upcoming meetings`);
    return { success: true, meetings };
  } catch (error) {
    console.error('[Calendar IPC] Failed to fetch meetings:', error);
    return { success: false, error: error.message };
  }
});

// ===================================================================
// Google Contacts & Speaker Matching Service-Specific IPC Handlers
// ===================================================================

// Fetch/refresh contacts from Google
ipcMain.handle('contacts:fetchContacts', async (event, forceRefresh = false) => {
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
});

// Search contacts by query string (name or email)
ipcMain.handle('contacts:searchContacts', async (event, query) => {
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
        contact.emails && contact.emails.some(email => email.toLowerCase().includes(normalizedQuery));
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
});

// Match speakers to participants
ipcMain.handle(
  'speakers:matchSpeakers',
  async (event, { transcript, participantEmails, options }) => {
    try {
      console.log('[Speakers IPC] Matching speakers to participants');
      if (!speakerMatcher) {
        throw new Error('Speaker matcher not initialized');
      }

      // Perform speaker matching
      const speakerMapping = await speakerMatcher.matchSpeakers(
        transcript,
        participantEmails,
        options
      );

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
  }
);

// Update speaker mapping manually (for corrections)
ipcMain.handle(
  'speakers:updateMapping',
  async (event, { meetingId, speakerLabel, participantEmail }) => {
    try {
      console.log(
        `[Speakers IPC] Updating speaker mapping: ${speakerLabel} -> ${participantEmail}`
      );

      // Load meeting data
      const meetingsData = await fileOperationManager.readMeetingsData();
      const meeting = meetingsData.meetings.find(m => m.id === meetingId);

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
      await fileOperationManager.writeMeetingsData(meetingsData);

      return { success: true, speakerMapping: meeting.speakerMapping };
    } catch (error) {
      console.error('[Speakers IPC] Failed to update mapping:', error);
      return { success: false, error: error.message };
    }
  }
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
ipcMain.handle('templates:getById', async (event, templateId) => {
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
});

// Get template raw file content for editing (Phase 10.3)
ipcMain.handle('templates:getContent', async (event, templateId) => {
  try {
    console.log('[Template IPC] Getting template content:', templateId);
    const template = templateManager.getTemplate(templateId);
    if (!template) {
      return { success: false, error: 'Template not found' };
    }

    // Read raw file content
    const filePath = template.filePath || path.join(templateManager.templatesPath, `${templateId}${template.format}`);
    const content = fs.readFileSync(filePath, 'utf8');

    return { success: true, content };
  } catch (error) {
    console.error('[Template IPC] Failed to get template content:', error);
    return { success: false, error: error.message };
  }
});

// Estimate cost for templates
ipcMain.handle('templates:estimateCost', async (event, { templateIds, transcript }) => {
  try {
    console.log('[Template IPC] Estimating cost for', templateIds.length, 'templates');
    const estimate = templateManager.estimateCost(templateIds, transcript);
    return { success: true, estimate };
  } catch (error) {
    console.error('[Template IPC] Failed to estimate cost:', error);
    return { success: false, error: error.message };
  }
});

// Generate summaries using multiple templates
ipcMain.handle(
  'templates:generateSummaries',
  withValidation(templatesGenerateSummariesSchema, async (event, { meetingId, templateIds }) => {
    try {
      console.log(
        '[Template IPC] Generating summaries for meeting:',
        meetingId,
        'with',
        templateIds.length,
        'templates'
      );

    // Load meeting data
    const data = await fileOperationManager.readMeetingsData();
    const meeting = [...data.upcomingMeetings, ...data.pastMeetings].find(m => m.id === meetingId);

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
    const exportResult = await exportMeetingToObsidian(meeting);

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
  })
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

// Helper function to get routing config path (same logic as RoutingEngine initialization)
function getRoutingConfigPath() {
  if (process.env.NODE_ENV === 'development') {
    const projectRoot = path.join(__dirname, '..', '..');
    return path.join(projectRoot, 'config', 'routing.yaml');
  } else {
    return path.join(app.getPath('userData'), 'config', 'routing.yaml');
  }
}

// Get routing configuration
ipcMain.handle('routing:getConfig', createIpcHandler(async () => {
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
}));

// Save routing configuration
ipcMain.handle('routing:saveConfig', createIpcHandler(async (event, content) => {
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
}));

// Validate routing configuration
ipcMain.handle('routing:validateConfig', createIpcHandler(async (event, content) => {
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
}));

// Test routing with given emails
ipcMain.handle('routing:testEmails', createIpcHandler(async (event, emails) => {
  console.log('[Routing IPC] Testing routing with emails:', emails);

  if (!routingEngine) {
    throw new Error('Routing engine not initialized');
  }

  // Create a mock meeting object with participants
  const mockMeeting = {
    participants: emails.map(email => ({ email })),
  };

  // Use routing engine to determine vault path
  const result = routingEngine.determineMeetingPath(mockMeeting);

  return {
    vaultPath: result.vaultPath,
    reason: result.reason,
    matchedOrganizations: result.matchedOrgs || [],
    matchedEmails: emails.filter(email => {
      return routingEngine.findMatchingOrganization(email) !== null;
    }),
  };
}));

// Add new organization to routing config
ipcMain.handle('routing:addOrganization', createIpcHandler(async (event, { type, id, vaultPath, emails, contacts }) => {
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

  if (!['clients', 'industry'].includes(type)) {
    throw new Error('Type must be "clients" or "industry"');
  }

  // Check if organization already exists
  if (config[type] && config[type][id]) {
    throw new Error(`Organization "${id}" already exists in ${type}`);
  }

  // Initialize section if it doesn't exist
  if (!config[type]) {
    config[type] = {};
  }

  // Add the new organization
  config[type][id] = {
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

  return { content: newContent };
}));

// Delete organization from routing config
ipcMain.handle('routing:deleteOrganization', createIpcHandler(async (event, { type, id }) => {
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

  // Check if organization exists
  if (!config[type] || !config[type][id]) {
    throw new Error(`Organization "${id}" not found in ${type}`);
  }

  // Prevent deleting internal (it's special)
  if (type === 'internal') {
    throw new Error('Cannot delete internal organization');
  }

  // Create backup before deleting
  const backupPath = routingPath.replace('.yaml', '.backup.yaml');
  if (fs.existsSync(routingPath)) {
    fs.copyFileSync(routingPath, backupPath);
    console.log('[Routing IPC] Created backup at:', backupPath);
  }

  // Delete the organization
  delete config[type][id];

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

  return { content: newContent };
}));

// Restore routing configuration from backup
ipcMain.handle('routing:restoreBackup', createIpcHandler(async () => {
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
}));

// ===================================================================
// End Routing Configuration IPC Handlers
// ===================================================================

// ===================================================================
// LLM Provider Management
// ===================================================================

// Get current LLM provider
ipcMain.handle('llm:getProvider', async () => {
  try {
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
ipcMain.handle('obsidian:exportMeeting', async (event, meetingId) => {
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
});

// Get export status/configuration
ipcMain.handle('obsidian:getStatus', async () => {
  return {
    initialized: !!(vaultStructure && routingEngine),
    vaultPath: vaultStructure ? vaultStructure.vaultBasePath : null,
    routingConfigured: !!routingEngine,
  };
});

// ===================================================================
// End Obsidian Export IPC Handlers
// ===================================================================

// ===================================================================
// Import Transcripts IPC Handlers (Phase 8)
// ===================================================================

// Import a single file
ipcMain.handle('import:importFile', async (event, { filePath, options }) => {
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
});

// Import multiple files in batch
ipcMain.handle('import:importBatch', async (event, { filePaths, options }) => {
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
});

// Get import manager status
ipcMain.handle('import:getStatus', async () => {
  return {
    initialized: !!importManager,
    supportedFormats: ['.txt', '.md', '.vtt', '.srt'],
  };
});

// Select files for import using Electron dialog
ipcMain.handle('import:selectFiles', async () => {
  const { dialog } = require('electron');
  const fs = require('fs').promises;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Transcript Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Transcript Files', extensions: ['txt', 'md', 'vtt', 'srt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return [];
  }

  // Get file stats to include file sizes
  const filesWithStats = await Promise.all(
    result.filePaths.map(async filePath => {
      try {
        const stats = await fs.stat(filePath);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
        };
      } catch (error) {
        console.error(`Error getting stats for ${filePath}:`, error);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: 0,
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
ipcMain.handle('patterns:readFile', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    logger.main.error('[Patterns] Failed to read file:', error);
    return { success: false, error: error.message };
  }
});

// Test parsing with given patterns and sample text
ipcMain.handle('patterns:testParse', async (event, { content, filePath }) => {
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
});

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
ipcMain.handle('patterns:saveConfig', async (event, { configYaml }) => {
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
});

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

// Get vault path
ipcMain.handle('settings:getVaultPath', async () => {
  return vaultStructure?.vaultBasePath || null;
});

// Get AI provider preferences (Phase 10.3)
ipcMain.handle('settings:getProviderPreferences', async (event) => {
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
ipcMain.handle('app:updateSettings', async (event, updates) => {
  try {
    // Merge updates into current settings
    if (updates.recordingQuality) {
      appSettings.recordingQuality = { ...appSettings.recordingQuality, ...updates.recordingQuality };
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

    // Save to disk
    saveAppSettings();
    logger.ipc.info('[IPC] app:updateSettings - Settings updated successfully');

    return { success: true, data: appSettings };
  } catch (error) {
    logger.ipc.error('[IPC] app:updateSettings failed:', error);
    return { success: false, error: error.message };
  }
});

// Get application logs (Phase 10.7)
ipcMain.handle('app:getLogs', async (event, options = {}) => {
  try {
    const { limit = 1000, level = 'all' } = options;

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
      }
    };
  } catch (error) {
    logger.ipc.error('[IPC] app:getLogs failed:', error);
    return { success: false, error: error.message };
  }
});

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
      keys.map(async (key) => {
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
ipcMain.handle('keys:get', async (event, keyName) => {
  try {
    const value = await keyManagementService.getKey(keyName);
    return { success: true, data: value };
  } catch (error) {
    log.error(`[IPC] keys:get failed for ${keyName}:`, error);
    return { success: false, error: error.message };
  }
});

// Set an API key
ipcMain.handle('keys:set', async (event, keyName, value) => {
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
});

// Delete an API key
ipcMain.handle('keys:delete', async (event, keyName) => {
  try {
    const deleted = await keyManagementService.deleteKey(keyName);
    return { success: true, data: deleted };
  } catch (error) {
    log.error(`[IPC] keys:delete failed for ${keyName}:`, error);
    return { success: false, error: error.message };
  }
});

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
ipcMain.handle('keys:test', async (event, keyName) => {
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
});

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

// Handler to get active recording ID for a note
ipcMain.handle('getActiveRecordingId', async (event, noteId) => {
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
});

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
  async (event, meetingId, transcriptionProvider = 'recallai') => {
    try {
      // Validate meetingId
      const validatedId = MeetingIdSchema.parse(meetingId);
      console.log(`Starting manual desktop recording for meeting: ${validatedId}`);
      console.log(`Using transcription provider: ${transcriptionProvider}`);

      // Read current data
      const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
      const meetingsData = JSON.parse(fileData);

      // Find the meeting
      const pastMeetingIndex = meetingsData.pastMeetings.findIndex(
        meeting => meeting.id === validatedId
      );

      if (pastMeetingIndex === -1) {
        return { success: false, error: 'Meeting not found' };
      }

      const meeting = meetingsData.pastMeetings[pastMeetingIndex];

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
          return { success: false, error: 'Failed to create recording token' };
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

        RecallAiSdk.startRecording({
          windowId: key,
          uploadToken: uploadData.upload_token,
        });

        // Update recording state and tray menu (Phase 10.7)
        isRecording = true;
        updateSystemTrayMenu();

        return {
          success: true,
          recordingId: key,
        };
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
      console.warn(`SDK stopRecording failed: ${sdkError.message} - recording may have already ended`);

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
      const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
      const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

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

  handleTranscriptFailed: async ({ transcriptId, recordingId, error }) => {
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
    const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
    const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

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
ipcMain.on('webhook-transcript-failed', async (event, { transcriptId, recordingId, error }) => {
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
});

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
ipcMain.handle('generateMeetingSummaryStreaming', async (event, meetingId) => {
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
});

// Handle manual transcript fetch for a meeting
ipcMain.handle('fetchTranscript', async (event, meetingId) => {
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
});

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
async function createMeetingNoteAndRecord(platformName, transcriptionProvider = 'recallai') {
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
    console.log(
      `[Meeting Creation] Creating meeting for detected ${platformName}, windowId: ${detectedMeeting.window.id}`
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
      platform: platformName,
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

    console.log(`Participant joined: ${participantName} (ID: ${participantId}, Host: ${isHost})`);

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

      if (existingParticipantIndex !== -1) {
        // Update existing participant
        meeting.participants[existingParticipantIndex] = {
          id: participantId,
          name: participantName,
          isHost: isHost,
          platform: platform,
          joinTime: new Date().toISOString(),
          status: 'active',
        };
      } else {
        // Add new participant
        meeting.participants.push({
          id: participantId,
          name: participantName,
          isHost: isHost,
          platform: platform,
          joinTime: new Date().toISOString(),
          status: 'active',
        });
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

// Store speaker labels per window (AssemblyAI speaker diarization)
const windowSpeakerLabels = new Map(); // windowId -> latest speaker label

/**
 * Match speaker labels to participant names using simple heuristics
 * @param {Object} meeting - Meeting object with transcript and participants
 */
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
 */
async function pollForUploadCompletion(windowId) {
  const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
  const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

  if (!RECALLAI_API_KEY) {
    throw new Error('RECALLAI_API_KEY not set in .env file');
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

  const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
  const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

  if (!RECALLAI_API_KEY) {
    throw new Error('RECALLAI_API_KEY not set in .env file');
  }

  try {
    // Find the meeting for this recording
    const meetingsData = await fileOperationManager.readMeetingsData();
    const meeting = meetingsData.pastMeetings.find(m => m.recordingId === windowId);

    if (!meeting) {
      throw new Error(`No meeting found for window ID: ${windowId}`);
    }

    // Get expected speaker count from participants
    const speakersExpected = meeting.participants ? meeting.participants.length : null;

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
  const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
  const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

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
async function processRecallAITranscript(transcript, meetingId, windowId) {
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
        data.pastMeetings[meetingIndex].transcript = processedTranscript;
        data.pastMeetings[meetingIndex].transcriptComplete = true;
        console.log(`[Recall.ai] Updated meeting with ${processedTranscript.length} utterances`);
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
    // Try to load template file from config/templates
    const templatePath = path.join(
      templateManager ? templateManager.templatesPath : path.join(__dirname, '..', 'config', 'templates'),
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
    console.warn('[AutoSummary] Failed to load template file, using hardcoded fallback:', error.message);
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
    const transcriptText = meeting.transcript
      .map(entry => `${entry.speaker}: ${entry.text}`)
      .join('\n');

    // Format detected participants if available
    let participantsText = '';
    if (meeting.participants && meeting.participants.length > 0) {
      participantsText =
        'Detected participants:\n' +
        meeting.participants.map(p => `- ${p.name}${p.isHost ? ' (Host)' : ''}`).join('\n');
    }

    // Load system prompt from template file or use hardcoded fallback (Phase 10.3)
    let systemMessage = loadAutoSummaryPrompt(needsTitleSuggestion);

    // Prepare the user prompt
    const userPrompt = `Summarize the following meeting transcript with the EXACT format specified in your instructions:
${participantsText ? participantsText + '\n\n' : ''}
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
ipcMain.handle('joinDetectedMeeting', async (event, transcriptionProvider = 'recallai') => {
  return joinDetectedMeeting(transcriptionProvider);
});

// Function to handle joining a detected meeting
async function joinDetectedMeeting(transcriptionProvider = 'recallai') {
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
