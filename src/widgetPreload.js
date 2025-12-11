const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetAPI', {
  // Recording controls
  startRecording: meetingId => ipcRenderer.invoke('widget:start-recording', meetingId),
  stopRecording: () => ipcRenderer.invoke('widget:stop-recording'),

  // Widget controls
  hideWidget: () => ipcRenderer.send('widget:hide'),
  requestSync: () => ipcRenderer.send('widget:request-sync'),

  // v1.2: Always-on-top control
  toggleAlwaysOnTop: enabled => ipcRenderer.invoke('widget:toggleAlwaysOnTop', enabled),

  // Listen for updates from main process
  onUpdate: callback => ipcRenderer.on('widget:update', callback),

  // Open meeting in main app
  openMeeting: meetingId => ipcRenderer.send('widget:open-meeting', meetingId),
});
