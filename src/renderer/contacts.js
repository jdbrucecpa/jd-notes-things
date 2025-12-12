/**
 * Contacts Page Module (CS-1)
 * Displays Google Contacts with search, filter, and meeting history.
 */

let allContacts = [];
let filteredContacts = [];
let selectedContact = null;
let searchTimeout = null;
let navigationContext = null; // Track where we navigated from

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
}

/**
 * Open the contacts view
 * @param {string} [emailToSelect] - Optional email to find and select a specific contact
 */
export async function openContactsView(emailToSelect) {
  const contactsView = document.getElementById('contactsView');
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');

  // Close settings if open
  if (settingsView) {
    settingsView.style.display = 'none';
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

  // If email specified, find and select the contact
  if (emailToSelect) {
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
            <span style="color: var(--color-error);">Failed to load contacts: ${result.error}</span>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error('[Contacts] Error loading contacts:', error);
    if (contactsList) {
      contactsList.innerHTML = `
        <div class="contacts-loading">
          <span style="color: var(--color-error);">Error: ${error.message}</span>
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
    filterContacts(query);
  }, 200);
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

  // Check if Obsidian pages exist
  let contactPageExists = false;
  let companyPageExists = false;

  try {
    const contactResult = await window.electronAPI.contactsContactPageExists(contact.name);
    contactPageExists = contactResult.success && contactResult.exists;
  } catch (error) {
    console.warn('[Contacts] Could not check Obsidian contact page status:', error);
  }

  // Check company page if organization exists
  if (contact.organization) {
    try {
      const companyResult = await window.electronAPI.contactsCompanyPageExists(
        contact.organization
      );
      companyPageExists = companyResult.success && companyResult.exists;
    } catch (error) {
      console.warn('[Contacts] Could not check Obsidian company page status:', error);
    }
  }

  // Build contact page status/button
  const contactPageHtml = contactPageExists
    ? `<div class="contact-detail-item obsidian-page-exists">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
        </svg>
        <span>Contact page: [[${escapeHtml(contact.name)}]]</span>
      </div>`
    : `<button class="btn btn-secondary contact-create-page-btn" id="createObsidianPageBtn">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
        </svg>
        Create Contact Page
      </button>`;

  // Build company page status/button (only if organization exists)
  let companyPageHtml = '';
  if (contact.organization) {
    companyPageHtml = companyPageExists
      ? `<div class="contact-detail-item obsidian-page-exists">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
          </svg>
          <span>Company page: [[${escapeHtml(contact.organization)}]]</span>
        </div>`
      : `<button class="btn btn-secondary contact-create-page-btn" id="createCompanyPageBtn">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z" fill="currentColor"/>
          </svg>
          Create Company Page
        </button>`;
  }

  // Build Obsidian actions section
  const obsidianActionsHtml = `
    <div class="contact-detail-section">
      <h4>Obsidian</h4>
      <div class="contact-obsidian-actions">
        ${contactPageHtml}
        ${companyPageHtml}
      </div>
    </div>
  `;

  detailContent.innerHTML = `
    <div class="contact-detail-header">
      <div class="contact-detail-avatar">
        ${contact.photoUrl ? `<img src="${contact.photoUrl}" alt="${contact.name}" />` : initials}
      </div>
      <div>
        <div class="contact-detail-name">${escapeHtml(contact.name)}</div>
        ${
          contact.organization
            ? `<div class="contact-detail-org">${escapeHtml(contact.organization)}${contact.title ? ` - ${escapeHtml(contact.title)}` : ''}</div>`
            : ''
        }
      </div>
    </div>

    <div class="contact-detail-section">
      <h4>Contact Information</h4>
      ${emailsHtml}
      ${phonesHtml}
      ${googleLinkHtml}
    </div>

    ${obsidianActionsHtml}

    <div class="contact-detail-section" id="contactMeetingsSection">
      <h4>Meeting History</h4>
      <div class="contact-meetings-list" id="contactMeetingsList">
        <div class="contacts-loading"><span>Loading meetings...</span></div>
      </div>
    </div>
  `;

  // Add click handler for create contact page button
  const createPageBtn = document.getElementById('createObsidianPageBtn');
  if (createPageBtn) {
    createPageBtn.addEventListener('click', () => createContactObsidianPage(contact));
  }

  // Add click handler for create company page button
  const createCompanyBtn = document.getElementById('createCompanyPageBtn');
  if (createCompanyBtn) {
    createCompanyBtn.addEventListener('click', () => createCompanyObsidianPage(contact));
  }

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
 * Create an Obsidian contact page for the given contact
 */
async function createContactObsidianPage(contact) {
  const btn = document.getElementById('createObsidianPageBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="spinning">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" fill="currentColor"/>
      </svg>
      Creating...
    `;
  }

  try {
    const result = await window.electronAPI.contactsCreateContactPage(contact);

    if (result.success && result.created) {
      console.log('[Contacts] Created Obsidian page:', result.path);
      // Re-render to show "page exists" state
      renderContactDetail(contact);
    } else if (result.success && !result.created) {
      console.log('[Contacts] Page already exists:', result.path);
      renderContactDetail(contact);
    } else {
      console.error('[Contacts] Failed to create page:', result.error);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
          </svg>
          Create Contact Page (Failed)
        `;
      }
    }
  } catch (error) {
    console.error('[Contacts] Error creating Obsidian page:', error);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
        </svg>
        Create Contact Page (Error)
      `;
    }
  }
}

/**
 * Create an Obsidian company page for the contact's organization
 */
async function createCompanyObsidianPage(contact) {
  if (!contact.organization) {
    console.warn('[Contacts] Cannot create company page - no organization');
    return;
  }

  const btn = document.getElementById('createCompanyPageBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="spinning">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" fill="currentColor"/>
      </svg>
      Creating...
    `;
  }

  try {
    // Build company data from contact
    const companyData = {
      name: contact.organization,
      contacts: [contact.name],
    };

    // Try to extract domain from contact's email
    if (contact.emails && contact.emails.length > 0) {
      const emailParts = contact.emails[0].split('@');
      if (emailParts.length === 2) {
        companyData.domain = emailParts[1];
      }
    }

    const result = await window.electronAPI.contactsCreateCompanyPage(companyData);

    if (result.success && result.created) {
      console.log('[Contacts] Created Obsidian company page:', result.path);
      // Re-render to show "page exists" state
      renderContactDetail(contact);
    } else if (result.success && !result.created) {
      console.log('[Contacts] Company page already exists:', result.path);
      renderContactDetail(contact);
    } else {
      console.error('[Contacts] Failed to create company page:', result.error);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 7V3H2v18h20V7H12z" fill="currentColor"/>
          </svg>
          Create Company Page (Failed)
        `;
      }
    }
  } catch (error) {
    console.error('[Contacts] Error creating Obsidian company page:', error);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 7V3H2v18h20V7H12z" fill="currentColor"/>
        </svg>
        Create Company Page (Error)
      `;
    }
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
