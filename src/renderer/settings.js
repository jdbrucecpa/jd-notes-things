/**
 * Settings Management Module (Phase 10.1 + 10.2 + 10.3)
 * Handles application settings, theme switching, and persistence
 * Phase 10.1: Settings infrastructure and theme foundation
 * Phase 10.2: Security panel with API key management
 * Phase 10.3: AI model configuration (separate providers for auto vs template summaries)
 */

import { initializeSecurityPanel } from './securitySettings.js';
import { updateEditorTheme } from './templates.js';
import { escapeHtml } from './security.js';
import {
  initialize as initializePatternTestingPanel,
  updateEditorTheme as updatePatternEditorTheme,
} from './components/PatternTestingPanel.js';
import { initializeTabs } from './utils/tabHelper.js';
import { notifySuccess, notifyError, notifyInfo } from './utils/notificationHelper.js';


// Default settings
const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' or 'dark'
  autoStartRecording: false,
  debugMode: false,
  vaultPath: '',
  autoSummaryProvider: 'gemini-2.5-flash', // AI model for auto-summaries (Budget-friendly default)
  templateSummaryProvider: 'claude-haiku-4-5', // AI model for template summaries
  patternGenerationProvider: 'gemini-2.5-flash-lite', // AI model for pattern generation (cheapest option)
  recordingProvider: 'recall', // v2.0: 'recall' (Recall.ai SDK) or 'local' (FFmpeg + Window Monitoring)
  transcriptionProvider: 'assemblyai', // v2.0: 'assemblyai', 'deepgram', or 'local' (JD Audio Service)
  aiServiceUrl: 'http://localhost:8374', // v2.0: JD Audio Service endpoint
  localLLMUrl: 'http://localhost:11434', // v2.0: Local LLM server (Ollama or compatible)
};

// Settings storage key
const SETTINGS_STORAGE_KEY = 'jd-notes-settings';

/**
 * Load settings from localStorage
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

/**
 * Get a specific setting value
 */
export function getSetting(key) {
  const settings = loadSettings();
  return settings[key];
}

/**
 * Update a specific setting
 */
export function updateSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  return saveSettings(settings);
}

/**
 * Apply theme to the document
 */
export function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
}

/**
 * Open settings and switch to a specific tab
 */
export function openSettingsTab(tabName) {
  const settingsView = document.getElementById('settingsView');
  const mainView = document.getElementById('mainView');
  const contactsView = document.getElementById('contactsView');
  const reportsView = document.getElementById('reportsView');

  // Close other views if open
  if (contactsView) contactsView.style.display = 'none';
  if (reportsView) reportsView.style.display = 'none';

  // Show settings view
  if (mainView) mainView.style.display = 'none';
  if (settingsView) settingsView.style.display = 'block';

  // Map tab names to button IDs
  const tabButtonId = `${tabName}SettingsTab`;
  const tabButton = document.getElementById(tabButtonId);

  // Trigger click on the tab button to activate it (this will use the initializeTabs logic)
  if (tabButton) {
    tabButton.click();
  } else {
    console.warn(`[Settings] Tab button not found for tab: ${tabName}`);
  }
}

/**
 * Initialize settings UI
 */
export function initializeSettingsUI() {
  const settings = loadSettings();

  // Apply current theme
  applyTheme(settings.theme);

  // Get DOM elements
  const settingsView = document.getElementById('settingsView');
  const mainView = document.getElementById('mainView');
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettings');

  // Control elements
  const darkModeToggle = document.getElementById('darkModeToggle');
  const autoStartToggle = document.getElementById('autoStartToggle');
  const showRecordingWidgetToggle = document.getElementById('showRecordingWidgetToggle');
  const debugModeToggle = document.getElementById('debugModeToggle');
  const vaultPathInput = document.getElementById('vaultPathInput');
  const browseVaultPathBtn = document.getElementById('browseVaultPathBtn');
  const autoSummaryProviderSelect = document.getElementById('autoSummaryProviderSelect');
  const templateSummaryProviderSelect = document.getElementById('templateSummaryProviderSelect');
  const patternGenerationProviderSelect = document.getElementById(
    'patternGenerationProviderSelect'
  );
  const recordingProviderSelect = document.getElementById('recordingProviderSelect');
  const transcriptionProviderSelect = document.getElementById('transcriptionProviderSelect');
  const aiServiceUrlInput = document.getElementById('aiServiceUrlInput');
  const localLLMUrlInput = document.getElementById('localLLMUrlInput');
  const fullyLocalPresetBtn = document.getElementById('fullyLocalPresetBtn');
  const exportAllSettingsBtn = document.getElementById('exportAllSettingsBtn');
  const importAllSettingsBtn = document.getElementById('importAllSettingsBtn');
  const exportStatus = document.getElementById('exportStatus');
  // RS-2: Refresh Obsidian Links
  const refreshObsidianLinksBtn = document.getElementById('refreshObsidianLinksBtn');
  const refreshLinksStatus = document.getElementById('refreshLinksStatus');

  // Version information
  const electronVersion = document.getElementById('electronVersion');
  const nodeVersion = document.getElementById('nodeVersion');
  const chromeVersion = document.getElementById('chromeVersion');

  // Open settings (full-page view)
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      // Close other views if open
      const contactsView = document.getElementById('contactsView');
      const reportsView = document.getElementById('reportsView');
      if (contactsView) contactsView.style.display = 'none';
      if (reportsView) reportsView.style.display = 'none';

      mainView.style.display = 'none';
      settingsView.style.display = 'block';
      loadSettingsIntoUI();

      // Initialize security panel (Phase 10.2)
      try {
        await initializeSecurityPanel();
      } catch (error) {
        console.error('[Settings] Failed to initialize security panel:', error);
      }
    });
  }

  // Close settings (return to main view)
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsView.style.display = 'none';
      mainView.style.display = 'block';
    });
  }

  // Tab switching
  initializeTabs(
    [
      { buttonId: 'profileSettingsTab', contentId: 'profilePanel' },
      { buttonId: 'generalSettingsTab', contentId: 'generalPanel' },
      { buttonId: 'securitySettingsTab', contentId: 'securityPanel' },
      { buttonId: 'clientsSettingsTab', contentId: 'clientsPanel' },
      { buttonId: 'templatesSettingsTab', contentId: 'templatesPanel' },
      { buttonId: 'vocabularySettingsTab', contentId: 'vocabularyPanel' },
      { buttonId: 'patternsSettingsTab', contentId: 'patternsPanel' },
      { buttonId: 'notificationsSettingsTab', contentId: 'notificationsPanel' },
      { buttonId: 'shortcutsSettingsTab', contentId: 'shortcutsPanel' },
      { buttonId: 'streamDeckSettingsTab', contentId: 'streamdeckPanel' },
      { buttonId: 'logsSettingsTab', contentId: 'logsPanel' },
      { buttonId: 'reportsSettingsTab', contentId: 'reportsPanel' },
      { buttonId: 'backupSettingsTab', contentId: 'backupPanel' },
      { buttonId: 'advancedSettingsTab', contentId: 'advancedPanel' },
      { buttonId: 'aboutSettingsTab', contentId: 'aboutPanel' },
    ],
    buttonId => {
      // Trigger panel-specific actions based on which tab was activated
      if (buttonId === 'reportsSettingsTab') {
        console.log('[Settings] Reports tab clicked');
        initSettingsReports();
      } else if (buttonId === 'backupSettingsTab') {
        console.log('[Settings] Backup tab clicked, loading manifest');
        loadBackupManifest();
      } else if (buttonId === 'profileSettingsTab') {
        console.log('[Settings] Profile tab clicked, loading profile');
        loadUserProfile();
      } else if (buttonId === 'templatesSettingsTab' && window.loadTemplates) {
        console.log('[Settings] Templates tab clicked, calling loadTemplates()');
        window.loadTemplates();
      } else if (buttonId === 'clientsSettingsTab') {
        console.log('[Settings] Clients tab clicked, loading clients');
        renderClientsTab();
      } else if (buttonId === 'patternsSettingsTab') {
        console.log('[Settings] Patterns tab clicked, initializing pattern editor');
        initializePatternTestingPanel('pattern-editor').catch(err => {
          console.error('[Settings] Failed to initialize pattern editor:', err);
        });
      } else if (buttonId === 'logsSettingsTab' && window.refreshLogs) {
        console.log('[Settings] Logs tab clicked, auto-loading logs');
        window.refreshLogs();
      } else if (buttonId === 'vocabularySettingsTab') {
        console.log('[Settings] Vocabulary tab clicked, loading vocabulary');
        loadVocabulary();
      } else if (buttonId === 'streamDeckSettingsTab') {
        console.log('[Settings] Stream Deck tab clicked, loading status');
        loadStreamDeckSettings();
      }
    }
  );

  // Dark mode toggle
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const isActive = darkModeToggle.classList.toggle('active');
      const newTheme = isActive ? 'dark' : 'light';

      updateSetting('theme', newTheme);
      applyTheme(newTheme);

      // Update Monaco editor themes
      updateEditorTheme(isActive);
      updatePatternEditorTheme(isActive);
    });
  }

  // Auto-start recording toggle
  if (autoStartToggle) {
    autoStartToggle.addEventListener('click', () => {
      const isActive = autoStartToggle.classList.toggle('active');
      updateSetting('autoStartRecording', isActive);
      // Sync to main process
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ autoStartRecording: isActive });
      }
      // Notify calendar to re-render with updated toggle visibility
      window.dispatchEvent(
        new CustomEvent('autoStartSettingChanged', { detail: { enabled: isActive } })
      );
    });
  }

  // Show recording widget toggle
  if (showRecordingWidgetToggle) {
    showRecordingWidgetToggle.addEventListener('click', () => {
      const isActive = showRecordingWidgetToggle.classList.toggle('active');
      updateSetting('showRecordingWidget', isActive);
      // Also update main process settings
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ showRecordingWidget: isActive });
      }
    });
  }

  // Debug mode toggle
  if (debugModeToggle) {
    debugModeToggle.addEventListener('click', () => {
      const isActive = debugModeToggle.classList.toggle('active');
      updateSetting('debugMode', isActive);
    });
  }

  // Browse vault path button
  if (browseVaultPathBtn) {
    browseVaultPathBtn.addEventListener('click', async () => {
      try {
        const result = await window.electronAPI.chooseVaultPath();

        if (result.success && result.path) {
          // Update the input field
          if (vaultPathInput) {
            vaultPathInput.value = result.path;
          }
          notifySuccess('Vault path updated successfully');
        } else if (result.error) {
          notifyError(`Failed to update vault path: ${result.error}`);
        }
        // If canceled (success: false, no error), do nothing
      } catch (error) {
        console.error('[Settings] Error choosing vault path:', error);
        notifyError(error, { prefix: 'Failed to update vault path:' });
      }
    });
  }

  // RS-2: Refresh Obsidian Links button
  if (refreshObsidianLinksBtn) {
    refreshObsidianLinksBtn.addEventListener('click', async () => {
      try {
        // Disable button and show scanning status
        refreshObsidianLinksBtn.disabled = true;
        refreshObsidianLinksBtn.textContent = 'Scanning...';
        if (refreshLinksStatus) {
          refreshLinksStatus.textContent = 'Scanning vault...';
          refreshLinksStatus.style.color = 'var(--text-secondary)';
        }

        const result = await window.electronAPI.obsidianRefreshLinks();

        if (result.success) {
          const msg =
            result.updated > 0
              ? `Updated ${result.updated} stale link${result.updated !== 1 ? 's' : ''}`
              : 'All links are up to date';

          if (refreshLinksStatus) {
            // Create a "see logs" link instead of plain text
            refreshLinksStatus.innerHTML = `${msg} - <a href="#" class="see-logs-link" style="color: var(--primary-color); text-decoration: underline; cursor: pointer;">see logs</a>`;
            refreshLinksStatus.style.color = 'var(--status-success)';

            // Add click handler to the link
            const seeLogsLink = refreshLinksStatus.querySelector('.see-logs-link');
            if (seeLogsLink) {
              seeLogsLink.addEventListener('click', e => {
                e.preventDefault();
                if (window.showLogsWithFilter) {
                  window.showLogsWithFilter('[datasync]');
                }
              });
            }
          }

          // Show detailed toast
          if (result.updated > 0) {
            notifySuccess(`${msg}. ${result.missing.length} notes not found in vault.`);
          } else {
            notifySuccess(msg);
          }
        } else {
          if (refreshLinksStatus) {
            refreshLinksStatus.textContent = result.error || 'Failed';
            refreshLinksStatus.style.color = 'var(--status-error)';
          }
          notifyError(`Failed to refresh links: ${result.error}`);
        }
      } catch (error) {
        console.error('[Settings] Error refreshing Obsidian links:', error);
        if (refreshLinksStatus) {
          refreshLinksStatus.textContent = 'Error';
          refreshLinksStatus.style.color = 'var(--status-error)';
        }
        notifyError(error, { prefix: 'Failed to refresh Obsidian links:' });
      } finally {
        // Re-enable button
        refreshObsidianLinksBtn.disabled = false;
        refreshObsidianLinksBtn.textContent = 'Refresh Links';
      }
    });
  }

  // Auto Summary Provider selection
  if (autoSummaryProviderSelect) {
    autoSummaryProviderSelect.addEventListener('change', e => {
      updateSetting('autoSummaryProvider', e.target.value);
      notifySuccess(`Auto-summary provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Template Summary Provider selection
  if (templateSummaryProviderSelect) {
    templateSummaryProviderSelect.addEventListener('change', e => {
      updateSetting('templateSummaryProvider', e.target.value);
      notifySuccess(`Template summary provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Pattern Generation Provider selection (Phase 10.8.3)
  if (patternGenerationProviderSelect) {
    patternGenerationProviderSelect.addEventListener('change', e => {
      updateSetting('patternGenerationProvider', e.target.value);
      notifySuccess(`Pattern generation provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Recording Provider selection (v2.0)
  if (recordingProviderSelect) {
    recordingProviderSelect.addEventListener('change', e => {
      const newProvider = e.target.value;
      updateSetting('recordingProvider', newProvider);
      // Sync to main process so the setting is persisted in app-settings.json
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ recordingProvider: newProvider });
      }
      notifyInfo('Recording provider switched to ' + (newProvider === 'local' ? 'Local' : 'Recall.ai') + '.');
    });
  }

  // Transcription Provider selection (v2.0) is handled by renderer.js
  // which saves directly to localStorage key 'transcriptionProvider'.
  // Do NOT add a duplicate change handler here.

  // AI Service URL input (v2.0)
  if (aiServiceUrlInput) {
    aiServiceUrlInput.addEventListener('change', e => {
      const newUrl = e.target.value.trim();
      updateSetting('aiServiceUrl', newUrl);
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ aiServiceUrl: newUrl });
      }
      checkAIServiceStatus();
      notifySuccess('JD Audio Service URL updated');
    });
  }

  // Local LLM URL input (v2.0)
  if (localLLMUrlInput) {
    localLLMUrlInput.addEventListener('change', e => {
      const newUrl = e.target.value.trim();
      updateSetting('localLLMUrl', newUrl);
      if (window.electronAPI?.appUpdateSettings) {
        window.electronAPI.appUpdateSettings({ localLLMUrl: newUrl });
      }
      checkLocalLLMStatus();
      populateOllamaModelDropdowns();
      notifySuccess('Local LLM Server URL updated');
    });
  }

  // Fully Local Preset button (v2.0)
  if (fullyLocalPresetBtn) {
    fullyLocalPresetBtn.addEventListener('click', () => {
      applyFullyLocalPreset();
    });
  }

  // Comprehensive Export All Settings (SE-1)
  if (exportAllSettingsBtn) {
    exportAllSettingsBtn.addEventListener('click', async () => {
      try {
        exportAllSettingsBtn.disabled = true;
        exportAllSettingsBtn.querySelector('span').textContent = 'Exporting...';

        if (exportStatus) {
          exportStatus.style.display = 'block';
          exportStatus.textContent = 'Preparing export...';
        }

        const result = await window.electronAPI.settingsExport();

        if (result.canceled) {
          if (exportStatus) exportStatus.style.display = 'none';
          return;
        }

        if (result.success) {
          const sizeKB = (result.size / 1024).toFixed(1);
          notifySuccess(`Settings exported successfully (${sizeKB} KB)`);

          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: var(--status-success);">Export complete:</span> ${result.manifest.included.length} files exported`;
            if (result.manifest.warnings.length > 0) {
              exportStatus.innerHTML += `<br><span style="color: var(--color-warning);">Warnings:</span> ${result.manifest.warnings.join(', ')}`;
            }
          }
        } else {
          notifyError('Export failed: ' + result.error);
          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: var(--color-error);">Export failed:</span> ${escapeHtml(result.error)}`;
          }
        }
      } catch (error) {
        console.error('Error exporting settings:', error);
        notifyError(error, { prefix: 'Export failed:' });
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: var(--color-error);">Export failed:</span> ${escapeHtml(error.message)}`;
        }
      } finally {
        exportAllSettingsBtn.disabled = false;
        exportAllSettingsBtn.querySelector('span').textContent = 'Export All Settings';
      }
    });
  }

  // Comprehensive Import All Settings (SE-2)
  if (importAllSettingsBtn) {
    importAllSettingsBtn.addEventListener('click', async () => {
      try {
        importAllSettingsBtn.disabled = true;
        importAllSettingsBtn.querySelector('span').textContent = 'Importing...';

        if (exportStatus) {
          exportStatus.style.display = 'block';
          exportStatus.textContent = 'Selecting file...';
        }

        const result = await window.electronAPI.settingsImport({ overwrite: false });

        if (result.canceled) {
          if (exportStatus) exportStatus.style.display = 'none';
          return;
        }

        if (result.success) {
          notifySuccess(`Settings imported: ${result.imported.length} files`);

          if (exportStatus) {
            let statusHtml = `<span style="color: var(--status-success);">Import complete:</span> ${result.imported.length} files imported`;
            if (result.skipped.length > 0) {
              statusHtml += `<br><span style="color: var(--color-warning);">Skipped:</span> ${result.skipped.length} files (already exist)`;
            }
            if (result.errors.length > 0) {
              statusHtml += `<br><span style="color: var(--color-error);">Errors:</span> ${result.errors.map(e => e.file).join(', ')}`;
            }
            exportStatus.innerHTML = statusHtml;
          }

          // Reload UI to reflect imported settings
          loadSettingsIntoUI();
        } else {
          notifyError('Import failed: ' + result.error);
          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: var(--color-error);">Import failed:</span> ${escapeHtml(result.error)}`;
          }
        }
      } catch (error) {
        console.error('Error importing settings:', error);
        notifyError(error, { prefix: 'Import failed:' });
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: var(--color-error);">Import failed:</span> ${escapeHtml(error.message)}`;
        }
      } finally {
        importAllSettingsBtn.disabled = false;
        importAllSettingsBtn.querySelector('span').textContent = 'Import Settings';
      }
    });
  }

  // Load version information
  if (electronVersion && window.electronAPI) {
    window.electronAPI
      .getAppVersion()
      .then(version => {
        electronVersion.textContent = version.electron || '-';
        nodeVersion.textContent = version.node || '-';
        chromeVersion.textContent = version.chrome || '-';
      })
      .catch(() => {
        electronVersion.textContent = 'N/A';
        nodeVersion.textContent = 'N/A';
        chromeVersion.textContent = 'N/A';
      });
  }

  // GitHub repo link handler
  const githubRepoLink = document.getElementById('githubRepoLink');
  if (githubRepoLink) {
    githubRepoLink.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI.openExternal('https://github.com/jdbrucecpa/jd-notes-things');
    });
  }

  // Check for Updates button handler
  // Note: The update banner (at top of app) handles displaying update state
  const checkForUpdatesBtn = document.getElementById('checkForUpdatesBtn');
  const updateStatus = document.getElementById('updateStatus');
  if (checkForUpdatesBtn) {
    checkForUpdatesBtn.addEventListener('click', async () => {
      checkForUpdatesBtn.disabled = true;
      checkForUpdatesBtn.textContent = 'Checking...';
      if (updateStatus) {
        updateStatus.textContent = 'Checking for updates...';
      }

      try {
        const result = await window.electronAPI.checkForUpdates();
        // The update banner at the top of the app will show detailed status
        // Here we just show a brief confirmation
        if (result.success) {
          if (updateStatus) {
            updateStatus.textContent = result.message || 'Check complete - see banner above';
          }
        } else {
          if (updateStatus) {
            updateStatus.textContent = result.message || 'Update check not available';
          }
        }
      } catch (error) {
        console.error('[Settings] Update check error:', error);
        if (updateStatus) {
          updateStatus.textContent = 'Error checking for updates';
        }
      }

      checkForUpdatesBtn.disabled = false;
      checkForUpdatesBtn.textContent = 'Check Now';
    });
  }

  /**
   * Check and display connection status for the JD Audio Service.
   */
  async function checkAIServiceStatus() {
    const statusEl = document.getElementById('aiServiceStatus');
    if (!statusEl) return;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'service-status checking';
    try {
      const result = await window.electronAPI.aiServiceHealth();
      if (result && result.status === 'connected') {
        statusEl.textContent = 'Connected';
        statusEl.className = 'service-status connected';
      } else {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'service-status disconnected';
      }
    } catch {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'service-status disconnected';
    }
  }

  /**
   * Check and display connection status for the local LLM server.
   */
  async function checkLocalLLMStatus() {
    const statusEl = document.getElementById('localLLMStatus');
    if (!statusEl) return;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'service-status checking';
    try {
      const currentSettings = loadSettings();
      const url = currentSettings.localLLMUrl || 'http://localhost:11434';
      const result = await window.electronAPI.listLocalModels(url);
      if (result && result.success) {
        const count = result.models ? result.models.length : 0;
        statusEl.textContent = count > 0 ? `Connected (${count} models)` : 'Connected (no models)';
        statusEl.className = 'service-status connected';
      } else {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'service-status disconnected';
      }
    } catch {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'service-status disconnected';
    }
  }

  /**
   * Apply the "Fully Local" preset: local recording, local transcription, and first available local LLM.
   */
  async function applyFullyLocalPreset() {
    // Switch recording provider to local
    updateSetting('recordingProvider', 'local');
    if (window.electronAPI?.appUpdateSettings) {
      window.electronAPI.appUpdateSettings({ recordingProvider: 'local' });
    }
    if (recordingProviderSelect) {
      recordingProviderSelect.value = 'local';
    }

    // Switch transcription provider to local — use localStorage key that renderer.js reads
    localStorage.setItem('transcriptionProvider', 'local');
    if (transcriptionProviderSelect) {
      transcriptionProviderSelect.value = 'local';
    }

    // Try to find a local model and apply to all LLM dropdowns
    try {
      const currentSettings = loadSettings();
      const url = currentSettings.localLLMUrl || 'http://localhost:11434';
      const result = await window.electronAPI.listLocalModels(url);
      if (result && result.success && result.models && result.models.length > 0) {
        const firstModel = result.models[0].name || result.models[0];
        updateSetting('autoSummaryProvider', firstModel);
        updateSetting('templateSummaryProvider', firstModel);
        updateSetting('patternGenerationProvider', firstModel);
        if (autoSummaryProviderSelect) autoSummaryProviderSelect.value = firstModel;
        if (templateSummaryProviderSelect) templateSummaryProviderSelect.value = firstModel;
        if (patternGenerationProviderSelect) patternGenerationProviderSelect.value = firstModel;
        notifySuccess(`Fully local preset applied — using model: ${firstModel}`);
      } else {
        notifyInfo('Fully local preset applied. No local models found — configure your LLM server.');
      }
    } catch {
      notifyInfo('Fully local preset applied. Could not reach local LLM server.');
    }
  }

  /**
   * Load current settings into UI controls
   */
  function loadSettingsIntoUI() {
    const currentSettings = loadSettings();

    // Update toggles
    if (darkModeToggle) {
      if (currentSettings.theme === 'dark') {
        darkModeToggle.classList.add('active');
      } else {
        darkModeToggle.classList.remove('active');
      }
    }

    if (autoStartToggle) {
      if (currentSettings.autoStartRecording) {
        autoStartToggle.classList.add('active');
      } else {
        autoStartToggle.classList.remove('active');
      }
    }

    if (showRecordingWidgetToggle) {
      // Default to true if not set
      if (currentSettings.showRecordingWidget !== false) {
        showRecordingWidgetToggle.classList.add('active');
      } else {
        showRecordingWidgetToggle.classList.remove('active');
      }
    }

    if (debugModeToggle) {
      if (currentSettings.debugMode) {
        debugModeToggle.classList.add('active');
      } else {
        debugModeToggle.classList.remove('active');
      }
    }

    // Update AI provider selections (v1.3.2: Anthropic, Gemini, Ollama)
    if (autoSummaryProviderSelect) {
      autoSummaryProviderSelect.value = currentSettings.autoSummaryProvider || 'gemini-2.5-flash';
    }

    if (templateSummaryProviderSelect) {
      templateSummaryProviderSelect.value =
        currentSettings.templateSummaryProvider || 'claude-haiku-4-5';
    }

    if (patternGenerationProviderSelect) {
      patternGenerationProviderSelect.value =
        currentSettings.patternGenerationProvider || 'gemini-2.5-flash-lite';
    }

    // v2.0: Recording provider (also read from main process appSettings for accuracy)
    if (recordingProviderSelect) {
      // Try main process first (source of truth at startup), fall back to localStorage
      if (window.electronAPI?.appGetSettings) {
        window.electronAPI
          .appGetSettings()
          .then(result => {
            if (result.success && result.data?.recordingProvider) {
              recordingProviderSelect.value = result.data.recordingProvider;
            } else {
              recordingProviderSelect.value = currentSettings.recordingProvider || 'recall';
            }
          })
          .catch(() => {
            recordingProviderSelect.value = currentSettings.recordingProvider || 'recall';
          });
      } else {
        recordingProviderSelect.value = currentSettings.recordingProvider || 'recall';
      }
    }

    // v2.0: Transcription provider — read from localStorage to match renderer.js storage key
    if (transcriptionProviderSelect) {
      transcriptionProviderSelect.value = localStorage.getItem('transcriptionProvider') || 'assemblyai';
    }

    // v2.0: Service endpoint URLs
    if (aiServiceUrlInput) {
      aiServiceUrlInput.value = currentSettings.aiServiceUrl || 'http://localhost:8374';
    }
    if (localLLMUrlInput) {
      localLLMUrlInput.value = currentSettings.localLLMUrl || 'http://localhost:11434';
    }

    // v2.0: Check service statuses on load
    checkAIServiceStatus();
    checkLocalLLMStatus();

    // Update vault path (this will be populated from main process)
    if (vaultPathInput && window.electronAPI) {
      window.electronAPI
        .getVaultPath()
        .then(path => {
          vaultPathInput.value = path || 'Not configured';
        })
        .catch(() => {
          vaultPathInput.value = 'Not configured';
        });
    }
  }

  // Initial load
  loadSettingsIntoUI();

  // Populate Ollama model dropdowns dynamically
  populateOllamaModelDropdowns();

  // Initialize profile save button
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', saveUserProfile);
  }
}

/**
 * Fetch available Ollama models and populate all dropdown optgroups with class "ollama-model-group".
 * Falls back to a "No models found" disabled option if Ollama is unreachable.
 */
export async function populateOllamaModelDropdowns() {
  if (!window.electronAPI?.listOllamaModels) return;

  const optgroups = document.querySelectorAll('.ollama-model-group');
  if (optgroups.length === 0) return;

  // Remember current selections so we can restore them after repopulating
  const selects = new Map();
  optgroups.forEach(og => {
    const select = og.closest('select');
    if (select) selects.set(select, select.value);
  });

  try {
    const result = await window.electronAPI.listOllamaModels();
    const models = result.success && result.models.length > 0 ? result.models : [];

    optgroups.forEach(og => {
      // Clear existing options
      og.innerHTML = '';

      if (models.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.textContent = 'No Ollama models found';
        og.appendChild(opt);
      } else {
        models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = `ollama-${m.name}`;
          const sizeGB = m.size ? ` (${(m.size / 1e9).toFixed(1)}GB)` : '';
          opt.textContent = `${m.name}${sizeGB} — Free`;
          og.appendChild(opt);
        });
      }
    });

    // Restore previous selections
    selects.forEach((prevValue, select) => {
      if (prevValue && prevValue.startsWith('ollama-')) {
        // Try to restore the previous selection
        const option = select.querySelector(`option[value="${CSS.escape(prevValue)}"]`);
        if (option) {
          select.value = prevValue;
        }
      } else if (prevValue) {
        select.value = prevValue;
      }
    });
  } catch (error) {
    console.warn('[Settings] Could not fetch Ollama models:', error);
    optgroups.forEach(og => {
      og.innerHTML = '<option value="" disabled>Ollama unavailable</option>';
    });
  }
}

/**
 * Load user profile from main process
 */
async function loadUserProfile() {
  try {
    if (!window.electronAPI?.getUserProfile) {
      console.warn('[Settings] getUserProfile API not available');
      return;
    }

    const result = await window.electronAPI.getUserProfile();
    if (result.success && result.profile) {
      const profile = result.profile;

      // Populate form fields
      const nameInput = document.getElementById('profileName');
      const emailInput = document.getElementById('profileEmail');
      const titleInput = document.getElementById('profileTitle');
      const orgInput = document.getElementById('profileOrganization');
      const contextInput = document.getElementById('profileContext');

      if (nameInput) nameInput.value = profile.name || '';
      if (emailInput) emailInput.value = profile.email || '';
      if (titleInput) titleInput.value = profile.title || '';
      if (orgInput) orgInput.value = profile.organization || '';
      if (contextInput) contextInput.value = profile.context || '';

      console.log('[Settings] Loaded user profile:', profile.name);
    }
  } catch (error) {
    console.error('[Settings] Failed to load user profile:', error);
  }
}

/**
 * Save user profile to main process
 */
async function saveUserProfile() {
  const statusEl = document.getElementById('profileSaveStatus');

  try {
    const profile = {
      name: document.getElementById('profileName')?.value?.trim() || '',
      email: document.getElementById('profileEmail')?.value?.trim() || '',
      title: document.getElementById('profileTitle')?.value?.trim() || '',
      organization: document.getElementById('profileOrganization')?.value?.trim() || '',
      context: document.getElementById('profileContext')?.value?.trim() || '',
    };

    if (!window.electronAPI?.saveUserProfile) {
      throw new Error('saveUserProfile API not available');
    }

    const result = await window.electronAPI.saveUserProfile(profile);

    if (result.success) {
      if (statusEl) {
        statusEl.textContent = 'Saved!';
        statusEl.style.color = 'var(--status-success)';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 2000);
      }
      notifySuccess('Profile saved successfully');
      console.log('[Settings] Saved user profile');
    } else {
      throw new Error(result.error || 'Failed to save profile');
    }
  } catch (error) {
    console.error('[Settings] Failed to save user profile:', error);
    if (statusEl) {
      statusEl.textContent = 'Error saving';
      statusEl.style.color = 'var(--status-error)';
    }
    notifyError(error, { prefix: 'Failed to save profile:' });
  }
}

// ===================================================================
// VC-2: Vocabulary Management (v1.2.5 - Simplified to global terms only)
// ===================================================================

let vocabularyConfig = null;

/**
 * Load vocabulary configuration and update UI
 */
async function loadVocabulary() {
  try {
    if (!window.electronAPI?.vocabularyGetConfig) {
      console.warn('[Vocabulary] API not available');
      return;
    }

    const result = await window.electronAPI.vocabularyGetConfig();
    if (result.success) {
      vocabularyConfig = result.data;
      renderVocabularyUI();
    } else {
      console.error('[Vocabulary] Failed to load config:', result.error);
      notifyError('Failed to load vocabulary: ' + result.error);
    }
  } catch (error) {
    console.error('[Vocabulary] Error loading vocabulary:', error);
    notifyError(error, { prefix: 'Error loading vocabulary:' });
  }
}

/**
 * Get all terms from global vocabulary (combines spelling corrections and keyword boosts)
 */
function getAllTerms() {
  if (!vocabularyConfig?.global) return [];

  const terms = [];

  // Extract terms from spelling corrections (the "to" value)
  for (const sc of vocabularyConfig.global.spelling_corrections || []) {
    if (sc.to) {
      terms.push({ term: sc.to, source: 'spelling' });
    }
  }

  // Extract terms from keyword boosts
  for (const kb of vocabularyConfig.global.keyword_boosts || []) {
    if (kb.word) {
      terms.push({ term: kb.word, source: 'keyword' });
    }
  }

  return terms;
}

/**
 * Render the vocabulary UI
 */
function renderVocabularyUI() {
  const terms = getAllTerms();
  renderTermsList(terms);

  // Update count
  const countEl = document.getElementById('termsCount');
  if (countEl) {
    countEl.textContent = terms.length;
  }
}

/**
 * Render the terms list
 */
function renderTermsList(terms) {
  const list = document.getElementById('termsList');
  if (!list) return;

  if (terms.length === 0) {
    list.innerHTML = '<div class="vocabulary-empty">No priority terms defined</div>';
    return;
  }

  list.innerHTML = terms
    .map(
      ({ term }) => `
    <div class="vocabulary-item">
      <div class="vocabulary-item-content">
        <span class="vocabulary-item-term">${escapeHtml(term)}</span>
      </div>
      <button class="vocabulary-item-delete" onclick="deleteTerm('${term.replace(/'/g, "\\'")}')" title="Delete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M6 18L18 6"/>
        </svg>
      </button>
    </div>
  `
    )
    .join('');
}

/**
 * Add one or more terms (supports comma-separated input)
 */
async function addTerm() {
  const input = document.getElementById('termInput');
  const value = input?.value?.trim();

  if (!value) {
    notifyError('Please enter a term');
    return;
  }

  // Support comma-separated terms
  const terms = value
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (terms.length === 0) {
    notifyError('Please enter at least one term');
    return;
  }

  try {
    let addedCount = 0;
    for (const term of terms) {
      // Store as keyword_boost with default intensifier (for Deepgram compatibility)
      const result = await window.electronAPI.vocabularyAddGlobalKeyword(term, 5);
      if (result.success) {
        addedCount++;
      }
    }

    if (addedCount > 0) {
      input.value = '';
      await loadVocabulary();
      notifySuccess(
        addedCount === 1 ? 'Term added' : `${addedCount} terms added`
      );
    } else {
      notifyError('Failed to add terms');
    }
  } catch (error) {
    console.error('[Vocabulary] Error adding term:', error);
    notifyError(error, { prefix: 'Error adding term:' });
  }
}

/**
 * Delete a term (removes from both spelling_corrections and keyword_boosts)
 */
async function deleteTerm(term) {
  try {
    // Try removing from keyword boosts first
    const result = await window.electronAPI.vocabularyRemoveGlobalKeyword(term);

    // Also try removing from spelling corrections (by "to" value)
    const spellingResult = await window.electronAPI.vocabularyRemoveGlobalSpelling(term);

    if (result.success || spellingResult.success) {
      await loadVocabulary();
      notifySuccess('Term removed');
    } else {
      notifyError('Failed to remove term');
    }
  } catch (error) {
    console.error('[Vocabulary] Error deleting term:', error);
    notifyError(error, { prefix: 'Error removing term:' });
  }
}

/**
 * Initialize vocabulary UI event listeners
 */
function initializeVocabularyUI() {
  // Add term button
  const addTermBtn = document.getElementById('addTermBtn');
  if (addTermBtn) {
    addTermBtn.addEventListener('click', addTerm);
  }

  // Enter key support
  document.getElementById('termInput')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') addTerm();
  });

  // Reload button
  const reloadBtn = document.getElementById('vocabularyReloadBtn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      await window.electronAPI.vocabularyReload();
      await loadVocabulary();
      notifySuccess('Vocabulary reloaded from disk');
    });
  }

  // Export button
  const exportBtn = document.getElementById('vocabularyExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (vocabularyConfig) {
        const dataStr = JSON.stringify(vocabularyConfig, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vocabulary-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notifySuccess('Vocabulary exported');
      }
    });
  }

  // Import button
  const importBtn = document.getElementById('vocabularyImportBtn');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.yaml,.yml';
      input.onchange = async e => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async event => {
            try {
              const imported = JSON.parse(event.target.result);
              // Merge global vocabulary only
              if (imported.global) {
                vocabularyConfig.global.spelling_corrections.push(
                  ...(imported.global.spelling_corrections || [])
                );
                vocabularyConfig.global.keyword_boosts.push(
                  ...(imported.global.keyword_boosts || [])
                );
              }
              // Also import any keyword_boosts from client configs as global
              if (imported.clients) {
                for (const clientVocab of Object.values(imported.clients)) {
                  vocabularyConfig.global.keyword_boosts.push(
                    ...(clientVocab.keyword_boosts || [])
                  );
                }
              }
              await window.electronAPI.vocabularySaveConfig(vocabularyConfig);
              await loadVocabulary();
              notifySuccess('Vocabulary imported');
            } catch (error) {
              console.error('[Vocabulary] Import error:', error);
              notifyError(error, { prefix: 'Failed to import vocabulary:' });
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    });
  }
}

// Expose delete function globally for onclick handlers
window.deleteTerm = deleteTerm;

// Initialize vocabulary UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeVocabularyUI();
});

// ===================================================================
// v1.2: Stream Deck Settings
// ===================================================================

/**
 * Load Stream Deck settings and status
 */
async function loadStreamDeckSettings() {
  console.log('[Settings] Loading Stream Deck settings...');

  const enabledToggle = document.getElementById('streamDeckEnabled');
  const statusItem = document.getElementById('streamDeckStatusItem');
  const infoBox = document.getElementById('streamDeckInfoBox');
  const refreshBtn = document.getElementById('refreshStreamDeckStatus');

  try {
    // Load app settings to get current Stream Deck enabled state
    const settingsResult = await window.electronAPI.appGetSettings();
    if (settingsResult.success && settingsResult.data) {
      const enabled = settingsResult.data.streamDeck?.enabled || false;
      if (enabledToggle) {
        enabledToggle.checked = enabled;
      }

      // Show/hide additional info based on enabled state
      if (statusItem) statusItem.style.display = enabled ? 'flex' : 'none';
      if (infoBox) infoBox.style.display = enabled ? 'block' : 'none';

      // If enabled, load status
      if (enabled) {
        await refreshStreamDeckStatus();
      }
    }
  } catch (error) {
    console.error('[Settings] Error loading Stream Deck settings:', error);
  }

  // Set up toggle handler
  if (enabledToggle) {
    enabledToggle.addEventListener('change', async () => {
      const enabled = enabledToggle.checked;
      console.log('[Settings] Stream Deck enabled:', enabled);

      try {
        await window.electronAPI.appUpdateSettings({
          streamDeck: { enabled },
        });

        // Show/hide additional info
        if (statusItem) statusItem.style.display = enabled ? 'flex' : 'none';
        if (infoBox) infoBox.style.display = enabled ? 'block' : 'none';

        if (enabled) {
          await refreshStreamDeckStatus();
          notifySuccess('Stream Deck integration enabled');
        } else {
          notifyInfo('Stream Deck integration disabled');
        }
      } catch (error) {
        console.error('[Settings] Error updating Stream Deck settings:', error);
        notifyError(error, { prefix: 'Failed to update Stream Deck settings:' });
        // Revert toggle
        enabledToggle.checked = !enabled;
      }
    });
  }

  // Set up refresh button
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshStreamDeckStatus();
    });
  }
}

/**
 * Refresh Stream Deck connection status
 */
async function refreshStreamDeckStatus() {
  const statusText = document.getElementById('streamDeckStatusText');

  try {
    const result = await window.electronAPI.appGetStreamDeckStatus();

    if (result.success && result.data) {
      const { enabled, connectedClients, wsEndpoint } = result.data;

      if (statusText) {
        if (!enabled) {
          statusText.textContent = 'Disabled';
          statusText.style.color = 'var(--text-secondary)';
        } else if (connectedClients > 0) {
          statusText.textContent = `Connected (${connectedClients} client${connectedClients !== 1 ? 's' : ''})`;
          statusText.style.color = 'var(--status-success)';
        } else {
          statusText.textContent = 'Enabled, waiting for connections...';
          statusText.style.color = 'var(--status-warning)';
        }
      }

      // Update endpoint display
      const endpointEl = document.getElementById('streamDeckEndpoint');
      if (endpointEl && wsEndpoint) {
        endpointEl.textContent = wsEndpoint;
      }
    }
  } catch (error) {
    console.error('[Settings] Error refreshing Stream Deck status:', error);
    if (statusText) {
      statusText.textContent = 'Error checking status';
      statusText.style.color = 'var(--status-error)';
    }
  }
}

// Initialize settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeBackupUI();
  initializeMcpUI();
});

// ===================================================
// Backup & Restore UI (v1.4)
// ===================================================

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function loadBackupManifest() {
  if (!window.electronAPI?.backupGetManifest) return;
  try {
    const result = await window.electronAPI.backupGetManifest();
    if (!result.success) return;
    const m = result.manifest;

    const dbInfo = document.getElementById('backupDbInfo');
    const configInfo = document.getElementById('backupConfigInfo');
    const audioInfo = document.getElementById('backupAudioInfo');
    const totalInfo = document.getElementById('backupTotalInfo');
    const lastInfo = document.getElementById('backupLastInfo');

    if (dbInfo) dbInfo.textContent = `${m.database.files} file (${formatBytes(m.database.size)})`;
    if (configInfo) configInfo.textContent = `${m.config.files} files (${formatBytes(m.config.size)})`;
    if (audioInfo) audioInfo.textContent = `${m.audio.files} files (${formatBytes(m.audio.size)})`;
    if (totalInfo) totalInfo.textContent = `${m.total.files} files (${formatBytes(m.total.size)})`;
    if (lastInfo) {
      lastInfo.textContent = m.lastBackup
        ? `${new Date(m.lastBackup.created_at).toLocaleString()} (${m.lastBackup.backup_type}, ${formatBytes(m.lastBackup.total_size)})`
        : 'Never';
    }
  } catch (error) {
    console.error('[Settings] Failed to load backup manifest:', error);
  }
}

function initializeBackupUI() {
  const fullBtn = document.getElementById('backupFullBtn');
  const incrementalBtn = document.getElementById('backupIncrementalBtn');
  const restoreBtn = document.getElementById('backupRestoreBtn');
  const restoreConfirmBtn = document.getElementById('backupRestoreConfirmBtn');
  const backupStatus = document.getElementById('backupStatus');
  const restoreStatus = document.getElementById('backupRestoreStatus');
  const restoreOptions = document.getElementById('backupRestoreOptions');

  if (fullBtn) {
    fullBtn.addEventListener('click', async () => {
      const dirResult = await window.electronAPI.backupSelectOutputDir();
      if (!dirResult.success) return;

      fullBtn.disabled = true;
      if (backupStatus) backupStatus.textContent = 'Creating full backup...';

      const result = await window.electronAPI.backupCreateFull(dirResult.path);
      fullBtn.disabled = false;

      if (result.success) {
        if (backupStatus) backupStatus.textContent = `Backup complete: ${result.filesIncluded} files (${formatBytes(result.totalSize)})`;
        notifySuccess('Full backup created successfully');
        loadBackupManifest();
      } else {
        if (backupStatus) backupStatus.textContent = `Backup failed: ${result.error}`;
        notifyError(result.error || 'Backup failed');
      }
    });
  }

  if (incrementalBtn) {
    incrementalBtn.addEventListener('click', async () => {
      const dirResult = await window.electronAPI.backupSelectOutputDir();
      if (!dirResult.success) return;

      incrementalBtn.disabled = true;
      if (backupStatus) backupStatus.textContent = 'Creating incremental backup...';

      const result = await window.electronAPI.backupCreateIncremental(dirResult.path);
      incrementalBtn.disabled = false;

      if (result.success) {
        const msg = result.filesIncluded === 0
          ? 'No changes since last backup'
          : `Incremental backup: ${result.filesIncluded} files (${formatBytes(result.totalSize)})`;
        if (backupStatus) backupStatus.textContent = msg;
        notifySuccess(msg);
        loadBackupManifest();
      } else {
        if (backupStatus) backupStatus.textContent = `Backup failed: ${result.error}`;
        notifyError(result.error || 'Backup failed');
      }
    });
  }

  let selectedBackupPath = null;

  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      const fileResult = await window.electronAPI.backupSelectRestoreFile();
      if (!fileResult.success) return;

      if (restoreStatus) restoreStatus.textContent = 'Validating...';
      const validation = await window.electronAPI.backupValidate(fileResult.path);

      if (validation.valid) {
        selectedBackupPath = fileResult.path;
        if (restoreStatus) restoreStatus.textContent = `Valid backup: ${validation.fileCount} files`;
        if (restoreOptions) restoreOptions.style.display = 'block';
      } else {
        if (restoreStatus) restoreStatus.textContent = `Invalid backup: ${validation.error}`;
        notifyError(validation.error || 'Invalid backup file');
      }
    });
  }

  // Restore toggle switches
  const toggleIds = ['restoreDatabaseToggle', 'restoreConfigToggle', 'restoreAudioToggle'];
  for (const id of toggleIds) {
    const toggle = document.getElementById(id);
    if (toggle) {
      toggle.addEventListener('click', () => toggle.classList.toggle('active'));
    }
  }

  if (restoreConfirmBtn) {
    restoreConfirmBtn.addEventListener('click', async () => {
      if (!selectedBackupPath) return;

      const options = {
        restoreDatabase: document.getElementById('restoreDatabaseToggle')?.classList.contains('active'),
        restoreConfig: document.getElementById('restoreConfigToggle')?.classList.contains('active'),
        restoreAudio: document.getElementById('restoreAudioToggle')?.classList.contains('active'),
      };

      restoreConfirmBtn.disabled = true;
      if (restoreStatus) restoreStatus.textContent = 'Restoring...';

      const result = await window.electronAPI.backupRestore(selectedBackupPath, options);
      restoreConfirmBtn.disabled = false;

      if (result.success) {
        notifySuccess('Backup restored successfully. Please restart the application.');
        if (restoreStatus) restoreStatus.textContent = 'Restore complete. Restart recommended.';
        if (restoreOptions) restoreOptions.style.display = 'none';
      } else {
        notifyError(result.error || 'Restore failed');
        if (restoreStatus) restoreStatus.textContent = `Restore failed: ${result.error}`;
      }
    });
  }
}

// ===================================================
// MCP Server UI (v1.4)
// ===================================================

function initializeMcpUI() {
  const loadBtn = document.getElementById('mcpLoadConfigBtn');
  const copyBtn = document.getElementById('mcpCopyConfigBtn');
  const snippet = document.getElementById('mcpConfigSnippet');

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      if (!window.electronAPI?.mcpGetConfig) return;
      const result = await window.electronAPI.mcpGetConfig();
      if (result.success && snippet) {
        snippet.textContent = result.configSnippet;
        snippet.style.display = 'block';
        if (copyBtn) copyBtn.style.display = 'inline-block';
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (snippet) {
        navigator.clipboard.writeText(snippet.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        });
      }
    });
  }
}

// ===================================================================
// Clients Tab (v1.4 - replaces Routing)
// ===================================================================

async function renderClientsTab() {
  const summary = document.getElementById('clientsSummary');
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  try {
    const result = await window.electronAPI.companiesGetAll();
    const companies = result.success ? result.companies : [];
    const configured = companies.filter(c => c.vaultPath);
    const clientCount = configured.filter(c => c.category === 'Client').length;
    const otherCount = configured.length - clientCount;

    if (summary) {
      summary.textContent =
        `${configured.length} companies configured \u2014 ` +
        `${clientCount} Client${clientCount !== 1 ? 's' : ''}, ` +
        `${otherCount} Other`;
    }

    tbody.textContent = '';
    for (const company of configured) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';

      const tdName = document.createElement('td');
      tdName.style.cssText = 'padding: 8px 12px; font-weight: 500;';
      tdName.textContent = company.name;
      tr.appendChild(tdName);

      const tdCategory = document.createElement('td');
      tdCategory.style.cssText = 'padding: 8px 12px;';
      const catSelect = document.createElement('select');
      catSelect.className = 'settings-select client-category-select';
      catSelect.dataset.name = company.name;
      catSelect.style.cssText = 'padding: 4px 8px; font-size: 13px;';
      const optClient = document.createElement('option');
      optClient.value = 'Client';
      optClient.textContent = 'Client';
      optClient.selected = company.category === 'Client';
      const optOther = document.createElement('option');
      optOther.value = 'Other';
      optOther.textContent = 'Other';
      optOther.selected = company.category !== 'Client';
      catSelect.appendChild(optClient);
      catSelect.appendChild(optOther);
      tdCategory.appendChild(catSelect);
      tr.appendChild(tdCategory);

      const tdPath = document.createElement('td');
      tdPath.style.cssText = 'padding: 8px 12px;';
      const pathWrapper = document.createElement('div');
      pathWrapper.style.cssText = 'display: flex; gap: 4px; align-items: center;';
      const pathInput = document.createElement('input');
      pathInput.type = 'text';
      pathInput.className = 'settings-input client-path-input';
      pathInput.dataset.name = company.name;
      pathInput.value = company.vaultPath || '';
      pathInput.placeholder = 'No folder selected';
      pathInput.readOnly = true;
      pathInput.style.cssText = 'padding: 4px 8px; font-size: 13px; flex: 1; cursor: default;';
      pathWrapper.appendChild(pathInput);
      const browseBtn = document.createElement('button');
      browseBtn.className = 'btn btn-secondary btn-sm client-browse-btn';
      browseBtn.dataset.name = company.name;
      browseBtn.textContent = 'Browse';
      browseBtn.style.cssText = 'flex-shrink: 0; padding: 4px 8px; font-size: 12px;';
      pathWrapper.appendChild(browseBtn);
      tdPath.appendChild(pathWrapper);
      tr.appendChild(tdPath);

      const tdContacts = document.createElement('td');
      tdContacts.style.cssText = 'padding: 8px 12px; color: var(--text-secondary); font-size: 13px;';
      tdContacts.textContent = company.contactCount || 0;
      tr.appendChild(tdContacts);

      const tdAction = document.createElement('td');
      tdAction.style.cssText = 'padding: 8px 12px;';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon client-remove-btn';
      removeBtn.dataset.name = company.name;
      removeBtn.title = 'Remove';
      removeBtn.style.cssText = 'background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 16px;';
      removeBtn.textContent = '\u00d7';
      tdAction.appendChild(removeBtn);
      tr.appendChild(tdAction);

      tbody.appendChild(tr);
    }

    bindClientsTableHandlers();
  } catch (error) {
    if (summary) summary.textContent = 'Failed to load companies';
    console.error('[Settings] Clients tab error:', error);
  }
}

function bindClientsTableHandlers() {
  // Category change — save immediately
  document.querySelectorAll('.client-category-select').forEach(select => {
    select.addEventListener('change', async () => {
      const name = select.dataset.name;
      const pathInput = select.closest('tr').querySelector('.client-path-input');
      await window.electronAPI.companiesUpdate({
        name, vaultPath: pathInput?.value || null, category: select.value,
      });
    });
  });

  // Browse buttons — open folder picker, then save
  document.querySelectorAll('.client-browse-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      const result = await window.electronAPI.companiesSelectFolder();
      if (result.success && result.folderPath) {
        const pathInput = btn.closest('tr').querySelector('.client-path-input');
        if (pathInput) pathInput.value = result.folderPath;
        const catSelect = btn.closest('tr').querySelector('.client-category-select');
        await window.electronAPI.companiesUpdate({
          name, vaultPath: result.folderPath, category: catSelect?.value || 'Other',
        });
      }
    });
  });

  // Remove button
  document.querySelectorAll('.client-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.electronAPI.companiesRemove(btn.dataset.name);
      renderClientsTab();
    });
  });

  const addBtn = document.getElementById('addClientBtn');
  if (addBtn) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener('click', showAddClientPicker);
  }

  const cancelBtn = document.getElementById('cancelAddClient');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      document.getElementById('addClientPicker').style.display = 'none';
    });
  }
}

async function showAddClientPicker() {
  const picker = document.getElementById('addClientPicker');
  const resultsContainer = document.getElementById('addClientResults');
  const searchInput = document.getElementById('addClientSearch');
  if (!picker || !resultsContainer || !searchInput) return;

  picker.style.display = 'block';
  searchInput.value = '';
  searchInput.focus();

  const result = await window.electronAPI.companiesGetAll();
  const unconfigured = (result.success ? result.companies : []).filter(c => !c.vaultPath);

  const renderResults = (filter) => {
    const filtered = filter
      ? unconfigured.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
      : unconfigured;

    resultsContainer.textContent = '';
    for (const c of filtered.slice(0, 30)) {
      const opt = document.createElement('div');
      opt.className = 'add-client-option';
      opt.dataset.name = c.name;
      opt.style.cssText = 'padding: 8px 12px; cursor: pointer; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.name;
      opt.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.style.cssText = 'color: var(--text-secondary); font-size: 12px;';
      countSpan.textContent = `${c.contactCount || 0} contacts`;
      opt.appendChild(countSpan);

      opt.addEventListener('click', async () => {
        await window.electronAPI.companiesUpdate({
          name: c.name, vaultPath: '', category: 'Client',
        });
        picker.style.display = 'none';
        renderClientsTab();
      });
      opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--bg-secondary)'; });
      opt.addEventListener('mouseleave', () => { opt.style.background = ''; });

      resultsContainer.appendChild(opt);
    }
  };

  renderResults('');
  const newSearch = searchInput.cloneNode(true);
  searchInput.parentNode.replaceChild(newSearch, searchInput);
  newSearch.addEventListener('input', () => renderResults(newSearch.value));
  newSearch.focus();
}

// ===================================================================
// Reports Tab (v1.4)
// ===================================================================

let settingsReportType = 'no-recording';
const settingsReportData = { noRecording: [], noCalendar: [], coverage: null };
let settingsReportsInitialized = false;

function initSettingsReports() {
  if (settingsReportsInitialized) return;
  settingsReportsInitialized = true;

  // Default date range: last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const fromInput = document.getElementById('settingsReportDateFrom');
  const toInput = document.getElementById('settingsReportDateTo');
  if (fromInput) fromInput.value = thirtyDaysAgo.toISOString().split('T')[0];
  if (toInput) toInput.value = now.toISOString().split('T')[0];

  // Range preset buttons
  document.querySelectorAll('.settings-report-range').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days, 10);
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      if (fromInput) fromInput.value = from.toISOString().split('T')[0];
      if (toInput) toInput.value = to.toISOString().split('T')[0];
    });
  });

  // Report type tabs
  document.querySelectorAll('.settings-report-type').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-report-type').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settingsReportType = btn.dataset.type;
      renderSettingsReport();
    });
  });

  // Run button
  const runBtn = document.getElementById('settingsRunReportBtn');
  if (runBtn) {
    runBtn.addEventListener('click', runSettingsReport);
  }

  // Run initial report
  runSettingsReport();
}

async function runSettingsReport() {
  const dateFrom = document.getElementById('settingsReportDateFrom')?.value;
  const dateTo = document.getElementById('settingsReportDateTo')?.value;
  if (!dateFrom || !dateTo) return;

  const resultsEl = document.getElementById('settingsReportsResults');
  if (resultsEl) {
    resultsEl.textContent = '';
    const loading = document.createElement('p');
    loading.style.cssText = 'color: var(--text-secondary); text-align: center; padding: 40px;';
    loading.textContent = 'Loading report data...';
    resultsEl.appendChild(loading);
  }

  try {
    const promises = [
      window.electronAPI.calendarReportMeetingsWithoutRecordings(dateFrom, dateTo),
      window.electronAPI.calendarReportRecordingsWithoutCalendar(dateFrom, dateTo),
    ];
    if (window.electronAPI.calendarCoverageReport) {
      promises.push(window.electronAPI.calendarCoverageReport(dateFrom, dateTo));
    }

    const [noRecResult, noCalResult, coverageResult] = await Promise.all(promises);
    settingsReportData.noRecording = noRecResult.success ? noRecResult.meetings : [];
    settingsReportData.noCalendar = noCalResult.success ? noCalResult.meetings : [];
    settingsReportData.coverage = coverageResult?.success ? coverageResult : null;

    renderSettingsReport();
  } catch (error) {
    console.error('[Settings Reports] Error:', error);
    if (resultsEl) {
      resultsEl.textContent = '';
      const errP = document.createElement('p');
      errP.style.cssText = 'color: var(--color-error); padding: 20px;';
      errP.textContent = `Error: ${error.message}`;
      resultsEl.appendChild(errP);
    }
  }
}

function renderSettingsReport() {
  const resultsEl = document.getElementById('settingsReportsResults');
  if (!resultsEl) return;

  resultsEl.textContent = '';
  let meetings = [];
  let emptyMsg = '';

  if (settingsReportType === 'no-recording') {
    meetings = settingsReportData.noRecording;
    emptyMsg = 'All calendar meetings have recordings!';
  } else if (settingsReportType === 'no-calendar') {
    meetings = settingsReportData.noCalendar;
    emptyMsg = 'All recordings have matching calendar events!';
  } else if (settingsReportType === 'coverage') {
    const cov = settingsReportData.coverage;
    if (cov) {
      const summary = document.createElement('div');
      summary.style.cssText = 'padding: 16px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 16px;';

      const pct = document.createElement('div');
      pct.style.cssText = 'font-size: 24px; font-weight: 600; margin-bottom: 4px;';
      pct.textContent = `${cov.coveragePercent}% Coverage`;
      summary.appendChild(pct);

      const detail = document.createElement('div');
      detail.style.cssText = 'color: var(--text-secondary); font-size: 13px;';
      detail.textContent = `${cov.covered?.length || 0} recorded / ${cov.total || 0} total calendar meetings`;
      summary.appendChild(detail);

      resultsEl.appendChild(summary);
    }
    meetings = settingsReportData.coverage?.uncovered || [];
    emptyMsg = 'Full calendar coverage!';
  }

  if (meetings.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color: var(--text-secondary); text-align: center; padding: 20px;';
    empty.textContent = emptyMsg;
    resultsEl.appendChild(empty);
    return;
  }

  for (const m of meetings) {
    const row = document.createElement('div');
    row.style.cssText = 'padding: 10px 12px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;';

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 500; font-size: 14px;';
    title.textContent = m.title || 'Untitled';
    info.appendChild(title);

    const date = document.createElement('div');
    date.style.cssText = 'font-size: 12px; color: var(--text-secondary);';
    date.textContent = m.date ? new Date(m.date).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }) : '';
    info.appendChild(date);
    row.appendChild(info);

    resultsEl.appendChild(row);
  }
}
