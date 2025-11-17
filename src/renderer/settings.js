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
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const settingsPanels = {
    general: document.getElementById('generalPanel'),
    appearance: document.getElementById('appearancePanel'),
    security: document.getElementById('securityPanel'),
    routing: document.getElementById('routingPanel'),
    templates: document.getElementById('templatesPanel'),
    patterns: document.getElementById('patternsPanel'),
    notifications: document.getElementById('notificationsPanel'),
    shortcuts: document.getElementById('shortcutsPanel'),
    logs: document.getElementById('logsPanel'),
    advanced: document.getElementById('advancedPanel'),
    about: document.getElementById('aboutPanel'),
  };

  // Show settings view
  if (mainView) mainView.style.display = 'none';
  if (settingsView) settingsView.style.display = 'block';

  // Switch to the requested tab
  settingsTabs.forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Show the corresponding panel
  Object.entries(settingsPanels).forEach(([name, panel]) => {
    if (panel) {
      panel.style.display = name === tabName ? 'block' : 'none';
    }
  });

  // Trigger panel-specific actions
  if (tabName === 'templates' && window.loadTemplates) {
    window.loadTemplates();
  }
  if (tabName === 'routing' && window.loadRouting) {
    window.loadRouting();
  }
  if (tabName === 'patterns') {
    initializePatternTestingPanel('pattern-editor').catch(err => {
      console.error('[Settings] Failed to initialize pattern editor:', err);
    });
  }
  if (tabName === 'logs' && window.refreshLogs) {
    console.log('[Settings] Auto-loading logs');
    window.refreshLogs();
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

  // Tab elements
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const settingsPanels = {
    general: document.getElementById('generalPanel'),
    appearance: document.getElementById('appearancePanel'),
    security: document.getElementById('securityPanel'),
    routing: document.getElementById('routingPanel'),
    templates: document.getElementById('templatesPanel'),
    patterns: document.getElementById('patternsPanel'), // Phase 10.8.2
    notifications: document.getElementById('notificationsPanel'), // Phase 10.7
    shortcuts: document.getElementById('shortcutsPanel'), // Phase 10.7
    logs: document.getElementById('logsPanel'), // Phase 10.7
    advanced: document.getElementById('advancedPanel'),
    about: document.getElementById('aboutPanel'),
  };

  // Control elements
  const darkModeToggle = document.getElementById('darkModeToggle');
  const autoStartToggle = document.getElementById('autoStartToggle');
  const debugModeToggle = document.getElementById('debugModeToggle');
  const vaultPathInput = document.getElementById('vaultPathInput');
  const autoSummaryProviderSelect = document.getElementById('autoSummaryProviderSelect');
  const templateSummaryProviderSelect = document.getElementById('templateSummaryProviderSelect');
  const patternGenerationProviderSelect = document.getElementById('patternGenerationProviderSelect');
  const exportSettingsBtn = document.getElementById('exportSettingsBtn');
  const importSettingsBtn = document.getElementById('importSettingsBtn');
  const importSettingsFile = document.getElementById('importSettingsFile');

  // Version information
  const electronVersion = document.getElementById('electronVersion');
  const nodeVersion = document.getElementById('nodeVersion');
  const chromeVersion = document.getElementById('chromeVersion');

  // Open settings (full-page view)
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
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
  settingsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;

      // Update active tab
      settingsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding panel
      Object.values(settingsPanels).forEach(panel => {
        if (panel) panel.style.display = 'none';
      });
      if (settingsPanels[tabName]) {
        settingsPanels[tabName].style.display = 'block';

        // Load templates when templates panel is shown
        if (tabName === 'templates' && window.loadTemplates) {
          console.log('[Settings] Templates tab clicked, calling loadTemplates()');
          window.loadTemplates();
        }

        // Load routing when routing panel is shown
        if (tabName === 'routing' && window.loadRouting) {
          console.log('[Settings] Routing tab clicked, calling loadRouting()');
          window.loadRouting();
        }

        // Initialize pattern editor when patterns panel is shown (Phase 10.8.2)
        if (tabName === 'patterns') {
          console.log('[Settings] Patterns tab clicked, initializing pattern editor');
          initializePatternTestingPanel('pattern-editor').catch(err => {
            console.error('[Settings] Failed to initialize pattern editor:', err);
          });
        }

        // Load logs when logs panel is shown (Phase 10.7)
        if (tabName === 'logs' && window.refreshLogs) {
          console.log('[Settings] Logs tab clicked, auto-loading logs');
          window.refreshLogs();
        }
      }
    });
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

  // Auto Summary Provider selection
  if (autoSummaryProviderSelect) {
    autoSummaryProviderSelect.addEventListener('change', (e) => {
      updateSetting('autoSummaryProvider', e.target.value);
      showToast(`Auto-summary provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Template Summary Provider selection
  if (templateSummaryProviderSelect) {
    templateSummaryProviderSelect.addEventListener('change', (e) => {
      updateSetting('templateSummaryProvider', e.target.value);
      showToast(`Template summary provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Pattern Generation Provider selection (Phase 10.8.3)
  if (patternGenerationProviderSelect) {
    patternGenerationProviderSelect.addEventListener('change', (e) => {
      updateSetting('patternGenerationProvider', e.target.value);
      showToast(`Pattern generation provider changed to ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // Export settings
  if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener('click', () => {
      exportSettings();
      showToast('Settings exported successfully');
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
        showToast('Settings imported successfully');
        loadSettingsIntoUI();

        // Clear file input
        e.target.value = '';
      } catch (error) {
        console.error('Error importing settings:', error);
        showToast('Failed to import settings: ' + error.message);
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

  /**
   * Show toast notification
   */
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, 2000);
  }

  // Initial load
  loadSettingsIntoUI();
}
