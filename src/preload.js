// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// Set up the SDK logger bridge between main and renderer
contextBridge.exposeInMainWorld('sdkLoggerBridge', {
  // Receive logs from main process
  onSdkLog: (callback) => ipcRenderer.on('sdk-log', (_, logEntry) => callback(logEntry)),

  // Send logs from renderer to main process
  sendSdkLog: (logEntry) => ipcRenderer.send('sdk-log', logEntry)
});

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (page) => ipcRenderer.send('navigate', page),
  saveMeetingsData: (data) => ipcRenderer.invoke('saveMeetingsData', data),
  loadMeetingsData: () => ipcRenderer.invoke('loadMeetingsData'),
  deleteMeeting: (meetingId) => ipcRenderer.invoke('deleteMeeting', meetingId),
  generateMeetingSummary: (meetingId) => ipcRenderer.invoke('generateMeetingSummary', meetingId),
  generateMeetingSummaryStreaming: (meetingId) => ipcRenderer.invoke('generateMeetingSummaryStreaming', meetingId),
  startManualRecording: (meetingId, transcriptionProvider) => ipcRenderer.invoke('startManualRecording', meetingId, transcriptionProvider),
  stopManualRecording: (recordingId) => ipcRenderer.invoke('stopManualRecording', recordingId),
  debugGetHandlers: () => ipcRenderer.invoke('debugGetHandlers'),
  checkForDetectedMeeting: () => ipcRenderer.invoke('checkForDetectedMeeting'),
  joinDetectedMeeting: (transcriptionProvider) => ipcRenderer.invoke('joinDetectedMeeting', transcriptionProvider),
  onOpenMeetingNote: (callback) => ipcRenderer.on('open-meeting-note', (_, meetingId) => callback(meetingId)),
  onRecordingCompleted: (callback) => ipcRenderer.on('recording-completed', (_, meetingId) => callback(meetingId)),
  onTranscriptUpdated: (callback) => ipcRenderer.on('transcript-updated', (_, meetingId) => callback(meetingId)),
  onSummaryGenerated: (callback) => ipcRenderer.on('summary-generated', (_, meetingId) => callback(meetingId)),
  onSummaryUpdate: (callback) => ipcRenderer.on('summary-update', (_, data) => callback(data)),
  onRecordingStateChange: (callback) => ipcRenderer.on('recording-state-change', (_, data) => callback(data)),
  onParticipantsUpdated: (callback) => ipcRenderer.on('participants-updated', (_, meetingId) => callback(meetingId)),
  onVideoFrame: (callback) => ipcRenderer.on('video-frame', (_, data) => callback(data)),
  onMeetingDetectionStatus: (callback) => ipcRenderer.on('meeting-detection-status', (_, data) => callback(data)),
  onAuthExpired: (callback) => ipcRenderer.on('auth:expired', (_, data) => callback(data)),
  getActiveRecordingId: (noteId) => ipcRenderer.invoke('getActiveRecordingId', noteId),
  // Unified Google Authentication (Calendar + Contacts)
  googleGetAuthUrl: () => ipcRenderer.invoke('google:getAuthUrl'),
  googleAuthenticate: (code) => ipcRenderer.invoke('google:authenticate', code),
  googleIsAuthenticated: () => ipcRenderer.invoke('google:isAuthenticated'),
  googleGetStatus: () => ipcRenderer.invoke('google:getStatus'),
  googleSignOut: () => ipcRenderer.invoke('google:signOut'),
  googleOpenAuthWindow: () => ipcRenderer.invoke('google:openAuthWindow'),
  // Google Calendar integration
  getCalendarMeetings: (hours) => ipcRenderer.invoke('calendar:getUpcomingMeetings', hours),
  // Template system (Phase 4)
  templatesGetAll: () => ipcRenderer.invoke('templates:getAll'),
  templatesGetById: (templateId) => ipcRenderer.invoke('templates:getById', templateId),
  templatesEstimateCost: (templateIds, transcript) => ipcRenderer.invoke('templates:estimateCost', { templateIds, transcript }),
  templatesGenerateSummaries: (meetingId, templateIds) => ipcRenderer.invoke('templates:generateSummaries', { meetingId, templateIds }),
  templatesReload: () => ipcRenderer.invoke('templates:reload'),
  // LLM Provider Management
  getLLMProvider: () => ipcRenderer.invoke('llm:getProvider'),
  switchLLMProvider: (provider) => ipcRenderer.invoke('llm:switchProvider', provider),
  // Obsidian Export (Phase 5)
  obsidianExportMeeting: (meetingId) => ipcRenderer.invoke('obsidian:exportMeeting', meetingId),
  obsidianGetStatus: () => ipcRenderer.invoke('obsidian:getStatus'),
  // Google Contacts & Speaker Matching (Phase 6)
  contactsFetchContacts: (forceRefresh) => ipcRenderer.invoke('contacts:fetchContacts', forceRefresh),
  speakersMatchSpeakers: (transcript, participantEmails, options) => ipcRenderer.invoke('speakers:matchSpeakers', { transcript, participantEmails, options }),
  speakersUpdateMapping: (meetingId, speakerLabel, participantEmail) => ipcRenderer.invoke('speakers:updateMapping', { meetingId, speakerLabel, participantEmail }),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  // Import Transcripts (Phase 8)
  importFile: (filePath, options) => ipcRenderer.invoke('import:importFile', { filePath, options }),
  importBatch: (filePaths, options) => ipcRenderer.invoke('import:importBatch', { filePaths, options }),
  importGetStatus: () => ipcRenderer.invoke('import:getStatus'),
  selectImportFiles: () => ipcRenderer.invoke('import:selectFiles'),
  onImportProgress: (callback) => ipcRenderer.on('import:progress', (_, data) => callback(data))
});
