/**
 * Speaker Mapping Module (SM-2)
 * Handles the speaker mapping modal for mapping any speaker to contacts
 */

import { escapeHtml } from './security.js';

// Current state
let currentMeetingId = null;
let currentMappings = {};
let searchTimeouts = {};
let documentClickHandler = null; // Single delegated click handler
let mergeMode = false; // Whether merge selection mode is active
let selectedForMerge = new Set(); // Speakers selected for merging

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
  const profileSuggestions = result.success ? (result.profileSuggestions || {}) : {};
  console.log(`[SpeakerMapping] Extract IDs took ${(performance.now() - extractStart).toFixed(0)}ms, found ${speakerIds.length} IDs`);
  if (Object.keys(profileSuggestions).length > 0) {
    console.log(`[SpeakerMapping] Profile suggestions:`, profileSuggestions);
  }

  if (speakerIds.length === 0) {
    // No speakers found in transcript
    speakersList.style.display = 'none';
    noSpeakersMessage.style.display = 'flex';
    applyBtn.disabled = true;
    statsText.textContent = 'No speakers to map';
  } else {
    speakersList.style.display = 'flex';
    noSpeakersMessage.style.display = 'none';

    // Detect duplicate speakers
    const dupStart = performance.now();
    const dupResult = await window.electronAPI.speakerMappingDetectDuplicates(speakerIds);
    console.log(`[SpeakerMapping] Detect duplicates took ${(performance.now() - dupStart).toFixed(0)}ms`);
    console.log('[SpeakerMapping] Duplicates:', dupResult);

    // Apply auto-merges and filter speaker list
    let filteredSpeakerIds = [...speakerIds];
    const autoMergedMappings = {};

    if (dupResult.success && dupResult.autoMerge?.length > 0) {
      for (const merge of dupResult.autoMerge) {
        console.log(`[SpeakerMapping] Auto-merging "${merge.from}" → "${merge.to}"`);
        // Remove the "from" speaker from the list
        filteredSpeakerIds = filteredSpeakerIds.filter(id => id !== merge.from);
        // Add to auto-merged mappings (will be applied when user saves)
        autoMergedMappings[merge.from] = {
          contactName: merge.to,
          contactEmail: null,
          obsidianLink: `[[${merge.to}]]`,
          autoMerged: true,
          reason: merge.reason
        };
      }
      if (dupResult.autoMerge.length > 0) {
        window.showToast?.(`Auto-merged ${dupResult.autoMerge.length} duplicate speaker(s)`, 'info');
      }
    }

    // Store auto-merged mappings for later application
    window._autoMergedMappings = autoMergedMappings;

    // Store suggestions for merge UI
    window._duplicateSuggestions = dupResult.success ? dupResult.suggestions : [];

    // Get suggestions from known mappings
    const suggestStart = performance.now();
    const suggestionsResult = await window.electronAPI.speakerMappingGetSuggestions(filteredSpeakerIds);
    const storedSuggestions = suggestionsResult.success ? suggestionsResult.suggestions : {};
    console.log(`[SpeakerMapping] Get suggestions took ${(performance.now() - suggestStart).toFixed(0)}ms`);

    // Merge profile suggestions with stored suggestions (profile takes precedence for single speaker)
    const suggestions = { ...storedSuggestions };
    for (const [speakerId, profileSuggestion] of Object.entries(profileSuggestions)) {
      // Profile suggestion (single speaker = user) takes precedence
      suggestions[speakerId] = {
        ...profileSuggestion,
        isProfileSuggestion: true,
      };
    }

    // Render speaker mapping rows
    const renderStart = performance.now();
    await renderSpeakerRows(speakersList, filteredSpeakerIds, suggestions);
    console.log(`[SpeakerMapping] Render rows took ${(performance.now() - renderStart).toFixed(0)}ms`);

    // Render duplicate suggestions section if any
    if (window._duplicateSuggestions?.length > 0) {
      renderDuplicateSuggestions(speakersList, window._duplicateSuggestions);
    }

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
 * Render duplicate suggestions section
 */
function renderDuplicateSuggestions(container, suggestions) {
  if (!suggestions || suggestions.length === 0) return;

  const section = document.createElement('div');
  section.className = 'duplicate-suggestions-section';
  section.innerHTML = `
    <div class="duplicate-suggestions-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
      </svg>
      <span>Potential Duplicates (click to merge)</span>
    </div>
    <div class="duplicate-suggestions-list"></div>
  `;

  const list = section.querySelector('.duplicate-suggestions-list');

  for (const suggestion of suggestions) {
    const item = document.createElement('div');
    item.className = 'duplicate-suggestion-item';
    item.innerHTML = `
      <div class="duplicate-speakers">
        <span class="duplicate-speaker">${escapeHtml(suggestion.speakers[0])}</span>
        <span class="duplicate-separator">↔</span>
        <span class="duplicate-speaker">${escapeHtml(suggestion.speakers[1])}</span>
      </div>
      <div class="duplicate-reason">${escapeHtml(suggestion.reason)}</div>
      <div class="duplicate-actions">
        <button class="btn btn-sm merge-btn" data-merge-to="0" title="Keep ${escapeHtml(suggestion.speakers[0])}">
          Keep "${escapeHtml(suggestion.speakers[0])}"
        </button>
        <button class="btn btn-sm merge-btn" data-merge-to="1" title="Keep ${escapeHtml(suggestion.speakers[1])}">
          Keep "${escapeHtml(suggestion.speakers[1])}"
        </button>
      </div>
    `;

    // Set up merge button handlers
    const mergeBtns = item.querySelectorAll('.merge-btn');
    mergeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const keepIndex = parseInt(btn.dataset.mergeTo, 10);
        const keepSpeaker = suggestion.speakers[keepIndex];
        const mergeSpeaker = suggestion.speakers[1 - keepIndex];
        mergeSpeakers(mergeSpeaker, keepSpeaker, item);
      });
    });

    list.appendChild(item);
  }

  container.appendChild(section);
}

/**
 * Merge one speaker into another
 */
function mergeSpeakers(fromSpeaker, toSpeaker, suggestionItem) {
  console.log(`[SpeakerMapping] Merging "${fromSpeaker}" → "${toSpeaker}"`);

  // Add to current mappings
  currentMappings[fromSpeaker] = {
    contactName: toSpeaker,
    contactEmail: null,
    obsidianLink: `[[${toSpeaker}]]`,
    merged: true
  };

  // Remove the "from" speaker row from the list
  const fromRow = document.querySelector(`.speaker-mapping-row[data-speaker-id="${CSS.escape(fromSpeaker)}"]`);
  if (fromRow) {
    fromRow.remove();
  }

  // Mark suggestion as resolved
  suggestionItem.classList.add('resolved');
  suggestionItem.innerHTML = `
    <div class="duplicate-resolved">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#4caf50"/>
      </svg>
      <span>Merged "${escapeHtml(fromSpeaker)}" → "${escapeHtml(toSpeaker)}"</span>
    </div>
  `;

  // Update stats
  updateMappingStats();
  window.showToast?.(`Merged "${fromSpeaker}" → "${toSpeaker}"`, 'success');
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
    <div class="speaker-merge-checkbox">
      <input type="checkbox" class="merge-checkbox" data-speaker-id="${escapeHtml(speakerId)}" />
    </div>
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
        <div class="speaker-suggestion ${suggestion.isProfileSuggestion ? 'profile-suggestion' : ''}">
          <span class="speaker-suggestion-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              ${suggestion.isProfileSuggestion
                ? '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>'
                : '<path d="M12 2C6.48 2 2 6.48 2 12S6.48 22 12 22 22 17.52 22 12 17.52 2 12 2ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" fill="currentColor"/>'}
            </svg>
          </span>
          <span class="speaker-suggestion-text">${suggestion.isProfileSuggestion
            ? 'Single speaker auto-labeled as you (from profile)'
            : 'Auto-suggested from previous mapping'}</span>
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
  const checkbox = row.querySelector('.merge-checkbox');

  // Merge checkbox
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedForMerge.add(speakerId);
        row.classList.add('selected-for-merge');
      } else {
        selectedForMerge.delete(speakerId);
        row.classList.remove('selected-for-merge');
      }
      updateMergeConfirmButton();
    });
  }

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
 * Toggle merge selection mode
 */
function toggleMergeMode() {
  mergeMode = !mergeMode;
  selectedForMerge.clear();

  const mergeBtn = document.getElementById('mergeSpeakersBtn');
  const confirmMergeBtn = document.getElementById('confirmMergeBtn');
  const checkboxes = document.querySelectorAll('.speaker-merge-checkbox');
  const rows = document.querySelectorAll('.speaker-mapping-row');

  if (mergeMode) {
    // Enter merge mode
    mergeBtn.textContent = 'Cancel Merge';
    mergeBtn.classList.add('active');
    checkboxes.forEach(cb => cb.classList.add('visible'));
    confirmMergeBtn.style.display = 'inline-flex';
    confirmMergeBtn.disabled = true;
  } else {
    // Exit merge mode
    mergeBtn.textContent = 'Merge Speakers';
    mergeBtn.classList.remove('active');
    checkboxes.forEach(cb => {
      cb.classList.remove('visible');
      cb.querySelector('input').checked = false;
    });
    rows.forEach(r => r.classList.remove('selected-for-merge'));
    confirmMergeBtn.style.display = 'none';
  }
}

/**
 * Update confirm merge button state
 */
function updateMergeConfirmButton() {
  const confirmBtn = document.getElementById('confirmMergeBtn');
  if (confirmBtn) {
    confirmBtn.disabled = selectedForMerge.size < 2;
    confirmBtn.textContent = selectedForMerge.size >= 2
      ? `Merge ${selectedForMerge.size} Speakers`
      : 'Select 2+ Speakers';
  }
}

/**
 * Execute merge of selected speakers
 */
function confirmMergeSelected() {
  if (selectedForMerge.size < 2) return;

  const speakers = Array.from(selectedForMerge);

  // Sort by name length (longest first) to pick the most complete name as target
  speakers.sort((a, b) => b.length - a.length);

  const targetSpeaker = speakers[0]; // Keep the longest/most complete name
  const speakersToMerge = speakers.slice(1);

  console.log(`[SpeakerMapping] Merging ${speakersToMerge.join(', ')} → ${targetSpeaker}`);

  // Add mappings for all merged speakers
  for (const speaker of speakersToMerge) {
    currentMappings[speaker] = {
      contactName: targetSpeaker,
      contactEmail: null,
      obsidianLink: `[[${targetSpeaker}]]`,
      merged: true
    };

    // Remove the merged speaker's row
    const row = document.querySelector(`.speaker-mapping-row[data-speaker-id="${CSS.escape(speaker)}"]`);
    if (row) {
      row.remove();
    }
  }

  // Exit merge mode
  toggleMergeMode();

  // Update stats
  updateMappingStats();
  window.showToast?.(`Merged ${speakersToMerge.length} speaker(s) → "${targetSpeaker}"`, 'success');
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
  const mergeBtn = document.getElementById('mergeSpeakersBtn');
  const confirmMergeBtn = document.getElementById('confirmMergeBtn');

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
    // Reset merge mode
    mergeMode = false;
    selectedForMerge.clear();
    if (mergeBtn) {
      mergeBtn.textContent = 'Merge Speakers';
      mergeBtn.classList.remove('active');
    }
    if (confirmMergeBtn) {
      confirmMergeBtn.style.display = 'none';
    }
    // Clean up the delegated click handler
    if (documentClickHandler) {
      document.removeEventListener('click', documentClickHandler);
      documentClickHandler = null;
    }
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;

  // Merge mode buttons
  if (mergeBtn) {
    mergeBtn.onclick = toggleMergeMode;
  }
  if (confirmMergeBtn) {
    confirmMergeBtn.onclick = confirmMergeSelected;
  }

  // Click outside to close
  modal.onclick = e => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Apply mappings
  applyBtn.onclick = async () => {
    // Merge auto-merged mappings with user mappings
    const allMappings = {
      ...(window._autoMergedMappings || {}),
      ...currentMappings
    };

    if (Object.keys(allMappings).length === 0) {
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';

    try {
      // Apply mappings to meeting
      const result = await window.electronAPI.speakerMappingApplyToMeeting(
        currentMeetingId,
        allMappings,
        { useWikiLinks: false }
      );

      if (result.success) {
        console.log('[SpeakerMapping] Mappings applied successfully');
        console.log('[SpeakerMapping] Updated meeting:', result.meeting);
        console.log('[SpeakerMapping] Updated transcript sample:', result.meeting?.transcript?.slice(0, 2));
        window.showToast(`Applied ${Object.keys(allMappings).length} speaker mappings`, 'success');

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
