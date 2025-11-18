/**
 * Routing Editor Module
 * Phase 10.4: Visual editor for routing.yaml configuration
 */

import * as monaco from 'monaco-editor';
import { createModal } from './utils/modalHelper.js';

let routingEditor = null;
let routingConfig = null;
let organizations = [];
let currentOrgSelection = null;

/**
 * Initialize the routing editor
 */
export function initializeRoutingEditor() {
  console.log('[RoutingEditor] Initializing...');

  // Initialize Monaco Editor for routing.yaml
  const container = document.getElementById('routingMonacoContainer');
  if (!container) {
    console.error('[RoutingEditor] Monaco container not found');
    return;
  }

  // Detect current theme
  const isDarkTheme = document.body.classList.contains('dark-theme');

  routingEditor = monaco.editor.create(container, {
    value: '# Loading routing configuration...',
    language: 'yaml',
    theme: isDarkTheme ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    readOnly: false,
  });

  console.log('[RoutingEditor] Monaco Editor initialized');

  // Set up event listeners
  setupEventListeners();

  // Expose loadRouting globally
  window.loadRouting = loadRouting;

  console.log('[RoutingEditor] Initialization complete');
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Tab switching
  const editorTabBtn = document.getElementById('routingEditorTabBtn');
  const testTabBtn = document.getElementById('routingTestTabBtn');
  const editorTabContent = document.getElementById('routingEditorTabContent');
  const testTabContent = document.getElementById('routingTestTabContent');

  if (editorTabBtn && testTabBtn) {
    editorTabBtn.addEventListener('click', () => {
      editorTabBtn.classList.add('active');
      testTabBtn.classList.remove('active');
      editorTabContent.style.display = 'block';
      testTabContent.style.display = 'none';
    });

    testTabBtn.addEventListener('click', () => {
      testTabBtn.classList.add('active');
      editorTabBtn.classList.remove('active');
      testTabContent.style.display = 'block';
      editorTabContent.style.display = 'none';
    });
  }

  // Refresh routing button
  const refreshRoutingBtn = document.getElementById('refreshRoutingBtn');
  if (refreshRoutingBtn) {
    refreshRoutingBtn.addEventListener('click', refreshRouting);
  }

  // Undo routing button
  const undoRoutingBtn = document.getElementById('undoRoutingBtn');
  if (undoRoutingBtn) {
    undoRoutingBtn.addEventListener('click', undoRouting);
  }

  // Save routing button
  const saveRoutingBtn = document.getElementById('saveRoutingBtn');
  if (saveRoutingBtn) {
    saveRoutingBtn.addEventListener('click', saveRouting);
  }

  // Validate routing button
  const validateRoutingBtn = document.getElementById('validateRoutingBtn');
  if (validateRoutingBtn) {
    validateRoutingBtn.addEventListener('click', validateRouting);
  }

  // Test routing button (toolbar)
  const testRoutingBtn = document.getElementById('testRoutingBtn');
  if (testRoutingBtn) {
    testRoutingBtn.addEventListener('click', () => {
      // Switch to test tab
      testTabBtn.click();
    });
  }

  // Run routing test button
  const runRoutingTestBtn = document.getElementById('runRoutingTestBtn');
  if (runRoutingTestBtn) {
    runRoutingTestBtn.addEventListener('click', runRoutingTest);
  }

  // New organization button
  const newOrganizationBtn = document.getElementById('newOrganizationBtn');
  if (newOrganizationBtn) {
    newOrganizationBtn.addEventListener('click', createNewOrganization);
  }

  // Delete organization button
  const deleteOrganizationBtn = document.getElementById('deleteOrganizationBtn');
  if (deleteOrganizationBtn) {
    deleteOrganizationBtn.addEventListener('click', deleteOrganization);
  }
}

/**
 * Load routing configuration from backend
 */
async function loadRouting() {
  console.log('[RoutingEditor] Loading routing configuration...');

  try {
    const response = await window.electronAPI.routingGetConfig();

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to load routing configuration');
    }

    routingConfig = response.config;
    const content = response.content || '';

    console.log(`[RoutingEditor] Loaded routing configuration`);

    // Update Monaco editor
    if (routingEditor) {
      routingEditor.setValue(content);
    }

    // Parse organizations from config
    parseOrganizations();
    renderOrganizationList();
  } catch (error) {
    console.error('[RoutingEditor] Failed to load routing configuration:', error);

    if (routingEditor) {
      routingEditor.setValue(`# Error loading routing configuration: ${error.message}\n\n# Please check your config/routing.yaml file`);
    }

    const orgList = document.getElementById('routingOrganizationList');
    if (orgList) {
      orgList.innerHTML = `<p style="color: var(--error-color); padding: 20px; text-align: center;">Error: ${error.message}</p>`;
    }
  }
}

/**
 * Parse organizations from routing config
 */
function parseOrganizations() {
  organizations = [];

  if (!routingConfig) return;

  // Add clients
  if (routingConfig.clients) {
    Object.keys(routingConfig.clients).forEach(key => {
      organizations.push({
        id: key,
        type: 'clients', // Use plural to match YAML section name
        name: key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        data: routingConfig.clients[key]
      });
    });
  }

  // Add industry contacts
  if (routingConfig.industry) {
    Object.keys(routingConfig.industry).forEach(key => {
      organizations.push({
        id: key,
        type: 'industry', // Singular to match YAML section name
        name: key.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        data: routingConfig.industry[key]
      });
    });
  }

  // Add internal
  if (routingConfig.internal) {
    organizations.push({
      id: 'internal',
      type: 'internal',
      name: 'Internal Team',
      data: routingConfig.internal
    });
  }

  console.log('[RoutingEditor] Parsed', organizations.length, 'organizations');
}

/**
 * Render organization list in sidebar
 */
function renderOrganizationList() {
  const orgList = document.getElementById('routingOrganizationList');

  if (!orgList) {
    console.error('[RoutingEditor] Organization list element not found!');
    return;
  }

  if (organizations.length === 0) {
    orgList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No organizations found</p>';
    return;
  }

  let html = '';

  // Group by type
  const clients = organizations.filter(o => o.type === 'clients');
  const industry = organizations.filter(o => o.type === 'industry');
  const internal = organizations.filter(o => o.type === 'internal');

  if (clients.length > 0) {
    html += '<div class="org-list-group"><div class="org-list-group-title">Clients</div>';
    clients.forEach(org => {
      html += `<div class="org-list-item" data-id="${org.id}" data-type="${org.type}">`;
      html += `<strong>${org.name}</strong>`;
      html += `<small>${org.data.vault_path || ''}</small>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  if (industry.length > 0) {
    html += '<div class="org-list-group"><div class="org-list-group-title">Industry</div>';
    industry.forEach(org => {
      html += `<div class="org-list-item" data-id="${org.id}" data-type="${org.type}">`;
      html += `<strong>${org.name}</strong>`;
      html += `<small>${org.data.vault_path || ''}</small>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  if (internal.length > 0) {
    html += '<div class="org-list-group"><div class="org-list-group-title">Internal</div>';
    internal.forEach(org => {
      html += `<div class="org-list-item" data-id="${org.id}" data-type="${org.type}">`;
      html += `<strong>${org.name}</strong>`;
      html += `<small>${org.data.vault_path || ''}</small>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  orgList.innerHTML = html;

  // Add click handlers
  orgList.querySelectorAll('.org-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      const type = item.getAttribute('data-type');
      selectOrganization(id, type);
    });
  });
}

/**
 * Select an organization
 */
function selectOrganization(id, type) {
  currentOrgSelection = { id, type };

  // Highlight selected
  document.querySelectorAll('.org-list-item').forEach(item => {
    if (item.dataset.id === id && item.dataset.type === type) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });

  // Enable delete button
  const deleteBtn = document.getElementById('deleteOrganizationBtn');
  if (deleteBtn) {
    deleteBtn.disabled = false;
  }

  // Scroll editor to the organization's section
  scrollToOrganization(id, type);
}

/**
 * Scroll editor to organization section
 */
function scrollToOrganization(id, type) {
  if (!routingEditor) return;

  const content = routingEditor.getValue();
  const lines = content.split('\n');

  // Find the line with the organization
  let targetLine = 0;
  let foundSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for section headers
    if (line === `${type}:` || line === `${type}s:`) {
      foundSection = true;
      continue;
    }

    if (foundSection) {
      // Look for the organization key
      if (line.startsWith(`${id}:`) || line.includes(`  ${id}:`)) {
        targetLine = i + 1;
        break;
      }
    }
  }

  if (targetLine > 0) {
    routingEditor.revealLineInCenter(targetLine);
    routingEditor.setPosition({ lineNumber: targetLine, column: 1 });
  }
}

/**
 * Refresh routing configuration (reload from disk)
 */
async function refreshRouting() {
  console.log('[RoutingEditor] Refreshing routing configuration...');

  try {
    await loadRouting();
    window.showToast('Configuration refreshed successfully', 'success');
  } catch (error) {
    console.error('[RoutingEditor] Failed to refresh:', error);
    window.showToast('Failed to refresh: ' + error.message, 'error');
  }
}

/**
 * Undo routing changes (restore from backup)
 */
async function undoRouting() {
  console.log('[RoutingEditor] Restoring from backup...');

  // Confirm undo using modal helper
  createModal({
    title: 'Restore from Backup',
    body: `
      <p style="margin-bottom: 16px;">Are you sure you want to restore the routing configuration from the backup file?</p>
      <p style="color: var(--text-secondary); font-size: 13px;">This will discard any unsaved changes in the editor.</p>
    `,
    confirmText: 'Restore Backup',
    cancelText: 'Cancel',
    onConfirm: async () => {
      try {
        const response = await window.electronAPI.routingRestoreBackup();

        if (!response || !response.success) {
          throw new Error(response?.error || 'Failed to restore from backup');
        }

        window.showToast('Configuration restored from backup successfully', 'success');

        // Reload the configuration
        await loadRouting();
      } catch (error) {
        console.error('[RoutingEditor] Failed to restore backup:', error);
        window.showToast('Failed to restore: ' + error.message, 'error');
        // Re-throw to let modalHelper handle the error state
        throw error;
      }
    }
  });
}

/**
 * Save routing configuration
 */
async function saveRouting() {
  console.log('[RoutingEditor] Saving routing configuration...');

  if (!routingEditor) return;

  const content = routingEditor.getValue();

  try {
    const response = await window.electronAPI.routingSaveConfig(content);

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to save routing configuration');
    }

    console.log('[RoutingEditor] Routing configuration saved successfully');
    window.showToast('Routing configuration saved successfully', 'success');

    // Reload to update organizations list
    await loadRouting();
  } catch (error) {
    console.error('[RoutingEditor] Failed to save routing configuration:', error);
    window.showToast('Failed to save: ' + error.message, 'error');
  }
}

/**
 * Validate routing configuration
 */
async function validateRouting() {
  console.log('[RoutingEditor] Validating routing configuration...');

  if (!routingEditor) return;

  const content = routingEditor.getValue();

  try {
    const response = await window.electronAPI.routingValidateConfig(content);

    if (!response || !response.success) {
      throw new Error(response?.error || 'Validation failed');
    }

    if (response.valid) {
      window.showToast('Routing configuration is valid ✓', 'success');
    } else {
      window.showToast(`Validation errors: ${response.errors.join(', ')}`, 'error');
    }
  } catch (error) {
    console.error('[RoutingEditor] Validation failed:', error);
    window.showToast('Validation error: ' + error.message, 'error');
  }
}

/**
 * Run routing test
 */
async function runRoutingTest() {
  console.log('[RoutingEditor] Running routing test...');

  const emailInput = document.getElementById('routingTestEmailInput');
  if (!emailInput || !emailInput.value.trim()) {
    window.showToast('Please enter at least one email address', 'warning');
    return;
  }

  const emails = emailInput.value
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);

  if (emails.length === 0) {
    window.showToast('Please enter valid email addresses', 'warning');
    return;
  }

  try {
    const response = await window.electronAPI.routingTestEmails(emails);

    if (!response || !response.success) {
      throw new Error(response?.error || 'Routing test failed');
    }

    // Display results
    const resultsDiv = document.getElementById('routingTestResults');
    const outputDiv = document.getElementById('routingTestOutput');

    if (resultsDiv && outputDiv) {
      resultsDiv.style.display = 'block';

      let html = '<div class="routing-test-result">';
      html += `<div class="routing-test-path"><strong>Vault Path:</strong> ${response.vaultPath || 'Unknown'}</div>`;
      html += `<div class="routing-test-reason"><strong>Reason:</strong> ${response.reason || 'No reason provided'}</div>`;

      if (response.matchedOrganizations && response.matchedOrganizations.length > 0) {
        html += `<div class="routing-test-matches"><strong>Matched Organizations:</strong> ${response.matchedOrganizations.join(', ')}</div>`;
      }

      if (response.matchedEmails && response.matchedEmails.length > 0) {
        html += '<div class="routing-test-emails"><strong>Matched Emails:</strong><ul>';
        response.matchedEmails.forEach(match => {
          html += `<li>${match}</li>`;
        });
        html += '</ul></div>';
      }

      html += '</div>';

      outputDiv.innerHTML = html;
    }

    console.log('[RoutingEditor] Routing test completed:', response);
  } catch (error) {
    console.error('[RoutingEditor] Routing test failed:', error);
    window.showToast('Test failed: ' + error.message, 'error');
  }
}

/**
 * Create new organization
 */
async function createNewOrganization() {
  // Generate unique IDs for form elements to avoid conflicts
  const formId = 'addOrgForm_' + Date.now();

  createModal({
    title: 'Add New Organization',
    body: `
      <div class="form-group">
        <label for="${formId}_type">Type</label>
        <select id="${formId}_type" class="form-control">
          <option value="clients">Client</option>
          <option value="industry">Industry Contact</option>
        </select>
      </div>
      <div class="form-group">
        <label for="${formId}_id">Organization ID</label>
        <input type="text" id="${formId}_id" class="form-control" placeholder="e.g., acme-corp" />
        <small class="form-help">Use lowercase with hyphens (e.g., acme-corp, tech-solutions)</small>
      </div>
      <div class="form-group">
        <label for="${formId}_vaultPath">Vault Path</label>
        <input type="text" id="${formId}_vaultPath" class="form-control" placeholder="e.g., clients/acme-corp" />
        <small class="form-help">Relative path in Obsidian vault</small>
      </div>
      <div class="form-group">
        <label for="${formId}_emails">Email Domains (comma-separated, optional)</label>
        <input type="text" id="${formId}_emails" class="form-control" placeholder="e.g., acmecorp.com, acme.io" />
        <small class="form-help">Email domains to match (without @)</small>
      </div>
      <div class="form-group">
        <label for="${formId}_contacts">Specific Email Contacts (comma-separated, optional)</label>
        <input type="text" id="${formId}_contacts" class="form-control" placeholder="e.g., john@example.com" />
        <small class="form-help">Specific email addresses to match</small>
      </div>
    `,
    confirmText: 'Add Organization',
    cancelText: 'Cancel',
    size: 'medium',
    onConfirm: async () => {
      const type = document.getElementById(`${formId}_type`).value;
      const id = document.getElementById(`${formId}_id`).value.trim();
      const vaultPath = document.getElementById(`${formId}_vaultPath`).value.trim();
      const emailsStr = document.getElementById(`${formId}_emails`).value.trim();
      const contactsStr = document.getElementById(`${formId}_contacts`).value.trim();

      // Validate
      if (!id) {
        window.showToast('Organization ID is required', 'error');
        throw new Error('Validation failed'); // Prevent modal from closing
      }

      if (!vaultPath) {
        window.showToast('Vault path is required', 'error');
        throw new Error('Validation failed'); // Prevent modal from closing
      }

      // Validate ID format (lowercase with hyphens)
      if (!/^[a-z0-9-]+$/.test(id)) {
        window.showToast('Organization ID must be lowercase alphanumeric with hyphens', 'error');
        throw new Error('Validation failed'); // Prevent modal from closing
      }

      // Parse emails and contacts
      const emails = emailsStr ? emailsStr.split(',').map(e => e.trim()).filter(e => e) : [];
      const contacts = contactsStr ? contactsStr.split(',').map(c => c.trim()).filter(c => c) : [];

      try {
        const response = await window.electronAPI.routingAddOrganization(type, id, vaultPath, emails, contacts);

        if (!response || !response.success) {
          throw new Error(response?.error || 'Failed to add organization');
        }

        window.showToast('Organization added successfully', 'success');

        // Update the editor content
        if (routingEditor && response.content) {
          routingEditor.setValue(response.content);
        }

        // Reload the configuration and organization list
        await loadRouting();
      } catch (error) {
        console.error('[RoutingEditor] Failed to add organization:', error);
        window.showToast('Failed to add organization: ' + error.message, 'error');
        throw error; // Re-throw to prevent modal from closing on error
      }
    }
  });

  // Focus on the ID input after modal is created
  setTimeout(() => {
    const idInput = document.getElementById(`${formId}_id`);
    if (idInput) {
      idInput.focus();
    }
  }, 150);
}

/**
 * Delete organization
 */
async function deleteOrganization() {
  if (!currentOrgSelection) return;

  const { id, type } = currentOrgSelection;

  // Prevent deleting internal
  if (type === 'internal') {
    window.showToast('Cannot delete the internal organization', 'error');
    return;
  }

  // Confirm deletion
  const orgName = id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  createModal({
    title: 'Confirm Deletion',
    body: `
      <p style="margin-bottom: 16px;">Are you sure you want to delete the organization <strong>"${orgName}"</strong>?</p>
      <p style="color: var(--text-secondary); font-size: 13px;">This action cannot be undone. A backup will be created automatically.</p>
    `,
    confirmText: 'Delete Organization',
    cancelText: 'Cancel',
    onConfirm: async () => {
      try {
        const response = await window.electronAPI.routingDeleteOrganization(type, id);

        if (!response || !response.success) {
          throw new Error(response?.error || 'Failed to delete organization');
        }

        window.showToast('Organization deleted successfully', 'success');

        // Update the editor content
        if (routingEditor && response.content) {
          routingEditor.setValue(response.content);
        }

        // Clear current selection
        currentOrgSelection = null;

        // Disable delete button
        const deleteBtn = document.getElementById('deleteOrganizationBtn');
        if (deleteBtn) {
          deleteBtn.disabled = true;
        }

        // Reload the configuration and organization list
        await loadRouting();
      } catch (error) {
        console.error('[RoutingEditor] Failed to delete organization:', error);
        window.showToast('Failed to delete organization: ' + error.message, 'error');
        throw error; // Re-throw to prevent modal from closing on error
      }
    }
  });
}

/**
 * Update routing editor theme (called when app theme changes)
 */
export function updateRoutingEditorTheme(isDarkTheme) {
  if (routingEditor) {
    monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
    console.log('[RoutingEditor] Theme updated to', isDarkTheme ? 'dark' : 'light');
  }
}
