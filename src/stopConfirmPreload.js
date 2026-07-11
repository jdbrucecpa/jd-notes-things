const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('confirmAPI', {
  // User pressed "End Recording" — stop now.
  end: () => ipcRenderer.send('confirm:end'),
  // User pressed "Keep Recording" — cancel the auto-stop, keep recording.
  keep: () => ipcRenderer.send('confirm:keep'),
  // Main process is authoritative for the countdown; it pushes the remaining
  // whole seconds each tick. Renderer only displays.
  onTick: callback =>
    ipcRenderer.on('confirm:tick', (_event, data) => callback(data)),
});
