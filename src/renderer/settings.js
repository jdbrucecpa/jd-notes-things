/**
 * Settings Management Module (Phase 10.1 + 10.2 + 10.3)
 * Handles application settings, theme switching, and persistence
 * Phase 10.1: Settings infrastructure and theme foundation
 * Phase 10.2: Security panel with API key management
 * Phase 10.3: AI model configuration (separate providers for auto vs template summaries)
 */

import { initializeSecurityPanel } from './securitySettings.js';
import { updateEditorTheme } from './templates.js';
import { updateRoutingEditorTheme } from './routing.js';
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
  // CRM Integration settings (OCRM)
  crmIntegration: {
    enabled: false, // Master toggle for CRM integration
    pathStructure: 'legacy', // 'legacy' | 'ocrm' - folder structure to use
    useRequestQueue: false, // Write .crm/requests/ JSON files for obsidian-crm plugin
    waitForAck: false, // Poll for acknowledgment from CRM plugin
    ackTimeoutMs: 5000, // Timeout for acknowledgment polling
  },
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
      { buttonId: 'routingSettingsTab', contentId: 'routingPanel' },
      { buttonId: 'templatesSettingsTab', contentId: 'templatesPanel' },
      { buttonId: 'vocabularySettingsTab', contentId: 'vocabularyPanel' },
      { buttonId: 'patternsSettingsTab', contentId: 'patternsPanel' },
      { buttonId: 'notificationsSettingsTab', contentId: 'notificationsPanel' },
      { buttonId: 'shortcutsSettingsTab', contentId: 'shortcutsPanel' },
      { buttonId: 'streamDeckSettingsTab', contentId: 'streamdeckPanel' },
      { buttonId: 'logsSettingsTab', contentId: 'logsPanel' },
      { buttonId: 'advancedSettingsTab', contentId: 'advancedPanel' },
      { buttonId: 'aboutSettingsTab', contentId: 'aboutPanel' },
    ],
    buttonId => {
      // Trigger panel-specific actions based on which tab was activated
      if (buttonId === 'profileSettingsTab') {
        console.log('[Settings] Profile tab clicked, loading profile');
        loadUserProfile();
      } else if (buttonId === 'templatesSettingsTab' && window.loadTemplates) {
        console.log('[Settings] Templates tab clicked, calling loadTemplates()');
        window.loadTemplates();
      } else if (buttonId === 'routingSettingsTab' && window.loadRouting) {
        console.log('[Settings] Routing tab clicked, calling loadRouting()');
        window.loadRouting();
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
      updateRoutingEditorTheme(isActive);
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

  // Initialize profile save button
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', saveUserProfile);
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

// ===================================================================
// OCRM: CRM Integration Settings
// ===================================================================

/**
 * Initialize CRM Integration settings UI
 */
export function initializeCrmSettings() {
  const settings = loadSettings();
  const crmSettings = settings.crmIntegration || DEFAULT_SETTINGS.crmIntegration;

  // Get DOM elements
  const crmEnabledToggle = document.getElementById('crmEnabledToggle');
  const crmSettingsContainer = document.getElementById('crmSettingsContainer');
  const crmPathStructureSelect = document.getElementById('crmPathStructureSelect');
  const crmRequestQueueToggle = document.getElementById('crmRequestQueueToggle');
  const crmAckSettings = document.getElementById('crmAckSettings');
  const crmWaitForAckToggle = document.getElementById('crmWaitForAckToggle');
  const crmDocsLink = document.getElementById('crmDocsLink');

  // Initialize UI state
  if (crmEnabledToggle) {
    if (crmSettings.enabled) {
      crmEnabledToggle.classList.add('active');
    }
    if (crmSettingsContainer) {
      crmSettingsContainer.style.display = crmSettings.enabled ? 'block' : 'none';
    }
  }

  if (crmPathStructureSelect) {
    crmPathStructureSelect.value = crmSettings.pathStructure || 'legacy';
  }

  if (crmRequestQueueToggle) {
    if (crmSettings.useRequestQueue) {
      crmRequestQueueToggle.classList.add('active');
    }
    if (crmAckSettings) {
      crmAckSettings.style.display = crmSettings.useRequestQueue ? 'flex' : 'none';
    }
  }

  if (crmWaitForAckToggle && crmSettings.waitForAck) {
    crmWaitForAckToggle.classList.add('active');
  }

  // Event handlers
  if (crmEnabledToggle) {
    crmEnabledToggle.addEventListener('click', () => {
      const enabled = crmEnabledToggle.classList.toggle('active');
      updateCrmSetting('enabled', enabled);
      if (crmSettingsContainer) {
        crmSettingsContainer.style.display = enabled ? 'block' : 'none';
      }
      notifySuccess(enabled ? 'CRM Integration enabled' : 'CRM Integration disabled');

      // Sync to main process
      syncCrmSettingsToMain();
    });
  }

  if (crmPathStructureSelect) {
    crmPathStructureSelect.addEventListener('change', e => {
      updateCrmSetting('pathStructure', e.target.value);
      notifySuccess(`Path structure changed to ${e.target.value === 'ocrm' ? 'OCRM' : 'Legacy'}`);
      syncCrmSettingsToMain();
    });
  }

  if (crmRequestQueueToggle) {
    crmRequestQueueToggle.addEventListener('click', () => {
      const enabled = crmRequestQueueToggle.classList.toggle('active');
      updateCrmSetting('useRequestQueue', enabled);
      if (crmAckSettings) {
        crmAckSettings.style.display = enabled ? 'flex' : 'none';
      }
      notifySuccess(enabled ? 'CRM Request Queue enabled' : 'CRM Request Queue disabled');
      syncCrmSettingsToMain();
    });
  }

  if (crmWaitForAckToggle) {
    crmWaitForAckToggle.addEventListener('click', () => {
      const enabled = crmWaitForAckToggle.classList.toggle('active');
      updateCrmSetting('waitForAck', enabled);
      notifySuccess(enabled ? 'Wait for acknowledgment enabled' : 'Wait for acknowledgment disabled');
      syncCrmSettingsToMain();
    });
  }

  if (crmDocsLink) {
    crmDocsLink.addEventListener('click', e => {
      e.preventDefault();
      window.electronAPI?.openExternal('https://github.com/jdbruce-cpa/obsidian-crm');
    });
  }
}

/**
 * Update a single CRM setting
 */
function updateCrmSetting(key, value) {
  const settings = loadSettings();
  if (!settings.crmIntegration) {
    settings.crmIntegration = { ...DEFAULT_SETTINGS.crmIntegration };
  }
  settings.crmIntegration[key] = value;
  saveSettings(settings);
}

/**
 * Sync CRM settings to main process
 */
async function syncCrmSettingsToMain() {
  try {
    const settings = loadSettings();
    if (window.electronAPI?.appUpdateSettings) {
      await window.electronAPI.appUpdateSettings({
        crmIntegration: settings.crmIntegration,
      });
    }
  } catch (error) {
    console.error('[CRM Settings] Error syncing to main process:', error);
  }
}

/**
 * Get CRM settings - exported for use by other modules
 */
export function getCrmSettings() {
  const settings = loadSettings();
  return settings.crmIntegration || DEFAULT_SETTINGS.crmIntegration;
}

// Initialize CRM settings when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeCrmSettings();
});
