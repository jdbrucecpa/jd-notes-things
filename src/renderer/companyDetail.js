/**
 * Company Detail View (v1.4)
 *
 * Displays company information, configuration (category + vault path),
 * contacts in the company, and meeting history.
 * Accessible from the Companies toggle on the Contacts page.
 */

let _currentCompany = null;

/**
 * Open the company detail panel within the contacts view.
 * @param {string} organization - Company/organization name
 */
export async function openCompanyDetail(organization) {
  _currentCompany = organization;
  const detailContent = document.getElementById('contactDetailContent');
  const detailEmpty = document.querySelector('.contact-detail-empty');
  if (!detailContent) return;

  // Show detail, hide empty state
  detailContent.style.display = 'block';
  if (detailEmpty) detailEmpty.style.display = 'none';

  detailContent.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'padding: 24px; text-align: center; color: var(--text-secondary);';
  loadingDiv.textContent = 'Loading company details...';
  detailContent.appendChild(loadingDiv);

  try {
    const [contactsResult, meetingsResult, companiesResult] = await Promise.all([
      window.electronAPI.contactsGetCompanyContacts(organization),
      window.electronAPI.contactsGetCompanyMeetings(organization),
      window.electronAPI.companiesGetAll(),
    ]);

    const contacts = contactsResult.success ? contactsResult.contacts : [];
    const meetings = meetingsResult.success ? meetingsResult.meetings : [];
    const companies = companiesResult.success ? companiesResult.companies : [];
    const dbData = companies.find(c => c.name.toLowerCase() === organization.toLowerCase());

    renderCompanyDetail(organization, contacts, meetings, dbData);
  } catch (error) {
    console.error('[CompanyDetail] Failed to load:', error);
    detailContent.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'padding: 24px; color: var(--color-error);';
    errDiv.textContent = `Failed to load company details: ${error.message}`;
    detailContent.appendChild(errDiv);
  }
}

function renderCompanyDetail(organization, contacts, meetings, dbData) {
  const detailContent = document.getElementById('contactDetailContent');
  if (!detailContent) return;

  // Extract domains from contact emails (read-only display)
  const domains = new Set();
  for (const contact of contacts) {
    if (contact.emails) {
      for (const email of contact.emails) {
        const domain = email.split('@')[1];
        if (domain) domains.add(domain);
      }
    }
  }

  // Build using DOM methods to avoid XSS
  detailContent.textContent = '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding: 24px;';

  // ── Header ──
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;';

  const headerLeft = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.style.cssText = 'margin: 0 0 4px; font-size: 20px;';
  h2.textContent = organization;
  headerLeft.appendChild(h2);

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color: var(--text-secondary); font-size: 13px;';
  subtitle.textContent = `${contacts.length} contact${contacts.length !== 1 ? 's' : ''} \u00b7 ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`;
  if (domains.size > 0) {
    subtitle.textContent += ` \u00b7 ${Array.from(domains).join(', ')}`;
  }
  headerLeft.appendChild(subtitle);
  header.appendChild(headerLeft);

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-outline btn-sm';
  backBtn.style.cssText = 'flex-shrink: 0;';
  backBtn.textContent = '\u2190 Back';
  backBtn.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('company-detail-back'));
  });
  header.appendChild(backBtn);
  wrapper.appendChild(header);

  // ── Configuration Section ──
  const configSection = document.createElement('div');
  configSection.style.cssText = 'margin-bottom: 24px; padding: 16px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px;';

  const configTitle = document.createElement('h3');
  configTitle.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);';
  configTitle.textContent = 'Configuration';
  configSection.appendChild(configTitle);

  const configGrid = document.createElement('div');
  configGrid.style.cssText = 'display: grid; gap: 12px;';

  // Category row
  const catRow = document.createElement('div');
  catRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';
  const catLabel = document.createElement('label');
  catLabel.style.cssText = 'width: 100px; font-size: 13px; font-weight: 500;';
  catLabel.textContent = 'Category:';
  catRow.appendChild(catLabel);

  const catSelect = document.createElement('select');
  catSelect.id = 'companyCategory';
  catSelect.className = 'settings-select';
  catSelect.style.cssText = 'flex: 1; padding: 6px 10px;';
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '\u2014';
  optNone.selected = !dbData?.category;
  const optClient = document.createElement('option');
  optClient.value = 'Client';
  optClient.textContent = 'Client';
  optClient.selected = dbData?.category === 'Client';
  const optOther = document.createElement('option');
  optOther.value = 'Other';
  optOther.textContent = 'Other';
  optOther.selected = dbData?.category === 'Other';
  catSelect.appendChild(optNone);
  catSelect.appendChild(optClient);
  catSelect.appendChild(optOther);
  catRow.appendChild(catSelect);
  configGrid.appendChild(catRow);

  // Folder path row
  const pathRow = document.createElement('div');
  pathRow.style.cssText = 'display: flex; gap: 8px; align-items: center;';
  const pathLabel = document.createElement('label');
  pathLabel.style.cssText = 'width: 100px; font-size: 13px; font-weight: 500;';
  pathLabel.textContent = 'Folder:';
  pathRow.appendChild(pathLabel);

  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.id = 'companyVaultPath';
  pathInput.className = 'settings-input';
  pathInput.style.cssText = 'flex: 1; padding: 6px 10px;';
  pathInput.value = dbData?.vaultPath || '';
  pathInput.placeholder = 'Click Browse to select a folder...';
  pathInput.readOnly = true;
  pathRow.appendChild(pathInput);

  const browseBtn = document.createElement('button');
  browseBtn.className = 'btn btn-secondary btn-sm';
  browseBtn.textContent = 'Browse';
  browseBtn.style.cssText = 'flex-shrink: 0;';
  browseBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.companiesSelectFolder();
    if (result.success && result.folderPath) {
      pathInput.value = result.folderPath;
    }
  });
  pathRow.appendChild(browseBtn);
  configGrid.appendChild(pathRow);

  // Buttons row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 8px;';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.id = 'saveCompanyConfig';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const category = catSelect.value || null;
    const vaultPath = pathInput.value || null;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    await window.electronAPI.companiesUpdate({ name: organization, vaultPath, category });

    saveBtn.textContent = 'Saved!';
    setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }, 1500);
  });
  btnRow.appendChild(saveBtn);

  const syncBtn = document.createElement('button');
  syncBtn.className = 'btn btn-secondary btn-sm';
  syncBtn.textContent = 'Sync Contacts';
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    const result = await window.electronAPI.companiesSyncContacts(organization);
    syncBtn.textContent = result.success ? `Synced (${result.added} new)` : 'Sync Failed';
    setTimeout(() => { syncBtn.textContent = 'Sync Contacts'; syncBtn.disabled = false; }, 2000);
  });
  btnRow.appendChild(syncBtn);
  configGrid.appendChild(btnRow);

  configSection.appendChild(configGrid);
  wrapper.appendChild(configSection);

  // ── Contacts Section ──
  const contactsSection = document.createElement('div');
  contactsSection.style.cssText = 'margin-bottom: 24px;';

  const contactsTitle = document.createElement('h3');
  contactsTitle.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);';
  contactsTitle.textContent = `Contacts (${contacts.length})`;
  contactsSection.appendChild(contactsTitle);

  const contactsGrid = document.createElement('div');
  contactsGrid.style.cssText = 'display: grid; gap: 8px;';

  for (const contact of contacts) {
    const email = contact.emails?.[0] || '';
    const title = contact.title || '';

    const card = document.createElement('div');
    card.className = 'company-contact-card';
    card.style.cssText = 'padding: 12px; background: var(--bg-secondary, #f5f5f5); border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px;';

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width: 36px; height: 36px; border-radius: 50%; background: var(--primary-color); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; flex-shrink: 0;';
    avatar.textContent = (contact.name || '?')[0].toUpperCase();
    card.appendChild(avatar);

    const info = document.createElement('div');
    info.style.cssText = 'min-width: 0;';
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: 500; font-size: 14px;';
    nameDiv.textContent = contact.name || 'Unknown';
    info.appendChild(nameDiv);

    const detailDiv = document.createElement('div');
    detailDiv.style.cssText = 'font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    detailDiv.textContent = title ? `${title} \u00b7 ${email}` : email;
    info.appendChild(detailDiv);
    card.appendChild(info);

    card.addEventListener('click', () => {
      if (email && window.openContactsView) {
        window.openContactsView(email);
      }
    });

    contactsGrid.appendChild(card);
  }
  contactsSection.appendChild(contactsGrid);
  wrapper.appendChild(contactsSection);

  // ── Meetings Section ──
  const meetingsSection = document.createElement('div');

  const meetingsTitle = document.createElement('h3');
  meetingsTitle.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);';
  meetingsTitle.textContent = `Meeting History (${meetings.length})`;
  meetingsSection.appendChild(meetingsTitle);

  if (meetings.length === 0) {
    const noMeetings = document.createElement('p');
    noMeetings.style.cssText = 'color: var(--text-secondary); font-size: 13px;';
    noMeetings.textContent = 'No meetings found with this company.';
    meetingsSection.appendChild(noMeetings);
  } else {
    const meetingsGrid = document.createElement('div');
    meetingsGrid.style.cssText = 'display: grid; gap: 8px;';

    for (const meeting of meetings.slice(0, 50)) {
      const date = meeting.date ? new Date(meeting.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }) : 'Unknown';

      const card = document.createElement('div');
      card.className = 'company-meeting-card';
      card.style.cssText = 'padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer;';

      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = 'font-weight: 500; font-size: 14px;';
      titleDiv.textContent = meeting.title || 'Untitled';
      card.appendChild(titleDiv);

      const dateDiv = document.createElement('div');
      dateDiv.style.cssText = 'font-size: 12px; color: var(--text-secondary); margin-top: 2px;';
      dateDiv.textContent = date;
      card.appendChild(dateDiv);

      card.addEventListener('click', () => {
        const contactsView = document.getElementById('contactsView');
        const mainView = document.getElementById('mainView');
        if (contactsView) contactsView.style.display = 'none';
        if (mainView) mainView.style.display = 'block';
        if (window.showEditorView) window.showEditorView(meeting.id);
      });

      meetingsGrid.appendChild(card);
    }
    meetingsSection.appendChild(meetingsGrid);
  }
  wrapper.appendChild(meetingsSection);

  detailContent.appendChild(wrapper);
}
