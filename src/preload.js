// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Set up the SDK logger bridge between main and renderer
contextBridge.exposeInMainWorld('sdkLoggerBridge', {
  // Receive logs from main process
  onSdkLog: callback => ipcRenderer.on('sdk-log', (_, logEntry) => callback(logEntry)),

  // Send logs from renderer to main process
  sendSdkLog: logEntry => ipcRenderer.send('sdk-log', logEntry),
});

contextBridge.exposeInMainWorld('electronAPI', {
  // File path utilities (for drag-and-drop)
  getPathForFile: file => webUtils.getPathForFile(file),

  navigate: page => ipcRenderer.send('navigate', page),
  saveMeetingsData: data => ipcRenderer.invoke('saveMeetingsData', data),
  loadMeetingsData: () => ipcRenderer.invoke('loadMeetingsData'),
  updateMeetingField: (meetingId, field, value) =>
    ipcRenderer.invoke('updateMeetingField', meetingId, field, value),
  deleteMeeting: meetingId => ipcRenderer.invoke('deleteMeeting', meetingId),
  generateMeetingSummary: meetingId => ipcRenderer.invoke('generateMeetingSummary', meetingId),
  generateMeetingSummaryStreaming: meetingId =>
    ipcRenderer.invoke('generateMeetingSummaryStreaming', meetingId),
  startManualRecording: (meetingId, transcriptionProvider, action) =>
    ipcRenderer.invoke('startManualRecording', meetingId, transcriptionProvider, action),
  stopManualRecording: recordingId => ipcRenderer.invoke('stopManualRecording', recordingId),
  debugGetHandlers: () => ipcRenderer.invoke('debugGetHandlers'),
  checkForDetectedMeeting: () => ipcRenderer.invoke('checkForDetectedMeeting'),
  joinDetectedMeeting: transcriptionProvider =>
    ipcRenderer.invoke('joinDetectedMeeting', transcriptionProvider),
  onOpenMeetingNote: callback =>
    ipcRenderer.on('open-meeting-note', (_, meetingId) => callback(meetingId)),
  onRecordingCompleted: callback =>
    ipcRenderer.on('recording-completed', (_, meetingId) => callback(meetingId)),
  onTranscriptUpdated: callback =>
    ipcRenderer.on('transcript-updated', (_, meetingId) => callback(meetingId)),
  onSummaryGenerated: callback =>
    ipcRenderer.on('summary-generated', (_, meetingId) => callback(meetingId)),
  onSummaryUpdate: callback => ipcRenderer.on('summary-update', (_, data) => callback(data)),
  onRecordingStateChange: callback =>
    ipcRenderer.on('recording-state-change', (_, data) => callback(data)),
  onRecordingEnded: callback => ipcRenderer.on('recording-ended', (_, data) => callback(data)),
  // v1.2: Recording Widget IPC
  onWidgetCreateAndRecord: callback =>
    ipcRenderer.on('widget:create-and-record', (_, data) => callback(data)),
  // v1.2 fix: Handler for recording with specific action (append, overwrite, new)
  onWidgetCreateAndRecordWithAction: callback =>
    ipcRenderer.on('widget:create-and-record-with-action', (_, data) => callback(data)),
  onWidgetStopRecording: callback =>
    ipcRenderer.on('widget:stop-recording-request', () => callback()),
  sendWidgetRecordingResult: result => ipcRenderer.send('widget:recording-result', result),
  sendWidgetStopRecordingResult: result => ipcRenderer.send('widget:stop-recording-result', result),
  showRecordingWidget: meetingInfo => ipcRenderer.send('widget:show', meetingInfo),
  toggleRecordingWidget: () => ipcRenderer.invoke('widget:toggle'),
  widgetToggleAlwaysOnTop: enabled => ipcRenderer.invoke('widget:toggleAlwaysOnTop', enabled),
  widgetGetState: () => ipcRenderer.invoke('widget:getState'),
  // v1.2 fix: Notify main process when user views a meeting
  notifyCurrentMeetingChanged: meetingInfo => ipcRenderer.send('renderer:current-meeting-changed', meetingInfo),
  onParticipantsUpdated: callback =>
    ipcRenderer.on('participants-updated', (_, meetingId) => callback(meetingId)),
  onVideoFrame: callback => ipcRenderer.on('video-frame', (_, data) => callback(data)),
  onMeetingDetectionStatus: callback =>
    ipcRenderer.on('meeting-detection-status', (_, data) => callback(data)),
  onShowToast: callback => ipcRenderer.on('show-toast', (_, data) => callback(data)),
  onAuthExpired: callback => ipcRenderer.on('auth:expired', (_, data) => callback(data)),
  getActiveRecordingId: noteId => ipcRenderer.invoke('getActiveRecordingId', noteId),
  // SDK initialization state
  sdkIsReady: () => ipcRenderer.invoke('sdk:isReady'),
  onSdkReady: callback => ipcRenderer.on('sdk-ready', () => callback()),
  // Recall.ai Storage Management
  recallListRecordings: () => ipcRenderer.invoke('recall:listRecordings'),
  recallDeleteAllRecordings: () => ipcRenderer.invoke('recall:deleteAllRecordings'),
  recallDeleteRecording: recordingId => ipcRenderer.invoke('recall:deleteRecording', recordingId),
  // Unified Google Authentication (Calendar + Contacts)
  googleGetAuthUrl: () => ipcRenderer.invoke('google:getAuthUrl'),
  googleAuthenticate: code => ipcRenderer.invoke('google:authenticate', code),
  googleIsAuthenticated: () => ipcRenderer.invoke('google:isAuthenticated'),
  googleGetStatus: () => ipcRenderer.invoke('google:getStatus'),
  googleSignOut: () => ipcRenderer.invoke('google:signOut'),
  googleOpenAuthWindow: () => ipcRenderer.invoke('google:openAuthWindow'),
  // Google Calendar integration
  getCalendarMeetings: hours => ipcRenderer.invoke('calendar:getUpcomingMeetings', hours),
  // Template system (Phase 4)
  templatesGetAll: () => ipcRenderer.invoke('templates:getAll'),
  templatesGetById: templateId => ipcRenderer.invoke('templates:getById', templateId),
  templatesGetContent: templateId => ipcRenderer.invoke('templates:getContent', templateId),
  templatesEstimateCost: (templateIds, transcript, provider) =>
    ipcRenderer.invoke('templates:estimateCost', { templateIds, transcript, provider }),
  templatesGenerateSummaries: (meetingId, templateIds, routingOverride = null) =>
    ipcRenderer.invoke('templates:generateSummaries', { meetingId, templateIds, routingOverride }),
  templatesReload: () => ipcRenderer.invoke('templates:reload'),
  // Routing Configuration (Phase 10.4)
  routingGetConfig: () => ipcRenderer.invoke('routing:getConfig'),
  routingSaveConfig: content => ipcRenderer.invoke('routing:saveConfig', content),
  routingValidateConfig: content => ipcRenderer.invoke('routing:validateConfig', content),
  routingTestEmails: emails => ipcRenderer.invoke('routing:testEmails', emails),
  routingPreviewMeetingRoute: meetingId =>
    ipcRenderer.invoke('routing:previewMeetingRoute', meetingId),
  routingGetAllDestinations: () => ipcRenderer.invoke('routing:getAllDestinations'),
  routingAddOrganization: (type, id, vaultPath, emails, contacts) =>
    ipcRenderer.invoke('routing:addOrganization', { type, id, vaultPath, emails, contacts }),
  routingAddEmailsToOrganization: (type, slug, emails, contacts) =>
    ipcRenderer.invoke('routing:addEmailsToOrganization', { type, slug, emails, contacts }),
  routingDeleteOrganization: (type, id) =>
    ipcRenderer.invoke('routing:deleteOrganization', { type, id }),
  routingRestoreBackup: () => ipcRenderer.invoke('routing:restoreBackup'),
  // Vocabulary Management (VC-2)
  vocabularyGetConfig: () => ipcRenderer.invoke('vocabulary:getConfig'),
  vocabularyGetStats: () => ipcRenderer.invoke('vocabulary:getStats'),
  vocabularyGetClientSlugs: () => ipcRenderer.invoke('vocabulary:getClientSlugs'),
  vocabularyAddGlobalSpelling: (from, to) =>
    ipcRenderer.invoke('vocabulary:addGlobalSpelling', { from, to }),
  vocabularyAddGlobalKeyword: (word, intensifier) =>
    ipcRenderer.invoke('vocabulary:addGlobalKeyword', { word, intensifier }),
  vocabularyAddClientSpelling: (clientSlug, from, to) =>
    ipcRenderer.invoke('vocabulary:addClientSpelling', { clientSlug, from, to }),
  vocabularyAddClientKeyword: (clientSlug, word, intensifier) =>
    ipcRenderer.invoke('vocabulary:addClientKeyword', { clientSlug, word, intensifier }),
  vocabularyRemoveGlobalSpelling: to =>
    ipcRenderer.invoke('vocabulary:removeGlobalSpelling', { to }),
  vocabularyRemoveGlobalKeyword: word =>
    ipcRenderer.invoke('vocabulary:removeGlobalKeyword', { word }),
  vocabularySaveConfig: config => ipcRenderer.invoke('vocabulary:saveConfig', config),
  vocabularyReload: () => ipcRenderer.invoke('vocabulary:reload'),
  // LLM Provider Management
  getLLMProvider: () => ipcRenderer.invoke('llm:getProvider'),
  switchLLMProvider: provider => ipcRenderer.invoke('llm:switchProvider', provider),
  // Obsidian Export (Phase 5)
  obsidianExportMeeting: meetingId => ipcRenderer.invoke('obsidian:exportMeeting', meetingId),
  obsidianGetStatus: () => ipcRenderer.invoke('obsidian:getStatus'),
  // RS-2: Refresh Obsidian links for moved notes
  obsidianRefreshLinks: () => ipcRenderer.invoke('obsidian:refreshLinks'),
  // Google Contacts & Speaker Matching (Phase 6)
  contactsFetchContacts: forceRefresh => ipcRenderer.invoke('contacts:fetchContacts', forceRefresh),
  contactsSearchContacts: query => ipcRenderer.invoke('contacts:searchContacts', query),
  // CS-1: Contacts Page
  contactsGetAllContacts: forceRefresh =>
    ipcRenderer.invoke('contacts:getAllContacts', forceRefresh),
  contactsGetMeetingsForContact: email =>
    ipcRenderer.invoke('contacts:getMeetingsForContact', email),
  // CS-3: Contact/Company Page Management
  contactsCreateContactPage: (contact, options) =>
    ipcRenderer.invoke('contacts:createContactPage', contact, options),
  contactsContactPageExists: contactName =>
    ipcRenderer.invoke('contacts:contactPageExists', contactName),
  contactsCreateCompanyPage: (company, options) =>
    ipcRenderer.invoke('contacts:createCompanyPage', company, options),
  contactsCompanyPageExists: companyName =>
    ipcRenderer.invoke('contacts:companyPageExists', companyName),
  speakersMatchSpeakers: (transcript, participantEmails, options) =>
    ipcRenderer.invoke('speakers:matchSpeakers', { transcript, participantEmails, options }),
  speakersUpdateMapping: (meetingId, speakerLabel, participantEmail) =>
    ipcRenderer.invoke('speakers:updateMapping', { meetingId, speakerLabel, participantEmail }),
  openExternal: url => ipcRenderer.send('open-external', url),
  toggleDevTools: () => ipcRenderer.send('toggle-dev-tools'),
  // Speaker Mapping (SM-2)
  speakerMappingGetAll: () => ipcRenderer.invoke('speakerMapping:getAll'),
  speakerMappingGetSuggestions: speakerIds =>
    ipcRenderer.invoke('speakerMapping:getSuggestions', { speakerIds }),
  speakerMappingAdd: (speakerId, contact, sourceContext) =>
    ipcRenderer.invoke('speakerMapping:addMapping', { speakerId, contact, sourceContext }),
  speakerMappingDelete: speakerId =>
    ipcRenderer.invoke('speakerMapping:deleteMapping', { speakerId }),
  speakerMappingExtractIds: transcript =>
    ipcRenderer.invoke('speakerMapping:extractSpeakerIds', { transcript }),
  speakerMappingDetectDuplicates: speakers =>
    ipcRenderer.invoke('speakerMapping:detectDuplicates', { speakers }),
  speakerMappingApplyToTranscript: (transcript, mappings, options) =>
    ipcRenderer.invoke('speakerMapping:applyToTranscript', { transcript, mappings, options }),
  speakerMappingApplyToMeeting: (meetingId, mappings, options) =>
    ipcRenderer.invoke('speakerMapping:applyToMeeting', { meetingId, mappings, options }),
  speakerMappingGetStats: () => ipcRenderer.invoke('speakerMapping:getStats'),
  speakerMappingExport: () => ipcRenderer.invoke('speakerMapping:export'),
  speakerMappingImport: (data, merge) =>
    ipcRenderer.invoke('speakerMapping:import', { data, merge }),
  // Import Transcripts (Phase 8)
  importFile: (filePath, options) => ipcRenderer.invoke('import:importFile', { filePath, options }),
  importBatch: (filePaths, options) =>
    ipcRenderer.invoke('import:importBatch', { filePaths, options }),
  importGetStatus: () => ipcRenderer.invoke('import:getStatus'),
  selectImportFiles: () => ipcRenderer.invoke('import:selectFiles'),
  selectImportFolder: () => ipcRenderer.invoke('import:selectFolder'),
  onImportProgress: callback => ipcRenderer.on('import:progress', (_, data) => callback(data)),
  // IM-1: Audio File Import
  importAudioFile: (filePath, provider, options) =>
    ipcRenderer.invoke('import:importAudioFile', { filePath, provider, options }),
  transcribeAudio: (filePath, provider, options) =>
    ipcRenderer.invoke('import:transcribeAudio', { filePath, provider, options }),
  // Pattern Testing (Phase 10.8.2)
  readTranscriptFile: filePath => ipcRenderer.invoke('patterns:readFile', filePath),
  patternsTestParse: (content, filePath) =>
    ipcRenderer.invoke('patterns:testParse', { content, filePath }),
  patternsGetConfig: () => ipcRenderer.invoke('patterns:getConfig'),
  patternsGetConfigYaml: () => ipcRenderer.invoke('patterns:getConfigYaml'),
  patternsSaveConfig: configYaml => ipcRenderer.invoke('patterns:saveConfig', { configYaml }),
  // Settings (Phase 10.1 + 10.3)
  getAppVersion: () => ipcRenderer.invoke('settings:getAppVersion'),
  checkForUpdates: () => ipcRenderer.invoke('settings:checkForUpdates'),
  getVaultPath: () => ipcRenderer.invoke('settings:getVaultPath'),
  chooseVaultPath: () => ipcRenderer.invoke('settings:chooseVaultPath'),
  getProviderPreferences: () => ipcRenderer.invoke('settings:getProviderPreferences'),
  // User Profile (v1.1)
  getUserProfile: () => ipcRenderer.invoke('settings:getUserProfile'),
  saveUserProfile: profile => ipcRenderer.invoke('settings:saveUserProfile', profile),
  // Key Management (Phase 10.2)
  keysListAll: () => ipcRenderer.invoke('keys:list'),
  keysGet: keyName => ipcRenderer.invoke('keys:get', keyName),
  keysSet: (keyName, value) => ipcRenderer.invoke('keys:set', keyName, value),
  keysDelete: keyName => ipcRenderer.invoke('keys:delete', keyName),
  keysMigrate: () => ipcRenderer.invoke('keys:migrate'),
  keysTest: keyName => ipcRenderer.invoke('keys:test', keyName),
  // Desktop App Polish (Phase 10.7)
  appGetSettings: () => ipcRenderer.invoke('app:getSettings'),
  appUpdateSettings: updates => ipcRenderer.invoke('app:updateSettings', updates),
  appSetMeetingAutoStart: (meetingId, enabled) =>
    ipcRenderer.invoke('app:setMeetingAutoStart', meetingId, enabled),
  appGetMeetingAutoStart: meetingId => ipcRenderer.invoke('app:getMeetingAutoStart', meetingId),
  appGetStreamDeckStatus: () => ipcRenderer.invoke('app:getStreamDeckStatus'),
  appGetLogs: options => ipcRenderer.invoke('app:getLogs', options),
  appClearLogs: () => ipcRenderer.invoke('app:clearLogs'),
  appOpenLogFile: () => ipcRenderer.invoke('app:openLogFile'),
  // Settings Export/Import (SE-1, SE-2)
  settingsExportPreview: () => ipcRenderer.invoke('settings:exportPreview'),
  settingsExport: () => ipcRenderer.invoke('settings:export'),
  settingsImportValidate: zipPath => ipcRenderer.invoke('settings:importValidate', zipPath),
  settingsImport: options => ipcRenderer.invoke('settings:import', options),
  // Phase 10.7: Event listeners for tray/shortcuts
  onQuickRecordRequested: callback =>
    ipcRenderer.on('quick-record-requested', (_, data) => callback(data)),
  onToggleRecordingShortcut: callback =>
    ipcRenderer.on('toggle-recording-shortcut', (_, data) => callback(data)),
  onOpenSettings: callback => ipcRenderer.on('open-settings', (_, data) => callback(data)),
  onOpenLogsViewer: callback => ipcRenderer.on('open-logs-viewer', (_, data) => callback(data)),
  onStopRecordingRequested: callback =>
    ipcRenderer.on('stop-recording-requested', (_, data) => callback(data)),
  // Custom Title Bar Window Controls
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
});
