/**
 * Client Setup Wizard (v1.4)
 *
 * Wizard flow for discovering and configuring clients from Google Contacts.
 * Steps: Discover → Configure → Verify
 */

import { escapeHtml } from './security.js';

let discoveredCompanies = [];
let selectedCompanies = new Set();

/**
 * Open the client setup view.
 */
export async function openClientSetup() {
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');
  const contactsView = document.getElementById('contactsView');
  const clientSetupView = document.getElementById('clientSetupView');

  if (mainView) mainView.style.display = 'none';
  if (settingsView) settingsView.style.display = 'none';
  if (contactsView) contactsView.style.display = 'none';

  if (clientSetupView) {
    clientSetupView.style.display = 'flex';
    renderDiscoverStep();
  }
}

export function closeClientSetup() {
  const clientSetupView = document.getElementById('clientSetupView');
  const mainView = document.getElementById('mainView');
  if (clientSetupView) clientSetupView.style.display = 'none';
  if (mainView) mainView.style.display = 'block';
}

async function renderDiscoverStep() {
  const content = document.getElementById('clientSetupContent');
  if (!content) return;

  content.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-secondary);">Scanning Google Contacts for companies...</div>';

  try {
    const result = await window.electronAPI.clientsDiscover();
    if (!result.success) {
      content.innerHTML = `<div style="padding: 24px; color: var(--color-error);">Failed to discover companies: ${escapeHtml(result.error)}</div>`;
      return;
    }

    discoveredCompanies = result.companies;
    selectedCompanies = new Set();

    let html = `
      <div style="padding: 24px;">
        <h3 style="margin: 0 0 8px;">Discover Companies</h3>
        <p style="color: var(--text-secondary); margin: 0 0 16px;">Select companies from your Google Contacts to set up as clients. Companies already configured are shown as checked.</p>

        <div style="margin-bottom: 16px; display: flex; gap: 8px;">
          <button class="btn btn-outline btn-sm" id="selectAllCompaniesBtn">Select All New</button>
          <button class="btn btn-outline btn-sm" id="migrateYamlBtn">Import from routing.yaml</button>
        </div>

        <div style="display: grid; gap: 8px; max-height: 400px; overflow-y: auto;">`;

    for (let i = 0; i < discoveredCompanies.length; i++) {
      const company = discoveredCompanies[i];
      const checked = company.alreadySetUp ? 'checked disabled' : '';
      html += `
          <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer;">
            <input type="checkbox" class="company-checkbox" data-idx="${i}" ${checked}>
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(company.name)}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                ${company.contactCount} contacts
                ${company.domains.length > 0 ? ` &middot; ${company.domains.map(d => escapeHtml(d)).join(', ')}` : ''}
                ${company.alreadySetUp ? ' &middot; <span style="color: var(--status-success, #34c759);">Already configured</span>' : ''}
              </div>
            </div>
          </label>`;
    }

    html += `
        </div>
        <div style="margin-top: 16px; display: flex; gap: 12px;">
          <button class="btn btn-primary" id="configureSelectedBtn">Configure Selected</button>
          <button class="btn btn-secondary" id="skipToVerifyBtn">Skip to Verify</button>
        </div>
      </div>`;

    content.innerHTML = html;

    // Bind handlers
    content.querySelectorAll('.company-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx, 10);
        if (cb.checked) selectedCompanies.add(idx);
        else selectedCompanies.delete(idx);
      });
    });

    document.getElementById('selectAllCompaniesBtn')?.addEventListener('click', () => {
      content.querySelectorAll('.company-checkbox:not(:disabled)').forEach(cb => {
        cb.checked = true;
        selectedCompanies.add(parseInt(cb.dataset.idx, 10));
      });
    });

    document.getElementById('migrateYamlBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('migrateYamlBtn');
      btn.disabled = true;
      btn.textContent = 'Importing...';
      const result = await window.electronAPI.clientsMigrateFromYaml();
      if (result.success) {
        btn.textContent = `Imported ${result.imported} clients`;
        if (typeof window.showToast === 'function') window.showToast(`Imported ${result.imported} clients from routing.yaml`, 'success');
      } else {
        btn.textContent = 'Import Failed';
        if (typeof window.showToast === 'function') window.showToast(result.error, 'error');
      }
    });

    document.getElementById('configureSelectedBtn')?.addEventListener('click', () => {
      if (selectedCompanies.size === 0) {
        if (typeof window.showToast === 'function') window.showToast('Select at least one company', 'warning');
        return;
      }
      renderConfigureStep();
    });

    document.getElementById('skipToVerifyBtn')?.addEventListener('click', renderVerifyStep);
  } catch (error) {
    content.innerHTML = `<div style="padding: 24px; color: var(--color-error);">Error: ${escapeHtml(error.message)}</div>`;
  }
}

async function renderConfigureStep() {
  const content = document.getElementById('clientSetupContent');
  if (!content) return;

  const selected = Array.from(selectedCompanies).map(i => discoveredCompanies[i]).filter(Boolean);

  let html = `
    <div style="padding: 24px;">
      <h3 style="margin: 0 0 8px;">Configure Clients</h3>
      <p style="color: var(--text-secondary); margin: 0 0 16px;">Set vault paths and types for each selected company.</p>
      <div style="display: grid; gap: 16px;">`;

  for (let i = 0; i < selected.length; i++) {
    const company = selected[i];
    html += `
        <div style="padding: 16px; border: 1px solid var(--border-color); border-radius: 8px;">
          <div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(company.name)}</div>
          <div style="display: grid; gap: 8px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <label style="width: 80px; font-size: 13px;">Type:</label>
              <select class="settings-select client-type-select" data-idx="${i}" style="flex: 1;">
                <option value="client">Client</option>
                <option value="industry">Industry</option>
              </select>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <label style="width: 80px; font-size: 13px;">Vault Path:</label>
              <input type="text" class="settings-input client-vault-input" data-idx="${i}"
                     placeholder="clients/${escapeHtml(company.suggestedId)}/meetings"
                     value="clients/${escapeHtml(company.suggestedId)}/meetings" style="flex: 1;">
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <label style="width: 80px; font-size: 13px;">Domains:</label>
              <input type="text" class="settings-input client-domains-input" data-idx="${i}"
                     value="${escapeHtml(company.domains.join(', '))}"
                     placeholder="example.com, other.com" style="flex: 1;">
            </div>
          </div>
        </div>`;
  }

  html += `
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px;">
        <button class="btn btn-primary" id="saveClientsBtn">Save All Clients</button>
        <button class="btn btn-secondary" id="backToDiscoverBtn">Back</button>
      </div>
      <div id="configureStatus" style="margin-top: 8px; font-size: 13px;"></div>
    </div>`;

  content.innerHTML = html;

  document.getElementById('backToDiscoverBtn')?.addEventListener('click', renderDiscoverStep);

  document.getElementById('saveClientsBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveClientsBtn');
    const status = document.getElementById('configureStatus');
    btn.disabled = true;

    let saved = 0;
    for (let i = 0; i < selected.length; i++) {
      const company = selected[i];
      const typeSelect = content.querySelector(`.client-type-select[data-idx="${i}"]`);
      const vaultInput = content.querySelector(`.client-vault-input[data-idx="${i}"]`);
      const domainsInput = content.querySelector(`.client-domains-input[data-idx="${i}"]`);

      const clientData = {
        id: company.suggestedId,
        name: company.name,
        type: typeSelect?.value || 'client',
        vaultPath: vaultInput?.value || null,
        domains: (domainsInput?.value || '').split(',').map(d => d.trim()).filter(Boolean),
        googleSource: 'contacts_company',
      };

      try {
        await window.electronAPI.clientsCreate(clientData);
        saved++;
        if (status) status.textContent = `Saved ${saved}/${selected.length}...`;
      } catch (error) {
        console.error('[ClientSetup] Failed to save client:', error);
      }
    }

    if (status) status.textContent = `Saved ${saved} clients. Verifying...`;
    setTimeout(renderVerifyStep, 500);
  });
}

async function renderVerifyStep() {
  const content = document.getElementById('clientSetupContent');
  if (!content) return;

  content.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-secondary);">Running health check...</div>';

  try {
    const [clientsResult, checkResult] = await Promise.all([
      window.electronAPI.clientsGetAll(),
      window.electronAPI.clientsCheck(),
    ]);

    const clients = clientsResult.success ? clientsResult.clients : [];
    const report = checkResult.success ? checkResult.report : { totalClients: 0, issues: [] };

    let html = `
      <div style="padding: 24px;">
        <h3 style="margin: 0 0 8px;">Client Setup Status</h3>

        <div style="padding: 16px; background: ${report.healthy ? 'var(--status-success, #34c759)' : 'var(--color-warning, #ff9500)'}20; border-radius: 8px; margin-bottom: 16px;">
          <div style="font-weight: 600; font-size: 16px;">
            ${report.totalClients} Clients Configured
            ${report.healthy ? ' - All Healthy' : ` - ${report.issues.length} Issue${report.issues.length !== 1 ? 's' : ''}`}
          </div>
        </div>`;

    if (report.issues.length > 0) {
      html += `<div style="margin-bottom: 16px;">`;
      for (const issue of report.issues) {
        html += `
          <div style="padding: 8px 12px; margin-bottom: 4px; background: var(--color-warning, #ff9500)10; border-left: 3px solid var(--color-warning, #ff9500); border-radius: 4px;">
            ${escapeHtml(issue.message)}
          </div>`;
      }
      html += `</div>`;
    }

    // Client list
    html += `<div style="display: grid; gap: 8px;">`;
    for (const client of clients) {
      html += `
        <div style="padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 500;">${escapeHtml(client.name)}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              ${escapeHtml(client.type)} &middot; ${escapeHtml(client.vault_path || 'No vault path')}
              ${client.domains?.length ? ` &middot; ${client.domains.map(d => escapeHtml(d)).join(', ')}` : ''}
            </div>
          </div>
          <span style="font-size: 12px; padding: 2px 8px; border-radius: 12px; background: ${client.status === 'active' ? 'var(--status-success, #34c759)' : 'var(--text-secondary)'}20;">
            ${escapeHtml(client.status)}
          </span>
        </div>`;
    }
    html += `</div>

        <div style="margin-top: 16px; display: flex; gap: 12px;">
          <button class="btn btn-primary" id="clientSetupDoneBtn">Done</button>
          <button class="btn btn-secondary" id="clientSetupSyncBtn">Sync with Google Contacts</button>
          <button class="btn btn-secondary" id="clientSetupAddMoreBtn">Add More</button>
        </div>
      </div>`;

    content.innerHTML = html;

    document.getElementById('clientSetupDoneBtn')?.addEventListener('click', closeClientSetup);
    document.getElementById('clientSetupAddMoreBtn')?.addEventListener('click', renderDiscoverStep);
    document.getElementById('clientSetupSyncBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('clientSetupSyncBtn');
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      const result = await window.electronAPI.clientsSync();
      if (result.success) {
        btn.textContent = `Synced: ${result.newContacts} new contacts`;
        if (typeof window.showToast === 'function') window.showToast(`Found ${result.newContacts} new contacts, ${result.newCompanies} new companies`, 'success');
      } else {
        btn.textContent = 'Sync Failed';
      }
    });
  } catch (error) {
    content.innerHTML = `<div style="padding: 24px; color: var(--color-error);">Error: ${escapeHtml(error.message)}</div>`;
  }
}
