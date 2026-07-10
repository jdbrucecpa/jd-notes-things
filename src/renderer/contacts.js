/**
 * Contacts Page Module (CS-1)
 * Displays Google Contacts with search, filter, and meeting history.
 */

let allContacts = [];
let filteredContacts = [];
let selectedContact = null;
let searchTimeout = null;
let navigationContext = null; // Track where we navigated from

// Companies mode state
let contactsMode = 'contacts'; // 'contacts' | 'companies'
let allCompanies = [];
let companiesFilter = 'all';

/**
 * Initialize the contacts page
 */
export async function initContactsPage() {
  console.log('[Contacts] Initializing contacts page');

  // Set up event listeners
  setupEventListeners();

  // Load contacts
  await loadContacts();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Contacts navigation button (in header)
  const contactsBtn = document.getElementById('contactsBtn');
  if (contactsBtn) {
    contactsBtn.addEventListener('click', openContactsView);
  }

  // Close button
  const closeBtn = document.getElementById('closeContacts');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeContactsView);
  }

  // Search input
  const searchInput = document.getElementById('contactSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshContactsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadContacts(true));
  }

  // Companies/Contacts toggle
  const contactsModeBtn = document.getElementById('contactsModeBtn');
  const companiesModeBtn = document.getElementById('companiesModeBtn');
  if (contactsModeBtn) contactsModeBtn.addEventListener('click', () => switchContactsMode('contacts'));
  if (companiesModeBtn) companiesModeBtn.addEventListener('click', () => switchContactsMode('companies'));

  // Filter chips for companies
  document.querySelectorAll('.companies-filters .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.companies-filters .filter-chip').forEach(c => {
        c.style.background = 'var(--bg-secondary)';
        c.style.color = 'var(--text-primary)';
        c.style.borderColor = 'var(--text-secondary)';
      });
      chip.style.background = 'var(--primary-color)';
      chip.style.color = 'white';
      companiesFilter = chip.dataset.filter;
      renderCompaniesList();
    });
  });

  // Listen for company-detail-back to restore companies mode
  document.addEventListener('company-detail-back', () => {
    // If we were in companies mode, just clear the detail
    if (contactsMode === 'companies') {
      const detailContent = document.getElementById('contactDetailContent');
      const detailEmpty = document.querySelector('.contact-detail-empty');
      if (detailContent) detailContent.style.display = 'none';
      if (detailEmpty) detailEmpty.style.display = 'flex';
    }
  });
}

/**
 * Open the contacts view
 * @param {string} [emailToSelect] - Optional email to find and select a specific contact
 */
export async function openContactsView(emailToSelect) {
  const contactsView = document.getElementById('contactsView');
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');

  const reportsView = document.getElementById('reportsView');

  // Close other views if open
  if (settingsView) {
    settingsView.style.display = 'none';
  }
  if (reportsView) {
    reportsView.style.display = 'none';
  }

  if (contactsView) {
    contactsView.style.display = 'flex';
  }
  if (mainView) {
    mainView.style.display = 'none';
  }

  // Load contacts if not already loaded
  if (allContacts.length === 0) {
    await loadContacts();
  }

  // If email specified (and it's actually a string, not an Event object from click handler),
  // find and select the contact
  if (emailToSelect && typeof emailToSelect === 'string') {
    const contact = allContacts.find(
      c => c.emails && c.emails.some(e => e.toLowerCase() === emailToSelect.toLowerCase())
    );
    if (contact) {
      selectContact(contact);
    }
  }
}

/**
 * Close the contacts view
 */
export function closeContactsView() {
  const contactsView = document.getElementById('contactsView');
  const mainView = document.getElementById('mainView');

  if (contactsView) {
    contactsView.style.display = 'none';
  }
  if (mainView) {
    mainView.style.display = 'block';
  }
}

/**
 * Load contacts from Google
 */
async function loadContacts(forceRefresh = false) {
  const contactsList = document.getElementById('contactsList');
  const contactsCount = document.getElementById('contactsCount');

  // Show loading state
  if (contactsList) {
    contactsList.innerHTML = '<div class="contacts-loading"><span>Loading contacts...</span></div>';
  }

  try {
    const result = await window.electronAPI.contactsGetAllContacts(forceRefresh);

    if (result.success) {
      allContacts = result.contacts || [];
      filteredContacts = [...allContacts];

      console.log(`[Contacts] Loaded ${allContacts.length} contacts`);

      if (contactsCount) {
        contactsCount.textContent = `${allContacts.length} contacts`;
      }

      renderContactsList();
    } else {
      console.error('[Contacts] Failed to load contacts:', result.error);
      if (contactsList) {
        contactsList.innerHTML = `
          <div class="contacts-loading">
            <span style="color: var(--color-error);">Failed to load contacts: ${escapeHtml(result.error)}</span>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[Contacts] Error loading contacts:', error);
    if (contactsList) {
      contactsList.innerHTML = `
        <div class="contacts-loading">
          <span style="color: var(--color-error);">Error: ${escapeHtml(error.message)}</span>
        </div>
      `;
    }
  }
}

/**
 * Handle search input
 */
function handleSearchInput(event) {
  const query = event.target.value.trim();

  // Debounce search
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(() => {
    if (contactsMode === 'companies') {
      renderCompaniesList();
    } else {
      filterContacts(query);
    }
  }, 200);
}

// ===================================================================
// Companies Mode (v1.4)
// ===================================================================

function switchContactsMode(mode) {
  contactsMode = mode;
  const contactsModeBtn = document.getElementById('contactsModeBtn');
  const companiesModeBtn = document.getElementById('companiesModeBtn');
  const contactsList = document.getElementById('contactsList');
  const contactsHeader = document.querySelector('.contacts-list-header');
  const companiesContainer = document.getElementById('companiesListContainer');

  if (contactsModeBtn) {
    contactsModeBtn.style.background = mode === 'contacts' ? 'var(--primary-color)' : 'var(--bg-secondary)';
    contactsModeBtn.style.color = mode === 'contacts' ? 'white' : 'var(--text-primary)';
  }
  if (companiesModeBtn) {
    companiesModeBtn.style.background = mode === 'companies' ? 'var(--primary-color)' : 'var(--bg-secondary)';
    companiesModeBtn.style.color = mode === 'companies' ? 'white' : 'var(--text-primary)';
  }

  if (mode === 'contacts') {
    if (contactsList) contactsList.style.display = '';
    if (contactsHeader) contactsHeader.style.display = '';
    if (companiesContainer) companiesContainer.style.display = 'none';
  } else {
    if (contactsList) contactsList.style.display = 'none';
    if (contactsHeader) contactsHeader.style.display = 'none';
    if (companiesContainer) companiesContainer.style.display = 'flex';
    loadCompaniesList();
  }
}

async function loadCompaniesList() {
  const container = document.getElementById('companiesList');
  if (!container) return;

  container.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'padding: 12px; color: var(--text-secondary);';
  loadingDiv.textContent = 'Loading companies...';
  container.appendChild(loadingDiv);

  try {
    const result = await window.electronAPI.companiesGetAll();
    allCompanies = result.success ? result.companies : [];
    renderCompaniesList();
  } catch (_error) {
    container.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'padding: 12px; color: var(--color-error);';
    errDiv.textContent = 'Failed to load companies';
    container.appendChild(errDiv);
  }
}

function renderCompaniesList() {
  const container = document.getElementById('companiesList');
  if (!container) return;

  let filtered = allCompanies;
  if (companiesFilter === 'has-folder') filtered = allCompanies.filter(c => c.vaultPath);
  else if (companiesFilter === 'no-folder') filtered = allCompanies.filter(c => !c.vaultPath);
  else if (companiesFilter === 'client') filtered = allCompanies.filter(c => c.category === 'Client');

  const searchInput = document.getElementById('contactSearchInput');
  const search = searchInput?.value?.toLowerCase() || '';
  if (search) filtered = filtered.filter(c => c.name.toLowerCase().includes(search));

  container.textContent = '';

  for (const c of filtered) {
    const item = document.createElement('div');
    item.className = 'contact-item company-item';
    item.dataset.company = c.name;
    item.style.cssText = 'padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 10px;';

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width: 32px; height: 32px; border-radius: 6px; background: var(--primary-color); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px; flex-shrink: 0;';
    avatar.textContent = (c.name[0] || '?').toUpperCase();
    item.appendChild(avatar);

    const info = document.createElement('div');
    info.style.cssText = 'flex: 1; min-width: 0;';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 6px;';
    const nameText = document.createElement('span');
    nameText.textContent = c.name;
    nameRow.appendChild(nameText);

    if (c.category === 'Client') {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--primary-color); color: white;';
      badge.textContent = 'Client';
      nameRow.appendChild(badge);
    }
    info.appendChild(nameRow);

    const detailRow = document.createElement('div');
    detailRow.style.cssText = 'font-size: 12px; color: var(--text-secondary);';
    detailRow.textContent = `${c.contactCount} contact${c.contactCount !== 1 ? 's' : ''}${c.vaultPath ? ' \u00b7 \ud83d\udcc1' : ''}`;
    info.appendChild(detailRow);

    item.appendChild(info);

    item.addEventListener('click', () => {
      if (typeof window.openCompanyDetail === 'function') {
        window.openCompanyDetail(c.name);
      }
    });

    container.appendChild(item);
  }
}

/**
 * Filter contacts by search query
 */
function filterContacts(query) {
  const contactsCount = document.getElementById('contactsCount');

  if (!query) {
    filteredContacts = [...allContacts];
  } else {
    const normalizedQuery = query.toLowerCase();
    filteredContacts = allContacts.filter(contact => {
      const nameMatch = contact.name && contact.name.toLowerCase().includes(normalizedQuery);
      const emailMatch =
        contact.emails &&
        contact.emails.some(email => email.toLowerCase().includes(normalizedQuery));
      const orgMatch =
        contact.organization && contact.organization.toLowerCase().includes(normalizedQuery);
      return nameMatch || emailMatch || orgMatch;
    });
  }

  if (contactsCount) {
    contactsCount.textContent = query
      ? `${filteredContacts.length} of ${allContacts.length} contacts`
      : `${allContacts.length} contacts`;
  }

  renderContactsList();
}

/**
 * Render the contacts list
 */
function renderContactsList() {
  const contactsList = document.getElementById('contactsList');
  if (!contactsList) return;

  if (filteredContacts.length === 0) {
    contactsList.innerHTML = `
      <div class="contacts-loading">
        <span>No contacts found</span>
      </div>
    `;
    return;
  }

  const html = filteredContacts
    .map(contact => {
      const initials = getInitials(contact.name);
      const primaryEmail = contact.emails && contact.emails[0] ? contact.emails[0] : '';
      const isSelected = selectedContact && selectedContact.resourceName === contact.resourceName;

      return `
      <div class="contact-item ${isSelected ? 'selected' : ''}" data-resource="${contact.resourceName}">
        <div class="contact-item-avatar">
          ${contact.photoUrl ? `<img src="${contact.photoUrl}" alt="${contact.name}" />` : initials}
        </div>
        <div class="contact-item-info">
          <div class="contact-item-name">${escapeHtml(contact.name)}</div>
          <div class="contact-item-email">${escapeHtml(primaryEmail)}</div>
        </div>
      </div>
    `;
    })
    .join('');

  contactsList.innerHTML = html;

  // Add click handlers
  contactsList.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => {
      const resourceName = item.dataset.resource;
      const contact = filteredContacts.find(c => c.resourceName === resourceName);
      if (contact) {
        selectContact(contact);
      }
    });
  });
}

/**
 * Select a contact and show details
 */
async function selectContact(contact) {
  selectedContact = contact;

  // Update selection in list
  const contactsList = document.getElementById('contactsList');
  if (contactsList) {
    contactsList.querySelectorAll('.contact-item').forEach(item => {
      item.classList.remove('selected');
      if (item.dataset.resource === contact.resourceName) {
        item.classList.add('selected');
      }
    });
  }

  // Show contact details
  const emptyState = document.querySelector('.contact-detail-empty');
  const detailContent = document.getElementById('contactDetailContent');

  if (emptyState) emptyState.style.display = 'none';
  if (detailContent) {
    detailContent.style.display = 'block';
    renderContactDetail(contact);
  }
}

/**
 * Render contact detail view
 */
async function renderContactDetail(contact) {
  const detailContent = document.getElementById('contactDetailContent');
  if (!detailContent) return;

  const initials = getInitials(contact.name);
  const primaryEmail = contact.emails && contact.emails[0] ? contact.emails[0] : null;

  // Build emails section
  const emailsHtml =
    contact.emails && contact.emails.length > 0
      ? contact.emails
          .map(
            email => `
        <div class="contact-detail-item">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="currentColor"/>
          </svg>
          <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
        </div>
      `
          )
          .join('')
      : '<div class="contact-detail-item">No email addresses</div>';

  // Build phones section
  const phonesHtml =
    contact.phones && contact.phones.length > 0
      ? contact.phones
          .map(
            phone => `
        <div class="contact-detail-item">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="currentColor"/>
          </svg>
          <span>${escapeHtml(phone)}</span>
        </div>
      `
          )
          .join('')
      : '';

  // Build Google contact link
  // resourceName format is "people/c1234567890", need to extract the ID
  const contactId = contact.resourceName ? contact.resourceName.replace('people/', '') : null;
  const googleLinkHtml = contactId
    ? `
    <div class="contact-detail-item">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" fill="currentColor"/>
      </svg>
      <a href="https://contacts.google.com/person/${contactId}" target="_blank">Open in Google Contacts</a>
    </div>
  `
    : '';

  // v1.4: Organization is clickable to open company detail
  const orgHtml = contact.organization
    ? `<div class="contact-detail-org">
        <a href="#" class="company-link" data-org="${escapeHtml(contact.organization)}" style="color: var(--primary-color); text-decoration: none;">${escapeHtml(contact.organization)}</a>${contact.title ? ` - ${escapeHtml(contact.title)}` : ''}
      </div>`
    : '';

  detailContent.innerHTML = `
    <div class="contact-detail-header" style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="contact-detail-avatar">
          ${contact.photoUrl ? `<img src="${contact.photoUrl}" alt="${contact.name}" />` : initials}
        </div>
        <div>
          <div class="contact-detail-name">${escapeHtml(contact.name)}</div>
          ${orgHtml}
        </div>
      </div>
      ${contact.resourceName ? '<button class="btn btn-outline btn-sm" id="editContactBtn">Edit</button>' : ''}
    </div>

    <div class="contact-detail-section">
      <h4>Contact Information</h4>
      ${emailsHtml}
      ${phonesHtml}
      ${googleLinkHtml}
    </div>

    <div class="contact-detail-section" id="contactMeetingsSection">
      <h4>Meeting History</h4>
      <div class="contact-meetings-list" id="contactMeetingsList">
        <div class="contacts-loading"><span>Loading meetings...</span></div>
      </div>
    </div>
  `;

  // v1.4: Edit contact button
  const editBtn = document.getElementById('editContactBtn');
  if (editBtn) {
    editBtn.addEventListener('click', () => openContactEditForm(contact));
  }

  // v1.4: Company link click → open company detail
  detailContent.querySelectorAll('.company-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const org = link.dataset.org;
      if (org && typeof window.openCompanyDetail === 'function') {
        window.openCompanyDetail(org);
      }
    });
  });

  // Load meetings for this contact
  if (primaryEmail) {
    await loadContactMeetings(primaryEmail);
  } else {
    const meetingsList = document.getElementById('contactMeetingsList');
    if (meetingsList) {
      meetingsList.innerHTML = '<div class="contact-detail-item">No email to search meetings</div>';
    }
  }
}

/**
 * v1.4: Open inline edit form for a contact
 */
function openContactEditForm(contact) {
  const detailContent = document.getElementById('contactDetailContent');
  if (!detailContent) return;

  const emailsValue = (contact.emails || []).join(', ');
  const phonesValue = (contact.phones || []).join(', ');

  detailContent.innerHTML = `
    <div style="padding: 24px;">
      <h3 style="margin: 0 0 16px; font-size: 18px;">Edit Contact</h3>
      <div style="display: grid; gap: 12px;">
        <div>
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">Name</label>
          <input type="text" class="settings-input" id="editContactName" value="${escapeHtml(contact.name || '')}" style="width: 100%;">
        </div>
        <div>
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">Organization</label>
          <input type="text" class="settings-input" id="editContactOrg" value="${escapeHtml(contact.organization || '')}" style="width: 100%;">
        </div>
        <div>
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">Title</label>
          <input type="text" class="settings-input" id="editContactTitle" value="${escapeHtml(contact.title || '')}" style="width: 100%;">
        </div>
        <div>
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">Emails (comma-separated)</label>
          <input type="text" class="settings-input" id="editContactEmails" value="${escapeHtml(emailsValue)}" style="width: 100%;">
        </div>
        <div>
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px;">Phones (comma-separated)</label>
          <input type="text" class="settings-input" id="editContactPhones" value="${escapeHtml(phonesValue)}" style="width: 100%;">
        </div>
      </div>
      <div style="display: flex; gap: 12px; margin-top: 16px;">
        <button class="btn btn-primary" id="saveContactEditBtn">Save</button>
        <button class="btn btn-secondary" id="cancelContactEditBtn">Cancel</button>
      </div>
      <div id="editContactStatus" style="margin-top: 8px; font-size: 13px;"></div>
    </div>
  `;

  document.getElementById('cancelContactEditBtn')?.addEventListener('click', () => {
    renderContactDetail(contact);
  });

  document.getElementById('saveContactEditBtn')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('saveContactEditBtn');
    const status = document.getElementById('editContactStatus');
    saveBtn.disabled = true;
    if (status) status.textContent = 'Saving...';

    try {
      const updates = {
        name: document.getElementById('editContactName')?.value?.trim(),
        organization: document.getElementById('editContactOrg')?.value?.trim(),
        title: document.getElementById('editContactTitle')?.value?.trim(),
        emails: document.getElementById('editContactEmails')?.value
          ?.split(',').map(e => e.trim()).filter(Boolean),
        phones: document.getElementById('editContactPhones')?.value
          ?.split(',').map(p => p.trim()).filter(Boolean),
      };

      const result = await window.electronAPI.contactsUpdateContact(
        contact.resourceName,
        updates
      );

      if (result.success) {
        // Refresh the contact detail with updated data
        const updatedContact = { ...contact, ...updates };
        if (result.contact) Object.assign(updatedContact, result.contact);
        selectedContact = updatedContact;
        renderContactDetail(updatedContact);
        if (typeof window.showToast === 'function') window.showToast('Contact updated', 'success');
      } else {
        if (status) status.textContent = `Error: ${result.error}`;
        if (status) status.style.color = 'var(--color-error)';
        saveBtn.disabled = false;
      }
    } catch (error) {
      if (status) status.textContent = `Error: ${error.message}`;
      if (status) status.style.color = 'var(--color-error)';
      saveBtn.disabled = false;
    }
  });
}

/**
 * Load meetings for a contact
 */
async function loadContactMeetings(email) {
  const meetingsList = document.getElementById('contactMeetingsList');
  if (!meetingsList) return;

  try {
    const result = await window.electronAPI.contactsGetMeetingsForContact(email);

    if (result.success && result.meetings && result.meetings.length > 0) {
      const html = result.meetings
        .map(meeting => {
          const date = new Date(meeting.date);
          const dateStr = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });

          return `
          <div class="contact-meeting-item" data-meeting-id="${meeting.id}">
            <span class="contact-meeting-date">${dateStr}</span>
            <span class="contact-meeting-title">${escapeHtml(meeting.title)}</span>
          </div>
        `;
        })
        .join('');

      meetingsList.innerHTML = html;

      // Add click handlers for meetings
      meetingsList.querySelectorAll('.contact-meeting-item').forEach(item => {
        item.addEventListener('click', () => {
          const meetingId = item.dataset.meetingId;
          // Store navigation context so we can return to this contact
          navigationContext = {
            type: 'contact',
            contact: selectedContact,
            contactEmail: email,
          };
          // Show back button
          const backButton = document.getElementById('backButton');
          if (backButton) {
            backButton.style.display = 'flex';
          }
          // Close contacts and open meeting
          closeContactsView();
          // Trigger meeting detail view
          if (window.showMeetingDetail) {
            window.showMeetingDetail(meetingId);
          }
        });
      });
    } else {
      meetingsList.innerHTML = '<div class="contact-detail-item">No meetings found</div>';
    }
  } catch (error) {
    console.error('[Contacts] Error loading meetings:', error);
    meetingsList.innerHTML =
      '<div class="contact-detail-item" style="color: var(--color-error);">Error loading meetings</div>';
  }
}

/**
 * Get initials from name
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(' ').filter(p => p);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get the current navigation context (for back navigation)
 */
export function getNavigationContext() {
  return navigationContext;
}

/**
 * Clear the navigation context
 */
export function clearNavigationContext() {
  navigationContext = null;
  // Hide back button
  const backButton = document.getElementById('backButton');
  if (backButton) {
    backButton.style.display = 'none';
  }
}

/**
 * Return to the contact we came from
 */
export function returnToContact() {
  if (navigationContext && navigationContext.type === 'contact' && navigationContext.contact) {
    openContactsView();
    // Re-select the contact
    selectContact(navigationContext.contact);
    // Clear context after returning
    navigationContext = null;
    // Hide back button
    const backButton = document.getElementById('backButton');
    if (backButton) {
      backButton.style.display = 'none';
    }
  }
}

// Export for global access
if (typeof window !== 'undefined') {
  window.openContactsView = openContactsView;
  window.closeContactsView = closeContactsView;
  window.returnToContact = returnToContact;
  window.getContactNavigationContext = getNavigationContext;
  window.clearContactNavigationContext = clearNavigationContext;
}
