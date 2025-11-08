const { app, BrowserWindow, ipcMain, protocol, Notification } = require('electron');
const path = require('node:path');
const url = require('url');
const fs = require('fs');
const RecallAiSdk = require('@recallai/desktop-sdk');
const axios = require('axios');
const sdkLogger = require('./sdk-logger');
const { MeetingsDataSchema, MeetingIdSchema, RecordingIdSchema} = require('./shared/validation');
const { z } = require('zod');
const GoogleAuth = require('./main/integrations/GoogleAuth');
const GoogleCalendar = require('./main/integrations/GoogleCalendar');
const GoogleContacts = require('./main/integrations/GoogleContacts');
const SpeakerMatcher = require('./main/integrations/SpeakerMatcher');
const TemplateManager = require('./main/templates/TemplateManager');
const VaultStructure = require('./main/storage/VaultStructure');
const RoutingEngine = require('./main/routing/RoutingEngine');
const ConfigLoader = require('./main/routing/ConfigLoader');
const { createLLMServiceFromEnv } = require('./main/services/llmService');
require('dotenv').config();

// Initialize LLM service with auto-detection of available provider
// Priority: Azure OpenAI > Anthropic > OpenAI
const llmService = createLLMServiceFromEnv();
console.log(`[Main] LLM Service initialized with provider: ${llmService.getProviderName()}`);

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
let configLoader = null;

// Speaker recognition system (Phase 6)
let googleContacts = null;
let speakerMatcher = null;

let mainWindow;

// Meeting monitor state
const notifiedMeetings = new Set(); // Track meetings we've shown notifications for
const autoStartedMeetings = new Set(); // Track meetings we've auto-started recording
let meetingMonitorInterval = null;

/**
 * Meeting monitor - checks for upcoming meetings and auto-starts recording
 */
function startMeetingMonitor() {
  console.log('[Meeting Monitor] Starting meeting monitor...');

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
        console.log(`[Meeting Monitor] Meeting starting soon: ${meeting.title}`);
        showMeetingNotification(meeting, minutesUntilStart);
        notifiedMeetings.add(meeting.id);
      }

      // Auto-start recording when meeting starts (within 1 minute window)
      if (minutesUntilStart <= 0 && minutesUntilStart >= -1 && !autoStartedMeetings.has(meeting.id)) {
        console.log(`[Meeting Monitor] Auto-starting recording for: ${meeting.title}`);
        await autoStartRecording(meeting);
        autoStartedMeetings.add(meeting.id);
      }
    }

    // Clean up old meeting IDs (remove meetings from more than 1 hour ago)
    const oneHourAgo = now - (60 * 60 * 1000);
    for (const meeting of meetings) {
      const startTime = new Date(meeting.startTime);
      if (startTime < oneHourAgo) {
        notifiedMeetings.delete(meeting.id);
        autoStartedMeetings.delete(meeting.id);
      }
    }
  } catch (error) {
    console.error('[Meeting Monitor] Error checking meetings:', error);
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
    timeoutType: 'default'
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
      title: meeting.title,
      date: new Date().toISOString().split('T')[0],
      content: `# ${meeting.title}\n\n## Meeting Information\n- Date: ${new Date(meeting.startTime).toLocaleDateString()}\n- Time: ${new Date(meeting.startTime).toLocaleTimeString()}\n- Platform: ${meeting.platform}\n${meeting.meetingLink ? `- Link: ${meeting.meetingLink}\n` : ''}${meeting.organizer ? `- Organizer: ${meeting.organizer.name} (${meeting.organizer.email})\n` : ''}\n\n## Participants\n${meeting.participants.map(p => `- ${p.name} (${p.email})`).join('\n')}\n\n## Recording\nAuto-started at ${new Date().toLocaleTimeString()}\n\n## Transcript\nRecording in progress...\n`,
      recordingId: null,
      recordingStatus: 'pending',
      transcript: '',
      summary: '',
      calendarEventId: meeting.id,
      participantEmails: meeting.participantEmails || []
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
      icon: null
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
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f9f9f9',
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
  console.log("Registering IPC handlers...");
  // Log all registered IPC handlers
  console.log("IPC handlers:", Object.keys(ipcMain._invokeHandlers));

  // Set up SDK logger IPC handlers
  ipcMain.on('sdk-log', (event, logEntry) => {
    // Forward logs from renderer to any open windows
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sdk-log', logEntry);
    }
  });

  // Set up logger event listener to send logs from main to renderer
  sdkLogger.onLog((logEntry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sdk-log', logEntry);
    }
  });

  // Create recordings directory if it doesn't exist
  try {
    if (!fs.existsSync(RECORDING_PATH)) {
      fs.mkdirSync(RECORDING_PATH, { recursive: true });
    }
  } catch (e) {
    console.error("Couldn't create the recording path:", e);
  }

  // Create meetings file if it doesn't exist
  try {
    if (!fs.existsSync(meetingsFilePath)) {
      const initialData = { upcomingMeetings: [], pastMeetings: [] };
      fs.writeFileSync(meetingsFilePath, JSON.stringify(initialData, null, 2));
    }
  } catch (e) {
    console.error("Couldn't create the meetings file:", e);
  }

  // Initialize the Recall.ai SDK
  initSDK();

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
  } catch (error) {
    console.error('[ObsidianExport] Failed to initialize:', error.message);
    console.log('[ObsidianExport] Obsidian export will be disabled');
  }

  // Note: Speaker Recognition System (Phase 6) is initialized within initializeGoogleServices()
  // This ensures all Google services (Calendar, Contacts, Speaker Matcher) are initialized together
  if (!googleAuth || !googleAuth.isAuthenticated()) {
    console.log('[SpeakerRecognition] Google not authenticated - speaker matching will use fallback');
    console.log('[SpeakerRecognition] Speaker names will fall back to email-based extraction');
  }

  // Start meeting monitor for auto-recording (only after all services initialized)
  startMeetingMonitor();

  createWindow();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup meeting monitor when app quits
app.on('before-quit', () => {
  if (meetingMonitorInterval) {
    clearInterval(meetingMonitorInterval);
    console.log('[Meeting Monitor] Stopped meeting monitor');
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Path to meetings data file in the user's Application Support directory
const meetingsFilePath = path.join(app.getPath('userData'), 'meetings.json');

// Path for RecallAI SDK recordings
const RECORDING_PATH = path.join(app.getPath("userData"), 'recordings');

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
      startTime: new Date()
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
  }
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
    if (this.cachedData && (now - this.lastReadTime < 500)) {
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
        reject
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
  }
};

// Create a desktop SDK upload token directly (no separate server needed)
async function createDesktopSdkUpload() {
  try {
    const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
    const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

    if (!RECALLAI_API_KEY) {
      console.error("RECALLAI_API_KEY is missing! Set it in .env file");
      return null;
    }

    const url = `${RECALLAI_API_URL}/api/v1/sdk_upload/`;

    const response = await axios.post(url, {
      recording_config: {
        transcript: {
          provider: {
            assembly_ai_v3_streaming: {
              word_boost: [],
              speaker_labels: true
            }
          }
        },
        realtime_endpoints: [
          {
            type: "desktop-sdk-callback",
            events: [
              "participant_events.join",
              "video_separate_png.data",
              "transcript.data",
              "transcript.provider_data"
            ]
          },
        ],
      }
    }, {
      headers: { 'Authorization': `Token ${RECALLAI_API_KEY}` },
      timeout: 9000,
    });

    console.log("Upload token created successfully:", response.data.upload_token?.substring(0, 8) + '...');
    return response.data;
  } catch (error) {
    console.error("Error creating upload token:", error.response?.data || error.message);
    return null;
  }
}

// Initialize the Recall.ai SDK
function initSDK() {
  console.log("Initializing Recall.ai SDK");

  // Log the SDK initialization
  sdkLogger.logApiCall('init', {
    dev: process.env.NODE_ENV === 'development',
    api_url: process.env.RECALLAI_API_URL,
    config: {
      recording_path: RECORDING_PATH
    }
  });

  RecallAiSdk.init({
    // dev: true,
    api_url: process.env.RECALLAI_API_URL,
    config: {
      recording_path: RECORDING_PATH
    }
  });

  // Listen for meeting detected events
  RecallAiSdk.addEventListener('meeting-detected', (evt) => {
    console.log("Meeting detected:", evt);

    // Log the meeting detected event
    sdkLogger.logEvent('meeting-detected', {
      platform: evt.window.platform,
      windowId: evt.window.id
    });

    detectedMeeting = evt;

    // Map platform codes to readable names
    const platformNames = {
      'zoom': 'Zoom',
      'google-meet': 'Google Meet',
      'slack': 'Slack',
      'teams': 'Microsoft Teams'
    };

    // Get a user-friendly platform name, or use the raw platform name if not in our map
    const platformName = platformNames[evt.window.platform] || evt.window.platform;

    // Send a notification
    let notification = new Notification({
      title: `${platformName} Meeting Detected`,
      body: platformName
    });

    // Handle notification click
    notification.on('click', () => {
      console.log("Notification clicked for platform:", platformName);
      joinDetectedMeeting();
    });

    notification.show();

    // Send the meeting detected status to the renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting-detection-status', { detected: true });
    }
  });

  // Listen for meeting closed events
  RecallAiSdk.addEventListener('meeting-closed', (evt) => {
    console.log("Meeting closed:", evt);

    // Log the SDK meeting-closed event
    sdkLogger.logEvent('meeting-closed', {
      windowId: evt.window.id
    });

    // Clean up the global tracking when a meeting ends
    if (evt.window && evt.window.id && global.activeMeetingIds && global.activeMeetingIds[evt.window.id]) {
      console.log(`Cleaning up meeting tracking for: ${evt.window.id}`);
      delete global.activeMeetingIds[evt.window.id];
    }

    detectedMeeting = null;

    // Send the meeting closed status to the renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meeting-detection-status', { detected: false });
    }
  });

  // Listen for recording ended events
  RecallAiSdk.addEventListener('recording-ended', async (evt) => {
    console.log("Recording ended:", evt);

    // Log the SDK recording-ended event
    sdkLogger.logEvent('recording-ended', {
      windowId: evt.window.id
    });

    try {
      // Update the note with recording information
      await updateNoteWithRecordingInfo(evt.window.id);

      // Add a small delay before uploading (good practice for file system operations)
      setTimeout(async () => {
        try {
          // Try to get a new upload token for the upload if needed
          const uploadData = await createDesktopSdkUpload();

          if (uploadData && uploadData.upload_token) {
            console.log('Uploading recording with new upload token:', uploadData.upload_token.substring(0, 8) + '...');

            // Log the uploadRecording API call
            sdkLogger.logApiCall('uploadRecording', {
              windowId: evt.window.id,
              uploadToken: `${uploadData.upload_token.substring(0, 8)}...` // Log truncated token for security
            });

            RecallAiSdk.uploadRecording({
              windowId: evt.window.id,
              uploadToken: uploadData.upload_token
            });
          } else {
            // Fallback to regular upload
            console.log('Uploading recording without new token');

            // Log the uploadRecording API call (fallback)
            sdkLogger.logApiCall('uploadRecording', {
              windowId: evt.window.id
            });

            RecallAiSdk.uploadRecording({ windowId: evt.window.id });
          }
        } catch (uploadError) {
          console.error('Error during upload:', uploadError);
          // Fallback to regular upload

          // Log the uploadRecording API call (error fallback)
          sdkLogger.logApiCall('uploadRecording', {
            windowId: evt.window.id,
            error: 'Fallback after error'
          });

          RecallAiSdk.uploadRecording({ windowId: evt.window.id });
        }
      }, 3000); // Wait 3 seconds before uploading
    } catch (error) {
      console.error("Error handling recording ended:", error);
    }
  });

  RecallAiSdk.addEventListener('permissions-granted', async (evt) => {
    console.log("PERMISSIONS GRANTED");
  });

  // Track upload progress
  RecallAiSdk.addEventListener('upload-progress', async (evt) => {
    const { progress, window } = evt;
    console.log(`Upload progress: ${progress}%`);

    // Log the SDK upload-progress event
    // sdkLogger.logEvent('upload-progress', {
    //   windowId: window.id,
    //   progress
    // });

    // Update the note with upload progress if needed
    if (progress === 100) {
      console.log(`Upload completed for recording: ${window.id}`);
      // Could update the note here with upload completion status
    }
  });

  // Track SDK state changes
  RecallAiSdk.addEventListener('sdk-state-change', async (evt) => {
    const { sdk: { state: { code } }, window } = evt;
    console.log("Recording state changed:", code, "for window:", window?.id);

    // Log the SDK sdk-state-change event
    sdkLogger.logEvent('sdk-state-change', {
      state: code,
      windowId: window?.id
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
          noteId
        });
      }
    }
  });

  // Listen for real-time transcript events
  RecallAiSdk.addEventListener('realtime-event', async (evt) => {
    // Only log non-video frame events to prevent flooding the logger
    if (evt.event !== 'video_separate_png.data') {
      console.log("Received realtime event:", evt.event);

      // Log the SDK realtime-event event
      sdkLogger.logEvent('realtime-event', {
        eventType: evt.event,
        windowId: evt.window?.id
      });
    }

    // Handle different event types
    if (evt.event === 'transcript.data' && evt.data && evt.data.data) {
      await processTranscriptData(evt);
    }
    else if (evt.event === 'transcript.provider_data' && evt.data && evt.data.data) {
      await processTranscriptProviderData(evt);
    }
    else if (evt.event === 'participant_events.join' && evt.data && evt.data.data) {
      await processParticipantJoin(evt);
    }
    else if (evt.event === 'video_separate_png.data' && evt.data && evt.data.data) {
      await processVideoFrame(evt);
    }
  });

  // Handle errors
  RecallAiSdk.addEventListener('error', async (evt) => {
    console.error("RecallAI SDK Error:", evt);
    const { type, message } = evt;

    // Log the SDK error event
    sdkLogger.logEvent('error', {
      errorType: type,
      errorMessage: message
    });

    // Show notification for errors
    let notification = new Notification({
      title: 'Recording Error',
      body: `Error: ${type} - ${message}`
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

    // Extract participant emails for routing
    const participantEmails = meeting.participantEmails || [];
    if (participantEmails.length === 0) {
      console.warn('[ObsidianExport] No participant emails found - routing to unfiled');
    }

    // Perform speaker matching if available (Phase 6)
    if (speakerMatcher && meeting.transcript && meeting.transcript.length > 0 && participantEmails.length > 0) {
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
        console.warn('[ObsidianExport] Speaker matching failed, continuing without:', error.message);
      }
    } else if (meeting.transcript && meeting.transcript.length > 0) {
      console.log('[ObsidianExport] Speaker matching skipped - speaker matcher not available or no participants');
    }

    // Get routing decisions
    const routingDecision = routingEngine.route({
      participantEmails,
      meetingTitle: meeting.title || 'Untitled Meeting',
      meetingDate: meeting.date ? new Date(meeting.date) : new Date()
    });
    const routes = routingDecision.routes;
    console.log(`[ObsidianExport] Found ${routes.length} routing destination(s)`);

    const createdPaths = [];

    // Process each route (may have multiple for multi-org meetings)
    for (const route of routes) {
      console.log(`[ObsidianExport] Exporting to: ${route.fullPath}`);

      // Generate file slug from title and date
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const titleSlug = meeting.title
        ? meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : 'meeting';
      const baseFilename = `${dateStr}-${titleSlug}`;

      // Create meeting folder path
      const meetingFolder = vaultStructure.getAbsolutePath(route.fullPath);
      vaultStructure.ensureDirectory(meetingFolder);

      // Generate summary markdown (primary file)
      const summaryPath = path.join(meetingFolder, `${baseFilename}.md`);
      const summaryContent = generateSummaryMarkdown(meeting, baseFilename);
      fs.writeFileSync(summaryPath, summaryContent, 'utf8');
      console.log(`[ObsidianExport] Created summary: ${summaryPath}`);

      // Generate transcript markdown (secondary file)
      const transcriptPath = path.join(meetingFolder, `${baseFilename}-transcript.md`);
      const transcriptContent = generateTranscriptMarkdown(meeting, baseFilename);
      fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
      console.log(`[ObsidianExport] Created transcript: ${transcriptPath}`);

      createdPaths.push({
        organization: route.organizationName || route.type,
        summaryPath,
        transcriptPath
      });
    }

    console.log(`[ObsidianExport] Successfully exported meeting to ${createdPaths.length} location(s)`);
    return {
      success: true,
      paths: createdPaths,
      routeCount: routes.length
    };

  } catch (error) {
    console.error('[ObsidianExport] Export failed:', error);
    return {
      success: false,
      error: error.message
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
  if (meeting.participantEmails && meeting.participantEmails.length > 0) {
    participantsYaml = meeting.participantEmails.map(email => {
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
    }).join('\n');
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
  markdown += `*Generated by JD Notes Things*\n`;

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
          const confidenceNote = segment.speakerConfidence === 'low' || segment.speakerConfidence === 'none'
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
  markdown += `*Generated by JD Notes Things*\n`;

  return markdown;
}

// Handle saving meetings data
ipcMain.handle('saveMeetingsData', async (event, data) => {
  console.log('[IPC] saveMeetingsData called with data:', {
    upcomingCount: data?.upcomingMeetings?.length,
    pastCount: data?.pastMeetings?.length
  });
  try {
    // Validate input data
    console.log('[IPC] Validating meetings data...');
    const validatedData = MeetingsDataSchema.parse(data);
    console.log('[IPC] Validation successful');

    // Use the file operation manager to safely write the file
    console.log('[IPC] Writing to file...');
    await fileOperationManager.writeData(validatedData);
    console.log('[IPC] File write complete');
    return { success: true };
  } catch (error) {
    console.error('[IPC] Caught error during save:', error);
    console.error('[IPC] Error type:', error.constructor.name);
    console.error('[IPC] Error instanceof ZodError:', error instanceof z.ZodError);

    if (error instanceof z.ZodError) {
      console.error('[IPC] Zod validation errors:', error.errors);
      console.error('[IPC] Full Zod error:', JSON.stringify(error, null, 2));
      return { success: false, error: `Validation failed: ${JSON.stringify(error.errors, null, 2)}` };
    }
    console.error('[IPC] Non-Zod error:', error.message, error.stack);
    return { success: false, error: error.message };
  }
});

// Debug handler to check if IPC handlers are registered
ipcMain.handle('debugGetHandlers', async () => {
  console.log("Checking registered IPC handlers...");
  const handlers = Object.keys(ipcMain._invokeHandlers);
  console.log("Registered handlers:", handlers);
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

// Authenticate with authorization code
ipcMain.handle('google:authenticate', async (event, code) => {
  try {
    console.log('[Google IPC] Authenticating with code');
    if (!googleAuth) {
      return { success: false, error: 'GoogleAuth not initialized' };
    }

    await googleAuth.getTokenFromCode(code);

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
      contactCount
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

  // Helper function to safely clean up the auth window
  const cleanup = () => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.destroy();
    }
    authWindow = null;
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
        contextIsolation: true
      }
    });

    authWindow.loadURL(authUrl);

    return new Promise((resolve) => {
      // Timeout after 5 minutes to prevent hanging
      const timeout = setTimeout(() => {
        if (authWindow && !authWindow.isDestroyed()) {
          console.log('[Google OAuth] Authentication timeout');
          cleanup();
          resolve({ success: false, error: 'Authentication timeout (5 minutes)' });
        }
      }, 5 * 60 * 1000);

      // Listen for the redirect
      authWindow.webContents.on('will-redirect', async (event, url) => {
        if (url.startsWith('http://localhost:3000/oauth2callback')) {
          event.preventDefault();
          clearTimeout(timeout);

          const parsedUrl = new URL(url);
          const code = parsedUrl.searchParams.get('code');

          if (code) {
            try {
              await googleAuth.getTokenFromCode(code);

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
      });

      authWindow.on('closed', () => {
        clearTimeout(timeout);
        cleanup();
        resolve({ success: false, error: 'Authentication window closed' });
      });
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
      lastFetch: googleContacts.lastFetch
    };
  } catch (error) {
    console.error('[Contacts IPC] Failed to fetch contacts:', error);
    return { success: false, error: error.message };
  }
});

// Match speakers to participants
ipcMain.handle('speakers:matchSpeakers', async (event, { transcript, participantEmails, options }) => {
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
    const updatedTranscript = speakerMatcher.applyMappingToTranscript(
      transcript,
      speakerMapping
    );

    // Get speaker statistics
    const speakerStats = speakerMatcher.analyzeSpeakers(transcript);
    const speakerSummary = speakerMatcher.getSpeakerSummary(speakerStats);

    return {
      success: true,
      speakerMapping,
      updatedTranscript,
      speakerSummary
    };
  } catch (error) {
    console.error('[Speakers IPC] Failed to match speakers:', error);
    return { success: false, error: error.message };
  }
});

// Update speaker mapping manually (for corrections)
ipcMain.handle('speakers:updateMapping', async (event, { meetingId, speakerLabel, participantEmail }) => {
  try {
    console.log(`[Speakers IPC] Updating speaker mapping: ${speakerLabel} -> ${participantEmail}`);

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
      method: 'user-correction'
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
});

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
ipcMain.handle('templates:generateSummaries', async (event, { meetingId, templateIds }) => {
  try {
    console.log('[Template IPC] Generating summaries for meeting:', meetingId, 'with', templateIds.length, 'templates');

    // Load meeting data
    const data = await fileOperationManager.readMeetingsData();
    const meeting = [...data.upcomingMeetings, ...data.pastMeetings].find(m => m.id === meetingId);

    if (!meeting) {
      return { success: false, error: 'Meeting not found' };
    }

    if (!meeting.transcript) {
      return { success: false, error: 'Meeting has no transcript' };
    }

    // Convert transcript to string if it's an array of objects
    let transcriptText = '';
    if (Array.isArray(meeting.transcript)) {
      transcriptText = meeting.transcript.map(segment => {
        if (typeof segment === 'object' && segment.text) {
          return `${segment.speaker || 'Speaker'}: ${segment.text}`;
        }
        return String(segment);
      }).join('\n');
    } else if (typeof meeting.transcript === 'string') {
      transcriptText = meeting.transcript;
    } else {
      transcriptText = String(meeting.transcript);
    }

    console.log(`[Template IPC] Transcript length: ${transcriptText.length} characters`);

    // Collect all section generation tasks to run in parallel
    const sectionTasks = [];

    for (const templateId of templateIds) {
      const template = templateManager.getTemplate(templateId);
      if (!template) {
        console.warn('[Template IPC] Template not found:', templateId);
        continue;
      }

      console.log('[Template IPC] Generating summary with template:', template.name);

      for (const section of template.sections) {
        console.log(`[Template IPC] Queuing section: ${section.title}`);

        sectionTasks.push({
          templateId: template.id,
          templateName: template.name,
          sectionTitle: section.title,
          promise: (async () => {
            try {
              const result = await llmService.generateCompletion({
                systemPrompt: 'You are a helpful assistant that analyzes meeting transcripts and creates structured summaries.',
                userPrompt: `${section.prompt}\n\nMeeting Transcript:\n${transcriptText}`,
                temperature: 0.7,
                maxTokens: 500
              });

              return {
                success: true,
                content: result.content
              };
            } catch (error) {
              console.error(`[Template IPC] Error generating section ${section.title}:`, error);
              return {
                success: false,
                content: '*Error generating this section*'
              };
            }
          })()
        });
      }
    }

    console.log(`[Template IPC] Firing ${sectionTasks.length} API calls in parallel...`);
    const startTime = Date.now();

    // Execute all API calls in parallel
    const sectionResults = await Promise.all(sectionTasks.map(task => task.promise));

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Template IPC] All API calls completed in ${duration}s`);

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
        sections: []
      });
    }

    // Add section results to their templates
    sectionTasks.forEach((task, index) => {
      const result = sectionResults[index];
      const templateData = templateMap.get(task.templateId);

      if (templateData) {
        templateData.sections.push({
          title: task.sectionTitle,
          content: result.content
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
        content: summaryMarkdown
      });
    }

    console.log(`[Template IPC] Generated ${summaries.length} summaries`);
    return { success: true, summaries };
  } catch (error) {
    console.error('[Template IPC] Failed to generate summaries:', error);
    return { success: false, error: error.message };
  }
});

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
// LLM Provider Management
// ===================================================================

// Get current LLM provider
ipcMain.handle('llm:getProvider', async () => {
  try {
    return {
      success: true,
      provider: llmService.getProviderName()
    };
  } catch (error) {
    console.error('[LLM] Error getting provider:', error);
    return { success: false, error: error.message };
  }
});

// Switch LLM provider
ipcMain.handle('llm:switchProvider', async (event, provider) => {
  try {
    console.log(`[LLM] Switching provider to: ${provider}`);

    // Validate provider
    const validProviders = ['openai', 'azure', 'anthropic'];
    if (!validProviders.includes(provider)) {
      return {
        success: false,
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      };
    }

    llmService.switchProvider(provider);

    return {
      success: true,
      provider: llmService.getProviderName()
    };
  } catch (error) {
    console.error('[LLM] Error switching provider:', error);
    return { success: false, error: error.message };
  }
});

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
    routingConfigured: !!routingEngine
  };
});

// ===================================================================
// End Obsidian Export IPC Handlers
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
        data: recordingInfo
      };
    }

    // Otherwise return all active recordings
    return {
      success: true,
      data: activeRecordings.getAll()
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
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === validatedId);
    const upcomingMeetingIndex = meetingsData.upcomingMeetings.findIndex(meeting => meeting.id === validatedId);

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
  try {
    console.log(`Manual summary generation requested for meeting: ${meetingId}`);

    // Read current data
    const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
    const meetingsData = JSON.parse(fileData);

    // Find the meeting
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === meetingId);

    if (pastMeetingIndex === -1) {
      return { success: false, error: 'Meeting not found' };
    }

    const meeting = meetingsData.pastMeetings[pastMeetingIndex];

    // Check if there's a transcript to summarize
    if (!meeting.transcript || meeting.transcript.length === 0) {
      return {
        success: false,
        error: 'No transcript available for this meeting'
      };
    }

    // Log summary generation to console instead of showing a notification
    console.log('Generating AI summary for meeting: ' + meetingId);

    // Generate the summary
    const summary = await generateMeetingSummary(meeting);

    // Get meeting title for use in the new content
    const meetingTitle = meeting.title || "Meeting Notes";

    // Get recording ID
    const recordingId = meeting.recordingId;

    // Check for different possible video file patterns
    const possibleFilePaths = recordingId ? [
      path.join(RECORDING_PATH, `${recordingId}.mp4`),
      path.join(RECORDING_PATH, `macos-desktop-${recordingId}.mp4`),
      path.join(RECORDING_PATH, `macos-desktop${recordingId}.mp4`),
      path.join(RECORDING_PATH, `desktop-${recordingId}.mp4`)
    ] : [];

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
      summary
    };
  } catch (error) {
    console.error('Error generating meeting summary:', error);
    return { success: false, error: error.message };
  }
});

// Handle starting a manual desktop recording
ipcMain.handle('startManualRecording', async (event, meetingId) => {
  try {
    // Validate meetingId
    const validatedId = MeetingIdSchema.parse(meetingId);
    console.log(`Starting manual desktop recording for meeting: ${validatedId}`);

    // Read current data
    const fileData = await fs.promises.readFile(meetingsFilePath, 'utf8');
    const meetingsData = JSON.parse(fileData);

    // Find the meeting
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === validatedId);

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
      console.log('Prepared desktop audio recording with key:', typeof key === 'string' ? key.substring(0, 8) + '...' : key);

      // Create a recording token
      const uploadData = await createDesktopSdkUpload();
      if (!uploadData || !uploadData.upload_token) {
        return { success: false, error: 'Failed to create recording token' };
      }

      // Store the recording ID in the meeting
      meeting.recordingId = key;

      // Initialize transcript array if not present
      if (!meeting.transcript) {
        meeting.transcript = [];
      }

      // Store tracking info for the recording
      global.activeMeetingIds = global.activeMeetingIds || {};
      global.activeMeetingIds[key] = {
        platformName: 'Desktop Recording',
        noteId: validatedId
      };

      // Register the recording in our active recordings tracker
      activeRecordings.addRecording(key, validatedId, 'Desktop Recording');

      // Save the updated data
      await fileOperationManager.writeData(meetingsData);

      // Start recording with the key from prepareDesktopAudioRecording
      console.log('Starting desktop recording with key:', typeof key === 'string' ? key.substring(0, 8) + '...' : key);

      // Log the startRecording API call
      sdkLogger.logApiCall('startRecording', {
        windowId: key,
        uploadToken: `${uploadData.upload_token.substring(0, 8)}...` // Log truncated token for security
      });

      RecallAiSdk.startRecording({
        windowId: key,
        uploadToken: uploadData.upload_token
      });

      return {
        success: true,
        recordingId: key
      };
    } catch (sdkError) {
      console.error('RecallAI SDK error:', sdkError);
      return { success: false, error: 'Failed to prepare desktop recording: ' + sdkError.message };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Invalid meeting ID format:', error.message);
      return { success: false, error: `Invalid meeting ID format: ${error.message}` };
    }
    console.error('Error starting manual recording:', error);
    return { success: false, error: error.message };
  }
});

// Handle stopping a manual desktop recording
ipcMain.handle('stopManualRecording', async (event, recordingId) => {
  try {
    // Validate recordingId
    const validatedId = RecordingIdSchema.parse(recordingId);
    console.log(`Stopping manual desktop recording: ${validatedId}`);

    // Stop the recording - using the windowId property as shown in the reference

    // Log the stopRecording API call
    sdkLogger.logApiCall('stopRecording', {
      windowId: validatedId
    });

    // Update our active recordings tracker
    activeRecordings.updateState(validatedId, 'stopping');

    RecallAiSdk.stopRecording({
      windowId: validatedId
    });

    // The recording-ended event will be triggered automatically,
    // which will handle uploading and generating the summary

    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Invalid recording ID format:', error.message);
      return { success: false, error: `Invalid recording ID format: ${error.message}` };
    }
    console.error('Error stopping manual recording:', error);
    return { success: false, error: error.message };
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
    const pastMeetingIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === meetingId);

    if (pastMeetingIndex === -1) {
      return { success: false, error: 'Meeting not found' };
    }

    const meeting = meetingsData.pastMeetings[pastMeetingIndex];

    // Check if there's a transcript to summarize
    if (!meeting.transcript || meeting.transcript.length === 0) {
      return {
        success: false,
        error: 'No transcript available for this meeting'
      };
    }

    // Log summary generation to console instead of showing a notification
    console.log('Generating streaming summary for meeting: ' + meetingId);

    // Get meeting title for use in the new content
    const meetingTitle = meeting.title || "Meeting Notes";

    // Initial content with placeholders
    meeting.content = `# ${meetingTitle}\n\nGenerating summary...`;

    // Update the note on the frontend right away
    mainWindow.webContents.send('summary-update', {
      meetingId,
      content: meeting.content
    });

    // Create progress callback for streaming updates
    const streamProgress = (currentText) => {
      // Update content with current streaming text
      meeting.content = `# ${meetingTitle}\n\n## AI-Generated Meeting Summary\n${currentText}`;

      // Send immediate update to renderer - don't debounce or delay this
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          // Force immediate send of the update
          mainWindow.webContents.send('summary-update', {
            meetingId,
            content: meeting.content,
            timestamp: Date.now() // Add timestamp to ensure uniqueness
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
      summary
    };
  } catch (error) {
    console.error('Error generating streaming summary:', error);
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
      data: data
    };
  } catch (error) {
    console.error('Failed to load meetings data:', error);
    return { success: false, error: error.message };
  }
});

// Function to create a new meeting note and start recording
async function createMeetingNoteAndRecord(platformName) {
  console.log("Creating meeting note for platform:", platformName);
  try {
    if (!detectedMeeting) {
      console.error('No active meeting detected');
      return;
    }
    console.log("Detected meeting info:", detectedMeeting.window.id, detectedMeeting.window.platform);

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
      transcript: [] // Initialize an empty array for transcript data
    };

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
        console.log(`Successfully verified meeting ${id} was saved`);

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
    console.log('Starting recording for meeting:', detectedMeeting.window.id);

    try {
      // Get upload token
      const uploadData = await createDesktopSdkUpload();

      if (!uploadData || !uploadData.upload_token) {
        console.error('Failed to get upload token. Recording without upload token.');

        // Log the startRecording API call (no token fallback)
        sdkLogger.logApiCall('startRecording', {
          windowId: detectedMeeting.window.id
        });

        RecallAiSdk.startRecording({
          windowId: detectedMeeting.window.id
        });
      } else {
        console.log('Starting recording with upload token:', uploadData.upload_token.substring(0, 8) + '...');

        // Log the startRecording API call with upload token
        sdkLogger.logApiCall('startRecording', {
          windowId: detectedMeeting.window.id,
          uploadToken: `${uploadData.upload_token.substring(0, 8)}...` // Log truncated token for security
        });

        RecallAiSdk.startRecording({
          windowId: detectedMeeting.window.id,
          uploadToken: uploadData.upload_token
        });
      }
    } catch (error) {
      console.error('Error starting recording with upload token:', error);

      // Fallback to recording without token

      // Log the startRecording API call (error fallback)
      sdkLogger.logApiCall('startRecording', {
        windowId: detectedMeeting.window.id,
        error: 'Fallback after error'
      });

      RecallAiSdk.startRecording({
        windowId: detectedMeeting.window.id
      });
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
      console.error("Missing window ID in video frame event");
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
      console.log("No video frame data in event");
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
        timestamp: frameTimestamp
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
      console.error("Missing window ID in participant join event");
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
      console.log("No participant data in event");
      return;
    }

    const participantName = participantData.name || "Unknown Participant";
    const participantId = participantData.id;
    const isHost = participantData.is_host;
    const platform = participantData.platform;

    console.log(`Participant joined: ${participantName} (ID: ${participantId}, Host: ${isHost})`);

    // Skip "Host" and "Guest" generic names
    if (participantName === "Host" || participantName === "Guest" || participantName.includes("others") || (participantName.split(" ").length > 3)) {
      console.log(`Skipping generic participant name: ${participantName}`);
      return;
    }

    // Use the file operation manager to safely update the meetings data
    await fileOperationManager.scheduleOperation(async (meetingsData) => {
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
          status: 'active'
        };
      } else {
        // Add new participant
        meeting.participants.push({
          id: participantId,
          name: participantName,
          isHost: isHost,
          platform: platform,
          joinTime: new Date().toISOString(),
          status: 'active'
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

let currentUnknownSpeaker = -1;

async function processTranscriptProviderData(evt) {
  // let speakerId = evt.data.data.payload.
  try {
    if (evt.data.data.data.payload.channel.alternatives[0].words[0].speaker !== undefined) {
      currentUnknownSpeaker = evt.data.data.data.payload.channel.alternatives[0].words[0].speaker;
    }
  } catch (error) {
    // console.error("Error processing provider data:", error);
  }
}

// Function to process transcript data and store it with the meeting note
async function processTranscriptData(evt) {
  try {
    const windowId = evt.window?.id;
    if (!windowId) {
      console.error("Missing window ID in transcript event");
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

    // Get speaker information
    let speaker;
    if (evt.data.data.participant?.name && evt.data.data.participant?.name !== "Host" && evt.data.data.participant?.name !== "Guest") {
      speaker = evt.data.data.participant?.name;
    } else if (currentUnknownSpeaker !== -1) {
      speaker = `Speaker ${currentUnknownSpeaker}`;
    } else {
      speaker = "Unknown Speaker";
    }

    // Combine all words into a single text
    const text = words.map(word => word.text).join(" ");

    console.log(`Transcript from ${speaker}: "${text}"`);

    // Use the file operation manager to safely update the meetings data
    await fileOperationManager.scheduleOperation(async (meetingsData) => {
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

      // Add the new transcript entry
      meeting.transcript.push({
        text,
        speaker,
        timestamp: new Date().toISOString()
      });

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

// Function to generate AI summary from transcript with streaming support
async function generateMeetingSummary(meeting, progressCallback = null) {
  try {
    if (!meeting.transcript || meeting.transcript.length === 0) {
      console.log('No transcript available to summarize');
      return 'No transcript available to summarize.';
    }

    console.log(`Generating AI summary for meeting: ${meeting.id}`);

    // Format the transcript into a single text for the AI to process
    const transcriptText = meeting.transcript.map(entry =>
      `${entry.speaker}: ${entry.text}`
    ).join('\n');

    // Format detected participants if available
    let participantsText = "";
    if (meeting.participants && meeting.participants.length > 0) {
      participantsText = "Detected participants:\n" + meeting.participants.map(p =>
        `- ${p.name}${p.isHost ? ' (Host)' : ''}`
      ).join('\n');
    }

    // Define a system prompt to guide the AI's response with a specific format
    const systemMessage =
      "You are an AI assistant that summarizes meeting transcripts. " +
      "You MUST format your response using the following structure:\n\n" +
      "# Participants\n" +
      "- [List all participants mentioned in the transcript]\n\n" +
      "# Summary\n" +
      "- [Key discussion point 1]\n" +
      "- [Key discussion point 2]\n" +
      "- [Key decisions made]\n" +
      "- [Include any important deadlines or dates mentioned]\n\n" +
      "# Action Items\n" +
      "- [Action item 1] - [Responsible person if mentioned]\n" +
      "- [Action item 2] - [Responsible person if mentioned]\n" +
      "- [Add any other action items discussed]\n\n" +
      "Stick strictly to this format with these exact section headers. Keep each bullet point concise but informative.";

    // Prepare the user prompt
    const userPrompt = `Summarize the following meeting transcript with the EXACT format specified in your instructions:
${participantsText ? participantsText + "\n\n" : ""}
Transcript:
${transcriptText}`;

    // If no progress callback provided, use the non-streaming version
    if (!progressCallback) {
      const result = await llmService.generateCompletion({
        systemPrompt: systemMessage,
        userPrompt: userPrompt,
        maxTokens: 1000,
        temperature: 0.7
      });

      console.log(`AI summary generated successfully using ${llmService.getProviderName()} (${result.model})`);
      return result.content;
    } else {
      // Use streaming version with progress callback
      const fullText = await llmService.streamCompletion({
        systemPrompt: systemMessage,
        userPrompt: userPrompt,
        maxTokens: 1000,
        temperature: 0.7,
        onChunk: (cumulativeText) => {
          if (progressCallback) {
            progressCallback(cumulativeText);
          }
        }
      });

      console.log(`AI summary completed - ${fullText.length} characters`);

      if (fullText.length === 0) {
        console.warn('WARNING: AI returned empty summary!');
      }

      return fullText;
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
    const noteIndex = meetingsData.pastMeetings.findIndex(meeting =>
      meeting.recordingId === recordingId
    );

    if (noteIndex === -1) {
      console.log('No meeting note found for recording ID:', recordingId);
      return;
    }

    // Format current date
    const now = new Date();
    const formattedDate = now.toLocaleString();

    // Update the meeting note content
    const meeting = meetingsData.pastMeetings[noteIndex];
    const content = meeting.content;

    // Replace the "Recording: In Progress..." line with completed information
    let updatedContent = content.replace(
      "Recording: In Progress...",
      `Recording: Completed at ${formattedDate}\n`
    );

    // Update the meeting object
    meeting.content = updatedContent;
    meeting.recordingComplete = true;
    meeting.recordingEndTime = now.toISOString();

    // Save the initial update
    await fileOperationManager.writeData(meetingsData);

    // Generate AI summary if there's a transcript
    if (meeting.transcript && meeting.transcript.length > 0) {
      console.log(`Generating AI summary for meeting ${meeting.id}...`);

      // Log summary generation to console instead of showing a notification
      console.log('Generating AI summary for meeting: ' + meeting.id);

      // Get meeting title for use in the new content
      const meetingTitle = meeting.title || "Meeting Notes";

      // Create initial content with placeholder
      meeting.content = `# ${meetingTitle}\nGenerating summary...`;

      // Notify any open editors immediately
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('summary-update', {
          meetingId: meeting.id,
          content: meeting.content
        });
      }

      // Create progress callback for streaming updates
      const streamProgress = (currentText) => {
        // Update content with current streaming text
        meeting.content = `# ${meetingTitle}\n\n${currentText}`;

        // Send immediate update to renderer if note is open
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.webContents.send('summary-update', {
              meetingId: meeting.id,
              content: meeting.content,
              timestamp: Date.now() // Add timestamp to ensure uniqueness
            });
          } catch (err) {
            console.error('Error sending streaming update to renderer:', err);
          }
        }
      };

      // Generate the summary with streaming updates
      const summary = await generateMeetingSummary(meeting, streamProgress);

      // Check for different possible video file patterns
      const possibleFilePaths = [
        path.join(RECORDING_PATH, `${recordingId}.mp4`),
        path.join(RECORDING_PATH, `macos-desktop-${recordingId}.mp4`),
        path.join(RECORDING_PATH, `macos-desktop${recordingId}.mp4`),
        path.join(RECORDING_PATH, `desktop-${recordingId}.mp4`)
      ];

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

      console.log("Attempting to embed video file", videoFilePath);

      // Set the content to just the summary
      meeting.content = `${summary}`;

      // If video exists, store the path separately but don't add it to the content
      if (videoExists) {
        meeting.videoPath = videoFilePath; // Store the path for future reference
        console.log(`Stored video path in meeting object: ${videoFilePath}`);
      } else {
        console.log('Video file not found, continuing without embedding');
      }

      meeting.hasSummary = true;

      // Save the updated data with summary
      await fileOperationManager.writeData(meetingsData);

      console.log('Updated meeting note with AI summary');
    }

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
ipcMain.handle('joinDetectedMeeting', async () => {
  return joinDetectedMeeting();
});

// Function to handle joining a detected meeting
async function joinDetectedMeeting() {
  try {
    console.log("Join detected meeting called");

    if (!detectedMeeting) {
      console.log("No detected meeting available");
      return { success: false, error: "No active meeting detected" };
    }

    // Map platform codes to readable names
    const platformNames = {
      'zoom': 'Zoom',
      'google-meet': 'Google Meet',
      'slack': 'Slack',
      'teams': 'Microsoft Teams'
    };

    // Get a user-friendly platform name, or use the raw platform name if not in our map
    const platformName = platformNames[detectedMeeting.window.platform] || detectedMeeting.window.platform;

    console.log("Joining detected meeting for platform:", platformName);

    // Ensure main window exists and is visible
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("Creating new main window");
      createWindow();
    }

    // Bring window to front with focus
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    // Process with more reliable timing
    return new Promise((resolve) => {
      // Wait a moment for the window to be fully focused and ready
      setTimeout(async () => {
        console.log("Window is ready, creating new meeting note");

        try {
          // Create a new meeting note and start recording
          const id = await createMeetingNoteAndRecord(platformName);

          console.log("Created new meeting with ID:", id);
          resolve({ success: true, meetingId: id });
        } catch (err) {
          console.error("Error creating meeting note:", err);
          resolve({ success: false, error: err.message });
        }
      }, 800); // Increased timeout for more reliability
    });
  } catch (error) {
    console.error("Error in joinDetectedMeeting:", error);
    return { success: false, error: error.message };
  }
}
