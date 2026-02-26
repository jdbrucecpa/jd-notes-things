/**
 * Meeting Detail View Module
 * Handles the modern meeting detail interface with tabs
 */

import { escapeHtml, markdownToSafeHtml } from './security.js';
import { contactsService } from './services/contactsService.js';
import { withButtonLoadingElement } from './utils/buttonHelper.js';
import { initializeTabs } from './utils/tabHelper.js';
import { openSpeakerMappingModal } from './speakerMapping.js';
import { createModal } from './utils/modalHelper.js';
import { loadSettings } from './settings.js';
import { notifyError } from './utils/notificationHelper.js';

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
    participantItem.className = 'participant-card';
    participantItem.dataset.index = index;

    const name = participant.name || participant.email || 'Unknown';
    const initials = getInitials(name);
    const isLinked = !!(participant.email || participant.contactId);
    const participantStats = findParticipantSpeakerStats(participant, speakerStats);
    const organization = participant.company || participant.organization || '';

    // Status indicator
    let statusBadge;
    if (isLinked) {
      statusBadge = '<span class="participant-status participant-status-matched" title="Matched to Google Contact"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>';
    } else {
      statusBadge = '<span class="participant-status participant-status-unmatched" title="No Google Contact">?</span>';
    }

    // Talk time badge
    const talkTimeBadge = participantStats
      ? `<div class="participant-talk-time" title="${participantStats.wordCount} words">
           <span class="talk-time-percent">${participantStats.talkTimePercent}%</span>
           <div class="talk-time-bar-mini">
             <div class="talk-time-fill-mini" style="width: ${Math.min(participantStats.talkTimePercent, 100)}%"></div>
           </div>
         </div>`
      : '';

    // Sub-info (email + org on collapsed card)
    let subInfo = '';
    if (participant.email) {
      subInfo += `<div class="participant-email">${escapeHtml(participant.email)}</div>`;
    }
    if (organization) {
      subInfo += `<div class="participant-company">${escapeHtml(organization)}</div>`;
    }

    // Collapsed state (always visible)
    const collapsedHtml = `
      <div class="participant-card-header" data-index="${index}">
        <div class="participant-avatar">${escapeHtml(initials)}</div>
        <div class="participant-info">
          <div class="participant-name-row">
            <span class="participant-name">${escapeHtml(name)}</span>
            ${statusBadge}
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
          <button class="icon-btn expand-btn" title="Show details" data-index="${index}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
        </div>
      </div>
    `;

    // Expanded state (hidden by default, loaded on demand)
    const expandedHtml = `
      <div class="participant-card-expanded" data-index="${index}" style="display: none;">
        <div class="expanded-section" id="participant-details-${index}">
          <div class="expanded-section-loading">Loading details...</div>
        </div>
      </div>
    `;

    // Unmatched CTA (shown for unmatched participants)
    const unmatchedCta = !isLinked ? `
      <div class="participant-unmatched-cta" data-index="${index}">
        <button class="btn btn-outline btn-xs add-to-contacts-btn" data-index="${index}" data-name="${escapeHtml(participant.originalName || name)}" data-email="${escapeHtml(participant.email || '')}">
          + Add to Google Contacts
        </button>
      </div>
    ` : '';

    participantItem.innerHTML = collapsedHtml + unmatchedCta + expandedHtml;
    participantsList.appendChild(participantItem);
  });

  // Add the "Add participant" row at the end
  const addRow = document.createElement('div');
  addRow.className = 'add-participant-row';
  addRow.innerHTML = '<button class="btn btn-outline btn-sm add-participant-btn">+ Add Participant</button>';
  participantsList.appendChild(addRow);

  // Set up event listeners
  setupParticipantEventListeners();
  setupExpandableCards(meeting);
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

  // Refresh matching button
  setupRefreshMatchingButton();
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
 * Set up refresh participant matching button
 */
function setupRefreshMatchingButton() {
  const refreshBtn = document.getElementById('refreshParticipantMatchingBtn');
  if (!refreshBtn) return;

  // Remove existing listeners by cloning
  const newBtn = refreshBtn.cloneNode(true);
  refreshBtn.parentNode.replaceChild(newBtn, refreshBtn);

  newBtn.addEventListener('click', async () => {
    if (!currentMeetingId) return;

    // Show loading state
    newBtn.classList.add('refreshing');
    newBtn.disabled = true;

    try {
      const result = await window.electronAPI.contactsRematchParticipants(currentMeetingId);

      if (result.success) {
        // Update local meeting data
        currentMeeting.participants = result.participants;

        // Re-render the participants list
        populateParticipants(currentMeeting);
        updateParticipantCount();

        // Notify success
        const matchedCount = result.participants.filter(p => p.contactMatched).length;
        console.log(`[MeetingDetail] Re-matched participants: ${matchedCount} of ${result.participants.length} matched`);
      } else {
        console.error('[MeetingDetail] Failed to rematch participants:', result.error);
        alert('Failed to rematch participants: ' + result.error);
      }
    } catch (error) {
      console.error('[MeetingDetail] Error rematching participants:', error);
      alert('Error rematching participants: ' + error.message);
    } finally {
      // Remove loading state - get fresh reference since populateParticipants clones the button
      const currentBtn = document.getElementById('refreshParticipantMatchingBtn');
      if (currentBtn) {
        currentBtn.classList.remove('refreshing');
        currentBtn.disabled = false;
      }
    }
  });
}

// ===================================================================
// v1.3.0: Expandable participant cards with deep Google integration
// ===================================================================

/**
 * Set up expandable card toggle and lazy-load expanded content.
 */
function setupExpandableCards(meeting) {
  const participantsList = document.getElementById('meetingDetailParticipants');
  if (!participantsList) return;

  // Expand/collapse toggles
  participantsList.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      toggleExpandedCard(index, meeting);
    });
  });

  // Click on card header to expand
  participantsList.querySelectorAll('.participant-card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't expand if clicking buttons
      if (e.target.closest('.btn') || e.target.closest('.icon-btn')) return;
      const index = parseInt(header.dataset.index);
      toggleExpandedCard(index, meeting);
    });
  });

  // "Add to Google Contacts" buttons
  participantsList.querySelectorAll('.add-to-contacts-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      const email = btn.dataset.email;
      await handleAddToContacts(name, email, parseInt(btn.dataset.index), meeting);
    });
  });
}

/**
 * Toggle expanded state of a participant card.
 */
function toggleExpandedCard(index, meeting) {
  const expandedEl = document.querySelector(`.participant-card-expanded[data-index="${index}"]`);
  const expandBtn = document.querySelector(`.expand-btn[data-index="${index}"]`);
  if (!expandedEl) return;

  const isVisible = expandedEl.style.display !== 'none';

  // Collapse all other expanded cards
  document.querySelectorAll('.participant-card-expanded').forEach(el => {
    el.style.display = 'none';
  });
  document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';
  });

  if (!isVisible) {
    expandedEl.style.display = 'block';
    if (expandBtn) {
      expandBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
    }
    // Load expanded content lazily
    loadExpandedContent(index, meeting);
  }
}

/**
 * Load expanded card content (contact details, meeting history, emails, obsidian links).
 */
async function loadExpandedContent(index, meeting) {
  const container = document.getElementById(`participant-details-${index}`);
  if (!container) return;

  const participant = meeting.participants[index];
  if (!participant) return;

  const sections = [];

  // Contact Details Section
  sections.push(renderContactDetailsSection(participant));

  // Meeting History Section (async)
  sections.push(await renderMeetingHistorySection(participant));

  // Recent Emails Section (async)
  sections.push(await renderRecentEmailsSection(participant));

  // Obsidian Links Section
  sections.push(renderObsidianLinksSection(participant));

  container.innerHTML = sections.filter(Boolean).join('');

  // Set up click handlers for external links
  container.querySelectorAll('.external-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.dataset.url;
      if (url && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url);
      }
    });
  });
}

/**
 * Render contact details section (emails, phones, org, Google Contacts link).
 */
function renderContactDetailsSection(participant) {
  const items = [];

  if (participant.email) {
    items.push(`<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${escapeHtml(participant.email)}</span></div>`);
  }
  if (participant.organization || participant.company) {
    items.push(`<div class="detail-row"><span class="detail-label">Organization</span><span class="detail-value">${escapeHtml(participant.organization || participant.company)}</span></div>`);
  }
  if (participant.title) {
    items.push(`<div class="detail-row"><span class="detail-label">Title</span><span class="detail-value">${escapeHtml(participant.title)}</span></div>`);
  }
  if (participant.googleContactResource) {
    const contactUrl = `https://contacts.google.com/person/${participant.googleContactResource.replace('people/', '')}`;
    items.push(`<div class="detail-row"><a href="#" class="external-link" data-url="${contactUrl}">Open in Google Contacts</a></div>`);
  }

  if (items.length === 0) return '';
  return `<div class="expanded-section-group"><div class="expanded-section-title">Contact Details</div>${items.join('')}</div>`;
}

/**
 * Render meeting history section (count, last meeting, recent list).
 */
async function renderMeetingHistorySection(participant) {
  if (!participant.email) return '';

  try {
    const countResult = await window.electronAPI.dbGetMeetingCountForContact(participant.email);
    if (!countResult?.success || countResult.count === 0) return '';

    const meetingsResult = await window.electronAPI.dbGetMeetingsForContact(participant.email);
    const meetings = meetingsResult?.meetings || [];
    const recentMeetings = meetings.slice(0, 5);

    const listHtml = recentMeetings.map(m => {
      const date = new Date(m.date).toLocaleDateString();
      return `<div class="history-meeting-item" data-meeting-id="${escapeHtml(m.id)}">${escapeHtml(m.title)} <span class="history-date">${date}</span></div>`;
    }).join('');

    return `
      <div class="expanded-section-group">
        <div class="expanded-section-title">Meeting History (${countResult.count})</div>
        ${listHtml}
      </div>
    `;
  } catch (error) {
    console.error('[ParticipantCard] Error loading meeting history:', error);
    return '';
  }
}

/**
 * Render recent email threads section (from Gmail).
 */
async function renderRecentEmailsSection(participant) {
  if (!participant.email) return '';

  try {
    const result = await window.electronAPI.gmailGetThreadsByContact(participant.email, 5);
    if (!result?.success || !result.threads || result.threads.length === 0) return '';

    const threadsHtml = result.threads.map(t => {
      const date = t.lastMessageDate ? new Date(t.lastMessageDate).toLocaleDateString() : '';
      return `
        <div class="email-thread-item">
          <a href="#" class="external-link email-subject" data-url="${escapeHtml(t.gmailLink)}">${escapeHtml(t.subject)}</a>
          <span class="email-meta">${date} (${t.messageCount})</span>
        </div>
      `;
    }).join('');

    return `
      <div class="expanded-section-group">
        <div class="expanded-section-title">Recent Emails</div>
        ${threadsHtml}
      </div>
    `;
  } catch (error) {
    console.error('[ParticipantCard] Error loading email threads:', error);
    return '';
  }
}

/**
 * Render Obsidian links section (contact page, company page).
 */
function renderObsidianLinksSection(participant) {
  const items = [];
  const name = participant.name || participant.originalName;
  const company = participant.organization || participant.company;

  if (name) {
    items.push(`<div class="detail-row"><span class="obsidian-link-check" data-type="contact" data-name="${escapeHtml(name)}">Contact page: checking...</span></div>`);
  }
  if (company) {
    items.push(`<div class="detail-row"><span class="obsidian-link-check" data-type="company" data-name="${escapeHtml(company)}">Company page: checking...</span></div>`);
  }

  if (items.length === 0) return '';

  // Check page existence asynchronously after render
  setTimeout(async () => {
    for (const el of document.querySelectorAll('.obsidian-link-check')) {
      const type = el.dataset.type;
      const checkName = el.dataset.name;
      try {
        const exists = type === 'contact'
          ? await window.electronAPI.contactsContactPageExists(checkName)
          : await window.electronAPI.contactsCompanyPageExists(checkName);

        if (exists?.exists) {
          el.innerHTML = `${type === 'contact' ? 'Contact' : 'Company'} page exists`;
          el.classList.add('obsidian-exists');
        } else {
          const btnLabel = type === 'contact' ? 'Create Contact Page' : 'Create Company Page';
          el.innerHTML = `<button class="btn btn-outline btn-xs create-obsidian-page-btn" data-type="${type}" data-name="${escapeHtml(checkName)}">${btnLabel}</button>`;

          // Set up click handler
          el.querySelector('.create-obsidian-page-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Creating...';
            try {
              if (type === 'contact') {
                await window.electronAPI.contactsCreateContactPage({ name: checkName }, {});
              } else {
                await window.electronAPI.contactsCreateCompanyPage({ name: checkName }, {});
              }
              el.innerHTML = `${type === 'contact' ? 'Contact' : 'Company'} page created`;
              el.classList.add('obsidian-exists');
            } catch (_err) {
              btn.disabled = false;
              btn.textContent = 'Failed - retry';
            }
          });
        }
      } catch {
        el.textContent = `${type === 'contact' ? 'Contact' : 'Company'} page: unknown`;
      }
    }
  }, 100);

  return `<div class="expanded-section-group"><div class="expanded-section-title">Obsidian Vault</div>${items.join('')}</div>`;
}

/**
 * Handle "Add to Google Contacts" button click.
 */
async function handleAddToContacts(name, email, index, meeting) {
  try {
    // Infer organization from email domain
    let organization = '';
    if (email && email.includes('@')) {
      const domain = email.split('@')[1];
      if (domain && !domain.match(/gmail|yahoo|hotmail|outlook|aol|icloud/i)) {
        organization = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
      }
    }

    const result = await window.electronAPI.contactsCreateContact({
      name: name,
      email: email || undefined,
      organization: organization || undefined,
    });

    if (result?.success && result.contact) {
      console.log('[ParticipantCard] Created Google Contact:', result.contact.name);

      // Update participant data
      if (meeting.participants[index]) {
        meeting.participants[index].email = result.contact.emails?.[0] || email;
        meeting.participants[index].organization = result.contact.organization || organization;
        meeting.participants[index].googleContactResource = result.contact.resourceName;
      }

      // Re-render
      populateParticipants(meeting);
    } else {
      console.error('[ParticipantCard] Failed to create contact:', result?.error);
    }
  } catch (error) {
    console.error('[ParticipantCard] Error creating contact:', error);
  }
}

/**
 * Remove participant from card and save
 * Note: No confirmation dialog - user is already in edit mode and clicking remove is intentional
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
function showParticipantChangeInput(index, _buttonEl) {
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
 * Populate templates tab with expand/collapse and drag-and-drop reordering
 */
function populateTemplates(meeting) {
  const templatesList = document.getElementById('generatedTemplatesList');
  if (!templatesList) return;

  if (!meeting.summaries || meeting.summaries.length === 0) {
    templatesList.innerHTML = `
      <div class="placeholder-content">
        <p>No detailed summaries generated yet</p>
      </div>
    `;
    return;
  }

  // Filter out auto-summary, show only template summaries
  const templateSummaries = meeting.summaries.filter(s => s.templateId !== 'auto-summary-prompt');

  if (templateSummaries.length === 0) {
    templatesList.innerHTML = `
      <div class="placeholder-content">
        <p>No detailed summaries generated yet</p>
      </div>
    `;
    return;
  }

  templatesList.innerHTML = '';

  templateSummaries.forEach((summary, index) => {
    const card = document.createElement('div');
    card.className = 'template-summary-card';
    // Don't make entire card draggable - only drag handle triggers drag
    card.setAttribute('data-index', index);

    const isCollapsed = summary.collapsed === true;

    card.innerHTML = `
      <div class="template-summary-header">
        <div class="template-drag-handle" title="Drag to reorder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </div>
        <h4 class="template-summary-title">${escapeHtml(summary.templateName || summary.templateId || 'Untitled')}</h4>
        <button class="template-copy-btn" title="Copy to clipboard">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
        </button>
        <button class="template-delete-btn" title="Delete this section">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
        <button class="template-collapse-btn" title="${isCollapsed ? 'Expand' : 'Collapse'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="collapse-icon ${isCollapsed ? 'collapsed' : ''}">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </button>
      </div>
      <div class="template-summary-content ${isCollapsed ? 'collapsed' : ''}">${markdownToSafeHtml(summary.content || '')}</div>
    `;

    // Add click handler for collapse/expand
    const collapseBtn = card.querySelector('.template-collapse-btn');
    const copyBtn = card.querySelector('.template-copy-btn');
    const deleteBtn = card.querySelector('.template-delete-btn');
    const header = card.querySelector('.template-summary-header');
    const content = card.querySelector('.template-summary-content');

    // Copy button handler
    copyBtn.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(summary.content || '');
        // Show brief feedback
        const originalTitle = copyBtn.title;
        copyBtn.title = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.title = originalTitle;
          copyBtn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
    const icon = card.querySelector('.collapse-icon');

    const toggleCollapse = () => {
      const nowCollapsed = content.classList.toggle('collapsed');
      icon.classList.toggle('collapsed', nowCollapsed);
      collapseBtn.title = nowCollapsed ? 'Expand' : 'Collapse';
      // Update the meeting data to persist collapse state
      summary.collapsed = nowCollapsed;
    };

    collapseBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleCollapse();
    });

    // Delete button handler
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      const templateName = summary.templateName || summary.templateId || 'this section';
      if (confirm(`Delete "${templateName}"? This cannot be undone.`)) {
        deleteTemplateSummary(index, templatesList);
      }
    });

    // Allow clicking the title to toggle as well (but not the drag handle, copy, or delete buttons)
    header.addEventListener('click', e => {
      if (!e.target.closest('.template-drag-handle') &&
          !e.target.closest('.template-copy-btn') &&
          !e.target.closest('.template-delete-btn')) {
        toggleCollapse();
      }
    });

    // Drag and drop handlers - only the drag handle initiates dragging
    const dragHandle = card.querySelector('.template-drag-handle');

    // Make card draggable only when drag starts from handle
    dragHandle.addEventListener('mousedown', () => {
      card.setAttribute('draggable', 'true');
      // Clean up draggable on next mouseup (even if no drag occurred)
      const cleanup = () => {
        card.removeAttribute('draggable');
        document.removeEventListener('mouseup', cleanup);
      };
      document.addEventListener('mouseup', cleanup);
    });

    // Remove draggable after drag ends to allow text selection
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.removeAttribute('draggable');
    });

    card.addEventListener('dragstart', e => {
      // Only allow drag if it started from the handle
      if (!card.hasAttribute('draggable')) {
        e.preventDefault();
        return;
      }
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggingCard = templatesList.querySelector('.dragging');
      if (draggingCard && draggingCard !== card) {
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          templatesList.insertBefore(draggingCard, card);
        } else {
          templatesList.insertBefore(draggingCard, card.nextSibling);
        }
      }
    });

    card.addEventListener('drop', e => {
      e.preventDefault();
      // Update the order in the meeting data
      updateTemplateSummaryOrder(templatesList);
    });

    templatesList.appendChild(card);
  });
}

/**
 * Update the order of template summaries after drag-and-drop
 */
function updateTemplateSummaryOrder(templatesList) {
  if (!currentMeeting || !currentMeeting.summaries) return;

  const cards = templatesList.querySelectorAll('.template-summary-card');
  const newOrder = Array.from(cards).map(card => parseInt(card.getAttribute('data-index'), 10));

  // Get only template summaries (non-auto-summary)
  const templateSummaries = currentMeeting.summaries.filter(s => s.templateId !== 'auto-summary-prompt');
  const autoSummaries = currentMeeting.summaries.filter(s => s.templateId === 'auto-summary-prompt');

  // Reorder template summaries based on new order
  const reorderedTemplates = newOrder.map(oldIndex => templateSummaries[oldIndex]);

  // Update meeting summaries (keep auto-summaries, add reordered templates)
  currentMeeting.summaries = [...autoSummaries, ...reorderedTemplates];

  // Update data attributes to reflect new order
  cards.forEach((card, newIndex) => {
    card.setAttribute('data-index', newIndex);
  });

  console.log('[MeetingDetail] Template summaries reordered');
}

/**
 * Delete a template summary section
 */
async function deleteTemplateSummary(index, _templatesList) {
  if (!currentMeeting || !currentMeeting.summaries) return;

  // Get only template summaries (non-auto-summary)
  const templateSummaries = currentMeeting.summaries.filter(s => s.templateId !== 'auto-summary-prompt');
  const autoSummaries = currentMeeting.summaries.filter(s => s.templateId === 'auto-summary-prompt');

  // Remove the summary at the given index
  const deletedSummary = templateSummaries[index];
  templateSummaries.splice(index, 1);

  // Update meeting summaries
  currentMeeting.summaries = [...autoSummaries, ...templateSummaries];

  console.log(`[MeetingDetail] Deleted template summary: ${deletedSummary?.templateName || deletedSummary?.templateId}`);

  // Persist the deletion to disk using updateMeetingField
  try {
    await window.electronAPI.updateMeetingField(currentMeeting.id, 'summaries', currentMeeting.summaries);
    console.log(`[MeetingDetail] Template summary deletion persisted to disk`);
  } catch (err) {
    console.error('[MeetingDetail] Failed to persist deletion:', err);
  }

  // Re-render the templates list
  populateTemplates(currentMeeting);
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
 * Note: This is a stub - the main Generate button uses the template modal in renderer.js
 * This function is kept for potential future use with a dedicated button
 */
function generateTemplates(_onUpdate) {
  // The main Generate button opens the template modal via renderer.js
  // This stub exists in case a dedicated generateTemplatesBtn is added in the future
  console.log('[MeetingDetail] generateTemplates called - use main Generate button instead');
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
 * Get available model options for the regenerate modal
 * Returns array of { value, label } objects
 */
function getModelOptions() {
  const settings = loadSettings();
  const defaultModel = settings.autoSummaryProvider || 'openai-gpt-4o-mini';

  // Define all available models grouped by tier
  const models = [
    { value: 'default', label: `Default (${getModelDisplayName(defaultModel)})` },
    // Budget tier
    { value: 'openai-gpt-5-nano', label: '💰 GPT-5 nano — $0.05/$0.40' },
    { value: 'openai-gpt-4.1-nano', label: '💰 GPT-4.1 nano — $0.10/$0.40' },
    // Balanced tier
    { value: 'openai-gpt-4o-mini', label: '⚖️ GPT-4o mini — $0.15/$0.60' },
    { value: 'openai-gpt-5-mini', label: '⚖️ GPT-5 mini — $0.25/$2.00' },
    { value: 'openai-gpt-4.1-mini', label: '⚖️ GPT-4.1 mini — $0.40/$1.60' },
    // Premium tier
    { value: 'claude-haiku-4-5', label: '⭐ Claude Haiku 4.5 — $1.00/$5.00' },
    // Ultra-premium tier
    { value: 'claude-sonnet-4', label: '💎 Claude Sonnet 4 — $3.00/$15.00' },
    { value: 'claude-sonnet-4-5', label: '💎 Claude Sonnet 4.5 — $3.00/$15.00' },
  ];

  // Add Azure models if enabled
  if (settings.azureEnabled && settings.azureDeployments?.length > 0) {
    settings.azureDeployments.forEach(deployment => {
      models.push({
        value: `azure-${deployment.name}`,
        label: `☁️ ${deployment.displayName} — $${deployment.inputPrice}/$${deployment.outputPrice}`,
      });
    });
  }

  return models;
}

/**
 * Get display name for a model preference value
 */
function getModelDisplayName(modelValue) {
  const names = {
    'openai-gpt-5-nano': 'GPT-5 nano',
    'openai-gpt-4.1-nano': 'GPT-4.1 nano',
    'openai-gpt-4o-mini': 'GPT-4o mini',
    'openai-gpt-5-mini': 'GPT-5 mini',
    'openai-gpt-4.1-mini': 'GPT-4.1 mini',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-sonnet-4': 'Claude Sonnet 4',
    'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  };
  return names[modelValue] || modelValue;
}

/**
 * Regenerate summary for the meeting
 * Shows a modal with options for replace/append and model selection
 */
async function regenerateSummary(onUpdate) {
  if (!currentMeetingId) return;

  const btn = document.getElementById('regenerateSummaryBtn');
  if (!btn) return;

  // Build model options for the dropdown
  const modelOptions = getModelOptions();
  const modelOptionsHtml = modelOptions
    .map(m => `<option value="${m.value}">${escapeHtml(m.label)}</option>`)
    .join('');

  const modalBody = `
    <div style="display: flex; flex-direction: column; gap: 20px;">
      <div>
        <label style="font-weight: 600; margin-bottom: 8px; display: block;">Summary Mode</label>
        <div style="display: flex; flex-direction: column; gap: 8px;" id="regenerateModeOptions">
          <label class="regenerate-option selected" data-value="replace">
            <input type="radio" name="regenerateMode" value="replace" checked>
            <div class="regenerate-option-text">
              <strong>Replace</strong>
              <span>Regenerate and replace the existing summary</span>
            </div>
          </label>
          <label class="regenerate-option" data-value="append">
            <input type="radio" name="regenerateMode" value="append">
            <div class="regenerate-option-text">
              <strong>Append</strong>
              <span>Add new summary below the existing content</span>
            </div>
          </label>
        </div>
      </div>
      <div>
        <label for="regenerateModelSelect" style="font-weight: 600; margin-bottom: 8px; display: block;">AI Model</label>
        <select id="regenerateModelSelect" style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-primary); font-size: 14px;">
          ${modelOptionsHtml}
        </select>
        <small style="color: var(--text-secondary); font-size: 11px; margin-top: 4px; display: block;">Select a model for this generation only (won't change your default setting)</small>
      </div>
    </div>
  `;

  createModal({
    title: 'Regenerate Summary',
    body: modalBody,
    confirmText: 'Regenerate',
    cancelText: 'Cancel',
    size: 'medium',
    onConfirm: async () => {
      // Get selected options
      const modeInput = document.querySelector('input[name="regenerateMode"]:checked');
      const modelSelect = document.getElementById('regenerateModelSelect');
      const mode = modeInput ? modeInput.value : 'replace';
      const model = modelSelect ? modelSelect.value : 'default';

      // Close modal first, then start regeneration
      await performRegeneration(mode, model, onUpdate);
    },
  });

  // Add click handlers to toggle visual selection state on radio options
  setTimeout(() => {
    const options = document.querySelectorAll('.regenerate-option');
    options.forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected from all options
        options.forEach(opt => opt.classList.remove('selected'));
        // Add selected to clicked option
        option.classList.add('selected');
        // Check the radio inside
        const radio = option.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });
  }, 0);
}

/**
 * Perform the actual summary regeneration (non-blocking - runs in background)
 */
async function performRegeneration(mode, model, _onUpdate) {
  const btn = document.getElementById('regenerateSummaryBtn');

  console.log(`[MeetingDetail] Starting background summary regeneration for meeting: ${currentMeetingId}`);
  console.log(`[MeetingDetail] Mode: ${mode}, Model: ${model}`);

  // Brief button state change to indicate starting
  if (btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Starting...';

    // Re-enable after a short delay
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText;
    }, 500);
  }

  const options = {
    mode, // 'replace' or 'append'
    model: model === 'default' ? null : model, // null means use default from settings
  };

  try {
    const result = await window.electronAPI.generateMeetingSummary(currentMeetingId, options);

    if (result.success) {
      // Background task started successfully
      console.log(`[MeetingDetail] Background task started: ${result.taskId}`);

      // The existing summary-generated listener will handle updating the UI when complete
      // (see initializeMeetingDetail which sets up onSummaryGenerated listener)
    } else {
      // Immediate failure (validation error, meeting not found, etc.)
      console.error('[MeetingDetail] Failed to start summary regeneration:', result.error);
      notifyError(result.error, { prefix: 'Summary generation failed:', context: 'MeetingDetail' });
    }
  } catch (error) {
    console.error('[MeetingDetail] Error starting summary regeneration:', error);
    notifyError(error, { prefix: 'Failed to start summary generation:', context: 'MeetingDetail' });
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
