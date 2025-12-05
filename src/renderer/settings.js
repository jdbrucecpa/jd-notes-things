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
import { initialize as initializePatternTestingPanel, updateEditorTheme as updatePatternEditorTheme } from './components/PatternTestingPanel.js';
import { initializeTabs } from './utils/tabHelper.js';

// Default settings
const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' or 'dark'
  autoStartRecording: false,
  debugMode: false,
  vaultPath: '',
  autoSummaryProvider: 'azure-gpt-5-mini', // AI model for auto-summaries
  templateSummaryProvider: 'azure-gpt-5-mini', // AI model for template summaries
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
 * Export settings as JSON file
 */
export function exportSettings() {
  const settings = loadSettings();
  const dataStr = JSON.stringify(settings, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(dataBlob);
  link.download = `jd-notes-settings-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Import settings from JSON file
 */
export function importSettings(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        const merged = { ...DEFAULT_SETTINGS, ...imported };

        if (saveSettings(merged)) {
          // Apply theme immediately
          applyTheme(merged.theme);
          resolve(merged);
        } else {
          reject(new Error('Failed to save imported settings'));
        }
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Open settings and switch to a specific tab
 */
export function openSettingsTab(tabName) {
  const settingsView = document.getElementById('settingsView');
  const mainView = document.getElementById('mainView');
  const contactsView = document.getElementById('contactsView');

  // Close contacts view if open
  if (contactsView) contactsView.style.display = 'none';

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
  const debugModeToggle = document.getElementById('debugModeToggle');
  const vaultPathInput = document.getElementById('vaultPathInput');
  const browseVaultPathBtn = document.getElementById('browseVaultPathBtn');
  const autoSummaryProviderSelect = document.getElementById('autoSummaryProviderSelect');
  const templateSummaryProviderSelect = document.getElementById('templateSummaryProviderSelect');
  const patternGenerationProviderSelect = document.getElementById('patternGenerationProviderSelect');
  const exportSettingsBtn = document.getElementById('exportSettingsBtn');
  const importSettingsBtn = document.getElementById('importSettingsBtn');
  const importSettingsFile = document.getElementById('importSettingsFile');
  const exportAllSettingsBtn = document.getElementById('exportAllSettingsBtn');
  const importAllSettingsBtn = document.getElementById('importAllSettingsBtn');
  const exportStatus = document.getElementById('exportStatus');

  // Version information
  const electronVersion = document.getElementById('electronVersion');
  const nodeVersion = document.getElementById('nodeVersion');
  const chromeVersion = document.getElementById('chromeVersion');

  // Open settings (full-page view)
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      // Close contacts view if open
      const contactsView = document.getElementById('contactsView');
      if (contactsView) contactsView.style.display = 'none';

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
  initializeTabs([
    { buttonId: 'profileSettingsTab', contentId: 'profilePanel' },
    { buttonId: 'generalSettingsTab', contentId: 'generalPanel' },
    { buttonId: 'securitySettingsTab', contentId: 'securityPanel' },
    { buttonId: 'routingSettingsTab', contentId: 'routingPanel' },
    { buttonId: 'templatesSettingsTab', contentId: 'templatesPanel' },
    { buttonId: 'patternsSettingsTab', contentId: 'patternsPanel' },
    { buttonId: 'notificationsSettingsTab', contentId: 'notificationsPanel' },
    { buttonId: 'shortcutsSettingsTab', contentId: 'shortcutsPanel' },
    { buttonId: 'logsSettingsTab', contentId: 'logsPanel' },
    { buttonId: 'advancedSettingsTab', contentId: 'advancedPanel' },
    { buttonId: 'aboutSettingsTab', contentId: 'aboutPanel' }
  ], (buttonId) => {
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
    }
  });

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
          window.showToast('Vault path updated successfully', 'success');
        } else if (result.error) {
          window.showToast(`Failed to update vault path: ${result.error}`, 'error');
        }
        // If canceled (success: false, no error), do nothing
      } catch (error) {
        console.error('[Settings] Error choosing vault path:', error);
        window.showToast('Failed to update vault path', 'error');
      }
    });
  }

  // Auto Summary Provider selection
  if (autoSummaryProviderSelect) {
    autoSummaryProviderSelect.addEventListener('change', (e) => {
      updateSetting('autoSummaryProvider', e.target.value);
      window.showToast(`Auto-summary provider changed to ${e.target.options[e.target.selectedIndex].text}`, 'success');
    });
  }

  // Template Summary Provider selection
  if (templateSummaryProviderSelect) {
    templateSummaryProviderSelect.addEventListener('change', (e) => {
      updateSetting('templateSummaryProvider', e.target.value);
      window.showToast(`Template summary provider changed to ${e.target.options[e.target.selectedIndex].text}`, 'success');
    });
  }

  // Pattern Generation Provider selection (Phase 10.8.3)
  if (patternGenerationProviderSelect) {
    patternGenerationProviderSelect.addEventListener('change', (e) => {
      updateSetting('patternGenerationProvider', e.target.value);
      window.showToast(`Pattern generation provider changed to ${e.target.options[e.target.selectedIndex].text}`, 'success');
    });
  }

  // Export settings
  if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener('click', () => {
      exportSettings();
      window.showToast('Settings exported successfully', 'success');
    });
  }

  // Import settings
  if (importSettingsBtn) {
    importSettingsBtn.addEventListener('click', () => {
      importSettingsFile.click();
    });
  }

  if (importSettingsFile) {
    importSettingsFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await importSettings(file);
        window.showToast('Settings imported successfully', 'success');
        loadSettingsIntoUI();

        // Clear file input
        e.target.value = '';
      } catch (error) {
        console.error('Error importing settings:', error);
        window.showToast('Failed to import settings: ' + error.message, 'error');
      }
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
          window.showToast(`Settings exported successfully (${sizeKB} KB)`, 'success');

          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: #27ae60;">Export complete:</span> ${result.manifest.included.length} files exported`;
            if (result.manifest.warnings.length > 0) {
              exportStatus.innerHTML += `<br><span style="color: #e67e22;">Warnings:</span> ${result.manifest.warnings.join(', ')}`;
            }
          }
        } else {
          window.showToast('Export failed: ' + result.error, 'error');
          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: #e74c3c;">Export failed:</span> ${result.error}`;
          }
        }
      } catch (error) {
        console.error('Error exporting settings:', error);
        window.showToast('Export failed: ' + error.message, 'error');
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: #e74c3c;">Export failed:</span> ${error.message}`;
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
          window.showToast(`Settings imported: ${result.imported.length} files`, 'success');

          if (exportStatus) {
            let statusHtml = `<span style="color: #27ae60;">Import complete:</span> ${result.imported.length} files imported`;
            if (result.skipped.length > 0) {
              statusHtml += `<br><span style="color: #e67e22;">Skipped:</span> ${result.skipped.length} files (already exist)`;
            }
            if (result.errors.length > 0) {
              statusHtml += `<br><span style="color: #e74c3c;">Errors:</span> ${result.errors.map(e => e.file).join(', ')}`;
            }
            exportStatus.innerHTML = statusHtml;
          }

          // Reload UI to reflect imported settings
          loadSettingsIntoUI();
        } else {
          window.showToast('Import failed: ' + result.error, 'error');
          if (exportStatus) {
            exportStatus.innerHTML = `<span style="color: #e74c3c;">Import failed:</span> ${result.error}`;
          }
        }
      } catch (error) {
        console.error('Error importing settings:', error);
        window.showToast('Import failed: ' + error.message, 'error');
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: #e74c3c;">Import failed:</span> ${error.message}`;
        }
      } finally {
        importAllSettingsBtn.disabled = false;
        importAllSettingsBtn.querySelector('span').textContent = 'Import Settings';
      }
    });
  }

  // Load version information
  if (electronVersion && window.electronAPI) {
    window.electronAPI.getAppVersion().then(version => {
      electronVersion.textContent = version.electron || '-';
      nodeVersion.textContent = version.node || '-';
      chromeVersion.textContent = version.chrome || '-';
    }).catch(() => {
      electronVersion.textContent = 'N/A';
      nodeVersion.textContent = 'N/A';
      chromeVersion.textContent = 'N/A';
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

    if (debugModeToggle) {
      if (currentSettings.debugMode) {
        debugModeToggle.classList.add('active');
      } else {
        debugModeToggle.classList.remove('active');
      }
    }

    // Update AI provider selections
    if (autoSummaryProviderSelect) {
      autoSummaryProviderSelect.value = currentSettings.autoSummaryProvider || 'azure-gpt-5-mini';
    }

    if (templateSummaryProviderSelect) {
      templateSummaryProviderSelect.value = currentSettings.templateSummaryProvider || 'azure-gpt-5-mini';
    }

    if (patternGenerationProviderSelect) {
      patternGenerationProviderSelect.value = currentSettings.patternGenerationProvider || 'openai-gpt-4o-mini';
    }

    // Update vault path (this will be populated from main process)
    if (vaultPathInput && window.electronAPI) {
      window.electronAPI.getVaultPath().then(path => {
        vaultPathInput.value = path || 'Not configured';
      }).catch(() => {
        vaultPathInput.value = 'Not configured';
      });
    }
  }

  // Use global showToast from renderer.js (available via window.showToast)

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
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      }
      window.showToast?.('Profile saved successfully', 'success');
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
    window.showToast?.('Failed to save profile: ' + error.message, 'error');
  }
}
