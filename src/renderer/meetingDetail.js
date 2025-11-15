/**
 * Meeting Detail View Module
 * Handles the modern meeting detail interface with tabs
 */

import { sanitizeHtml, escapeHtml, markdownToSafeHtml } from './security.js';

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

  currentMeeting = meeting;
  currentMeetingId = meetingId;

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

    utteranceDiv.innerHTML = `
      <div class="speaker-label">
        <span class="speaker-name">${escapeHtml(utterance.speaker || 'Unknown Speaker')}</span>
        <span class="timestamp">${escapeHtml(timestamp)}</span>
      </div>
      <div class="utterance-text">${escapeHtml(utterance.text)}</div>
    `;

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
function addParticipant(onUpdate) {
  if (!currentMeeting.participants) {
    currentMeeting.participants = [];
  }

  currentMeeting.participants.push({
    name: '',
    email: ''
  });

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
