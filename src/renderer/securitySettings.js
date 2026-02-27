/**
 * Security Settings UI Module (Phase 10.2)
 * Handles API Key Management via Windows Credential Manager
 *
 * Note: File encryption removed - Obsidian requires plain text markdown files
 */

import { notifySuccess, notifyError, notifyInfo } from './utils/notificationHelper.js';
import { escapeHtml } from './security.js';

let currentEditingKey = null;
let listenersInitialized = false;

/**
 * Initialize the security panel
 */
export async function initializeSecurityPanel() {
  console.log('[SecuritySettings] Initializing security panel...');

  // Expose window functions immediately
  console.log(
    '[SecuritySettings] Exposing window.editAPIKey, window.testAPIKey, window.deleteAPIKey, window.saveAPIKey, window.cancelEditAPIKey'
  );

  // Load API keys
  await loadAPIKeys();

  // Set up event listeners only once to prevent duplicate handlers
  if (!listenersInitialized) {
    setupEventListeners();
    listenersInitialized = true;
  }

  console.log('[SecuritySettings] Security panel initialized');
  console.log('[SecuritySettings] window.editAPIKey defined?', typeof window.editAPIKey);
}

/**
 * Set up event listeners for security panel
 */
function setupEventListeners() {
  const tableBody = document.getElementById('apiKeysTableBody');
  if (tableBody) {
    tableBody.addEventListener('click', event => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'retry-load') {
        location.reload();
        return;
      }
      const key = btn.dataset.key;
      if (!key) return;
      if (action === 'edit') window.editAPIKey(key);
      else if (action === 'test') window.testAPIKey(key);
      else if (action === 'delete') window.deleteAPIKey(key);
    });
  }
}

/**
 * Load API keys from credential manager
 */
async function loadAPIKeys() {
  const tableBody = document.getElementById('apiKeysTableBody');
  if (!tableBody) return;

  try {
    // Show loading state
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px;">
          <div class="spinner"></div>
          <p style="margin-top: 12px; color: var(--text-secondary);">Loading keys...</p>
        </td>
      </tr>
    `;

    const result = await window.electronAPI.keysListAll();

    if (!result.success) {
      throw new Error(result.error || 'Failed to load keys');
    }

    const keys = result.data;

    console.log('[SecuritySettings] Rendering', keys.length, 'API keys');

    // Render keys table
    const htmlContent = keys
      .map(key => {
        const statusClass = key.hasValue ? 'stored' : 'missing';
        const statusText = key.hasValue ? 'Stored' : 'Not Set';

        const html = `
        <tr data-key="${escapeHtml(key.key)}">
          <td class="api-key-service">${escapeHtml(key.name)}</td>
          <td class="api-key-value">${escapeHtml(key.obfuscatedValue || '-')}</td>
          <td>
            <div class="api-key-status ${statusClass}">
              <div class="api-key-status-indicator"></div>
              ${statusText}
            </div>
          </td>
          <td>
            <div class="api-key-actions">
              <button class="api-key-action-btn" data-action="edit" data-key="${escapeHtml(key.key)}">
                ${key.hasValue ? 'Edit' : 'Set'}
              </button>
              ${
                key.hasValue
                  ? `
                <button class="api-key-action-btn" data-action="test" data-key="${escapeHtml(key.key)}">Test</button>
                <button class="api-key-action-btn danger" data-action="delete" data-key="${escapeHtml(key.key)}">Delete</button>
              `
                  : ''
              }
            </div>
          </td>
        </tr>
      `;

        return html;
      })
      .join('');

    tableBody.innerHTML = htmlContent;

    console.log(
      '[SecuritySettings] Table HTML set. First row sample:',
      htmlContent.substring(0, 300)
    );
    console.log(
      '[SecuritySettings] Number of buttons in DOM:',
      document.querySelectorAll('.api-key-action-btn').length
    );
  } catch (error) {
    console.error('[SecuritySettings] Failed to load API keys:', error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px; color: var(--color-error);">
          <p>Failed to load API keys: ${escapeHtml(error.message)}</p>
          <button class="api-key-action-btn" data-action="retry-load" style="margin-top: 12px;">Retry</button>
        </td>
      </tr>
    `;
  }
}

/**
 * Edit an API key
 */
window.editAPIKey = async function (keyName) {
  const row = document.querySelector(`tr[data-key="${keyName}"]`);
  if (!row) return;

  // Close any other editing rows
  if (currentEditingKey && currentEditingKey !== keyName) {
    await window.cancelEditAPIKey();
  }

  currentEditingKey = keyName;

  // Create edit row
  const editRow = document.createElement('tr');
  editRow.className = 'api-key-edit-row';
  editRow.innerHTML = `
    <td colspan="4">
      <div class="api-key-edit-form">
        <input
          type="password"
          class="api-key-edit-input"
          placeholder="Enter ${escapeHtml(keyName)}..."
          id="editInput_${escapeHtml(keyName)}"
        />
        <div class="api-key-edit-actions">
          <button class="api-key-edit-btn save" data-action="save">Save</button>
          <button class="api-key-edit-btn cancel" data-action="cancel">Cancel</button>
        </div>
      </div>
    </td>
  `;

  editRow.addEventListener('click', event => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'save') window.saveAPIKey(keyName);
    else if (btn.dataset.action === 'cancel') window.cancelEditAPIKey();
  });

  row.after(editRow);
  document.getElementById(`editInput_${keyName}`).focus();
};

/**
 * Save an API key
 */
window.saveAPIKey = async function (keyName) {
  const input = document.getElementById(`editInput_${keyName}`);
  if (!input) return;

  const value = input.value.trim();

  if (!value) {
    notifyError('Key value cannot be empty');
    return;
  }

  try {
    input.disabled = true;

    const result = await window.electronAPI.keysSet(keyName, value);

    if (!result.success) {
      throw new Error(result.error || 'Failed to save key');
    }

    notifySuccess(`${keyName} saved successfully`);

    // Remove edit row and reload keys
    await window.cancelEditAPIKey();
    await loadAPIKeys();
  } catch (error) {
    console.error(`[SecuritySettings] Failed to save key ${keyName}:`, error);
    notifyError(error, { prefix: 'Failed to save key:' });
    input.disabled = false;
  }
};

/**
 * Cancel editing an API key
 */
window.cancelEditAPIKey = async function () {
  if (!currentEditingKey) return;

  const editRow = document.querySelector('.api-key-edit-row');
  if (editRow) {
    editRow.remove();
  }

  currentEditingKey = null;
};

/**
 * Test an API key
 */
window.testAPIKey = async function (keyName) {
  try {
    notifyInfo(`Testing ${keyName}...`);

    const result = await window.electronAPI.keysTest(keyName);

    if (result.success) {
      notifySuccess(`✓ ${keyName} format is valid`);
    } else {
      notifyError(`✗ ${keyName} validation failed: ${result.message || result.error}`);
    }
  } catch (error) {
    console.error(`[SecuritySettings] Failed to test key ${keyName}:`, error);
    notifyError(error, { prefix: 'Test failed:' });
  }
};

/**
 * Delete an API key
 */
window.deleteAPIKey = async function (keyName) {
  if (!confirm(`Are you sure you want to delete ${keyName}?`)) {
    return;
  }

  try {
    const result = await window.electronAPI.keysDelete(keyName);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete key');
    }

    notifySuccess(`${keyName} deleted successfully`);

    // Reload keys table
    await loadAPIKeys();
  } catch (error) {
    console.error(`[SecuritySettings] Failed to delete key ${keyName}:`, error);
    notifyError(error, { prefix: 'Failed to delete key:' });
  }
};
