/**
 * Quick Contact Search Module (CS-2)
 * Provides Cmd+K style quick search for contacts
 */

let allContacts = [];
let filteredResults = [];
let selectedIndex = -1;
let searchTimeout = null;

/**
 * Initialize the quick search module
 */
export function initQuickSearch() {
  console.log('[QuickSearch] Initializing quick search');

  // Set up global keyboard shortcut
  document.addEventListener('keydown', handleGlobalKeydown);

  // Set up modal event listeners
  setupModalListeners();

  // Pre-fetch contacts for faster search
  preloadContacts();
}

/**
 * Handle global keyboard events
 */
function handleGlobalKeydown(event) {
  // Ctrl+K or Cmd+K to open quick search
  if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
    event.preventDefault();
    openQuickSearch();
    return;
  }
}

/**
 * Set up modal event listeners
 */
function setupModalListeners() {
  const overlay = document.getElementById('quickSearchOverlay');
  const input = document.getElementById('quickSearchInput');

  if (!overlay || !input) {
    console.warn('[QuickSearch] Modal elements not found');
    return;
  }

  // Close on overlay click (not modal content)
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      closeQuickSearch();
    }
  });

  // Input handling
  input.addEventListener('input', handleSearchInput);
  input.addEventListener('keydown', handleInputKeydown);
}

/**
 * Open the quick search modal
 */
export function openQuickSearch() {
  const overlay = document.getElementById('quickSearchOverlay');
  const input = document.getElementById('quickSearchInput');

  if (!overlay) return;

  // Show modal
  overlay.style.display = 'flex';

  // Reset state
  filteredResults = [];
  selectedIndex = -1;

  // Focus input after a small delay to ensure modal is visible
  if (input) {
    input.value = '';
    // Use setTimeout to ensure the modal is rendered before focusing
    setTimeout(() => {
      input.focus();
    }, 50);
  }

  renderResults();

  // Refresh contacts if needed
  if (allContacts.length === 0) {
    preloadContacts();
  }
}

/**
 * Close the quick search modal
 */
export function closeQuickSearch() {
  const overlay = document.getElementById('quickSearchOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Clear input
  const input = document.getElementById('quickSearchInput');
  if (input) {
    input.value = '';
  }

  // Reset state
  filteredResults = [];
  selectedIndex = -1;
}

/**
 * Pre-load contacts for faster search
 */
async function preloadContacts() {
  try {
    const result = await window.electronAPI.contactsGetAllContacts(false);
    if (result.success && result.contacts) {
      allContacts = result.contacts;
      console.log(`[QuickSearch] Pre-loaded ${allContacts.length} contacts`);
    }
  } catch (error) {
    console.error('[QuickSearch] Error pre-loading contacts:', error);
  }
}

/**
 * Handle search input changes
 */
function handleSearchInput(event) {
  const query = event.target.value.trim();

  // Debounce search
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  if (!query) {
    filteredResults = [];
    selectedIndex = -1;
    renderResults();
    return;
  }

  searchTimeout = setTimeout(() => {
    performSearch(query);
  }, 100);
}

/**
 * Perform fuzzy search over contacts
 */
function performSearch(query) {
  const normalizedQuery = query.toLowerCase();

  // Score and filter contacts
  const scored = allContacts.map(contact => {
    let score = 0;
    const matchDetails = {
      nameMatch: null,
      emailMatch: null,
      orgMatch: null,
    };

    // Check name match (highest priority)
    if (contact.name) {
      const nameLower = contact.name.toLowerCase();
      if (nameLower.startsWith(normalizedQuery)) {
        score += 100;
        matchDetails.nameMatch = 'start';
      } else if (nameLower.includes(normalizedQuery)) {
        score += 50;
        matchDetails.nameMatch = 'contains';
      }
    }

    // Check email match
    if (contact.emails && contact.emails.length > 0) {
      for (const email of contact.emails) {
        const emailLower = email.toLowerCase();
        if (emailLower.startsWith(normalizedQuery)) {
          score += 80;
          matchDetails.emailMatch = email;
          break;
        } else if (emailLower.includes(normalizedQuery)) {
          score += 40;
          matchDetails.emailMatch = email;
          break;
        }
      }
    }

    // Check organization match
    if (contact.organization) {
      const orgLower = contact.organization.toLowerCase();
      if (orgLower.startsWith(normalizedQuery)) {
        score += 60;
        matchDetails.orgMatch = 'start';
      } else if (orgLower.includes(normalizedQuery)) {
        score += 30;
        matchDetails.orgMatch = 'contains';
      }
    }

    return {
      contact,
      score,
      matchDetails,
    };
  });

  // Filter to matches and sort by score
  filteredResults = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10); // Limit to top 10 results

  // Reset selection
  selectedIndex = filteredResults.length > 0 ? 0 : -1;

  renderResults();
}

/**
 * Handle keyboard navigation in the search input
 */
function handleInputKeydown(event) {
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      closeQuickSearch();
      break;

    case 'ArrowDown':
      event.preventDefault();
      if (filteredResults.length > 0) {
        selectedIndex = Math.min(selectedIndex + 1, filteredResults.length - 1);
        renderResults();
        scrollToSelected();
      }
      break;

    case 'ArrowUp':
      event.preventDefault();
      if (filteredResults.length > 0) {
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderResults();
        scrollToSelected();
      }
      break;

    case 'Enter':
      event.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < filteredResults.length) {
        selectContact(filteredResults[selectedIndex].contact);
      }
      break;
  }
}

/**
 * Scroll to the selected result item
 */
function scrollToSelected() {
  const resultsContainer = document.getElementById('quickSearchResults');
  const selectedItem = resultsContainer?.querySelector('.quick-search-result-item.selected');

  if (selectedItem && resultsContainer) {
    selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/**
 * Render search results
 */
function renderResults() {
  const resultsContainer = document.getElementById('quickSearchResults');
  if (!resultsContainer) return;

  const input = document.getElementById('quickSearchInput');
  const query = input?.value?.trim() || '';

  if (!query) {
    resultsContainer.innerHTML = `
      <div class="quick-search-hint">
        <span>Type to search contacts by name, email, or company</span>
      </div>
    `;
    return;
  }

  if (filteredResults.length === 0) {
    resultsContainer.innerHTML = `
      <div class="quick-search-empty">
        <span>No contacts found for "${escapeHtml(query)}"</span>
      </div>
    `;
    return;
  }

  const html = filteredResults
    .map((item, index) => {
      const contact = item.contact;
      const initials = getInitials(contact.name);
      const isSelected = index === selectedIndex;

      // Highlight matching text
      const highlightedName = highlightMatch(contact.name || '', query);
      const email = contact.emails && contact.emails[0] ? contact.emails[0] : '';
      const highlightedEmail = highlightMatch(email, query);
      const org = contact.organization || '';
      const highlightedOrg = highlightMatch(org, query);

      // Build meta line
      const metaParts = [];
      if (highlightedEmail) metaParts.push(highlightedEmail);
      if (highlightedOrg) metaParts.push(highlightedOrg);
      const metaLine = metaParts.join(' · ');

      return `
      <div class="quick-search-result-item ${isSelected ? 'selected' : ''}"
           data-index="${index}"
           data-resource="${contact.resourceName}">
        <div class="quick-search-result-avatar">
          ${
            contact.photoUrl
              ? `<img src="${contact.photoUrl}" alt="${escapeHtml(contact.name)}" />`
              : initials
          }
        </div>
        <div class="quick-search-result-info">
          <div class="quick-search-result-name">${highlightedName}</div>
          ${metaLine ? `<div class="quick-search-result-meta">${metaLine}</div>` : ''}
        </div>
      </div>
    `;
    })
    .join('');

  resultsContainer.innerHTML = html;

  // Add click handlers
  resultsContainer.querySelectorAll('.quick-search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index, 10);
      if (index >= 0 && index < filteredResults.length) {
        selectContact(filteredResults[index].contact);
      }
    });

    // Hover to select
    item.addEventListener('mouseenter', () => {
      const index = parseInt(item.dataset.index, 10);
      if (index !== selectedIndex) {
        selectedIndex = index;
        renderResults();
      }
    });
  });
}

/**
 * Select a contact and navigate to their detail view
 */
function selectContact(contact) {
  console.log('[QuickSearch] Selected contact:', contact.name);

  // Close quick search
  closeQuickSearch();

  // Open contacts view and select this contact
  if (window.openContactsView) {
    window.openContactsView();
  }

  // After a short delay, find and click the contact in the list
  setTimeout(() => {
    const contactsList = document.getElementById('contactsList');
    if (contactsList) {
      const contactItem = contactsList.querySelector(`[data-resource="${contact.resourceName}"]`);
      if (contactItem) {
        contactItem.click();
        contactItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, 100);
}

/**
 * Highlight matching text in a string
 */
function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text);

  const escapedText = escapeHtml(text);
  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();

  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex === -1) return escapedText;

  // Find the actual case-preserved match in the original text
  const before = escapeHtml(text.substring(0, matchIndex));
  const match = escapeHtml(text.substring(matchIndex, matchIndex + query.length));
  const after = escapeHtml(text.substring(matchIndex + query.length));

  return `${before}<mark>${match}</mark>${after}`;
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

// Export for global access
if (typeof window !== 'undefined') {
  window.openQuickSearch = openQuickSearch;
  window.closeQuickSearch = closeQuickSearch;
}
