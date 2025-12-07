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
    startStopShortcut.value =
      appSettings.shortcuts.startStopRecording || 'CommandOrControl+Shift+R';
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
  document
    .getElementById('stopRecordingShortcut')
    ?.addEventListener('change', handleShortcutChange);

  // Logs Viewer
  document.getElementById('refreshLogsBtn')?.addEventListener('click', () => refreshLogs());
  document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogs);
  document.getElementById('openLogFileBtn')?.addEventListener('click', openLogFile);
  document.getElementById('logLevelFilter')?.addEventListener('change', () => refreshLogs());

  // Text filter - refresh on Enter or after typing stops
  const logTextFilter = document.getElementById('logTextFilter');
  if (logTextFilter) {
    let filterTimeout;
    logTextFilter.addEventListener('input', () => {
      clearTimeout(filterTimeout);
      filterTimeout = setTimeout(() => refreshLogs(), 300); // Debounce 300ms
    });
    logTextFilter.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        clearTimeout(filterTimeout);
        refreshLogs();
      }
    });
  }

  // Clear filter button
  document.getElementById('clearLogFilterBtn')?.addEventListener('click', () => {
    const logTextFilter = document.getElementById('logTextFilter');
    if (logTextFilter) {
      logTextFilter.value = '';
    }
    refreshLogs();
  });
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
async function handleShortcutChange(_event) {
  try {
    const startStopShortcut =
      document.getElementById('startStopShortcut')?.value || 'CommandOrControl+Shift+R';
    const quickRecordShortcut =
      document.getElementById('quickRecordShortcut')?.value || 'CommandOrControl+Shift+Q';
    const stopRecordingShortcut =
      document.getElementById('stopRecordingShortcut')?.value || 'CommandOrControl+Shift+S';

    const updates = {
      shortcuts: {
        startStopRecording: startStopShortcut,
        quickRecord: quickRecordShortcut,
        stopRecording: stopRecordingShortcut,
      },
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
 * Refresh logs viewer with optional text filter
 * @param {string} textFilter - Optional text filter to apply
 */
async function refreshLogs(textFilter = null) {
  try {
    const logLevelFilterSelect = document.getElementById('logLevelFilter');
    const logLevelFilter = logLevelFilterSelect?.value || 'all';
    const logTextFilterInput = document.getElementById('logTextFilter');
    const logViewerContent = document.getElementById('logViewerContent');
    const logStats = document.getElementById('logStats');
    const logPath = document.getElementById('logPath');

    // Use provided textFilter or get from input
    let textFilterValue = textFilter !== null ? textFilter : (logTextFilterInput?.value || '');

    // Handle "datasync" as a special level filter (it's actually a text filter)
    const isDatasyncLevel = logLevelFilter === 'datasync';
    const apiLevel = isDatasyncLevel ? 'all' : logLevelFilter;

    // If datasync is selected from dropdown, add it to the text filter
    if (isDatasyncLevel && !textFilterValue) {
      textFilterValue = '[datasync]';
    }

    // Update the input if a filter was provided programmatically
    if (textFilter !== null && logTextFilterInput) {
      logTextFilterInput.value = textFilter;
    }

    if (!logViewerContent) return;

    // Show loading state
    logViewerContent.innerHTML =
      '<div style="color: #666; text-align: center; padding: 40px;">Loading logs...</div>';

    const result = await window.electronAPI.appGetLogs({ limit: 2000, level: apiLevel });

    if (result.success) {
      let { logs, logPath: path, totalLines, filteredLines } = result.data;

      // Apply text filter if specified
      if (textFilterValue) {
        const filterLower = textFilterValue.toLowerCase();
        logs = logs.filter(line => line.toLowerCase().includes(filterLower));
        filteredLines = logs.length;
      }

      if (logs.length === 0) {
        const filterMsg = textFilterValue ? ` matching "${textFilterValue}"` : '';
        logViewerContent.innerHTML =
          `<div style="color: #666; text-align: center; padding: 40px;">No logs found${filterMsg}</div>`;
      } else {
        // Render logs with text highlighting if filter is active
        const logsHTML = logs
          .map(line => {
            let className = 'log-line';
            if (line.includes('[error]')) className += ' error';
            else if (line.includes('[warn]')) className += ' warn';
            else if (line.includes('[info]')) className += ' info';
            else if (line.includes('[debug]')) className += ' debug';
            // Highlight datasync logs
            if (line.includes('[datasync]')) className += ' datasync';

            let displayLine = escapeHtml(line);

            // Highlight the filter text if present
            if (textFilterValue) {
              const regex = new RegExp(`(${escapeRegExp(textFilterValue)})`, 'gi');
              displayLine = displayLine.replace(regex, '<mark style="background: #ffd700; color: #000;">$1</mark>');
            }

            return `<div class="${className}">${displayLine}</div>`;
          })
          .join('');

        logViewerContent.innerHTML = logsHTML;

        // Scroll to bottom
        logViewerContent.scrollTop = logViewerContent.scrollHeight;
      }

      // Update stats
      if (logStats) {
        const filterInfo = textFilterValue ? ` (filtered: "${textFilterValue}")` : '';
        logStats.textContent = `${filteredLines.toLocaleString()} lines${filterInfo} (${totalLines.toLocaleString()} total)`;
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
 * Escape special regex characters in a string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/**
 * Navigate to logs tab with a specific filter
 * @param {string} filter - The text filter to apply, or 'datasync' to use dropdown
 */
function showLogsWithFilter(filter) {
  // Click the logs tab to switch to it
  const logsTab = document.getElementById('logsSettingsTab');
  if (logsTab) {
    logsTab.click();
  }

  // Set the filter and refresh with a small delay to ensure tab is visible
  setTimeout(() => {
    // If filter is [datasync], just set the dropdown (no text filter)
    if (filter === '[datasync]') {
      const logLevelFilter = document.getElementById('logLevelFilter');
      if (logLevelFilter) {
        logLevelFilter.value = 'datasync';
      }
      // Clear text filter
      const logTextFilter = document.getElementById('logTextFilter');
      if (logTextFilter) {
        logTextFilter.value = '';
      }
      refreshLogs(); // No text filter, dropdown handles it
    } else {
      refreshLogs(filter);
    }
  }, 100);
}

// Export functions
export { initAppSettingsUI };

// Make functions globally available for settings.js
if (typeof window !== 'undefined') {
  window.refreshLogs = refreshLogs;
  window.showLogsWithFilter = showLogsWithFilter;
}
