/**
 * Meeting Detail View Module
 * Handles the modern meeting detail interface with tabs
 */

import { sanitizeHtml, escapeHtml, markdownToSafeHtml } from './security.js';
import { contactsService } from './services/contactsService.js';

// Current meeting being viewed
let currentMeeting = null;
let currentMeetingId = null;

// Tab state
let currentTab = 'summary';

/**
 * Initialize the meeting detail view
 * @param {string} meetingId - The ID of the meeting to display
 * @param {object} meeting - The meeting data object
 * @param {function} onBack - Callback when back button is clicked
 * @param {function} onUpdate - Callback when meeting data is updated
 */
export function initializeMeetingDetail(meetingId, meeting, onBack, onUpdate) {
  console.log(`[MeetingDetail] Initializing for meeting: ${meetingId}`);
  console.log('[MeetingDetail] Received meeting data:', {
    participantCount: meeting.participants?.length || 0,
    participants: meeting.participants,
    transcriptLength: meeting.transcript?.length || 0,
    firstSpeaker: meeting.transcript?.[0]?.speaker || 'N/A'
  });

  currentMeeting = meeting;
  currentMeetingId = meetingId;

  // Store update callback for speaker editing
  window._meetingDetailUpdateCallback = onUpdate;

  // Set up event listeners
  setupEventListeners(onBack, onUpdate);

  // Populate the view with meeting data
  populateMeetingInfo(meeting);
  populateParticipants(meeting);
  populateSummary(meeting);
  populateTranscript(meeting);
  populateTemplates(meeting);
  populateMetadata(meeting);

  // Switch to summary tab by default
  switchTab('summary');
}

/**
 * Set up all event listeners for the meeting detail view
 */
function setupEventListeners(onBack, onUpdate) {
  // Back button
  const backBtn = document.getElementById('backToListBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      console.log('[MeetingDetail] Back button clicked');
      currentMeeting = null;
      currentMeetingId = null;
      if (onBack) onBack();
    };
  }

  // Tab headers
  const tabHeaders = document.querySelectorAll('.tab-header');
  tabHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const tabName = header.dataset.tab;
      switchTab(tabName);
    });
  });

  // Edit title button
  const editTitleBtn = document.getElementById('editMeetingTitleBtn');
  if (editTitleBtn) {
    editTitleBtn.onclick = () => editMeetingTitle(onUpdate);
  }

  // Transcript search
  const searchBtn = document.getElementById('transcriptSearchBtn');
  const searchInput = document.getElementById('transcriptSearch');
  if (searchBtn && searchInput) {
    searchBtn.onclick = () => searchTranscript(searchInput.value);
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        searchTranscript(searchInput.value);
      }
    });
  }

  // Generate templates button
  const generateTemplatesBtn = document.getElementById('generateTemplatesBtn');
  if (generateTemplatesBtn) {
    generateTemplatesBtn.onclick = () => generateTemplates(onUpdate);
  }

  // Save vault path button
  const saveVaultPathBtn = document.getElementById('saveVaultPathBtn');
  if (saveVaultPathBtn) {
    saveVaultPathBtn.onclick = () => saveVaultPath(onUpdate);
  }

  // Add participant button
  const addParticipantBtn = document.getElementById('addParticipantBtn');
  if (addParticipantBtn) {
    addParticipantBtn.onclick = () => addParticipant(onUpdate);
  }

  // Export to Obsidian button
  const exportBtn = document.getElementById('exportToObsidianBtn');
  if (exportBtn) {
    exportBtn.onclick = () => exportToObsidian();
  }

  // Regenerate summary button
  const regenerateBtn = document.getElementById('regenerateSummaryBtn');
  if (regenerateBtn) {
    regenerateBtn.onclick = () => regenerateSummary(onUpdate);
  }
}

/**
 * Switch to a different tab
 */
function switchTab(tabName) {
  console.log(`[MeetingDetail] Switching to tab: ${tabName}`);
  currentTab = tabName;

  // Update tab headers
  const tabHeaders = document.querySelectorAll('.tab-header');
  tabHeaders.forEach(header => {
    if (header.dataset.tab === tabName) {
      header.classList.add('active');
    } else {
      header.classList.remove('active');
    }
  });

  // Update tab content
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    content.classList.remove('active');
  });

  const activeContent = document.getElementById(`${tabName}Tab`);
  if (activeContent) {
    activeContent.classList.add('active');
  }
}

/**
 * Populate meeting info card
 */
function populateMeetingInfo(meeting) {
  // Title
  const titleEl = document.getElementById('meetingDetailTitle');
  if (titleEl) {
    titleEl.textContent = meeting.title || 'Untitled Meeting';
  }

  // Date + Time + Duration
  const dateTimeEl = document.getElementById('meetingDetailDateTime');
  if (dateTimeEl) {
    const dateObj = new Date(meeting.date);
    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    const dateStr = dateObj.toLocaleDateString('en-US', dateOptions);
    const timeStr = dateObj.toLocaleTimeString('en-US', timeOptions);

    let durationStr = '';
    if (meeting.duration) {
      const minutes = Math.round(meeting.duration / 60);
      durationStr = ` (${minutes} min)`;
    }

    dateTimeEl.textContent = `${dateStr} ${timeStr}${durationStr}`;
  }

  // Participant count
  const countEl = document.getElementById('meetingDetailParticipantCount');
  if (countEl) {
    const count = meeting.participants ? meeting.participants.length : 0;
    countEl.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
  }

  // Obsidian sync status
  const obsidianStatusEl = document.getElementById('meetingDetailObsidianStatus');
  const obsidianStatusTextEl = document.getElementById('meetingDetailObsidianStatusText');
  if (obsidianStatusEl && obsidianStatusTextEl) {
    if (meeting.obsidianLink || meeting.vaultPath) {
      obsidianStatusTextEl.textContent = 'Synced';
      obsidianStatusEl.style.color = '#4caf50'; // Green for synced
    } else {
      obsidianStatusTextEl.textContent = 'Not synced';
      obsidianStatusEl.style.color = 'var(--text-secondary)'; // Gray for not synced
    }
  }

  // Vault path
  const pathEl = document.getElementById('meetingDetailVaultPath');
  if (pathEl) {
    pathEl.textContent = meeting.vaultPath || meeting.obsidianLink || 'Not saved to vault';
  }
}

/**
 * Populate participants card
 */
function populateParticipants(meeting) {
  const participantsList = document.getElementById('meetingDetailParticipants');
  if (!participantsList) return;

  if (!meeting.participants || meeting.participants.length === 0) {
    participantsList.innerHTML = `
      <div class="placeholder-content">
        <p>No participants detected</p>
      </div>
    `;
    return;
  }

  participantsList.innerHTML = '';

  meeting.participants.forEach(participant => {
    const participantItem = document.createElement('div');
    participantItem.className = 'participant-item';

    // Create initials for avatar
    const name = participant.name || participant.email || 'Unknown';
    const initials = getInitials(name);

    participantItem.innerHTML = `
      <div class="participant-avatar">${escapeHtml(initials)}</div>
      <div class="participant-info">
        <div class="participant-name">${escapeHtml(name)}</div>
        ${participant.email ? `<div class="participant-email">${escapeHtml(participant.email)}</div>` : ''}
      </div>
    `;

    participantsList.appendChild(participantItem);
  });
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
 * Populate summary tab - Shows the auto-generated summary from meeting.content
 */
function populateSummary(meeting) {
  const summaryContent = document.getElementById('meetingDetailSummary');
  if (!summaryContent) return;

  console.log('[MeetingDetail] populateSummary called for meeting:', meeting.id);
  console.log('[MeetingDetail] meeting.content exists?', !!meeting.content);

  // The auto-summary is stored in meeting.content (not meeting.summaries)
  if (!meeting.content) {
    console.log('[MeetingDetail] No summary found - showing placeholder');
    summaryContent.innerHTML = `
      <div class="placeholder-content">
        <p>No summary available yet</p>
        <button class="btn-primary" onclick="document.getElementById('regenerateSummaryBtn').click()">
          Generate Summary
        </button>
      </div>
    `;
    return;
  }

  // Display the auto-summary content directly
  summaryContent.innerHTML = markdownToSafeHtml(meeting.content);
}

/**
 * Populate transcript tab
 */
function populateTranscript(meeting) {
  const transcriptContent = document.getElementById('meetingDetailTranscript');
  if (!transcriptContent) return;

  if (!meeting.transcript || meeting.transcript.length === 0) {
    transcriptContent.innerHTML = `
      <div class="placeholder-content">
        <p>No transcript available yet</p>
      </div>
    `;
    return;
  }

  transcriptContent.innerHTML = '';

  meeting.transcript.forEach((utterance, index) => {
    const utteranceDiv = document.createElement('div');
    utteranceDiv.className = 'transcript-utterance';
    utteranceDiv.dataset.index = index;

    // Format timestamp
    const timestamp = formatTimestamp(utterance.start);

    const speakerName = utterance.speaker || 'Unknown Speaker';
    const speakerId = `speaker-${index}`;

    utteranceDiv.innerHTML = `
      <div class="speaker-label">
        <span class="speaker-name editable-speaker" id="${speakerId}" data-index="${index}" title="Click to edit speaker">
          ${escapeHtml(speakerName)}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="edit-icon">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
          </svg>
        </span>
        <span class="timestamp">${escapeHtml(timestamp)}</span>
      </div>
      <div class="utterance-text">${escapeHtml(utterance.text)}</div>
    `;

    // Add click handler for speaker editing
    const speakerNameEl = utteranceDiv.querySelector('.editable-speaker');
    speakerNameEl.addEventListener('click', () => {
      showSpeakerEditor(index, speakerName, speakerNameEl);
    });

    transcriptContent.appendChild(utteranceDiv);
  });
}

/**
 * Format timestamp from seconds to HH:MM:SS or MM:SS
 */
function formatTimestamp(seconds) {
  if (!seconds && seconds !== 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Search transcript for keywords
 */
function searchTranscript(query) {
  if (!query || !currentMeeting || !currentMeeting.transcript) {
    return;
  }

  const transcriptContent = document.getElementById('meetingDetailTranscript');
  if (!transcriptContent) return;

  const utterances = transcriptContent.querySelectorAll('.transcript-utterance');
  const lowerQuery = query.toLowerCase();
  let matchCount = 0;

  utterances.forEach(utterance => {
    const text = utterance.querySelector('.utterance-text').textContent;
    if (text.toLowerCase().includes(lowerQuery)) {
      utterance.style.display = 'block';
      utterance.classList.add('search-match');
      matchCount++;
    } else {
      utterance.style.display = 'none';
      utterance.classList.remove('search-match');
    }
  });

  console.log(`[MeetingDetail] Found ${matchCount} matches for "${query}"`);

  // Clear search to show all results
  if (query === '') {
    utterances.forEach(utterance => {
      utterance.style.display = 'block';
      utterance.classList.remove('search-match');
    });
  }
}

/**
 * Populate templates tab
 */
function populateTemplates(meeting) {
  const templatesList = document.getElementById('generatedTemplatesList');
  if (!templatesList) return;

  if (!meeting.summaries || meeting.summaries.length === 0) {
    templatesList.innerHTML = `
      <div class="placeholder-content">
        <p>No template summaries generated yet</p>
      </div>
    `;
    return;
  }

  // Filter out auto-summary, show only template summaries
  const templateSummaries = meeting.summaries.filter(s => s.templateId !== 'auto-summary-prompt');

  if (templateSummaries.length === 0) {
    templatesList.innerHTML = `
      <div class="placeholder-content">
        <p>No template summaries generated yet</p>
      </div>
    `;
    return;
  }

  templatesList.innerHTML = '';

  templateSummaries.forEach(summary => {
    const card = document.createElement('div');
    card.className = 'template-summary-card';

    card.innerHTML = `
      <h4 class="template-summary-title">${escapeHtml(summary.templateName || summary.templateId || 'Untitled')}</h4>
      <div class="template-summary-content">${markdownToSafeHtml(summary.content || '')}</div>
    `;

    templatesList.appendChild(card);
  });
}

/**
 * Populate metadata tab
 */
function populateMetadata(meeting) {
  // Meeting ID
  const meetingIdEl = document.getElementById('metadataMeetingId');
  if (meetingIdEl) {
    meetingIdEl.value = meeting.id || '';
  }

  // Recording ID
  const recordingIdEl = document.getElementById('metadataRecordingId');
  if (recordingIdEl) {
    recordingIdEl.value = meeting.recordingId || 'N/A';
  }

  // Created date
  const createdEl = document.getElementById('metadataCreated');
  if (createdEl) {
    const dateObj = new Date(meeting.createdAt || meeting.date);
    createdEl.value = dateObj.toLocaleString();
  }

  // Vault path (editable)
  const vaultPathEl = document.getElementById('metadataVaultPath');
  if (vaultPathEl) {
    vaultPathEl.value = meeting.vaultPath || '';
  }

  // Participants editor
  populateParticipantsEditor(meeting);
}

/**
 * Populate participants editor in metadata tab
 */
function populateParticipantsEditor(meeting) {
  const participantsEditor = document.getElementById('participantsEditor');
  if (!participantsEditor) return;

  participantsEditor.innerHTML = '';

  if (!meeting.participants || meeting.participants.length === 0) {
    participantsEditor.innerHTML = `
      <div class="placeholder-content">
        <p>No participants to edit</p>
      </div>
    `;
    return;
  }

  meeting.participants.forEach((participant, index) => {
    const row = document.createElement('div');
    row.className = 'participant-editor-row';

    row.innerHTML = `
      <input
        type="text"
        class="participant-name-input"
        data-index="${index}"
        value="${escapeHtml(participant.name || '')}"
        placeholder="Name"
      />
      <input
        type="email"
        class="participant-email-input"
        data-index="${index}"
        value="${escapeHtml(participant.email || '')}"
        placeholder="Email"
      />
      <button class="icon-btn remove-participant-btn" data-index="${index}" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
        </svg>
      </button>
    `;

    participantsEditor.appendChild(row);
  });

  // Add event listeners to remove buttons
  const removeButtons = participantsEditor.querySelectorAll('.remove-participant-btn');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      removeParticipant(index);
    });
  });
}

/**
 * Edit meeting title
 */
function editMeetingTitle(onUpdate) {
  const titleEl = document.getElementById('meetingDetailTitle');
  if (!titleEl) return;

  const currentTitle = titleEl.textContent;

  // Create an input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.className = 'meeting-title-edit-input';

  // Replace title with input
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  // Handle save
  const save = () => {
    const newTitle = input.value.trim() || 'Untitled Meeting';
    currentMeeting.title = newTitle;

    // Restore the title element
    input.replaceWith(titleEl);
    titleEl.textContent = newTitle;

    // Notify update
    if (onUpdate) {
      onUpdate(currentMeetingId, currentMeeting);
    }

    console.log(`[MeetingDetail] Title updated to: ${newTitle}`);
  };

  // Save on blur or enter key
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      save();
    } else if (e.key === 'Escape') {
      input.replaceWith(titleEl);
    }
  });
}

/**
 * Generate templates for the meeting
 */
async function generateTemplates(onUpdate) {
  if (!currentMeetingId) return;

  const btn = document.getElementById('generateTemplatesBtn');
  if (!btn) return;

  // Disable button and show loading state
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Generating...';

  try {
    console.log(`[MeetingDetail] Generating templates for meeting: ${currentMeetingId}`);

    // Get all available templates
    const templates = await window.electronAPI.templatesGetAll();

    if (!templates || templates.length === 0) {
      alert('No templates available. Please add templates in Settings > Templates.');
      return;
    }

    // Get template IDs (excluding auto-summary if present)
    const templateIds = templates
      .filter(t => t.id !== 'auto-summary')
      .map(t => t.id);

    if (templateIds.length === 0) {
      alert('No custom templates found. Only auto-summary is available.');
      return;
    }

    // Generate summaries for all templates
    const result = await window.electronAPI.templatesGenerateSummaries(
      currentMeetingId,
      templateIds
    );

    if (result.success) {
      console.log(`[MeetingDetail] Templates generated successfully`);

      // Update the meeting object with new summaries
      if (result.data && result.data.summaries) {
        currentMeeting.summaries = result.data.summaries;
        populateTemplates(currentMeeting);
      }

      // Notify update
      if (onUpdate) {
        onUpdate(currentMeetingId, currentMeeting);
      }
    } else {
      console.error('[MeetingDetail] Failed to generate templates:', result.error);
      alert(`Failed to generate templates: ${result.error}`);
    }
  } catch (error) {
    console.error('[MeetingDetail] Error generating templates:', error);
    alert(`Error generating templates: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Save vault path
 */
function saveVaultPath(onUpdate) {
  const vaultPathEl = document.getElementById('metadataVaultPath');
  if (!vaultPathEl) return;

  const newPath = vaultPathEl.value.trim();
  currentMeeting.vaultPath = newPath;

  // Update the info card display
  const pathDisplayEl = document.getElementById('meetingDetailVaultPath');
  if (pathDisplayEl) {
    pathDisplayEl.textContent = newPath || 'Not saved to vault';
  }

  // Notify update
  if (onUpdate) {
    onUpdate(currentMeetingId, currentMeeting);
  }

  console.log(`[MeetingDetail] Vault path updated to: ${newPath}`);
}

/**
 * Add a new participant
 */
/**
 * Add a participant with contact search
 */
async function addParticipant(onUpdate) {
  if (!currentMeeting.participants) {
    currentMeeting.participants = [];
  }

  // Show contact search modal
  showContactSearchModal((selectedContact) => {
    // Check for duplicates by email
    const isDuplicate = currentMeeting.participants.some(p =>
      p.email && selectedContact.email &&
      p.email.toLowerCase() === selectedContact.email.toLowerCase()
    );

    if (isDuplicate) {
      // Auto-replace duplicate participant
      const index = currentMeeting.participants.findIndex(p =>
        p.email && selectedContact.email &&
        p.email.toLowerCase() === selectedContact.email.toLowerCase()
      );

      currentMeeting.participants[index] = {
        name: selectedContact.name,
        email: selectedContact.email
      };

      window.showToast(`Updated existing participant: ${selectedContact.name}`, 'info');
    } else {
      // Add new participant
      currentMeeting.participants.push({
        name: selectedContact.name,
        email: selectedContact.email
      });

      window.showToast(`Added participant: ${selectedContact.name}`, 'success');
    }

    // Re-populate the editors
    populateParticipantsEditor(currentMeeting);
    populateParticipants(currentMeeting);

    // Update participant count
    const countEl = document.getElementById('meetingDetailParticipantCount');
    if (countEl) {
      const count = currentMeeting.participants.length;
      countEl.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
    }

    // Notify update
    if (onUpdate) {
      onUpdate(currentMeetingId, currentMeeting);
    }
  });
}

/**
 * Show contact search modal for adding participants
 */
function showContactSearchModal(onSelect) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'contact-search-modal-overlay';

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'contact-search-modal';

  modal.innerHTML = `
    <div class="contact-search-modal-header">
      <h3>Add Participant</h3>
      <button class="close-modal-btn" title="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="contact-search-modal-body">
      <div class="contact-search-input-container">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" fill="#666666"/>
        </svg>
        <input type="text" class="contact-search-input" placeholder="Search contacts by name or email..." autofocus />
      </div>
      <div class="contact-search-results" id="contactSearchResults">
        <div class="search-hint">Start typing to search contacts</div>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const searchInput = modal.querySelector('.contact-search-input');
  const resultsContainer = modal.querySelector('.contact-search-results');
  const closeBtn = modal.querySelector('.close-modal-btn');

  // Close modal function
  const closeModal = () => {
    overlay.remove();
  };

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Close button
  closeBtn.addEventListener('click', closeModal);

  // Escape key to close
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Search contacts as user types
  let searchTimeout;
  searchInput.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (!query) {
      resultsContainer.innerHTML = '<div class="search-hint">Start typing to search contacts</div>';
      return;
    }

    // Show loading state
    resultsContainer.innerHTML = '<div class="search-hint">Searching...</div>';

    searchTimeout = setTimeout(async () => {
      try {
        const contacts = await contactsService.search(query);

        if (contacts.length === 0) {
          resultsContainer.innerHTML = '<div class="search-hint">No contacts found</div>';
          return;
        }

        // Render contact results
        resultsContainer.innerHTML = '';
        contacts.forEach(contact => {
          const contactItem = document.createElement('div');
          contactItem.className = 'contact-search-result-item';

          const initials = contact.initials || contact.name.charAt(0).toUpperCase();

          contactItem.innerHTML = `
            <div class="contact-avatar">${escapeHtml(initials)}</div>
            <div class="contact-info">
              <div class="contact-name">${escapeHtml(contact.name)}</div>
              <div class="contact-email">${escapeHtml(contact.email)}</div>
            </div>
          `;

          contactItem.addEventListener('click', () => {
            onSelect(contact);
            closeModal();
          });

          resultsContainer.appendChild(contactItem);
        });
      } catch (error) {
        console.error('Error searching contacts:', error);
        resultsContainer.innerHTML = '<div class="search-hint error">Error searching contacts</div>';
      }
    }, 300); // Debounce search
  });

  // Focus search input
  searchInput.focus();
}

/**
 * Remove a participant
 */
function removeParticipant(index) {
  if (!currentMeeting.participants || index < 0 || index >= currentMeeting.participants.length) {
    return;
  }

  currentMeeting.participants.splice(index, 1);

  // Re-populate the editors
  populateParticipantsEditor(currentMeeting);
  populateParticipants(currentMeeting);

  // Update participant count
  const countEl = document.getElementById('meetingDetailParticipantCount');
  if (countEl) {
    const count = currentMeeting.participants.length;
    countEl.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
  }

  console.log(`[MeetingDetail] Removed participant at index ${index}`);
}

/**
 * Export meeting to Obsidian
 */
async function exportToObsidian() {
  if (!currentMeetingId) return;

  const btn = document.getElementById('exportToObsidianBtn');
  if (!btn) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Exporting...';

  try {
    console.log(`[MeetingDetail] Exporting meeting to Obsidian: ${currentMeetingId}`);

    const result = await window.electronAPI.obsidianExportMeeting(currentMeetingId);

    if (result.success) {
      console.log('[MeetingDetail] Export successful');
      alert('Meeting exported to Obsidian successfully!');

      // Update vault path if returned
      if (result.data && result.data.vaultPath) {
        currentMeeting.vaultPath = result.data.vaultPath;

        // Update displays
        const pathDisplayEl = document.getElementById('meetingDetailVaultPath');
        if (pathDisplayEl) {
          pathDisplayEl.textContent = result.data.vaultPath;
        }

        const vaultPathEl = document.getElementById('metadataVaultPath');
        if (vaultPathEl) {
          vaultPathEl.value = result.data.vaultPath;
        }
      }
    } else {
      console.error('[MeetingDetail] Export failed:', result.error);
      alert(`Failed to export to Obsidian: ${result.error}`);
    }
  } catch (error) {
    console.error('[MeetingDetail] Error exporting to Obsidian:', error);
    alert(`Error exporting to Obsidian: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Regenerate summary for the meeting
 */
async function regenerateSummary(onUpdate) {
  if (!currentMeetingId) return;

  const btn = document.getElementById('regenerateSummaryBtn');
  if (!btn) return;

  if (!confirm('Regenerate the auto-summary for this meeting? This will replace the existing summary.')) {
    return;
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Regenerating...';

  try {
    console.log(`[MeetingDetail] Regenerating summary for meeting: ${currentMeetingId}`);

    const result = await window.electronAPI.generateMeetingSummary(currentMeetingId);

    if (result.success) {
      console.log('[MeetingDetail] Summary regenerated successfully');

      // Update the meeting object with new summary
      if (result.data && result.data.summaries) {
        currentMeeting.summaries = result.data.summaries;
        populateSummary(currentMeeting);
      }

      // Notify update
      if (onUpdate) {
        onUpdate(currentMeetingId, currentMeeting);
      }
    } else {
      console.error('[MeetingDetail] Failed to regenerate summary:', result.error);
      alert(`Failed to regenerate summary: ${result.error}`);
    }
  } catch (error) {
    console.error('[MeetingDetail] Error regenerating summary:', error);
    alert(`Error regenerating summary: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * Show speaker editor with contact search
 */
async function showSpeakerEditor(utteranceIndex, currentSpeaker, speakerElement) {
  // Close any existing editor
  closeSpeakerEditor();

  console.log(`[MeetingDetail] Opening speaker editor for utterance ${utteranceIndex}`);

  // Create editor UI
  const editorDiv = document.createElement('div');
  editorDiv.className = 'speaker-editor-dropdown';
  editorDiv.id = 'speakerEditorDropdown';

  editorDiv.innerHTML = `
    <div class="speaker-editor-header">
      <input
        type="text"
        class="speaker-search-input"
        id="speakerSearchInput"
        placeholder="Search contacts or type name..."
        value="${escapeHtml(currentSpeaker)}"
      />
      <button class="icon-btn close-speaker-editor" id="closeSpeakerEditor" title="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="speaker-search-results" id="speakerSearchResults">
      <div class="search-hint">Start typing to search contacts...</div>
    </div>
    <div class="speaker-editor-actions">
      <button class="btn-secondary btn-small" id="cancelSpeakerEdit">Cancel</button>
      <button class="btn-primary btn-small" id="saveSpeakerEdit">Save</button>
    </div>
  `;

  // Position dropdown below the speaker element
  speakerElement.appendChild(editorDiv);
  speakerElement.classList.add('editing');

  // Store the current editing context
  window._speakerEditContext = {
    utteranceIndex,
    currentSpeaker,
    speakerElement,
  };

  // Focus the search input
  const searchInput = document.getElementById('speakerSearchInput');
  searchInput.focus();
  searchInput.select();

  // Set up event listeners
  setupSpeakerEditorListeners();
}

/**
 * Set up event listeners for speaker editor
 */
function setupSpeakerEditorListeners() {
  const searchInput = document.getElementById('speakerSearchInput');
  const saveBtn = document.getElementById('saveSpeakerEdit');
  const cancelBtn = document.getElementById('cancelSpeakerEdit');
  const closeBtn = document.getElementById('closeSpeakerEditor');
  const resultsDiv = document.getElementById('speakerSearchResults');

  let searchTimeout = null;

  // Search as user types
  searchInput.addEventListener('input', e => {
    const query = e.target.value.trim();

    // Debounce search
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (query.length < 2) {
      resultsDiv.innerHTML = '<div class="search-hint">Type at least 2 characters to search...</div>';
      return;
    }

    resultsDiv.innerHTML = '<div class="search-hint">Searching...</div>';

    searchTimeout = setTimeout(async () => {
      try {
        const result = await window.electronAPI.contactsSearchContacts(query);

        if (result.success && result.contacts.length > 0) {
          renderContactResults(result.contacts, resultsDiv, searchInput);
        } else {
          resultsDiv.innerHTML = '<div class="search-hint">No contacts found. You can still type a custom name.</div>';
        }
      } catch (error) {
        console.error('[MeetingDetail] Contact search error:', error);
        resultsDiv.innerHTML = '<div class="search-hint error">Search failed. You can still type a custom name.</div>';
      }
    }, 300);
  });

  // Save button
  saveBtn.addEventListener('click', async () => {
    await saveSpeakerEdit(searchInput.value.trim());
  });

  // Cancel/close buttons
  cancelBtn.addEventListener('click', closeSpeakerEditor);
  closeBtn.addEventListener('click', closeSpeakerEditor);

  // Save on Enter
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await saveSpeakerEdit(searchInput.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpeakerEditor();
    }
  });

  // Close on click outside
  document.addEventListener('click', handleClickOutside);
}

/**
 * Render contact search results
 */
function renderContactResults(contacts, resultsDiv, searchInput) {
  resultsDiv.innerHTML = '';

  contacts.forEach(contact => {
    const contactDiv = document.createElement('div');
    contactDiv.className = 'contact-result-item';

    const initials = getInitials(contact.name || '?');
    const email = contact.emails && contact.emails.length > 0 ? contact.emails[0] : '';

    contactDiv.innerHTML = `
      <div class="contact-avatar">${escapeHtml(initials)}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(contact.name || 'Unknown')}</div>
        ${email ? `<div class="contact-email">${escapeHtml(email)}</div>` : ''}
      </div>
    `;

    contactDiv.addEventListener('click', async () => {
      searchInput.value = contact.name || email;
      await saveSpeakerEdit(contact.name || email, contact); // Pass contact object for auto-add
    });

    resultsDiv.appendChild(contactDiv);
  });
}

/**
 * Handle click outside speaker editor
 */
function handleClickOutside(e) {
  const editorDropdown = document.getElementById('speakerEditorDropdown');
  if (!editorDropdown) return;

  const context = window._speakerEditContext;
  if (!context) return;

  // Check if click is outside both the editor and the speaker element
  if (!editorDropdown.contains(e.target) && !context.speakerElement.contains(e.target)) {
    closeSpeakerEditor();
  }
}

/**
 * Save speaker edit
 * @param {string} newSpeakerName - The new speaker name
 * @param {object} contact - Optional contact object from Google Contacts (for auto-add participant)
 */
async function saveSpeakerEdit(newSpeakerName, contact = null) {
  const context = window._speakerEditContext;
  if (!context || !currentMeeting) return;

  if (!newSpeakerName || newSpeakerName === context.currentSpeaker) {
    closeSpeakerEditor();
    return;
  }

  console.log(`[MeetingDetail] Updating speaker at index ${context.utteranceIndex} to: ${newSpeakerName}`);

  // Update the transcript in memory
  if (currentMeeting.transcript && currentMeeting.transcript[context.utteranceIndex]) {
    currentMeeting.transcript[context.utteranceIndex].speaker = newSpeakerName;

    // Update the UI
    const speakerNameSpan = context.speakerElement.querySelector('.speaker-name') || context.speakerElement;
    const editIcon = speakerNameSpan.querySelector('.edit-icon');
    speakerNameSpan.textContent = newSpeakerName;
    if (editIcon) {
      speakerNameSpan.appendChild(editIcon);
    }

    // Auto-add participant if contact was selected (Phase 10.6)
    if (contact) {
      // Extract email - contact might have 'email' (string) or 'emails' (array)
      const contactEmail = contact.email || (contact.emails && contact.emails.length > 0 ? contact.emails[0] : null);

      if (contactEmail) {
        if (!currentMeeting.participants) {
          currentMeeting.participants = [];
        }

        // Check if participant already exists
        const existingParticipant = currentMeeting.participants.find(p =>
          p.email && contactEmail &&
          p.email.toLowerCase() === contactEmail.toLowerCase()
        );

        if (!existingParticipant) {
          // Add new participant
          currentMeeting.participants.push({
            name: contact.name,
            email: contactEmail
          });

          // Re-populate the editors to show new participant
          populateParticipantsEditor(currentMeeting);
          populateParticipants(currentMeeting);

          // Update participant count
          const countEl = document.getElementById('meetingDetailParticipantCount');
          if (countEl) {
            const count = currentMeeting.participants.length;
            countEl.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
          }

          console.log(`[MeetingDetail] Auto-added participant: ${contact.name} (${contactEmail})`);
          window.showToast(`Added participant: ${contact.name}`, 'success');
        } else {
          console.log(`[MeetingDetail] Participant already exists: ${contact.name}`);
        }
      }
    }

    // Trigger update callback to save changes
    if (window._meetingDetailUpdateCallback) {
      console.log('[MeetingDetail] Calling update callback with:', {
        meetingId: currentMeetingId,
        participantCount: currentMeeting.participants?.length || 0,
        transcriptUpdated: true
      });
      await window._meetingDetailUpdateCallback(currentMeetingId, currentMeeting);
      console.log('[MeetingDetail] Update callback completed');
    } else {
      console.warn('[MeetingDetail] Update callback not found!');
    }

    console.log('[MeetingDetail] Speaker updated successfully');
  }

  closeSpeakerEditor();
}

/**
 * Close speaker editor
 */
function closeSpeakerEditor() {
  const editorDropdown = document.getElementById('speakerEditorDropdown');
  if (editorDropdown) {
    editorDropdown.remove();
  }

  // Remove editing class from speaker element
  if (window._speakerEditContext && window._speakerEditContext.speakerElement) {
    window._speakerEditContext.speakerElement.classList.remove('editing');
  }

  // Remove click outside listener
  document.removeEventListener('click', handleClickOutside);

  // Clear context
  window._speakerEditContext = null;
}

/**
 * Update the meeting detail view with fresh data
 * (Call this when meeting data changes externally)
 */
export function updateMeetingDetail(meeting) {
  if (!meeting || meeting.id !== currentMeetingId) {
    console.warn('[MeetingDetail] Attempted to update with non-current meeting');
    return;
  }

  currentMeeting = meeting;

  populateMeetingInfo(meeting);
  populateParticipants(meeting);
  populateSummary(meeting);
  populateTranscript(meeting);
  populateTemplates(meeting);
  populateMetadata(meeting);

  console.log('[MeetingDetail] View updated with fresh data');
}

/**
 * Get the currently active meeting ID
 */
export function getCurrentMeetingId() {
  return currentMeetingId;
}

/**
 * Clear the meeting detail view
 */
export function clearMeetingDetail() {
  currentMeeting = null;
  currentMeetingId = null;
  currentTab = 'summary';
  console.log('[MeetingDetail] Cleared');
}
