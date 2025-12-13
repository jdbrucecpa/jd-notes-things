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
import {
  initialize as initializePatternTestingPanel,
  updateEditorTheme as updatePatternEditorTheme,
} from './components/PatternTestingPanel.js';
import { initializeTabs } from './utils/tabHelper.js';
import { notifySuccess, notifyError, notifyInfo } from './utils/notificationHelper.js';
import { createModal } from './utils/modalHelper.js';

// Default settings
const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' or 'dark'
  autoStartRecording: false,
  debugMode: false,
  vaultPath: '',
  autoSummaryProvider: 'openai-gpt-4o-mini', // AI model for auto-summaries (Budget-friendly default)
  templateSummaryProvider: 'openai-gpt-4o-mini', // AI model for template summaries
  patternGenerationProvider: 'openai-gpt-5-nano', // AI model for pattern generation (cheapest option)
  // Azure OpenAI settings (v1.2)
  azureEnabled: false, // Whether to show Azure options in model dropdowns
  azureEndpoint: '', // Azure OpenAI endpoint URL
  azureDeployments: [], // Array of { id, name, displayName, tier, inputPrice, outputPrice }
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

  // ═══════════════════════════════════════════════════════════════════
  // Azure OpenAI Settings (v1.2)
  // ═══════════════════════════════════════════════════════════════════
  const azureEnabledToggle = document.getElementById('azureEnabledToggle');
  const azureDeploymentsContainer = document.getElementById('azureDeploymentsContainer');
  const azureDeploymentsList = document.getElementById('azureDeploymentsList');
  const azureDeploymentEmpty = document.getElementById('azureDeploymentEmpty');
  const addAzureDeploymentBtn = document.getElementById('addAzureDeploymentBtn');
  const azureEndpointInput = document.getElementById('azureEndpointInput');

  // Initialize Azure UI state
  function initializeAzureUI() {
    const settings = loadSettings();
    if (azureEnabledToggle) {
      if (settings.azureEnabled) {
        azureEnabledToggle.classList.add('active');
      } else {
        azureEnabledToggle.classList.remove('active');
      }
    }
    if (azureDeploymentsContainer) {
      azureDeploymentsContainer.style.display = settings.azureEnabled ? 'block' : 'none';
    }
    if (azureEndpointInput) {
      azureEndpointInput.value = settings.azureEndpoint || '';
    }
    renderAzureDeployments();
    updateModelDropdownsWithAzure();
  }

  // Azure enabled toggle (click + classList pattern to match other toggles)
  if (azureEnabledToggle) {
    azureEnabledToggle.addEventListener('click', () => {
      const enabled = azureEnabledToggle.classList.toggle('active');
      updateSetting('azureEnabled', enabled);
      if (azureDeploymentsContainer) {
        azureDeploymentsContainer.style.display = enabled ? 'block' : 'none';
      }
      updateModelDropdownsWithAzure();
      notifySuccess(enabled ? 'Azure OpenAI enabled' : 'Azure OpenAI disabled');
    });
  }

  // Azure endpoint input
  if (azureEndpointInput) {
    azureEndpointInput.addEventListener('change', e => {
      updateSetting('azureEndpoint', e.target.value.trim());
      notifySuccess('Azure endpoint updated');
    });
  }

  // Add deployment button
  if (addAzureDeploymentBtn) {
    addAzureDeploymentBtn.addEventListener('click', () => {
      showAzureDeploymentModal();
    });
  }

  // Render Azure deployments list
  function renderAzureDeployments() {
    const settings = loadSettings();
    const deployments = settings.azureDeployments || [];

    if (!azureDeploymentsList) return;

    // Clear existing cards (keep the empty state element)
    const cards = azureDeploymentsList.querySelectorAll('.azure-deployment-card');
    cards.forEach(card => card.remove());

    // Show/hide empty state
    if (azureDeploymentEmpty) {
      azureDeploymentEmpty.style.display = deployments.length === 0 ? 'block' : 'none';
    }

    // Render deployment cards
    deployments.forEach(deployment => {
      const card = createAzureDeploymentCard(deployment);
      azureDeploymentsList.appendChild(card);
    });
  }

  // Create a deployment card element
  function createAzureDeploymentCard(deployment) {
    const card = document.createElement('div');
    card.className = 'azure-deployment-card';
    card.dataset.id = deployment.id;

    const tierLabels = {
      budget: '💰 Budget',
      balanced: '⚖️ Balanced',
      premium: '⭐ Premium',
      'ultra-premium': '💎 Ultra-Premium',
    };

    card.innerHTML = `
      <div class="azure-deployment-info">
        <div class="azure-deployment-name">${escapeHtml(deployment.displayName)}</div>
        <div class="azure-deployment-details">
          <span class="azure-deployment-tier ${deployment.tier}">${tierLabels[deployment.tier] || deployment.tier}</span>
          <span>Deployment: ${escapeHtml(deployment.name)}</span>
          <span>$${deployment.inputPrice}/$${deployment.outputPrice} per MTok</span>
        </div>
      </div>
      <div class="azure-deployment-actions">
        <button class="azure-deployment-btn edit" data-id="${deployment.id}">Edit</button>
        <button class="azure-deployment-btn delete" data-id="${deployment.id}">Delete</button>
      </div>
    `;

    // Edit button handler
    card.querySelector('.azure-deployment-btn.edit').addEventListener('click', () => {
      showAzureDeploymentModal(deployment);
    });

    // Delete button handler
    card.querySelector('.azure-deployment-btn.delete').addEventListener('click', () => {
      deleteAzureDeployment(deployment.id);
    });

    return card;
  }

  // Show add/edit deployment modal using shared modal component
  function showAzureDeploymentModal(existingDeployment = null) {
    const isEdit = !!existingDeployment;
    const title = isEdit ? 'Edit Azure Deployment' : 'Add Azure Deployment';

    const modalBody = `
      <div class="azure-deployment-form">
        <div class="azure-deployment-form-row">
          <label for="azureDeploymentName">Deployment Name *</label>
          <input type="text" id="azureDeploymentName" placeholder="e.g., gpt-5-mini-deployment" value="${isEdit ? escapeHtml(existingDeployment.name) : ''}">
          <small class="hint" style="color: var(--text-secondary); font-size: 11px;">The exact name of your Azure OpenAI deployment</small>
        </div>
        <div class="azure-deployment-form-row">
          <label for="azureDeploymentDisplayName">Display Name *</label>
          <input type="text" id="azureDeploymentDisplayName" placeholder="e.g., GPT-5 Mini (Azure)" value="${isEdit ? escapeHtml(existingDeployment.displayName) : ''}">
          <small class="hint" style="color: var(--text-secondary); font-size: 11px;">How this model appears in the dropdown menus</small>
        </div>
        <div class="azure-deployment-form-row">
          <label for="azureDeploymentTier">Pricing Tier</label>
          <select id="azureDeploymentTier">
            <option value="budget" ${isEdit && existingDeployment.tier === 'budget' ? 'selected' : ''}>💰 Budget</option>
            <option value="balanced" ${!isEdit || existingDeployment.tier === 'balanced' ? 'selected' : ''}>⚖️ Balanced</option>
            <option value="premium" ${isEdit && existingDeployment.tier === 'premium' ? 'selected' : ''}>⭐ Premium</option>
            <option value="ultra-premium" ${isEdit && existingDeployment.tier === 'ultra-premium' ? 'selected' : ''}>💎 Ultra-Premium</option>
          </select>
          <small class="hint" style="color: var(--text-secondary); font-size: 11px;">Used for grouping in the model selector</small>
        </div>
        <div class="azure-deployment-form-pricing" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="azure-deployment-form-row">
            <label for="azureDeploymentInputPrice">Input Price ($/MTok)</label>
            <input type="text" id="azureDeploymentInputPrice" placeholder="0.25" value="${isEdit ? existingDeployment.inputPrice : '0.25'}">
          </div>
          <div class="azure-deployment-form-row">
            <label for="azureDeploymentOutputPrice">Output Price ($/MTok)</label>
            <input type="text" id="azureDeploymentOutputPrice" placeholder="2.00" value="${isEdit ? existingDeployment.outputPrice : '2.00'}">
          </div>
        </div>
      </div>
    `;

    createModal({
      title,
      body: modalBody,
      confirmText: isEdit ? 'Save Changes' : 'Add Deployment',
      cancelText: 'Cancel',
      size: 'medium',
      onConfirm: async () => {
        const name = document.getElementById('azureDeploymentName').value.trim();
        const displayName = document.getElementById('azureDeploymentDisplayName').value.trim();
        const tier = document.getElementById('azureDeploymentTier').value;
        const inputPrice = parseFloat(document.getElementById('azureDeploymentInputPrice').value) || 0.25;
        const outputPrice = parseFloat(document.getElementById('azureDeploymentOutputPrice').value) || 2.0;

        if (!name || !displayName) {
          notifyError('Deployment name and display name are required');
          throw new Error('Validation failed'); // Prevents modal from closing
        }

        const deployment = {
          id: isEdit ? existingDeployment.id : `azure-${name}-${Date.now()}`,
          name,
          displayName,
          tier,
          inputPrice,
          outputPrice,
        };

        if (isEdit) {
          updateAzureDeployment(deployment);
        } else {
          addAzureDeployment(deployment);
        }
      },
    });
  }

  // Add a new Azure deployment
  function addAzureDeployment(deployment) {
    const settings = loadSettings();
    const deployments = settings.azureDeployments || [];
    deployments.push(deployment);
    updateSetting('azureDeployments', deployments);
    renderAzureDeployments();
    updateModelDropdownsWithAzure();
    notifySuccess(`Added Azure deployment: ${deployment.displayName}`);
  }

  // Update an existing Azure deployment
  function updateAzureDeployment(deployment) {
    const settings = loadSettings();
    const deployments = settings.azureDeployments || [];
    const index = deployments.findIndex(d => d.id === deployment.id);
    if (index !== -1) {
      deployments[index] = deployment;
      updateSetting('azureDeployments', deployments);
      renderAzureDeployments();
      updateModelDropdownsWithAzure();
      notifySuccess(`Updated Azure deployment: ${deployment.displayName}`);
    }
  }

  // Delete an Azure deployment
  function deleteAzureDeployment(id) {
    const settings = loadSettings();
    const deployments = settings.azureDeployments || [];
    const deployment = deployments.find(d => d.id === id);
    if (!deployment) return;

    if (confirm(`Delete deployment "${deployment.displayName}"?`)) {
      const newDeployments = deployments.filter(d => d.id !== id);
      updateSetting('azureDeployments', newDeployments);
      renderAzureDeployments();
      updateModelDropdownsWithAzure();
      notifySuccess(`Deleted Azure deployment: ${deployment.displayName}`);
    }
  }

  // Update model dropdowns to include/exclude Azure options
  function updateModelDropdownsWithAzure() {
    const settings = loadSettings();
    const azureEnabled = settings.azureEnabled || false;
    const deployments = settings.azureDeployments || [];

    const dropdowns = [
      autoSummaryProviderSelect,
      templateSummaryProviderSelect,
      patternGenerationProviderSelect,
    ].filter(Boolean);

    dropdowns.forEach(dropdown => {
      // Remove existing Azure optgroup
      const existingAzureGroup = dropdown.querySelector('optgroup[label*="Azure"]');
      if (existingAzureGroup) {
        existingAzureGroup.remove();
      }

      // Add Azure optgroup if enabled and has deployments
      if (azureEnabled && deployments.length > 0) {
        const azureGroup = document.createElement('optgroup');
        azureGroup.label = '☁️ Azure OpenAI';

        // Group deployments by tier
        const tiers = ['budget', 'balanced', 'premium', 'ultra-premium'];
        tiers.forEach(tier => {
          const tierDeployments = deployments.filter(d => d.tier === tier);
          tierDeployments.forEach(deployment => {
            const option = document.createElement('option');
            option.value = `azure-${deployment.name}`;
            option.textContent = `${deployment.displayName} — $${deployment.inputPrice}/$${deployment.outputPrice} per MTok`;
            azureGroup.appendChild(option);
          });
        });

        dropdown.appendChild(azureGroup);
      }
    });
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize Azure UI on settings load
  initializeAzureUI();

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
            exportStatus.innerHTML = `<span style="color: var(--color-error);">Export failed:</span> ${result.error}`;
          }
        }
      } catch (error) {
        console.error('Error exporting settings:', error);
        notifyError(error, { prefix: 'Export failed:' });
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: var(--color-error);">Export failed:</span> ${error.message}`;
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
            exportStatus.innerHTML = `<span style="color: var(--color-error);">Import failed:</span> ${result.error}`;
          }
        }
      } catch (error) {
        console.error('Error importing settings:', error);
        notifyError(error, { prefix: 'Import failed:' });
        if (exportStatus) {
          exportStatus.innerHTML = `<span style="color: var(--color-error);">Import failed:</span> ${error.message}`;
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
        if (result.success) {
          if (updateStatus) {
            updateStatus.textContent = result.message || 'Checking for updates...';
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

    // Update AI provider selections (v1.2: defaults changed to OpenAI)
    if (autoSummaryProviderSelect) {
      autoSummaryProviderSelect.value = currentSettings.autoSummaryProvider || 'openai-gpt-4o-mini';
    }

    if (templateSummaryProviderSelect) {
      templateSummaryProviderSelect.value =
        currentSettings.templateSummaryProvider || 'openai-gpt-4o-mini';
    }

    if (patternGenerationProviderSelect) {
      patternGenerationProviderSelect.value =
        currentSettings.patternGenerationProvider || 'openai-gpt-5-nano';
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
// VC-2: Vocabulary Management
// ===================================================================

let vocabularyScope = 'global'; // 'global' or 'client'
let selectedClientSlug = '';
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
      await loadClientSlugs();
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
 * Load client slugs from routing config for the client selector
 */
async function loadClientSlugs() {
  try {
    const result = await window.electronAPI.vocabularyGetClientSlugs();
    if (result.success) {
      const clientSelect = document.getElementById('vocabularyClientSelect');
      if (clientSelect) {
        // Clear existing options except the default
        clientSelect.innerHTML = '<option value="">-- Select a client --</option>';

        // Add client slugs from routing config
        for (const slug of result.data) {
          const option = document.createElement('option');
          option.value = slug;
          option.textContent = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          clientSelect.appendChild(option);
        }

        // Add client slugs from vocabulary config that aren't in routing
        for (const slug of Object.keys(vocabularyConfig?.clients || {})) {
          if (!result.data.includes(slug)) {
            const option = document.createElement('option');
            option.value = slug;
            option.textContent =
              slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) + ' (vocabulary only)';
            clientSelect.appendChild(option);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Vocabulary] Error loading client slugs:', error);
  }
}

/**
 * Render the vocabulary UI based on current state
 */
function renderVocabularyUI() {
  const vocab = getActiveVocabulary();

  renderSpellingList(vocab.spelling_corrections || []);
  renderKeywordList(vocab.keyword_boosts || []);

  // Update counts
  document.getElementById('spellingCount').textContent = (vocab.spelling_corrections || []).length;
  document.getElementById('keywordCount').textContent = (vocab.keyword_boosts || []).length;
}

/**
 * Get the currently active vocabulary (global or client-specific)
 */
function getActiveVocabulary() {
  if (!vocabularyConfig) return { spelling_corrections: [], keyword_boosts: [] };

  if (vocabularyScope === 'client' && selectedClientSlug) {
    return (
      vocabularyConfig.clients?.[selectedClientSlug] || {
        spelling_corrections: [],
        keyword_boosts: [],
      }
    );
  }
  return vocabularyConfig.global || { spelling_corrections: [], keyword_boosts: [] };
}

/**
 * Render the spelling corrections list
 */
function renderSpellingList(corrections) {
  const list = document.getElementById('spellingList');
  if (!list) return;

  if (corrections.length === 0) {
    list.innerHTML = '<div class="vocabulary-empty">No spelling corrections defined</div>';
    return;
  }

  list.innerHTML = corrections
    .map(
      (sc, index) => `
    <div class="vocabulary-item" data-index="${index}">
      <div class="vocabulary-item-content">
        <span class="vocabulary-item-from">${Array.isArray(sc.from) ? sc.from.join(', ') : sc.from}</span>
        <span class="vocabulary-arrow">→</span>
        <span class="vocabulary-item-to">${sc.to}</span>
      </div>
      <button class="vocabulary-item-delete" onclick="deleteSpelling('${sc.to}')" title="Delete">
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
 * Render the keyword boosts list
 */
function renderKeywordList(keywords) {
  const list = document.getElementById('keywordList');
  if (!list) return;

  if (keywords.length === 0) {
    list.innerHTML = '<div class="vocabulary-empty">No keyword boosts defined</div>';
    return;
  }

  list.innerHTML = keywords
    .map(
      (kb, index) => `
    <div class="vocabulary-item" data-index="${index}">
      <div class="vocabulary-item-content">
        <span class="vocabulary-item-word">${kb.word}</span>
        <span class="vocabulary-item-intensifier">${kb.intensifier || 5}</span>
      </div>
      <button class="vocabulary-item-delete" onclick="deleteKeyword('${kb.word}')" title="Delete">
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
 * Add a spelling correction
 */
async function addSpelling() {
  const fromInput = document.getElementById('spellingFrom');
  const toInput = document.getElementById('spellingTo');

  const fromValue = fromInput?.value?.trim();
  const toValue = toInput?.value?.trim();

  if (!fromValue || !toValue) {
    notifyError('Please enter both incorrect and correct spellings');
    return;
  }

  const fromArray = fromValue
    .split(',')
    .map(s => s.trim())
    .filter(s => s);

  try {
    let result;
    if (vocabularyScope === 'client' && selectedClientSlug) {
      result = await window.electronAPI.vocabularyAddClientSpelling(
        selectedClientSlug,
        fromArray,
        toValue
      );
    } else {
      result = await window.electronAPI.vocabularyAddGlobalSpelling(fromArray, toValue);
    }

    if (result.success) {
      fromInput.value = '';
      toInput.value = '';
      await loadVocabulary();
      notifySuccess('Spelling correction added');
    } else {
      notifyError('Failed to add spelling: ' + result.error);
    }
  } catch (error) {
    console.error('[Vocabulary] Error adding spelling:', error);
    notifyError(error, { prefix: 'Error adding spelling correction:' });
  }
}

/**
 * Add a keyword boost
 */
async function addKeyword() {
  const wordInput = document.getElementById('keywordWord');
  const intensifierInput = document.getElementById('keywordIntensifier');

  const word = wordInput?.value?.trim();
  const intensifier = parseInt(intensifierInput?.value) || 5;

  if (!word) {
    notifyError('Please enter a word');
    return;
  }

  try {
    let result;
    if (vocabularyScope === 'client' && selectedClientSlug) {
      result = await window.electronAPI.vocabularyAddClientKeyword(
        selectedClientSlug,
        word,
        intensifier
      );
    } else {
      result = await window.electronAPI.vocabularyAddGlobalKeyword(word, intensifier);
    }

    if (result.success) {
      wordInput.value = '';
      intensifierInput.value = '5';
      await loadVocabulary();
      notifySuccess('Keyword boost added');
    } else {
      notifyError('Failed to add keyword: ' + result.error);
    }
  } catch (error) {
    console.error('[Vocabulary] Error adding keyword:', error);
    notifyError(error, { prefix: 'Error adding keyword boost:' });
  }
}

/**
 * Delete a spelling correction
 */
async function deleteSpelling(to) {
  try {
    // For now, only global deletions are supported via the API
    // Client deletions would need a separate API or direct config manipulation
    if (vocabularyScope === 'client') {
      // Remove from client config manually
      if (vocabularyConfig.clients?.[selectedClientSlug]) {
        vocabularyConfig.clients[selectedClientSlug].spelling_corrections =
          vocabularyConfig.clients[selectedClientSlug].spelling_corrections.filter(
            sc => sc.to !== to
          );
        await window.electronAPI.vocabularySaveConfig(vocabularyConfig);
        await loadVocabulary();
        notifySuccess('Spelling correction removed');
      }
    } else {
      const result = await window.electronAPI.vocabularyRemoveGlobalSpelling(to);
      if (result.success) {
        await loadVocabulary();
        notifySuccess('Spelling correction removed');
      } else {
        notifyError('Failed to remove spelling: ' + result.error);
      }
    }
  } catch (error) {
    console.error('[Vocabulary] Error deleting spelling:', error);
    notifyError(error, { prefix: 'Error removing spelling correction:' });
  }
}

/**
 * Delete a keyword boost
 */
async function deleteKeyword(word) {
  try {
    if (vocabularyScope === 'client') {
      // Remove from client config manually
      if (vocabularyConfig.clients?.[selectedClientSlug]) {
        vocabularyConfig.clients[selectedClientSlug].keyword_boosts = vocabularyConfig.clients[
          selectedClientSlug
        ].keyword_boosts.filter(kb => kb.word !== word);
        await window.electronAPI.vocabularySaveConfig(vocabularyConfig);
        await loadVocabulary();
        notifySuccess('Keyword boost removed');
      }
    } else {
      const result = await window.electronAPI.vocabularyRemoveGlobalKeyword(word);
      if (result.success) {
        await loadVocabulary();
        notifySuccess('Keyword boost removed');
      } else {
        notifyError('Failed to remove keyword: ' + result.error);
      }
    }
  } catch (error) {
    console.error('[Vocabulary] Error deleting keyword:', error);
    notifyError(error, { prefix: 'Error removing keyword boost:' });
  }
}

/**
 * Initialize vocabulary UI event listeners
 */
function initializeVocabularyUI() {
  // Scope tab switching
  document.querySelectorAll('.vocabulary-scope-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vocabulary-scope-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      vocabularyScope = tab.dataset.scope;
      const clientSelector = document.getElementById('vocabularyClientSelector');

      if (vocabularyScope === 'client') {
        clientSelector.style.display = 'flex';
      } else {
        clientSelector.style.display = 'none';
        selectedClientSlug = '';
      }

      renderVocabularyUI();
    });
  });

  // Client selector
  const clientSelect = document.getElementById('vocabularyClientSelect');
  if (clientSelect) {
    clientSelect.addEventListener('change', e => {
      selectedClientSlug = e.target.value;
      renderVocabularyUI();
    });
  }

  // Add new client vocabulary
  const addNewClientBtn = document.getElementById('addNewClientVocab');
  if (addNewClientBtn) {
    addNewClientBtn.addEventListener('click', () => {
      const formId = 'addClientVocab_' + Date.now();

      createModal({
        title: 'Add Client Vocabulary',
        body: `
          <div class="form-group">
            <label for="${formId}_slug">Client Slug</label>
            <input type="text" id="${formId}_slug" class="form-control" placeholder="e.g., acme-corp" />
            <small class="form-help">Use lowercase with hyphens (e.g., acme-corp, tech-solutions)</small>
          </div>
        `,
        confirmText: 'Add Client',
        cancelText: 'Cancel',
        onConfirm: async () => {
          const slugInput = document.getElementById(`${formId}_slug`);
          const slug = slugInput?.value?.trim();

          if (!slug) {
            notifyError('Please enter a client slug');
            throw new Error('Validation failed');
          }

          const normalizedSlug = slug.toLowerCase().replace(/\s+/g, '-');

          // Validate slug format
          if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
            notifyError('Client slug must be lowercase alphanumeric with hyphens');
            throw new Error('Validation failed');
          }

          if (!vocabularyConfig.clients) vocabularyConfig.clients = {};
          if (!vocabularyConfig.clients[normalizedSlug]) {
            vocabularyConfig.clients[normalizedSlug] = {
              spelling_corrections: [],
              keyword_boosts: [],
            };
            await window.electronAPI.vocabularySaveConfig(vocabularyConfig);
            await loadClientSlugs();
            document.getElementById('vocabularyClientSelect').value = normalizedSlug;
            selectedClientSlug = normalizedSlug;
            renderVocabularyUI();
            notifySuccess(`Created vocabulary for "${normalizedSlug}"`);
          } else {
            document.getElementById('vocabularyClientSelect').value = normalizedSlug;
            selectedClientSlug = normalizedSlug;
            renderVocabularyUI();
            notifyInfo(`Client "${normalizedSlug}" already exists, selected it`);
          }
        },
      });

      // Focus on the input after modal is created
      setTimeout(() => {
        const slugInput = document.getElementById(`${formId}_slug`);
        if (slugInput) slugInput.focus();
      }, 150);
    });
  }

  // Add spelling button
  const addSpellingBtn = document.getElementById('addSpellingBtn');
  if (addSpellingBtn) {
    addSpellingBtn.addEventListener('click', addSpelling);
  }

  // Add keyword button
  const addKeywordBtn = document.getElementById('addKeywordBtn');
  if (addKeywordBtn) {
    addKeywordBtn.addEventListener('click', addKeyword);
  }

  // Enter key support for spelling form
  document.getElementById('spellingTo')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') addSpelling();
  });

  // Enter key support for keyword form
  document.getElementById('keywordWord')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') addKeyword();
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

  // Export button (placeholder - would need file dialog)
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

  // Import button (placeholder)
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
              // Merge with existing
              if (imported.global) {
                vocabularyConfig.global.spelling_corrections.push(
                  ...(imported.global.spelling_corrections || [])
                );
                vocabularyConfig.global.keyword_boosts.push(
                  ...(imported.global.keyword_boosts || [])
                );
              }
              if (imported.clients) {
                for (const [slug, clientVocab] of Object.entries(imported.clients)) {
                  if (!vocabularyConfig.clients[slug]) {
                    vocabularyConfig.clients[slug] = clientVocab;
                  } else {
                    vocabularyConfig.clients[slug].spelling_corrections.push(
                      ...(clientVocab.spelling_corrections || [])
                    );
                    vocabularyConfig.clients[slug].keyword_boosts.push(
                      ...(clientVocab.keyword_boosts || [])
                    );
                  }
                }
              }
              await window.electronAPI.vocabularySaveConfig(vocabularyConfig);
              await loadVocabulary();
              notifySuccess('Vocabulary imported and merged');
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

// Expose delete functions globally for onclick handlers
window.deleteSpelling = deleteSpelling;
window.deleteKeyword = deleteKeyword;

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
