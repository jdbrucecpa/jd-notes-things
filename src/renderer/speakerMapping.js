/**
 * Speaker Mapping Module (SM-2)
 * Handles the speaker mapping modal for bulk replacement of cryptic speaker IDs
 */

import { escapeHtml } from './security.js';

// Current state
let currentMeetingId = null;
let currentMappings = {};
let searchTimeouts = {};
let documentClickHandler = null; // Single delegated click handler

/**
 * Open the speaker mapping modal for a meeting
 * @param {string} meetingId - The meeting ID
 * @param {Array} transcript - The transcript array
 * @param {Function} onComplete - Callback when mappings are applied
 */
export async function openSpeakerMappingModal(meetingId, transcript, onComplete) {
  const startTime = performance.now();
  console.log('[SpeakerMapping] Opening modal for meeting:', meetingId);

  currentMeetingId = meetingId;
  currentMappings = {};

  const modal = document.getElementById('speakerMappingModal');
  const speakersList = document.getElementById('speakerMappingsList');
  const noSpeakersMessage = document.getElementById('noSpeakersMessage');
  const applyBtn = document.getElementById('applySpeakerMappings');
  const statsText = document.getElementById('speakerMappingStatsText');

  if (!modal || !speakersList) {
    console.error('[SpeakerMapping] Modal elements not found');
    return;
  }

  // Show modal immediately with loading state
  modal.style.display = 'flex';
  speakersList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading speakers...</p>';

  console.log(`[SpeakerMapping] Modal shown at ${(performance.now() - startTime).toFixed(0)}ms`);

  // Extract unique speaker IDs that need mapping
  const extractStart = performance.now();
  const result = await window.electronAPI.speakerMappingExtractIds(transcript);
  const speakerIds = result.success ? result.speakerIds : [];
  console.log(`[SpeakerMapping] Extract IDs took ${(performance.now() - extractStart).toFixed(0)}ms, found ${speakerIds.length} IDs`);

  if (speakerIds.length === 0) {
    // No cryptic IDs found
    speakersList.style.display = 'none';
    noSpeakersMessage.style.display = 'flex';
    applyBtn.disabled = true;
    statsText.textContent = 'No speakers to map';
  } else {
    speakersList.style.display = 'flex';
    noSpeakersMessage.style.display = 'none';

    // Get suggestions from known mappings
    const suggestStart = performance.now();
    const suggestionsResult = await window.electronAPI.speakerMappingGetSuggestions(speakerIds);
    const suggestions = suggestionsResult.success ? suggestionsResult.suggestions : {};
    console.log(`[SpeakerMapping] Get suggestions took ${(performance.now() - suggestStart).toFixed(0)}ms`);

    // Render speaker mapping rows
    const renderStart = performance.now();
    await renderSpeakerRows(speakersList, speakerIds, suggestions);
    console.log(`[SpeakerMapping] Render rows took ${(performance.now() - renderStart).toFixed(0)}ms`);

    // Update stats
    updateMappingStats();
  }

  // Set up event listeners
  const listenersStart = performance.now();
  setupModalEventListeners(onComplete);
  console.log(`[SpeakerMapping] Setup listeners took ${(performance.now() - listenersStart).toFixed(0)}ms`);

  console.log(`[SpeakerMapping] Total modal open time: ${(performance.now() - startTime).toFixed(0)}ms`);
}

/**
 * Render speaker mapping rows
 */
async function renderSpeakerRows(container, speakerIds, suggestions) {
  container.innerHTML = '';

  for (const speakerId of speakerIds) {
    const suggestion = suggestions[speakerId];
    const row = createSpeakerRow(speakerId, suggestion);
    container.appendChild(row);

    // If there's a suggestion, pre-populate the mapping
    if (suggestion) {
      currentMappings[speakerId] = {
        contactName: suggestion.contactName,
        contactEmail: suggestion.contactEmail,
        obsidianLink: suggestion.obsidianLink,
      };
    }
  }
}

/**
 * Create a speaker mapping row
 */
function createSpeakerRow(speakerId, suggestion) {
  const row = document.createElement('div');
  row.className = 'speaker-mapping-row';
  row.dataset.speakerId = speakerId;

  if (suggestion) {
    row.classList.add('mapped');
  }

  const arrowSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 4L10.59 5.41 16.17 11H4V13H16.17L10.59 18.59 12 20L20 12L12 4Z" fill="currentColor"/>
  </svg>`;

  row.innerHTML = `
    <div class="speaker-id-box">
      <span class="speaker-id-label">Original Speaker</span>
      <span class="speaker-id-value">${escapeHtml(speakerId)}</span>
    </div>
    <div class="speaker-mapping-arrow">
      ${arrowSvg}
    </div>
    <div class="speaker-contact-box">
      <span class="speaker-contact-label">Map to Contact</span>
      <div class="speaker-contact-search">
        <input
          type="text"
          class="speaker-contact-input ${suggestion ? 'mapped' : ''}"
          placeholder="Search contacts..."
          value="${suggestion ? escapeHtml(suggestion.contactName) : ''}"
          data-speaker-id="${escapeHtml(speakerId)}"
        />
        <button class="speaker-contact-clear" title="Clear" style="${suggestion ? '' : 'display: none;'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      ${suggestion ? `
        <div class="speaker-suggestion">
          <span class="speaker-suggestion-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12S6.48 22 12 22 22 17.52 22 12 17.52 2 12 2ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" fill="currentColor"/>
            </svg>
          </span>
          <span class="speaker-suggestion-text">Auto-suggested from previous mapping</span>
        </div>
      ` : ''}
    </div>
  `;

  // Set up event listeners for this row
  setupRowEventListeners(row, speakerId);

  return row;
}

/**
 * Set up event listeners for a speaker row
 */
function setupRowEventListeners(row, speakerId) {
  const input = row.querySelector('.speaker-contact-input');
  const clearBtn = row.querySelector('.speaker-contact-clear');

  // Contact search
  input.addEventListener('input', e => {
    const query = e.target.value.trim();

    // Clear previous timeout
    if (searchTimeouts[speakerId]) {
      clearTimeout(searchTimeouts[speakerId]);
    }

    // Debounced search
    if (query.length >= 2) {
      searchTimeouts[speakerId] = setTimeout(() => {
        searchContacts(row, speakerId, query);
      }, 300);
    } else {
      hideDropdown(row);
      // Clear mapping if empty
      if (query.length === 0) {
        clearMapping(row, speakerId);
      }
    }
  });

  // Focus handling
  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length >= 2) {
      searchContacts(row, speakerId, query);
    }
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    clearMapping(row, speakerId);
    input.value = '';
    input.focus();
  });
}

/**
 * Search contacts and show dropdown
 */
async function searchContacts(row, speakerId, query) {
  try {
    const result = await window.electronAPI.contactsSearchContacts(query);

    if (result.success && result.contacts.length > 0) {
      showDropdown(row, speakerId, result.contacts);
    } else {
      hideDropdown(row);
    }
  } catch (error) {
    console.error('[SpeakerMapping] Contact search error:', error);
    hideDropdown(row);
  }
}

/**
 * Show contact dropdown
 * Uses fixed positioning to avoid clipping by overflow:auto containers
 */
function showDropdown(row, speakerId, contacts) {
  // Remove existing dropdown
  hideAllDropdowns();

  const input = row.querySelector('.speaker-contact-input');
  const dropdown = document.createElement('div');
  dropdown.className = 'speaker-contact-dropdown';
  dropdown.dataset.speakerId = speakerId;

  // Position the dropdown relative to the input using fixed positioning
  const inputRect = input.getBoundingClientRect();
  dropdown.style.position = 'fixed';
  dropdown.style.top = `${inputRect.bottom + 4}px`;
  dropdown.style.left = `${inputRect.left}px`;
  dropdown.style.width = `${inputRect.width}px`;

  for (const contact of contacts.slice(0, 5)) {
    const option = document.createElement('div');
    option.className = 'speaker-contact-option';

    const initials = getInitials(contact.name || '?');
    const email = contact.emails && contact.emails.length > 0 ? contact.emails[0] : '';

    option.innerHTML = `
      <div class="contact-avatar">${escapeHtml(initials)}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(contact.name || 'Unknown')}</div>
        ${email ? `<div class="contact-email">${escapeHtml(email)}</div>` : ''}
      </div>
    `;

    option.addEventListener('click', () => {
      selectContact(row, speakerId, contact);
      hideAllDropdowns();
    });

    dropdown.appendChild(option);
  }

  // Append to body to avoid clipping
  document.body.appendChild(dropdown);
}

/**
 * Hide contact dropdown for a specific row
 */
function hideDropdown(row) {
  const speakerId = row.dataset.speakerId;
  const dropdown = document.querySelector(`.speaker-contact-dropdown[data-speaker-id="${speakerId}"]`);
  if (dropdown) {
    dropdown.remove();
  }
}

/**
 * Hide all contact dropdowns
 */
function hideAllDropdowns() {
  const dropdowns = document.querySelectorAll('.speaker-contact-dropdown');
  dropdowns.forEach(dropdown => dropdown.remove());
}

/**
 * Select a contact for a speaker
 */
function selectContact(row, speakerId, contact) {
  const input = row.querySelector('.speaker-contact-input');
  const clearBtn = row.querySelector('.speaker-contact-clear');

  console.log('[SpeakerMapping] Selected contact:', contact);
  const email = contact.emails && contact.emails.length > 0 ? contact.emails[0] : contact.email || null;
  console.log('[SpeakerMapping] Extracted email:', email);

  // Update UI
  input.value = contact.name;
  input.classList.add('mapped');
  clearBtn.style.display = 'block';
  row.classList.add('mapped');

  // Hide dropdown
  hideDropdown(row);

  // Store mapping
  currentMappings[speakerId] = {
    contactName: contact.name,
    contactEmail: email,
    obsidianLink: `[[${contact.name}]]`,
  };
  console.log('[SpeakerMapping] Stored mapping:', speakerId, currentMappings[speakerId]);

  // Update stats
  updateMappingStats();
}

/**
 * Clear a speaker mapping
 */
function clearMapping(row, speakerId) {
  const input = row.querySelector('.speaker-contact-input');
  const clearBtn = row.querySelector('.speaker-contact-clear');

  input.classList.remove('mapped');
  clearBtn.style.display = 'none';
  row.classList.remove('mapped');

  // Remove mapping
  delete currentMappings[speakerId];

  // Update stats
  updateMappingStats();
}

/**
 * Update mapping statistics
 */
function updateMappingStats() {
  const statsText = document.getElementById('speakerMappingStatsText');
  const applyBtn = document.getElementById('applySpeakerMappings');

  const mappedCount = Object.keys(currentMappings).length;
  const totalRows = document.querySelectorAll('.speaker-mapping-row').length;

  statsText.textContent = `${mappedCount} of ${totalRows} speakers mapped`;

  // Enable apply button if at least one mapping
  applyBtn.disabled = mappedCount === 0;
}

/**
 * Set up modal event listeners
 */
function setupModalEventListeners(onComplete) {
  const modal = document.getElementById('speakerMappingModal');
  const closeBtn = document.getElementById('closeSpeakerMappingModal');
  const cancelBtn = document.getElementById('cancelSpeakerMapping');
  const applyBtn = document.getElementById('applySpeakerMappings');

  // Set up single delegated click handler for closing dropdowns
  if (documentClickHandler) {
    document.removeEventListener('click', documentClickHandler);
  }
  documentClickHandler = e => {
    // Check if click is inside any dropdown or input
    const isInsideDropdown = e.target.closest('.speaker-contact-dropdown');
    const isInsideInput = e.target.closest('.speaker-contact-input');
    if (!isInsideDropdown && !isInsideInput) {
      hideAllDropdowns();
    }
  };
  document.addEventListener('click', documentClickHandler);

  // Close handlers
  const closeModal = () => {
    hideAllDropdowns();
    modal.style.display = 'none';
    currentMeetingId = null;
    currentMappings = {};
    searchTimeouts = {};
    // Clean up the delegated click handler
    if (documentClickHandler) {
      document.removeEventListener('click', documentClickHandler);
      documentClickHandler = null;
    }
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = e => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Apply mappings
  applyBtn.onclick = async () => {
    if (Object.keys(currentMappings).length === 0) {
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';

    try {
      // Apply mappings to meeting
      const result = await window.electronAPI.speakerMappingApplyToMeeting(
        currentMeetingId,
        currentMappings,
        { useWikiLinks: false }
      );

      if (result.success) {
        console.log('[SpeakerMapping] Mappings applied successfully');
        console.log('[SpeakerMapping] Updated meeting:', result.meeting);
        console.log('[SpeakerMapping] Updated transcript sample:', result.meeting?.transcript?.slice(0, 2));
        window.showToast(`Applied ${Object.keys(currentMappings).length} speaker mappings`, 'success');

        // Call completion callback and wait for it
        if (onComplete) {
          await onComplete(result.meeting);
        }

        closeModal();
      } else {
        console.error('[SpeakerMapping] Failed to apply mappings:', result.error);
        window.showToast(`Failed to apply mappings: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('[SpeakerMapping] Error applying mappings:', error);
      window.showToast('Error applying mappings', 'error');
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply Mappings';
    }
  };
}

/**
 * Get initials from a name
 */
function getInitials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Check if a meeting has cryptic speaker IDs that need mapping
 * @param {Array} transcript - The transcript array
 * @returns {Promise<boolean>} True if there are cryptic IDs
 */
export async function hasCrypticSpeakerIds(transcript) {
  if (!transcript || transcript.length === 0) return false;

  const result = await window.electronAPI.speakerMappingExtractIds(transcript);
  return result.success && result.speakerIds.length > 0;
}
