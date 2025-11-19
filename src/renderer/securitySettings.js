/**
 * Security Settings UI Module (Phase 10.2)
 * Handles API Key Management via Windows Credential Manager
 *
 * Note: File encryption removed - Obsidian requires plain text markdown files
 */

let currentEditingKey = null;

/**
 * Initialize the security panel
 */
export async function initializeSecurityPanel() {
  console.log('[SecuritySettings] Initializing security panel...');

  // Expose window functions immediately
  console.log('[SecuritySettings] Exposing window.editAPIKey, window.testAPIKey, window.deleteAPIKey, window.saveAPIKey, window.cancelEditAPIKey');

  // Load API keys
  await loadAPIKeys();

  // Set up event listeners
  setupEventListeners();

  console.log('[SecuritySettings] Security panel initialized');
  console.log('[SecuritySettings] window.editAPIKey defined?', typeof window.editAPIKey);
}

/**
 * Set up event listeners for security panel
 */
function setupEventListeners() {
  // Migration button
  const migrateBtn = document.getElementById('migrateKeysBtn');
  if (migrateBtn) {
    migrateBtn.addEventListener('click', handleMigration);
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

    // Check if migration is needed (any keys in .env but not in credential manager)
    const needsMigration = keys.some((key) => !key.hasValue);
    showMigrationNotice(needsMigration);

    console.log('[SecuritySettings] Rendering', keys.length, 'API keys');

    // Render keys table
    const htmlContent = keys
      .map((key) => {
        const statusClass = key.hasValue ? 'stored' : 'missing';
        const statusText = key.hasValue ? 'Stored' : 'Not Set';

        const html = `
        <tr data-key="${key.key}">
          <td class="api-key-service">${key.name}</td>
          <td class="api-key-value">${key.obfuscatedValue || '-'}</td>
          <td>
            <div class="api-key-status ${statusClass}">
              <div class="api-key-status-indicator"></div>
              ${statusText}
            </div>
          </td>
          <td>
            <div class="api-key-actions">
              <button class="api-key-action-btn" onclick="window.editAPIKey('${key.key}')">
                ${key.hasValue ? 'Edit' : 'Set'}
              </button>
              ${
                key.hasValue
                  ? `
                <button class="api-key-action-btn" onclick="window.testAPIKey('${key.key}')">Test</button>
                <button class="api-key-action-btn danger" onclick="window.deleteAPIKey('${key.key}')">Delete</button>
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

    console.log('[SecuritySettings] Table HTML set. First row sample:', htmlContent.substring(0, 300));
    console.log('[SecuritySettings] Number of buttons in DOM:', document.querySelectorAll('.api-key-action-btn').length);
  } catch (error) {
    console.error('[SecuritySettings] Failed to load API keys:', error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px; color: #f44336;">
          <p>Failed to load API keys: ${error.message}</p>
          <button class="api-key-action-btn" onclick="location.reload()" style="margin-top: 12px;">Retry</button>
        </td>
      </tr>
    `;
  }
}

/**
 * Show or hide migration notice
 */
function showMigrationNotice(show) {
  const notice = document.getElementById('migrationNotice');
  if (notice) {
    notice.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Handle API key migration
 */
async function handleMigration() {
  const btn = document.getElementById('migrateKeysBtn');
  if (!btn) return;

  try {
    btn.disabled = true;
    btn.textContent = 'Migrating...';

    const result = await window.electronAPI.keysMigrate();

    if (!result.success) {
      throw new Error(result.error || 'Migration failed');
    }

    const { migrated, failed, skipped } = result.data;

    window.showToast(
      `Migration complete: ${migrated.length} migrated, ${failed.length} failed, ${skipped.length} skipped`,
      'success'
    );

    if (failed.length > 0) {
      console.error('[SecuritySettings] Migration failures:', failed);
    }

    // Reload keys table
    await loadAPIKeys();
  } catch (error) {
    console.error('[SecuritySettings] Migration failed:', error);
    window.showToast('Migration failed: ' + error.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Migrate Keys from .env';
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

  // Get current value if it exists
  let currentValue = '';
  try {
    const result = await window.electronAPI.keysGet(keyName);
    if (result.success && result.data) {
      currentValue = result.data;
    }
  } catch (error) {
    console.error(`[SecuritySettings] Failed to get key ${keyName}:`, error);
  }

  // Create edit row
  const editRow = document.createElement('tr');
  editRow.className = 'api-key-edit-row';
  editRow.innerHTML = `
    <td colspan="4">
      <div class="api-key-edit-form">
        <input
          type="password"
          class="api-key-edit-input"
          placeholder="Enter ${keyName}..."
          value="${currentValue}"
          id="editInput_${keyName}"
        />
        <div class="api-key-edit-actions">
          <button class="api-key-edit-btn save" onclick="window.saveAPIKey('${keyName}')">Save</button>
          <button class="api-key-edit-btn cancel" onclick="window.cancelEditAPIKey()">Cancel</button>
        </div>
      </div>
    </td>
  `;

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
    window.showToast('Key value cannot be empty', 'warning');
    return;
  }

  try {
    input.disabled = true;

    const result = await window.electronAPI.keysSet(keyName, value);

    if (!result.success) {
      throw new Error(result.error || 'Failed to save key');
    }

    window.showToast(`${keyName} saved successfully`, 'success');

    // Remove edit row and reload keys
    await window.cancelEditAPIKey();
    await loadAPIKeys();
  } catch (error) {
    console.error(`[SecuritySettings] Failed to save key ${keyName}:`, error);
    window.showToast('Failed to save key: ' + error.message, 'error');
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
    window.showToast(`Testing ${keyName}...`, 'info');

    const result = await window.electronAPI.keysTest(keyName);

    if (result.success) {
      window.showToast(`✓ ${keyName} format is valid`, 'success');
    } else {
      window.showToast(`✗ ${keyName} validation failed: ${result.message || result.error}`, 'error');
    }
  } catch (error) {
    console.error(`[SecuritySettings] Failed to test key ${keyName}:`, error);
    window.showToast('Test failed: ' + error.message, 'error');
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

    window.showToast(`${keyName} deleted successfully`, 'success');

    // Reload keys table
    await loadAPIKeys();
  } catch (error) {
    console.error(`[SecuritySettings] Failed to delete key ${keyName}:`, error);
    window.showToast('Failed to delete key: ' + error.message, 'error');
  }
};

// Use global showToast from renderer.js (available via window.showToast)
