/**
 * Meeting Detail View Module
 * Handles the modern meeting detail interface with tabs
 */

import { escapeHtml, markdownToSafeHtml } from './security.js';
import { contactsService } from './services/contactsService.js';
import { withButtonLoadingElement } from './utils/buttonHelper.js';
import { initializeTabs } from './utils/tabHelper.js';
import { openSpeakerMappingModal } from './speakerMapping.js';

// Current meeting being viewed
let currentMeeting = null;
let currentMeetingId = null;

// Platform display configuration
const PLATFORM_NAMES = {
  zoom: 'Zoom',
  teams: 'Teams',
  'google-meet': 'Google Meet',
  webex: 'Webex',
  whereby: 'Whereby',
  'in-person': 'In-Person',
  unknown: 'Meeting',
};

const PLATFORM_COLORS = {
  zoom: '#2D8CFF',
  teams: '#6264A7',
  'google-meet': '#0F9D58',
  webex: '#00BCEB',
  whereby: '#6366F1',
  'in-person': '#8B5CF6',
  unknown: '#999999',
};

/**
 * Calculate speaker statistics from a transcript
 * Returns a map of speaker name -> { talkTimePercent, wordCount, sampleQuote }
 * @param {Array} transcript - The transcript array
 * @returns {Object} Map of speaker name to stats
 */
function calculateSpeakerStatsFromTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return {};
  }

  const speakerWordCounts = {};
  const speakerFirstQuotes = {};
  let totalWords = 0;

  for (const utterance of transcript) {
    // Get speaker name (prefer speakerName, fall back to speaker)
    const speakerName = utterance.speakerName || utterance.speaker;
    const text = utterance.text || '';

    if (!speakerName || !text) continue;

    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    totalWords += wordCount;

    // Accumulate word count (normalize speaker name for matching)
    const normalizedName = speakerName.toLowerCase().trim();
    speakerWordCounts[normalizedName] = (speakerWordCounts[normalizedName] || 0) + wordCount;

    // Capture first meaningful quote
    if (!speakerFirstQuotes[normalizedName] && text.trim().length >= 10) {
      let quote = text.trim();
      if (quote.length > 60) {
        quote = quote.substring(0, 57) + '...';
      }
      speakerFirstQuotes[normalizedName] = quote;
    }
  }

  // Build stats object
  const stats = {};
  for (const [normalizedName, wordCount] of Object.entries(speakerWordCounts)) {
    const talkTimePercent = totalWords > 0 ? Math.round((wordCount / totalWords) * 100) : 0;
    stats[normalizedName] = {
      talkTimePercent,
      wordCount,
      sampleQuote: speakerFirstQuotes[normalizedName] || '',
    };
  }

  return stats;
}

/**
 * Find speaker stats for a participant by matching names
 * @param {Object} participant - The participant object
 * @param {Object} speakerStats - Map of normalized speaker names to stats
 * @returns {Object|null} Stats if found, null otherwise
 */
function findParticipantSpeakerStats(participant, speakerStats) {
  const participantName = (participant.name || participant.email || '').toLowerCase().trim();
  if (!participantName) return null;

  // Direct match
  if (speakerStats[participantName]) {
    return speakerStats[participantName];
  }

  // Try matching first name only
  const firstName = participantName.split(/\s+/)[0];
  for (const [speakerName, stats] of Object.entries(speakerStats)) {
    if (speakerName === firstName || speakerName.startsWith(firstName + ' ')) {
      return stats;
    }
  }

  // Try matching if speaker name contains participant's first name
  for (const [speakerName, stats] of Object.entries(speakerStats)) {
    const speakerFirst = speakerName.split(/\s+/)[0];
    if (speakerFirst === firstName) {
      return stats;
    }
  }

  return null;
}

/**
 * Update the platform display in the meeting header (UI-1)
 * @param {object} meeting - The meeting data object
 */
function updatePlatformDisplay(meeting) {
  const platformEl = document.getElementById('meetingDetailPlatform');
  const platformTextEl = document.getElementById('meetingDetailPlatformText');
  if (platformEl && platformTextEl) {
    // Normalize platform to lowercase for matching
    const platform = (meeting.platform || 'unknown').toLowerCase();
    const platformName = PLATFORM_NAMES[platform] || PLATFORM_NAMES.unknown;
    const platformColor = PLATFORM_COLORS[platform] || PLATFORM_COLORS.unknown;
    platformTextEl.textContent = platformName;
    platformEl.style.color = platformColor;
  }
}

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
    firstSpeaker: meeting.transcript?.[0]?.speakerName || meeting.transcript?.[0]?.speaker || 'N/A',
  });

  currentMeeting = meeting;
  currentMeetingId = meetingId;

  // Reset edit modes when viewing a new meeting
  exitMeetingInfoEditMode();

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

  // Tab switching
  initializeTabs([
    { buttonId: 'summaryTabBtn', contentId: 'summaryTab' },
    { buttonId: 'transcriptTabBtn', contentId: 'transcriptTab' },
    { buttonId: 'templatesTabBtn', contentId: 'templatesTab' },
    { buttonId: 'metadataTabBtn', contentId: 'metadataTab' },
  ]);

  // Edit meeting info button
  const editMeetingInfoBtn = document.getElementById('editMeetingInfoBtn');
  if (editMeetingInfoBtn) {
    editMeetingInfoBtn.onclick = () => enterMeetingInfoEditMode();
  }

  // Save meeting info button
  const saveMeetingInfoBtn = document.getElementById('saveMeetingInfoBtn');
  if (saveMeetingInfoBtn) {
    saveMeetingInfoBtn.onclick = () => saveMeetingInfo(onUpdate);
  }

  // Cancel meeting info edit button
  const cancelMeetingInfoEditBtn = document.getElementById('cancelMeetingInfoEditBtn');
  if (cancelMeetingInfoEditBtn) {
    cancelMeetingInfoEditBtn.onclick = () => exitMeetingInfoEditMode();
  }

  // Unlink meeting button (in edit mode)
  const unlinkMeetingBtn = document.getElementById('unlinkMeetingBtn');
  if (unlinkMeetingBtn) {
    unlinkMeetingBtn.onclick = () => unlinkFromObsidian(onUpdate);
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
    // Clear search when input is cleared (real-time)
    searchInput.addEventListener('input', e => {
      if (e.target.value === '') {
        searchTranscript('');
      }
    });
    // Also handle the 'search' event which fires when the native clear button (X) is clicked
    searchInput.addEventListener('search', e => {
      if (e.target.value === '') {
        searchTranscript('');
      }
    });
  }

  // Fix Speakers button (SM-2)
  const fixSpeakersBtn = document.getElementById('fixSpeakersBtn');
  if (fixSpeakersBtn) {
    fixSpeakersBtn.onclick = () => openFixSpeakersModal(onUpdate);
  }

  // Generate templates button
  const generateTemplatesBtn = document.getElementById('generateTemplatesBtn');
  if (generateTemplatesBtn) {
    generateTemplatesBtn.onclick = () => generateTemplates(onUpdate);
  }

  // Summary edit/save buttons
  const editSummaryBtn = document.getElementById('editSummaryBtn');
  const saveSummaryBtn = document.getElementById('saveSummaryBtn');
  const cancelEditSummaryBtn = document.getElementById('cancelEditSummaryBtn');

  if (editSummaryBtn) {
    editSummaryBtn.onclick = () => enterSummaryEditMode();
  }
  if (saveSummaryBtn) {
    saveSummaryBtn.onclick = () => saveSummaryEdit(onUpdate);
  }
  if (cancelEditSummaryBtn) {
    cancelEditSummaryBtn.onclick = () => exitSummaryEditMode();
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

  // UI-1: Platform indicator
  updatePlatformDisplay(meeting);

  // Obsidian sync status
  const obsidianStatusEl = document.getElementById('meetingDetailObsidianStatus');
  const obsidianStatusTextEl = document.getElementById('meetingDetailObsidianStatusText');
  if (obsidianStatusEl && obsidianStatusTextEl) {
    if (meeting.obsidianLink || meeting.vaultPath) {
      obsidianStatusTextEl.textContent = 'Synced';
      obsidianStatusEl.style.color = 'var(--status-success)';
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
 * Update the participant count display in the meeting info section
 */
function updateParticipantCount() {
  const countEl = document.getElementById('meetingDetailParticipantCount');
  if (countEl && currentMeeting) {
    const count = currentMeeting.participants ? currentMeeting.participants.length : 0;
    countEl.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
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
      <div class="add-participant-row">
        <button class="btn btn-outline btn-sm add-participant-btn">+ Add Participant</button>
      </div>
    `;
    setupAddParticipantButton();
    return;
  }

  // Calculate speaker stats from transcript
  const speakerStats = calculateSpeakerStatsFromTranscript(meeting.transcript);

  participantsList.innerHTML = '';

  meeting.participants.forEach((participant, index) => {
    const participantItem = document.createElement('div');
    participantItem.className = 'participant-item';
    participantItem.dataset.index = index;

    // Create initials for avatar
    const name = participant.name || participant.email || 'Unknown';
    const initials = getInitials(name);

    // Determine if linked to a contact (has email or contactId)
    const isLinked = !!(participant.email || participant.contactId);

    // Find speaker stats for this participant
    const participantStats = findParticipantSpeakerStats(participant, speakerStats);

    // Build sub-info line: email and/or company
    let subInfo = '';
    if (participant.email) {
      subInfo += `<div class="participant-email">${escapeHtml(participant.email)}</div>`;
    }
    if (participant.company || participant.organization) {
      const company = participant.company || participant.organization;
      subInfo += `<div class="participant-company">${escapeHtml(company)}</div>`;
    }

    // Name with optional link to contact and checkmark
    const checkmarkIcon = '<svg class="linked-check" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    const nameHtml = isLinked && participant.email
      ? `<a href="#" class="participant-name-link" data-email="${escapeHtml(participant.email)}">${escapeHtml(name)}</a>${checkmarkIcon}`
      : escapeHtml(name);

    // Build talk time badge if we have stats
    const talkTimeBadge = participantStats
      ? `<div class="participant-talk-time" title="${participantStats.wordCount} words">
           <span class="talk-time-percent">${participantStats.talkTimePercent}%</span>
           <div class="talk-time-bar-mini">
             <div class="talk-time-fill-mini" style="width: ${Math.min(participantStats.talkTimePercent, 100)}%"></div>
           </div>
         </div>`
      : '';

    participantItem.innerHTML = `
      <div class="participant-avatar">${escapeHtml(initials)}</div>
      <div class="participant-info">
        <div class="participant-name-row">
          <span class="participant-name">${nameHtml}</span>
          ${talkTimeBadge}
        </div>
        ${subInfo}
      </div>
      <div class="participant-actions">
        <button class="btn btn-outline btn-xs change-btn" data-index="${index}">Change</button>
        <button class="icon-btn remove-btn" title="Remove participant" data-index="${index}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    `;

    participantsList.appendChild(participantItem);
  });

  // Add the "Add participant" row at the end
  const addRow = document.createElement('div');
  addRow.className = 'add-participant-row';
  addRow.innerHTML = '<button class="btn btn-outline btn-sm add-participant-btn">+ Add Participant</button>';
  participantsList.appendChild(addRow);

  // Set up event listeners
  setupParticipantEventListeners();
}

/**
 * Set up event listeners for participant actions
 */
function setupParticipantEventListeners() {
  const participantsList = document.getElementById('meetingDetailParticipants');
  if (!participantsList) return;

  // Name links to contact card
  participantsList.querySelectorAll('.participant-name-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const email = link.dataset.email;
      if (email && window.openContactsView) {
        window.openContactsView(email);
      }
    });
  });

  // Remove buttons
  participantsList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      removeParticipantFromCard(index);
    });
  });

  // Change buttons (replace with different contact)
  participantsList.querySelectorAll('.change-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      showParticipantChangeInput(index, btn);
    });
  });

  // Add participant button
  setupAddParticipantButton();
}

/**
 * Set up add participant button
 */
function setupAddParticipantButton() {
  const addBtn = document.querySelector('.add-participant-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showAddParticipantDialog();
    });
  }
}

/**
 * Remove participant from card and save
 * Note: No confirmation dialog - user is already in edit mode and clicking remove is intentional.
 * Using confirm() causes Electron focus issues with subsequent modals.
 */
async function removeParticipantFromCard(index) {
  if (!currentMeeting || !currentMeeting.participants) return;

  const participant = currentMeeting.participants[index];
  if (!participant) return;

  currentMeeting.participants.splice(index, 1);

  // Save to backend
  try {
    await window.electronAPI.updateMeetingField(currentMeetingId, 'participants', currentMeeting.participants);
    populateParticipants(currentMeeting);
    updateParticipantCount();

    // Notify the update callback
    if (window._meetingDetailUpdateCallback) {
      window._meetingDetailUpdateCallback(currentMeetingId, currentMeeting);
    }
  } catch (error) {
    console.error('[MeetingDetail] Failed to remove participant:', error);
    // Restore the participant
    currentMeeting.participants.splice(index, 0, participant);
    updateParticipantCount();
  }
}

/**
 * Show contact search modal to change/replace a participant
 */
function showParticipantChangeInput(index, buttonEl) {
  const participant = currentMeeting?.participants?.[index];
  if (!participant) return;

  // Show contact search modal with custom title
  showContactSearchModal(
    async selectedContact => {
      // Replace participant with selected contact
      currentMeeting.participants[index] = {
        name: selectedContact.name,
        email: selectedContact.email || null,
        company: selectedContact.company || selectedContact.organization || null,
        contactId: selectedContact.contactId || null,
      };

      // Save to backend
      try {
        await window.electronAPI.updateMeetingField(
          currentMeetingId,
          'participants',
          currentMeeting.participants
        );
        populateParticipants(currentMeeting);

        if (window._meetingDetailUpdateCallback) {
          window._meetingDetailUpdateCallback(currentMeetingId, currentMeeting);
        }
      } catch (error) {
        console.error('[MeetingDetail] Failed to change participant:', error);
      }
    },
    `Replace "${participant.name}" with...`
  );
}

/**
 * Show contact search modal to add a new participant
 */
function showAddParticipantDialog() {
  showContactSearchModal(async selectedContact => {
    if (!currentMeeting.participants) {
      currentMeeting.participants = [];
    }

    currentMeeting.participants.push({
      name: selectedContact.name,
      email: selectedContact.email || null,
      company: selectedContact.company || selectedContact.organization || null,
      contactId: selectedContact.contactId || null,
    });

    // Save to backend
    try {
      await window.electronAPI.updateMeetingField(
        currentMeetingId,
        'participants',
        currentMeeting.participants
      );
      populateParticipants(currentMeeting);
      updateParticipantCount();

      if (window._meetingDetailUpdateCallback) {
        window._meetingDetailUpdateCallback(currentMeetingId, currentMeeting);
      }
    } catch (error) {
      console.error('[MeetingDetail] Failed to add participant:', error);
      currentMeeting.participants.pop();
      populateParticipants(currentMeeting);
      updateParticipantCount();
    }
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
  const editBtn = document.getElementById('editSummaryBtn');
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
    if (editBtn) editBtn.style.display = 'none';
    return;
  }

  // Display the auto-summary content directly
  summaryContent.innerHTML = markdownToSafeHtml(meeting.content);

  // Show edit button when there's content
  if (editBtn) editBtn.style.display = 'inline-flex';
}

/**
 * Populate transcript tab
 */
async function populateTranscript(meeting) {
  const transcriptContent = document.getElementById('meetingDetailTranscript');
  const fixSpeakersBtn = document.getElementById('fixSpeakersBtn');

  if (!transcriptContent) return;

  // Hide Fix Speakers button by default
  if (fixSpeakersBtn) {
    fixSpeakersBtn.style.display = 'none';
  }

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

    // Format timestamp - check both 'timestamp' field (our standard format) and 'start' (raw API format)
    const timestamp = formatTimestamp(utterance.timestamp || utterance.start);

    // SM-1: Use speakerName (matched name) if available, fall back to speaker label
    const speakerName = utterance.speakerName || utterance.speaker || 'Unknown Speaker';
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

  // SM-2: Always show Fix Speakers button when there's a transcript with speakers
  // User should always be able to remap speakers to contacts, not just for "cryptic" IDs
  if (fixSpeakersBtn && meeting.transcript && meeting.transcript.length > 0) {
    // Check if there are any speakers to map
    const hasSpeakers = meeting.transcript.some(u => u.speaker || u.speakerName);
    if (hasSpeakers) {
      fixSpeakersBtn.style.display = 'inline-flex';
    }
  }
}

/**
 * Format timestamp from milliseconds to HH:MM:SS or MM:SS
 * Note: AssemblyAI returns timestamps in milliseconds, Deepgram in seconds
 * We normalize to milliseconds in transcriptionService, but handle both for legacy data
 */
function formatTimestamp(ms) {
  if (!ms && ms !== 0) return '00:00';

  // Heuristic: if value is < 100000, it's likely in seconds (legacy Deepgram data)
  // A 27+ hour meeting in ms would exceed 100000000, so this is safe
  // Most meetings are < 27 hours, and timestamps in seconds would be < 100000 for ~27 hours
  let totalSeconds;
  if (ms < 100000) {
    // Likely in seconds (legacy Deepgram format) - value represents < 27 hours in seconds
    totalSeconds = Math.floor(ms);
  } else {
    // In milliseconds (AssemblyAI format and normalized Deepgram)
    totalSeconds = Math.floor(ms / 1000);
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Search transcript for keywords
 */
function searchTranscript(query) {
  if (!currentMeeting || !currentMeeting.transcript) {
    return;
  }

  const transcriptContent = document.getElementById('meetingDetailTranscript');
  if (!transcriptContent) return;

  const utterances = transcriptContent.querySelectorAll('.transcript-utterance');

  // Clear search to show all results when query is empty
  if (!query || query.trim() === '') {
    utterances.forEach(utterance => {
      utterance.style.display = 'block';
      utterance.classList.remove('search-match');
    });
    console.log('[MeetingDetail] Search cleared, showing all utterances');
    return;
  }

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
}

/**
 * Enter meeting info edit mode
 */
function enterMeetingInfoEditMode() {
  const viewMode = document.getElementById('meetingInfoViewMode');
  const editMode = document.getElementById('meetingInfoEditMode');

  if (!viewMode || !editMode || !currentMeeting) return;

  // Populate edit fields with current values
  const titleInput = document.getElementById('editMeetingTitle');
  const platformSelect = document.getElementById('editMeetingPlatform');
  const vaultPathInput = document.getElementById('editMeetingVaultPath');

  if (titleInput) {
    titleInput.value = currentMeeting.title || '';
  }
  if (platformSelect) {
    platformSelect.value = (currentMeeting.platform || 'unknown').toLowerCase();
  }
  if (vaultPathInput) {
    vaultPathInput.value = currentMeeting.vaultPath || currentMeeting.obsidianLink || '';
  }

  // Show/hide unlink button based on sync status
  const unlinkBtn = document.getElementById('unlinkMeetingBtn');
  if (unlinkBtn) {
    const isSynced = currentMeeting.vaultPath || currentMeeting.obsidianLink;
    unlinkBtn.style.display = isSynced ? 'inline-flex' : 'none';
  }

  // Switch to edit mode
  viewMode.style.display = 'none';
  editMode.style.display = 'block';

  // Add editing highlight to the card
  const meetingInfoCard = document.getElementById('meetingInfoCard');
  if (meetingInfoCard) {
    meetingInfoCard.classList.add('editing');
  }

  // Focus the title input
  if (titleInput) {
    titleInput.focus();
    titleInput.select();
  }
}

/**
 * Exit meeting info edit mode without saving
 */
function exitMeetingInfoEditMode() {
  const viewMode = document.getElementById('meetingInfoViewMode');
  const editMode = document.getElementById('meetingInfoEditMode');

  if (!viewMode || !editMode) return;

  // Switch back to view mode
  viewMode.style.display = 'block';
  editMode.style.display = 'none';

  // Remove editing highlight from the card
  const meetingInfoCard = document.getElementById('meetingInfoCard');
  if (meetingInfoCard) {
    meetingInfoCard.classList.remove('editing');
  }
}

/**
 * Save meeting info from edit mode
 */
async function saveMeetingInfo(onUpdate) {
  const titleInput = document.getElementById('editMeetingTitle');
  const platformSelect = document.getElementById('editMeetingPlatform');
  const vaultPathInput = document.getElementById('editMeetingVaultPath');

  if (!currentMeeting || !currentMeetingId) return;

  const newTitle = titleInput?.value.trim() || 'Untitled Meeting';
  const newPlatform = platformSelect?.value || 'unknown';
  const newVaultPath = vaultPathInput?.value.trim() || '';

  // Track what changed
  const changes = [];

  // Update title if changed
  if (newTitle !== currentMeeting.title) {
    try {
      const result = await window.electronAPI.updateMeetingField(currentMeetingId, 'title', newTitle);
      if (result.success) {
        currentMeeting.title = newTitle;
        changes.push('title');
      }
    } catch (err) {
      console.error('[MeetingInfo] Failed to update title:', err);
    }
  }

  // Update platform if changed
  const currentPlatform = (currentMeeting.platform || 'unknown').toLowerCase();
  if (newPlatform !== currentPlatform) {
    try {
      const result = await window.electronAPI.updateMeetingField(currentMeetingId, 'platform', newPlatform);
      if (result.success) {
        currentMeeting.platform = newPlatform;
        changes.push('platform');
      }
    } catch (err) {
      console.error('[MeetingInfo] Failed to update platform:', err);
    }
  }

  // Update vault path if changed
  const currentVaultPath = currentMeeting.vaultPath || currentMeeting.obsidianLink || '';
  if (newVaultPath !== currentVaultPath) {
    try {
      const result = await window.electronAPI.updateMeetingField(currentMeetingId, 'vaultPath', newVaultPath);
      if (result.success) {
        currentMeeting.vaultPath = newVaultPath;
        // Also update obsidianLink to keep them in sync
        if (newVaultPath) {
          currentMeeting.obsidianLink = newVaultPath;
        } else {
          // Clear obsidianLink when vault path is cleared
          delete currentMeeting.obsidianLink;
        }
        changes.push('vaultPath');
      }
    } catch (err) {
      console.error('[MeetingInfo] Failed to update vault path:', err);
    }
  }

  // Update the display
  populateMeetingInfo(currentMeeting);

  // Explicitly update vault path display to ensure it's current
  const pathDisplayEl = document.getElementById('meetingDetailVaultPath');
  if (pathDisplayEl) {
    pathDisplayEl.textContent = currentMeeting.vaultPath || currentMeeting.obsidianLink || 'Not saved to vault';
  }

  // Update sync status indicator
  const obsidianStatusEl = document.getElementById('meetingDetailObsidianStatus');
  const obsidianStatusTextEl = document.getElementById('meetingDetailObsidianStatusText');
  if (obsidianStatusEl && obsidianStatusTextEl) {
    const isSynced = currentMeeting.vaultPath || currentMeeting.obsidianLink;
    if (isSynced) {
      obsidianStatusTextEl.textContent = 'Synced';
      obsidianStatusEl.style.color = 'var(--status-success)';
    } else {
      obsidianStatusTextEl.textContent = 'Not synced';
      obsidianStatusEl.style.color = 'var(--text-secondary)';
    }
  }

  // Exit edit mode
  exitMeetingInfoEditMode();

  // Notify update callback
  if (changes.length > 0 && onUpdate) {
    onUpdate(currentMeetingId, currentMeeting);
  }

  if (changes.length > 0) {
    console.log(`[MeetingInfo] Updated: ${changes.join(', ')}`);
    if (window.showToast) {
      window.showToast('Meeting info saved', 'success');
    }
  }
}

/**
 * Generate templates for the meeting
 */
async function generateTemplates(onUpdate) {
  if (!currentMeetingId) return;

  const btn = document.getElementById('generateTemplatesBtn');
  if (!btn) return;

  await withButtonLoadingElement(btn, 'Generating...', async () => {
    console.log(`[MeetingDetail] Generating templates for meeting: ${currentMeetingId}`);

    // Get all available templates
    const templates = await window.electronAPI.templatesGetAll();

    if (!templates || templates.length === 0) {
      alert('No templates available. Please add templates in Settings > Templates.');
      return;
    }

    // Get template IDs (excluding auto-summary if present)
    const templateIds = templates.filter(t => t.id !== 'auto-summary').map(t => t.id);

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
  });
}

/**
 * Unlink meeting from Obsidian - clears sync status
 */
async function unlinkFromObsidian(onUpdate) {
  // Clear Obsidian-related fields
  delete currentMeeting.obsidianLink;
  delete currentMeeting.vaultPath;
  delete currentMeeting.exportedAt;

  // Update the vault path input in edit mode
  const vaultPathInput = document.getElementById('editMeetingVaultPath');
  if (vaultPathInput) {
    vaultPathInput.value = '';
  }

  // Hide the unlink button since there's nothing to unlink now
  const unlinkBtn = document.getElementById('unlinkMeetingBtn');
  if (unlinkBtn) {
    unlinkBtn.style.display = 'none';
  }

  // Show the Export button again
  const exportBtn = document.getElementById('exportToObsidianBtn');
  if (exportBtn) {
    exportBtn.style.display = 'flex';
  }

  // Update meeting in database
  try {
    await window.electronAPI.updateMeetingField(currentMeetingId, 'vaultPath', null);
    await window.electronAPI.updateMeetingField(currentMeetingId, 'obsidianLink', null);
    await window.electronAPI.updateMeetingField(currentMeetingId, 'exportedAt', null);
  } catch (err) {
    console.error('[MeetingDetail] Failed to clear vault path in database:', err);
  }

  // Update the display
  populateMeetingInfo(currentMeeting);

  // Exit edit mode
  exitMeetingInfoEditMode();

  // Notify update - this triggers saveMeetingsData
  if (onUpdate) {
    await onUpdate(currentMeetingId, currentMeeting);
  }

  // Show confirmation toast
  if (window.showToast) {
    window.showToast('Obsidian link removed', 'success');
  }

  console.log(`[MeetingDetail] Meeting unlinked from Obsidian: ${currentMeetingId}`);
}

/**
 * Show contact search modal for adding participants
 * @param {Function} onSelect - Callback when a contact is selected
 * @param {string} [title='Add Participant'] - Optional modal title
 */
function showContactSearchModal(onSelect, title = 'Add Participant') {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'contact-search-modal-overlay';

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'contact-search-modal';

  modal.innerHTML = `
    <div class="contact-search-modal-header">
      <h3>${escapeHtml(title)}</h3>
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
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  // Close button
  closeBtn.addEventListener('click', closeModal);

  // Escape key to close
  const handleEscape = e => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Pre-fetch contacts in background to warm the cache
  // This happens async and doesn't block the UI
  contactsService.fetchContacts(false).catch(err => {
    console.log('[ContactSearchModal] Background fetch failed (cache may be cold):', err.message);
  });

  // Search contacts as user types
  let searchTimeout;
  searchInput.addEventListener('input', async e => {
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
        // Use debounceMs: 0 since we already debounce in this handler
        const contacts = await contactsService.search(query, { debounceMs: 0 });

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
          // Get primary email from emails array, with fallback
          const primaryEmail = contact.email || (contact.emails && contact.emails[0]) || '';
          // Get company/organization if available
          const company = contact.company || contact.organization || '';

          contactItem.innerHTML = `
            <div class="contact-avatar">${escapeHtml(initials)}</div>
            <div class="contact-info">
              <div class="contact-name">${escapeHtml(contact.name)}</div>
              ${primaryEmail ? `<div class="contact-email">${escapeHtml(primaryEmail)}</div>` : ''}
              ${company ? `<div class="contact-company">${escapeHtml(company)}</div>` : ''}
            </div>
          `;

          contactItem.addEventListener('click', () => {
            // Normalize contact data to ensure email is available
            const normalizedContact = {
              name: contact.name,
              email: primaryEmail,
              company: company || null,
              organization: contact.organization || null,
            };
            onSelect(normalizedContact);
            closeModal();
          });

          resultsContainer.appendChild(contactItem);
        });
      } catch (error) {
        console.error('Error searching contacts:', error);
        resultsContainer.innerHTML =
          '<div class="search-hint error">Error searching contacts</div>';
      }
    }, 300); // Debounce search
  });

  // Focus search input after a brief delay to ensure DOM is ready
  // This fixes Electron focus issues with dynamically created elements
  setTimeout(() => {
    searchInput.focus();
  }, 50);
}

/**
 * Export meeting to Obsidian
 */
async function exportToObsidian() {
  if (!currentMeetingId) return;

  const btn = document.getElementById('exportToObsidianBtn');
  if (!btn) return;

  await withButtonLoadingElement(btn, 'Exporting...', async () => {
    console.log(`[MeetingDetail] Exporting meeting to Obsidian: ${currentMeetingId}`);

    const result = await window.electronAPI.obsidianExportMeeting(currentMeetingId);

    if (result.success) {
      console.log('[MeetingDetail] Export successful');
      alert('Meeting exported to Obsidian successfully!');

      // Update obsidianLink if returned (the IPC handler returns obsidianLink directly, not wrapped in data)
      if (result.obsidianLink) {
        currentMeeting.obsidianLink = result.obsidianLink;

        // Update header vault path display
        const pathDisplayEl = document.getElementById('meetingDetailVaultPath');
        if (pathDisplayEl) {
          pathDisplayEl.textContent = result.obsidianLink;
        }

        // Update metadata tab vault path field
        const vaultPathEl = document.getElementById('metadataVaultPath');
        if (vaultPathEl) {
          vaultPathEl.value = result.obsidianLink;
        }

        // Update obsidian sync status indicator in header
        const obsidianStatusEl = document.getElementById('meetingDetailObsidianStatus');
        const obsidianStatusTextEl = document.getElementById('meetingDetailObsidianStatusText');
        if (obsidianStatusEl && obsidianStatusTextEl) {
          obsidianStatusTextEl.textContent = 'Synced';
          obsidianStatusEl.style.color = '#4caf50'; // Green for synced
        }

        // Notify parent to persist changes
        if (window._meetingDetailUpdateCallback) {
          window._meetingDetailUpdateCallback(currentMeetingId, currentMeeting);
        }
      }
    } else {
      console.error('[MeetingDetail] Export failed:', result.error);
      alert(`Failed to export to Obsidian: ${result.error}`);
    }
  });
}

/**
 * Regenerate summary for the meeting
 */
async function regenerateSummary(onUpdate) {
  if (!currentMeetingId) return;

  const btn = document.getElementById('regenerateSummaryBtn');
  if (!btn) return;

  if (
    !confirm(
      'Regenerate the auto-summary for this meeting? This will replace the existing summary.'
    )
  ) {
    return;
  }

  await withButtonLoadingElement(btn, 'Regenerating...', async () => {
    console.log(`[MeetingDetail] Regenerating summary for meeting: ${currentMeetingId}`);

    const result = await window.electronAPI.generateMeetingSummary(currentMeetingId);

    if (result.success) {
      console.log('[MeetingDetail] Summary regenerated successfully');

      // Check if user has navigated away (currentMeeting would be null)
      if (!currentMeetingId) {
        console.log('[MeetingDetail] User navigated away, skipping summary update');
        return;
      }

      // The backend saves the summary to meeting.content, so we need to reload the data
      // to get the updated content
      const meetingsData = await window.electronAPI.loadMeetingsData();

      if (meetingsData.success) {
        // Find the updated meeting
        const allMeetings = [
          ...meetingsData.data.upcomingMeetings,
          ...meetingsData.data.pastMeetings,
        ];
        const updatedMeeting = allMeetings.find(m => m.id === currentMeetingId);

        if (updatedMeeting) {
          // Update the current meeting reference
          currentMeeting = updatedMeeting;

          // Re-render the summary tab with new content (only if still viewing this meeting)
          if (currentMeetingId) {
            populateSummary(currentMeeting);
            console.log('[MeetingDetail] Summary view updated with regenerated content');
          }

          // Notify parent that data has changed (only if we have valid meeting data)
          if (onUpdate && currentMeeting) {
            onUpdate(currentMeetingId, currentMeeting);
          }
        }
      }
    } else {
      console.error('[MeetingDetail] Failed to regenerate summary:', result.error);
      alert(`Failed to regenerate summary: ${result.error}`);
    }
  });
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
      resultsDiv.innerHTML =
        '<div class="search-hint">Type at least 2 characters to search...</div>';
      return;
    }

    resultsDiv.innerHTML = '<div class="search-hint">Searching...</div>';

    searchTimeout = setTimeout(async () => {
      try {
        const result = await window.electronAPI.contactsSearchContacts(query);

        if (result.success && result.contacts.length > 0) {
          renderContactResults(result.contacts, resultsDiv, searchInput);
        } else {
          resultsDiv.innerHTML =
            '<div class="search-hint">No contacts found. You can still type a custom name.</div>';
        }
      } catch (error) {
        console.error('[MeetingDetail] Contact search error:', error);
        resultsDiv.innerHTML =
          '<div class="search-hint error">Search failed. You can still type a custom name.</div>';
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
  searchInput.addEventListener('keydown', async e => {
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

  console.log(
    `[MeetingDetail] Updating speaker at index ${context.utteranceIndex} to: ${newSpeakerName}`
  );

  // Update the transcript in memory
  if (currentMeeting.transcript && currentMeeting.transcript[context.utteranceIndex]) {
    currentMeeting.transcript[context.utteranceIndex].speaker = newSpeakerName;

    // Update the UI
    const speakerNameSpan =
      context.speakerElement.querySelector('.speaker-name') || context.speakerElement;
    const editIcon = speakerNameSpan.querySelector('.edit-icon');
    speakerNameSpan.textContent = newSpeakerName;
    if (editIcon) {
      speakerNameSpan.appendChild(editIcon);
    }

    // Auto-add participant if contact was selected (Phase 10.6)
    if (contact) {
      // Extract email - contact might have 'email' (string) or 'emails' (array)
      const contactEmail =
        contact.email || (contact.emails && contact.emails.length > 0 ? contact.emails[0] : null);

      if (contactEmail) {
        if (!currentMeeting.participants) {
          currentMeeting.participants = [];
        }

        // Check if participant already exists
        const existingParticipant = currentMeeting.participants.find(
          p => p.email && contactEmail && p.email.toLowerCase() === contactEmail.toLowerCase()
        );

        if (!existingParticipant) {
          // Add new participant
          currentMeeting.participants.push({
            name: contact.name,
            email: contactEmail,
          });

          // Re-populate the participant card to show new participant
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
        transcriptUpdated: true,
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
 * Enter summary edit mode
 */
function enterSummaryEditMode() {
  const viewMode = document.getElementById('summaryViewMode');
  const editMode = document.getElementById('summaryEditMode');
  const editor = document.getElementById('summaryEditor');
  const editBtn = document.getElementById('editSummaryBtn');
  const saveBtn = document.getElementById('saveSummaryBtn');
  const cancelBtn = document.getElementById('cancelEditSummaryBtn');

  if (!currentMeeting || !currentMeeting.content) return;

  // Hide view mode, show edit mode
  viewMode.style.display = 'none';
  editMode.style.display = 'block';

  // Populate editor with current content (markdown)
  editor.value = currentMeeting.content;

  // Update buttons
  editBtn.style.display = 'none';
  saveBtn.style.display = 'inline-flex';
  cancelBtn.style.display = 'inline-flex';

  // Focus editor
  editor.focus();
}

/**
 * Exit summary edit mode without saving
 */
function exitSummaryEditMode() {
  const viewMode = document.getElementById('summaryViewMode');
  const editMode = document.getElementById('summaryEditMode');
  const editBtn = document.getElementById('editSummaryBtn');
  const saveBtn = document.getElementById('saveSummaryBtn');
  const cancelBtn = document.getElementById('cancelEditSummaryBtn');

  // Show view mode, hide edit mode
  viewMode.style.display = 'block';
  editMode.style.display = 'none';

  // Update buttons
  editBtn.style.display = 'inline-flex';
  saveBtn.style.display = 'none';
  cancelBtn.style.display = 'none';
}

/**
 * Save summary edit
 */
async function saveSummaryEdit(onUpdate) {
  const editor = document.getElementById('summaryEditor');
  const newContent = editor.value;

  if (!currentMeeting) return;

  console.log('[MeetingDetail] Saving summary edit');

  // Update current meeting object
  currentMeeting.content = newContent;

  // Exit edit mode
  exitSummaryEditMode();

  // Re-render the summary with new content
  populateSummary(currentMeeting);

  // Notify parent to save changes
  if (onUpdate) {
    onUpdate(currentMeetingId, currentMeeting);
  }

  console.log('[MeetingDetail] Summary saved successfully');
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
 * SM-2: Open Fix Speakers modal for bulk speaker mapping
 */
async function openFixSpeakersModal(onUpdate) {
  if (!currentMeetingId || !currentMeeting?.transcript) {
    console.warn('[MeetingDetail] No meeting or transcript to fix speakers');
    return;
  }

  await openSpeakerMappingModal(
    currentMeetingId,
    currentMeeting.transcript,
    async updatedMeeting => {
      console.log('[MeetingDetail] Speaker mappings applied, updating view');
      console.log('[MeetingDetail] Updated meeting participants:', updatedMeeting.participants);
      console.log(
        '[MeetingDetail] Updated transcript sample:',
        updatedMeeting.transcript?.slice(0, 2)
      );

      // Update current meeting with the updated data
      currentMeeting = updatedMeeting;

      // Refresh all relevant sections
      populateMeetingInfo(currentMeeting);
      populateParticipants(currentMeeting); // Important - update participants list!
      populateSummary(currentMeeting);
      await populateTranscript(currentMeeting);
      populateMetadata(currentMeeting);

      // Notify parent of the update
      if (onUpdate) {
        onUpdate(currentMeetingId, currentMeeting);
      }
    },
    {
      participants: currentMeeting.participants || [],
    }
  );
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
  console.log('[MeetingDetail] Cleared');
}
