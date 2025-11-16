/**
 * Phase 10.7: Desktop App Polish - App Settings UI
 * Handles recording quality, notifications, shortcuts, and logs viewer
 */

let appSettings = null;

/**
 * Initialize app settings UI
 */
async function initAppSettingsUI() {
  try {
    // Load settings from main process
    const result = await window.electronAPI.appGetSettings();

    if (result.success) {
      appSettings = result.data;
      populateSettingsUI();
      setupEventListeners();
    } else {
      console.error('[AppSettings] Failed to load settings:', result.error);
    }
  } catch (error) {
    console.error('[AppSettings] Initialization error:', error);
  }
}

/**
 * Populate UI with current settings
 */
function populateSettingsUI() {
  if (!appSettings) return;

  // Notification Preferences
  setToggleState('enableToastsToggle', appSettings.notifications.enableToasts);
  setToggleState('enableSoundsToggle', appSettings.notifications.enableSounds);
  setToggleState('minimizeToTrayToggle', appSettings.notifications.minimizeToTray);

  // Keyboard Shortcuts
  const startStopShortcut = document.getElementById('startStopShortcut');
  const quickRecordShortcut = document.getElementById('quickRecordShortcut');
  const stopRecordingShortcut = document.getElementById('stopRecordingShortcut');

  if (startStopShortcut) {
    startStopShortcut.value = appSettings.shortcuts.startStopRecording || 'CommandOrControl+Shift+R';
  }
  if (quickRecordShortcut) {
    quickRecordShortcut.value = appSettings.shortcuts.quickRecord || 'CommandOrControl+Shift+Q';
  }
  if (stopRecordingShortcut) {
    stopRecordingShortcut.value = appSettings.shortcuts.stopRecording || 'CommandOrControl+Shift+S';
  }
}

/**
 * Set toggle switch state
 */
function setToggleState(toggleId, enabled) {
  const toggle = document.getElementById(toggleId);
  if (toggle) {
    if (enabled) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Notification Toggles
  setupToggle('enableToastsToggle', 'notifications', 'enableToasts');
  setupToggle('enableSoundsToggle', 'notifications', 'enableSounds');
  setupToggle('minimizeToTrayToggle', 'notifications', 'minimizeToTray');

  // Keyboard Shortcuts
  document.getElementById('startStopShortcut')?.addEventListener('change', handleShortcutChange);
  document.getElementById('quickRecordShortcut')?.addEventListener('change', handleShortcutChange);
  document.getElementById('stopRecordingShortcut')?.addEventListener('change', handleShortcutChange);

  // Logs Viewer
  document.getElementById('refreshLogsBtn')?.addEventListener('click', refreshLogs);
  document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogs);
  document.getElementById('openLogFileBtn')?.addEventListener('click', openLogFile);
  document.getElementById('logLevelFilter')?.addEventListener('change', refreshLogs);
}

/**
 * Setup toggle switch
 */
function setupToggle(toggleId, category, key) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;

  toggle.addEventListener('click', async () => {
    const isActive = toggle.classList.contains('active');
    const newValue = !isActive;

    // Update UI immediately
    if (newValue) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }

    // Save to backend
    try {
      const updates = { [category]: { [key]: newValue } };
      const result = await window.electronAPI.appUpdateSettings(updates);

      if (result.success) {
        appSettings = result.data;
        console.log(`[AppSettings] ${category}.${key} updated to ${newValue}`);
      } else {
        // Revert on error
        if (newValue) {
          toggle.classList.remove('active');
        } else {
          toggle.classList.add('active');
        }
        console.error('[AppSettings] Update failed:', result.error);
        alert(`Failed to update setting: ${result.error}`);
      }
    } catch (error) {
      console.error('[AppSettings] Update error:', error);
      // Revert on error
      if (newValue) {
        toggle.classList.remove('active');
      } else {
        toggle.classList.add('active');
      }
      alert('Failed to update setting');
    }
  });
}

/**
 * Handle keyboard shortcut changes
 */
async function handleShortcutChange(event) {
  try {
    const startStopShortcut = document.getElementById('startStopShortcut')?.value || 'CommandOrControl+Shift+R';
    const quickRecordShortcut = document.getElementById('quickRecordShortcut')?.value || 'CommandOrControl+Shift+Q';
    const stopRecordingShortcut = document.getElementById('stopRecordingShortcut')?.value || 'CommandOrControl+Shift+S';

    const updates = {
      shortcuts: {
        startStopRecording: startStopShortcut,
        quickRecord: quickRecordShortcut,
        stopRecording: stopRecordingShortcut,
      }
    };

    const result = await window.electronAPI.appUpdateSettings(updates);

    if (result.success) {
      appSettings = result.data;
      console.log('[AppSettings] Keyboard shortcuts updated');
      showToast('Keyboard shortcuts updated - Changes take effect after app restart');
    } else {
      console.error('[AppSettings] Update failed:', result.error);
      alert(`Failed to update shortcuts: ${result.error}`);
    }
  } catch (error) {
    console.error('[AppSettings] Shortcut update error:', error);
    alert('Failed to update keyboard shortcuts');
  }
}

/**
 * Refresh logs viewer
 */
async function refreshLogs() {
  try {
    const logLevelFilter = document.getElementById('logLevelFilter')?.value || 'all';
    const logViewerContent = document.getElementById('logViewerContent');
    const logStats = document.getElementById('logStats');
    const logPath = document.getElementById('logPath');

    if (!logViewerContent) return;

    // Show loading state
    logViewerContent.innerHTML = '<div style="color: #666; text-align: center; padding: 40px;">Loading logs...</div>';

    const result = await window.electronAPI.appGetLogs({ limit: 1000, level: logLevelFilter });

    if (result.success) {
      const { logs, logPath: path, totalLines, filteredLines } = result.data;

      if (logs.length === 0) {
        logViewerContent.innerHTML = '<div style="color: #666; text-align: center; padding: 40px;">No logs found</div>';
      } else {
        // Render logs
        const logsHTML = logs.map(line => {
          let className = 'log-line';
          if (line.includes('[error]')) className += ' error';
          else if (line.includes('[warn]')) className += ' warn';
          else if (line.includes('[info]')) className += ' info';
          else if (line.includes('[debug]')) className += ' debug';

          return `<div class="${className}">${escapeHtml(line)}</div>`;
        }).join('');

        logViewerContent.innerHTML = logsHTML;

        // Scroll to bottom
        logViewerContent.scrollTop = logViewerContent.scrollHeight;
      }

      // Update stats
      if (logStats) {
        logStats.textContent = `${filteredLines.toLocaleString()} lines (${totalLines.toLocaleString()} total)`;
      }
      if (logPath) {
        logPath.textContent = path;
      }
    } else {
      logViewerContent.innerHTML = `<div style="color: #e74c3c; text-align: center; padding: 40px;">Error loading logs: ${result.error}</div>`;
    }
  } catch (error) {
    console.error('[AppSettings] Refresh logs error:', error);
    const logViewerContent = document.getElementById('logViewerContent');
    if (logViewerContent) {
      logViewerContent.innerHTML = `<div style="color: #e74c3c; text-align: center; padding: 40px;">Error: ${error.message}</div>`;
    }
  }
}

/**
 * Clear logs
 */
async function clearLogs() {
  if (!confirm('Are you sure you want to clear all logs? This cannot be undone.')) {
    return;
  }

  try {
    const result = await window.electronAPI.appClearLogs();

    if (result.success) {
      console.log('[AppSettings] Logs cleared');
      showToast('Logs cleared successfully');
      refreshLogs(); // Refresh to show empty state
    } else {
      alert(`Failed to clear logs: ${result.error}`);
    }
  } catch (error) {
    console.error('[AppSettings] Clear logs error:', error);
    alert('Failed to clear logs');
  }
}

/**
 * Open log file in external editor
 */
async function openLogFile() {
  try {
    const result = await window.electronAPI.appOpenLogFile();

    if (result.success) {
      console.log('[AppSettings] Log file opened');
    } else {
      alert(`Failed to open log file: ${result.error}`);
    }
  } catch (error) {
    console.error('[AppSettings] Open log file error:', error);
    alert('Failed to open log file');
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show toast notification
 */
function showToast(message) {
  // Use existing toast system if available
  if (typeof window.showToast === 'function') {
    console.log('[AppSettings] Showing toast:', message);
    window.showToast(message);
  } else {
    console.warn('[AppSettings] window.showToast not available. Message:', message);
  }
}

// Export functions
export { initAppSettingsUI };

// Make refreshLogs globally available for settings.js
if (typeof window !== 'undefined') {
  window.refreshLogs = refreshLogs;
}
