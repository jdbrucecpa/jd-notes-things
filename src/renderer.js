/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 */

import './index.css';
import { sanitizeHtml, escapeHtml } from './renderer/security.js';
import { initializeSettingsUI, openSettingsTab } from './renderer/settings.js';
import { initializeTemplateEditor } from './renderer/templates.js';
import { initializeRoutingEditor } from './renderer/routing.js';
import { initializeMeetingDetail, clearMeetingDetail, updateMeetingDetail } from './renderer/meetingDetail.js';
import { initAppSettingsUI } from './renderer/appSettings.js';
import { initContactsPage, openContactsView } from './renderer/contacts.js';
import { initQuickSearch } from './renderer/quickSearch.js';

// Create empty meetings data structure to be filled from the file
const meetingsData = {
  upcomingMeetings: [],
  pastMeetings: [],
};

// Create empty arrays that will be filled from file
const upcomingMeetings = [];
const pastMeetings = [];

// Calendar meetings from Google Calendar
const calendarMeetings = [];

// Group past meetings by date
let pastMeetingsByDate = {};

// Global recording state variables
window.isRecording = false;
window.currentRecordingId = null;

// Search/filter state
const searchState = {
  query: '',
  filters: {
    dateFrom: null,
    dateTo: null,
  },
};

// Bulk selection state
const bulkSelectionState = {
  enabled: false,
  selectedMeetings: new Set(),
};

// Platform configuration for meeting type icons (UI-1)
const platformConfig = {
  zoom: {
    name: 'Zoom',
    color: '#2D8CFF',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6.5C4 5.67 4.67 5 5.5 5h9c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-6zM17 8l3.5-2.5v8L17 11V8z" fill="currentColor"/>
    </svg>`,
  },
  teams: {
    name: 'Teams',
    color: '#6264A7',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.2 6H16V5c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v1H6.8c-.99 0-1.8.81-1.8 1.8v8.4c0 .99.81 1.8 1.8 1.8h12.4c.99 0 1.8-.81 1.8-1.8V7.8c0-.99-.81-1.8-1.8-1.8zM12 6h2v1h-2V6zm1.5 9h-5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h5c.28 0 .5.22.5.5s-.22.5-.5.5zm2-3h-7c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h7c.28 0 .5.22.5.5s-.22.5-.5.5z" fill="currentColor"/>
    </svg>`,
  },
  'google-meet': {
    name: 'Google Meet',
    color: '#0F9D58',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 6c-3.87 0-7 3.13-7 7s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zm3.5 9.5l-4.5-2.5V9l4.5 2.5v4z" fill="currentColor"/>
      <path d="M19 10l2-2v8l-2-2v-4z" fill="currentColor"/>
    </svg>`,
  },
  webex: {
    name: 'Webex',
    color: '#00BCEB',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-6h4v2h-4v-2zm0-6h4v4h-4V8z" fill="currentColor"/>
    </svg>`,
  },
  whereby: {
    name: 'Whereby',
    color: '#6366F1',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/>
    </svg>`,
  },
  'in-person': {
    name: 'In-Person',
    color: '#8B5CF6',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/>
    </svg>`,
  },
  unknown: {
    name: 'Meeting',
    color: '#999999',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/>
    </svg>`,
  },
};

/**
 * Get platform icon HTML for a given platform type
 * @param {string} platform - Platform identifier (zoom, teams, google-meet, etc.)
 * @returns {string} HTML string for the platform icon
 */
function getPlatformIconHtml(platform) {
  // Normalize platform to lowercase for matching config keys
  const normalizedPlatform = (platform || 'unknown').toLowerCase();
  const config = platformConfig[normalizedPlatform] || platformConfig.unknown;
  return `
    <div class="meeting-icon platform-icon" style="background-color: ${config.color}20;" title="${config.name}">
      <span style="color: ${config.color};">${config.icon}</span>
    </div>
  `;
}

/**
 * Get platform name for display
 * @param {string} platform - Platform identifier
 * @returns {string} Human-readable platform name
 */
function getPlatformName(platform) {
  // Normalize platform to lowercase for matching config keys
  const normalizedPlatform = (platform || 'unknown').toLowerCase();
  return platformConfig[normalizedPlatform]?.name || platformConfig.unknown.name;
}

/**
 * Get platform color
 * @param {string} platform - Platform identifier
 * @returns {string} Platform color hex
 */
function getPlatformColor(platform) {
  // Normalize platform to lowercase for matching config keys
  const normalizedPlatform = (platform || 'unknown').toLowerCase();
  return platformConfig[normalizedPlatform]?.color || platformConfig.unknown.color;
}

// Function to toggle bulk selection mode
function toggleBulkSelectionMode() {
  console.log('[Bulk] Toggling selection mode. Current:', bulkSelectionState.enabled);
  bulkSelectionState.enabled = !bulkSelectionState.enabled;
  console.log('[Bulk] New mode:', bulkSelectionState.enabled);

  // Show/hide checkboxes on all meeting cards
  const checkboxes = document.querySelectorAll('.meeting-select-checkbox');
  console.log('[Bulk] Found checkboxes:', checkboxes.length);
  checkboxes.forEach(checkbox => {
    checkbox.style.display = bulkSelectionState.enabled ? 'flex' : 'none';
    console.log('[Bulk] Checkbox display set to:', checkbox.style.display);
  });

  // Disable/enable individual delete buttons when in bulk mode
  const deleteButtons = document.querySelectorAll('.delete-meeting-btn');
  deleteButtons.forEach(btn => {
    btn.disabled = bulkSelectionState.enabled;
    btn.style.opacity = bulkSelectionState.enabled ? '0.3' : '1';
    btn.style.cursor = bulkSelectionState.enabled ? 'not-allowed' : 'pointer';
  });

  // Show/hide the multi-select toggle button (hide when active, show when inactive)
  const toggleBtn = document.getElementById('toggleBulkSelectBtn');
  if (toggleBtn) {
    toggleBtn.style.display = bulkSelectionState.enabled ? 'none' : 'inline-flex';
  }

  // Update toolbar visibility
  updateBulkActionsToolbar();

  // If disabling, clear selections
  if (!bulkSelectionState.enabled) {
    deselectAllMeetings();
  }
}

// Function to update bulk actions toolbar
function updateBulkActionsToolbar() {
  const toolbar = document.getElementById('bulkActionsToolbar');
  const countSpan = document.getElementById('bulkSelectionCount');
  const exportBtn = document.getElementById('batchExportBtn');
  const deleteBtn = document.getElementById('batchDeleteBtn');

  if (!toolbar || !countSpan) return;

  const count = bulkSelectionState.selectedMeetings.size;

  // Show/hide toolbar based on selection mode and count
  if (bulkSelectionState.enabled && count > 0) {
    toolbar.style.display = 'flex';
    countSpan.textContent = `${count} selected`;
    if (exportBtn) {
      exportBtn.disabled = false;
    }
    if (deleteBtn) {
      deleteBtn.disabled = false;
    }
  } else if (bulkSelectionState.enabled) {
    toolbar.style.display = 'flex';
    countSpan.textContent = '0 selected';
    if (exportBtn) {
      exportBtn.disabled = true;
    }
    if (deleteBtn) {
      deleteBtn.disabled = true;
    }
  } else {
    toolbar.style.display = 'none';
  }
}

// Function to select all meetings
function selectAllMeetings() {
  const checkboxes = document.querySelectorAll('.meeting-checkbox');

  checkboxes.forEach(checkbox => {
    const meetingId = checkbox.dataset.meetingId;
    if (meetingId) {
      checkbox.checked = true;
      bulkSelectionState.selectedMeetings.add(meetingId);
      const card = checkbox.closest('.meeting-card');
      if (card) {
        card.classList.add('selected');
      }
    }
  });

  updateBulkActionsToolbar();
}

// Function to deselect all meetings
function deselectAllMeetings() {
  const checkboxes = document.querySelectorAll('.meeting-checkbox');

  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
    const card = checkbox.closest('.meeting-card');
    if (card) {
      card.classList.remove('selected');
    }
  });

  bulkSelectionState.selectedMeetings.clear();
  updateBulkActionsToolbar();
}

// Function to batch export selected meetings to Obsidian
async function batchExportToObsidian() {
  const selectedIds = Array.from(bulkSelectionState.selectedMeetings);

  if (selectedIds.length === 0) {
    console.warn('No meetings selected for export');
    return;
  }

  console.log(`Exporting ${selectedIds.length} meetings to Obsidian...`);

  // Get all meetings
  const allMeetings = [...upcomingMeetings, ...pastMeetings];

  // Filter selected meetings
  const meetingsToExport = allMeetings.filter(m => selectedIds.includes(m.id));

  let successCount = 0;
  let errorCount = 0;

  // Export each meeting
  for (const meeting of meetingsToExport) {
    try {
      console.log(`Exporting meeting: ${meeting.title} (${meeting.id})`);

      const result = await window.electronAPI.obsidianExportMeeting(meeting.id);

      if (result.success) {
        successCount++;
        console.log(`Successfully exported: ${meeting.title}`);

        // Update meeting with Obsidian link
        meeting.obsidianLink = result.obsidianLink;
        meeting.vaultPath = result.vaultPath;
      } else {
        errorCount++;
        console.error(`Failed to export ${meeting.title}:`, result.error);
      }
    } catch (error) {
      errorCount++;
      console.error(`Error exporting ${meeting.title}:`, error);
    }
  }

  console.log(`Batch export complete: ${successCount} succeeded, ${errorCount} failed`);

  // Save updated meetings data
  await saveMeetingsData();

  // Refresh UI
  renderMeetings();

  // Show success message
  alert(`Exported ${successCount} of ${selectedIds.length} meetings to Obsidian`);

  // Clear selection and exit bulk mode
  toggleBulkSelectionMode();
}

// Function to batch delete selected meetings
async function batchDeleteMeetings() {
  const selectedIds = Array.from(bulkSelectionState.selectedMeetings);

  if (selectedIds.length === 0) {
    console.warn('No meetings selected for deletion');
    return;
  }

  // Confirm deletion
  const confirmMessage = `Are you sure you want to delete ${selectedIds.length} meeting${selectedIds.length > 1 ? 's' : ''}? This cannot be undone.`;
  if (!confirm(confirmMessage)) {
    return;
  }

  console.log(`Deleting ${selectedIds.length} meetings...`);

  let successCount = 0;
  let errorCount = 0;

  // Delete each meeting
  for (const meetingId of selectedIds) {
    try {
      console.log(`Deleting meeting: ${meetingId}`);

      const result = await window.electronAPI.deleteMeeting(meetingId);

      if (result.success) {
        successCount++;
        console.log(`Successfully deleted: ${meetingId}`);

        // Remove from local arrays
        const pastIndex = pastMeetings.findIndex(m => m.id === meetingId);
        if (pastIndex !== -1) {
          pastMeetings.splice(pastIndex, 1);
        }

        const upcomingIndex = upcomingMeetings.findIndex(m => m.id === meetingId);
        if (upcomingIndex !== -1) {
          upcomingMeetings.splice(upcomingIndex, 1);
        }
      } else {
        errorCount++;
        console.error(`Failed to delete ${meetingId}:`, result.error);
      }
    } catch (error) {
      errorCount++;
      console.error(`Error deleting ${meetingId}:`, error);
    }
  }

  console.log(`Batch delete complete: ${successCount} succeeded, ${errorCount} failed`);

  // Refresh UI
  renderMeetings();

  // Show success message
  if (errorCount === 0) {
    alert(`Successfully deleted ${successCount} meeting${successCount > 1 ? 's' : ''}`);
  } else {
    alert(`Deleted ${successCount} meeting${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
  }

  // Clear selection and exit bulk mode
  toggleBulkSelectionMode();
}

// Function to check if there's an active recording for the current note
// Note: Currently unused - kept for future feature
// eslint-disable-next-line no-unused-vars
async function checkActiveRecordingState() {
  if (!currentEditingMeetingId) return;

  try {
    console.log('Checking active recording state for note:', currentEditingMeetingId);
    const result = await window.electronAPI.getActiveRecordingId(currentEditingMeetingId);

    if (result.success && result.data) {
      console.log('Found active recording for current note:', result.data);
      updateRecordingButtonUI(true, result.data.recordingId);
    } else {
      console.log('No active recording found for note');
      updateRecordingButtonUI(false, null);
    }
  } catch (error) {
    console.error('Error checking recording state:', error);
  }
}

// Function to update the recording button UI
function updateRecordingButtonUI(isActive, recordingId) {
  const recordButton = document.getElementById('recordButton');
  if (!recordButton) return;

  // Get the elements inside the button
  const recordIcon = recordButton.querySelector('.record-icon');
  const stopIcon = recordButton.querySelector('.stop-icon');

  if (isActive) {
    // Recording is active
    console.log('Updating UI for active recording:', recordingId);
    window.isRecording = true;
    window.currentRecordingId = recordingId;

    // Update button UI
    recordButton.classList.add('recording');
    recordIcon.style.display = 'none';
    stopIcon.style.display = 'block';
  } else {
    // No active recording
    console.log('Updating UI for inactive recording');
    window.isRecording = false;
    window.currentRecordingId = null;

    // Update button UI
    recordButton.classList.remove('recording');
    recordIcon.style.display = 'block';
    stopIcon.style.display = 'none';
  }
}

// Function to format date for section headers
function formatDateHeader(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if date is today, yesterday, or earlier
  if (date.toDateString() === now.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    // Format as "Fri, Apr 25" or similar
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
}

// We'll initialize pastMeetings and pastMeetingsByDate when we load data from file

// Save meetings data back to file
async function saveMeetingsData() {
  // Save to localStorage as a backup
  localStorage.setItem('meetingsData', JSON.stringify(meetingsData));

  // Save to the actual file using IPC
  try {
    console.log('Saving meetings data to file...');
    console.log('[Save] Data being saved:', {
      upcomingCount: meetingsData.upcomingMeetings?.length || 0,
      pastCount: meetingsData.pastMeetings?.length || 0,
      firstPastMeeting: meetingsData.pastMeetings?.[0] ? {
        id: meetingsData.pastMeetings[0].id,
        title: meetingsData.pastMeetings[0].title,
        participantCount: meetingsData.pastMeetings[0].participants?.length || 0,
        transcriptLength: meetingsData.pastMeetings[0].transcript?.length || 0,
        firstSpeakers: meetingsData.pastMeetings[0].transcript?.slice(0, 3).map(t => t.speaker) || []
      } : null
    });
    const result = await window.electronAPI.saveMeetingsData(meetingsData);
    if (result.success) {
      console.log('Meetings data saved successfully to file');
    } else {
      console.error('Failed to save meetings data to file:', result.error);
    }
  } catch (error) {
    console.error('Error saving meetings data to file:', error);
  }
}

// Keep track of which meeting is being edited
let currentEditingMeetingId = null;

// Function to save the current note
async function saveCurrentNote() {
  const editorElement = document.getElementById('simple-editor');
  const noteTitleElement = document.getElementById('noteTitle');

  // Early exit if elements aren't available
  if (!editorElement || !noteTitleElement) {
    console.warn('Cannot save note: Editor elements not found');
    return;
  }

  // Early exit if no current meeting ID
  if (!currentEditingMeetingId) {
    console.warn('Cannot save note: No active meeting ID');
    return;
  }

  // Get title text, defaulting to "New Note" if empty
  const noteTitle = noteTitleElement.textContent.trim() || 'New Note';

  // Set title back to element in case it was empty
  if (!noteTitleElement.textContent.trim()) {
    noteTitleElement.textContent = noteTitle;
  }

  // Find which meeting is currently active by ID
  const activeMeeting = [...upcomingMeetings, ...pastMeetings].find(
    m => m.id === currentEditingMeetingId
  );

  if (activeMeeting) {
    console.log(`Saving note with ID: ${currentEditingMeetingId}, Title: ${noteTitle}`);

    // Get the current content from the editor
    const content = editorElement.value;
    console.log(`Note content length: ${content.length} characters`);

    // Update the title and content in the meeting object
    activeMeeting.title = noteTitle;
    activeMeeting.content = content;

    // Update the data arrays directly to make sure they stay in sync
    const pastIndex = meetingsData.pastMeetings.findIndex(m => m.id === currentEditingMeetingId);
    if (pastIndex !== -1) {
      meetingsData.pastMeetings[pastIndex].title = noteTitle;
      meetingsData.pastMeetings[pastIndex].content = content;
      console.log('Updated meeting in pastMeetings array');
    }

    const upcomingIndex = meetingsData.upcomingMeetings.findIndex(
      m => m.id === currentEditingMeetingId
    );
    if (upcomingIndex !== -1) {
      meetingsData.upcomingMeetings[upcomingIndex].title = noteTitle;
      meetingsData.upcomingMeetings[upcomingIndex].content = content;
      console.log('Updated meeting in upcomingMeetings array');
    }

    // Also update the subtitle if it's a date-based one
    const dateObj = new Date(activeMeeting.date);
    if (dateObj) {
      document.getElementById('noteDate').textContent = formatDate(dateObj);
    }

    try {
      // Save the data to file
      await saveMeetingsData();
      console.log('Note saved successfully:', noteTitle);
    } catch (error) {
      console.error('Error saving note:', error);
    }
  } else {
    console.error(`Cannot save note: Meeting not found with ID: ${currentEditingMeetingId}`);

    // Log all available meetings for debugging
    console.log(
      'Available meeting IDs:',
      [...upcomingMeetings, ...pastMeetings].map(m => m.id).join(', ')
    );
  }
}

// Format date for display in the note header
function formatDate(date) {
  const options = { month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Simple debounce function
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Show toast notification
function showToast(message, type = 'info') {
  console.log('[Toast] Showing:', message, 'Type:', type);

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease-out;
    max-width: 400px;
  `;

  // Set background color based on type
  const colors = {
    success: '#4CAF50',
    error: '#F44336',
    warning: '#FF9800',
    info: '#2196F3',
  };
  toast.style.backgroundColor = colors[type] || colors.info;
  toast.textContent = message;

  document.body.appendChild(toast);
  console.log('[Toast] Element appended to body, z-index:', toast.style.zIndex);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Make showToast available globally for other modules
window.showToast = showToast;

// Clear search function (called from empty state button)
window.clearSearch = function () {
  searchState.query = '';
  searchState.filters.dateFrom = null;
  searchState.filters.dateTo = null;

  // Clear search input
  const searchInput = document.querySelector('.search-input');
  if (searchInput) {
    searchInput.value = '';
  }

  // Re-render meetings
  renderMeetings();
};

// ========================================
// Display AI Generated Summaries
// ========================================

// Obsolete function removed - summaries are now displayed via updateMeetingDetail() in meetingDetail.js

// Markdown conversion is now handled by the security module
// using the marked library + DOMPurify sanitization
// See: src/renderer/security.js - markdownToSafeHtml()

// Function to create meeting card elements
function createMeetingCard(meeting) {
  const card = document.createElement('div');
  card.className = 'meeting-card';
  card.dataset.id = meeting.id;

  let iconHtml = '';

  // UI-1: Use platform-specific icons if platform is available
  if (meeting.platform && meeting.platform !== 'unknown') {
    iconHtml = getPlatformIconHtml(meeting.platform);
  } else if (meeting.type === 'profile') {
    iconHtml = `
      <div class="profile-pic">
        <img src="https://via.placeholder.com/40" alt="Profile">
      </div>
    `;
  } else if (meeting.type === 'calendar') {
    iconHtml = `
      <div class="meeting-icon calendar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3.01 4.9 3.01 6L3 20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 20H5V10H19V20ZM19 8H5V6H19V8ZM9 14H7V12H9V14ZM13 14H11V12H13V14ZM17 14H15V12H17V14ZM9 18H7V16H9V18ZM13 18H11V16H13V18ZM17 18H15V16H17V18Z" fill="#6947BD"/>
        </svg>
      </div>
    `;
  } else if (meeting.type === 'document') {
    iconHtml = `
      <div class="meeting-icon document">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4.01 2.9 4.01 4L4 20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM16 18H8V16H16V18ZM16 14H8V12H16V14ZM13 9V3.5L18.5 9H13Z" fill="#4CAF50"/>
        </svg>
      </div>
    `;
  } else {
    // Default to unknown platform icon for meetings without specific type
    iconHtml = getPlatformIconHtml('unknown');
  }

  // Format date and time
  const dateObj = new Date(meeting.date);
  const dateOptions = { month: 'short', day: 'numeric' };
  const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  const dateStr = dateObj.toLocaleDateString('en-US', dateOptions);
  const timeStr = dateObj.toLocaleTimeString('en-US', timeOptions);

  // Duration
  let durationStr = '';
  if (meeting.duration) {
    const minutes = Math.round(meeting.duration / 60);
    durationStr = `${minutes} min`;
  }

  // Participant names
  let participantsStr = 'No participants';
  if (meeting.participants && meeting.participants.length > 0) {
    const names = meeting.participants.map(p => p.name || 'Unknown').slice(0, 3);
    participantsStr = names.join(', ');
    if (meeting.participants.length > 3) {
      participantsStr += ` +${meeting.participants.length - 3}`;
    }
  }

  // Obsidian sync status
  const isSynced = !!(meeting.obsidianLink || meeting.vaultPath);
  const syncStatus = isSynced ? 'Synced' : 'Not synced';
  const syncClass = isSynced ? 'synced' : 'not-synced';

  // Build metadata line: Date + Time Duration | Participants | Sync Status
  const metadataHtml = `
    <div class="meeting-metadata">
      <span class="meeting-meta-date">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}${durationStr ? ` (${escapeHtml(durationStr)})` : ''}</span>
      <span class="meeting-meta-separator">•</span>
      <span class="meeting-meta-participants">${escapeHtml(participantsStr)}</span>
      <span class="meeting-meta-separator">•</span>
      <span class="meeting-meta-sync ${syncClass}">${syncStatus}</span>
    </div>
  `;

  // Set card HTML (without checkbox - we'll add it programmatically)
  card.innerHTML = sanitizeHtml(`
    <div class="meeting-icon-container">
      ${iconHtml}
    </div>
    <div class="meeting-content">
      <div class="meeting-title">${escapeHtml(meeting.title)}</div>
      ${metadataHtml}
    </div>
    <div class="meeting-actions">
      <button class="delete-meeting-btn" data-id="${escapeHtml(meeting.id)}" title="Delete note">
      </button>
    </div>
  `);

  // Create delete button SVG programmatically (after sanitization) to avoid DOMPurify stripping it
  const deleteBtn = card.querySelector('.delete-meeting-btn');
  if (deleteBtn) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z');
    path.setAttribute('fill', 'currentColor');

    svg.appendChild(path);
    deleteBtn.appendChild(svg);
  }

  // Create checkbox programmatically (after sanitization) to avoid DOMPurify stripping it
  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'meeting-select-checkbox';
  checkboxContainer.style.display = 'none';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'meeting-checkbox';
  checkbox.dataset.meetingId = meeting.id;

  checkbox.addEventListener('change', (e) => {
    e.stopPropagation(); // Prevent card click event
    if (e.target.checked) {
      bulkSelectionState.selectedMeetings.add(meeting.id);
      card.classList.add('selected');
    } else {
      bulkSelectionState.selectedMeetings.delete(meeting.id);
      card.classList.remove('selected');
    }
    updateBulkActionsToolbar();
  });

  checkboxContainer.appendChild(checkbox);
  card.insertBefore(checkboxContainer, card.firstChild);

  // Add click handler to card for toggling selection in bulk mode
  card.addEventListener('click', (e) => {
    // Only toggle if in bulk selection mode
    if (bulkSelectionState.enabled) {
      // Don't toggle if clicking the checkbox itself or delete button
      if (e.target.closest('.meeting-checkbox') || e.target.closest('.delete-meeting-btn')) {
        return;
      }

      // Toggle the checkbox
      checkbox.checked = !checkbox.checked;

      // Trigger the change event to update selection state
      checkbox.dispatchEvent(new Event('change'));
    }
  });

  return card;
}

// Function to create calendar meeting card
function createCalendarMeetingCard(meeting) {
  const card = document.createElement('div');
  card.className = 'meeting-card calendar-meeting';
  card.dataset.id = meeting.id;

  // UI-1: Use platform-specific icon from global config
  const platformName = getPlatformName(meeting.platform);

  // Format the meeting time
  const startTime = new Date(meeting.startTime);
  const endTime = new Date(meeting.endTime);
  const timeString = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Sanitize calendar meeting title and IDs to prevent XSS
  card.innerHTML = sanitizeHtml(`
    ${getPlatformIconHtml(meeting.platform)}
    <div class="meeting-content">
      <div class="meeting-title">${escapeHtml(meeting.title)}</div>
      <div class="meeting-time">${escapeHtml(timeString)} • ${escapeHtml(platformName)}</div>
      <div class="meeting-participants">${meeting.participants.length} participant${meeting.participants.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="meeting-actions">
      ${
        meeting.meetingLink
          ? `
        <button class="join-calendar-meeting-btn" data-id="${escapeHtml(meeting.id)}" data-link="${escapeHtml(meeting.meetingLink)}" title="Join meeting">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/>
          </svg>
        </button>
      `
          : ''
      }
      <button class="record-calendar-meeting-btn" data-id="${escapeHtml(meeting.id)}" title="Record meeting">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `);

  return card;
}

// Google authentication state (unified for Calendar and Contacts)
let googleAuthenticated = false;
let contactsCount = 0;

// Function to initialize Google integration (unified for Calendar and Contacts)
async function initializeGoogle() {
  try {
    console.log('Initializing Google integration...');
    const authResult = await window.electronAPI.googleIsAuthenticated();
    const statusResult = await window.electronAPI.googleGetStatus();

    // BF-1 Fix: Check authResult.authenticated, not the object itself
    const isAuthenticated = authResult && authResult.success && authResult.authenticated;

    if (isAuthenticated && statusResult.success) {
      console.log('Google already authenticated');
      googleAuthenticated = true;
      contactsCount = statusResult.contactCount || 0;
      updateGoogleStatus(true);
      return true;
    } else {
      console.log('Google not authenticated');
      googleAuthenticated = false;
      updateGoogleStatus(false);
      return false;
    }
  } catch (error) {
    console.error('Error initializing Google integration:', error);
    updateGoogleStatus(false);
    return false;
  }
}

// Function to update Google button UI
function updateGoogleStatus(isConnected) {
  const googleBtn = document.getElementById('googleBtn');
  if (!googleBtn) return;

  if (isConnected) {
    googleBtn.classList.add('connected');
    googleBtn.title = `Google Connected (${contactsCount} contacts) - Click to disconnect`;
  } else {
    googleBtn.classList.remove('connected');
    googleBtn.title = 'Connect Google (Calendar + Contacts)';
  }
}

// Function to handle Google button click
async function handleGoogleButtonClick() {
  const googleBtn = document.getElementById('googleBtn');
  if (!googleBtn) return;

  if (googleAuthenticated) {
    // Already connected - show disconnect option
    if (confirm('Disconnect Google? Calendar meetings and speaker matching will be disabled.')) {
      try {
        const result = await window.electronAPI.googleSignOut();
        if (result.success) {
          console.log('Google disconnected');
          googleAuthenticated = false;
          contactsCount = 0;
          updateGoogleStatus(false);
          calendarMeetings.length = 0; // Clear calendar meetings
          renderMeetings(); // Re-render without calendar meetings
        }
      } catch (error) {
        console.error('Error disconnecting Google:', error);
      }
    }
  } else {
    // Not connected - start OAuth flow
    try {
      googleBtn.disabled = true;
      googleBtn.textContent = 'Connecting...';

      const result = await window.electronAPI.googleOpenAuthWindow();

      if (result.success) {
        console.log('Google authentication successful');
        googleAuthenticated = true;

        // Get contact count
        const statusResult = await window.electronAPI.googleGetStatus();
        if (statusResult.success) {
          contactsCount = statusResult.contactCount || 0;
          console.log(`Loaded ${contactsCount} contacts`);
        }

        updateGoogleStatus(true);

        // Fetch calendar meetings after successful authentication
        await fetchCalendarMeetings();
      } else {
        console.error('Google authentication failed:', result.error);
        alert('Failed to connect Google: ' + result.error);
      }
    } catch (error) {
      console.error('Error during Google authentication:', error);
      alert('Error connecting Google: ' + error.message);
    } finally {
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <span id="googleStatus" class="google-status"></span>
      `;
    }
  }
}

// Function to fetch calendar meetings from Google Calendar
async function fetchCalendarMeetings() {
  try {
    console.log('Fetching calendar meetings...');
    const result = await window.electronAPI.getCalendarMeetings(24); // Next 24 hours

    if (result.success) {
      console.log(`Fetched ${result.meetings.length} calendar meetings`);
      calendarMeetings.length = 0; // Clear existing
      calendarMeetings.push(...result.meetings);
      renderMeetings(); // Re-render to show updated calendar
    } else {
      console.error('Failed to fetch calendar meetings:', result.error);
      if (result.error.includes('Not authenticated')) {
        // Show authentication needed UI
        console.log('Calendar authentication required');
      }
    }
  } catch (error) {
    console.error('Error fetching calendar meetings:', error);
  }
}

// ===================================================================
// End Google Integration
// ===================================================================

// Function to show home view
function showHomeView() {
  document.getElementById('homeView').style.display = 'block';
  document.getElementById('editorView').style.display = 'none';
  document.getElementById('newNoteBtn').style.display = 'block';
  document.getElementById('toggleSidebar').style.display = 'none';

  // Hide navigation buttons when on home
  const homeButton = document.getElementById('homeButton');
  const backButton = document.getElementById('backButton');
  if (homeButton) homeButton.style.display = 'none';
  if (backButton) backButton.style.display = 'none';

  // Hide the entire floating controls section on home page
  const floatingControls = document.querySelector('.floating-controls');
  if (floatingControls) {
    floatingControls.style.display = 'none';
  }

  // Show Record Zoom Meeting button and set its state based on meeting detection
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    // Always show the button
    joinMeetingBtn.style.display = 'flex';
    joinMeetingBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/>
      </svg>
      Record Zoom Meeting
    `;

    // Enable/disable based on meeting detection
    if (window.meetingDetected) {
      joinMeetingBtn.disabled = false;
    } else {
      joinMeetingBtn.disabled = true;
    }
  }
}

// Function to update Obsidian button state
function updateObsidianButton(meeting) {
  const obsidianButton = document.getElementById('obsidianButton');
  const obsidianButtonText = document.getElementById('obsidianButtonText');

  if (!obsidianButton || !obsidianButtonText) return;

  // Show button if meeting has content or summaries
  if (meeting && (meeting.content || (meeting.summaries && meeting.summaries.length > 0))) {
    obsidianButton.style.display = 'flex';

    // Update button text and style based on publish status
    if (meeting.obsidianLink) {
      obsidianButtonText.textContent = 'Republish to Obsidian';
      obsidianButton.classList.add('published');
    } else {
      obsidianButtonText.textContent = 'Publish to Obsidian';
      obsidianButton.classList.remove('published');
    }
  } else {
    // Hide button if no content
    obsidianButton.style.display = 'none';
  }
}

// Function to show editor view
function showEditorView(meetingId) {
  console.log(`Showing editor view for meeting ID: ${meetingId}`);

  // Make the views visible/hidden
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('editorView').style.display = 'block';
  document.getElementById('newNoteBtn').style.display = 'none';
  document.getElementById('toggleSidebar').style.display = 'none'; // Hide the sidebar toggle

  // Show Home button (always visible when not on home)
  const homeButton = document.getElementById('homeButton');
  if (homeButton) {
    homeButton.style.display = 'block';
  }

  // Show Back button only if there's a navigation context (e.g., coming from contacts)
  const backButton = document.getElementById('backButton');
  const backButtonText = document.getElementById('backButtonText');
  const contactContext = window.getContactNavigationContext ? window.getContactNavigationContext() : null;

  if (contactContext && contactContext.type === 'contact' && contactContext.contact) {
    if (backButton) backButton.style.display = 'flex';
    if (backButtonText) backButtonText.textContent = contactContext.contact.name || 'Contact';
  } else {
    if (backButton) backButton.style.display = 'none';
  }

  // Always hide the join meeting button when in editor view
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    joinMeetingBtn.style.display = 'none';
  }

  // Find the meeting in either upcoming or past meetings
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

  if (!meeting) {
    console.error(`Meeting not found: ${meetingId}`);
    return;
  }

  // Set the current editing meeting ID
  currentEditingMeetingId = meetingId;
  console.log(`Now editing meeting: ${meetingId} - ${meeting.title}`);
  console.log('[Renderer] Meeting data being passed to detail view:', {
    participantCount: meeting.participants?.length || 0,
    participants: meeting.participants,
    transcriptLength: meeting.transcript?.length || 0,
    firstSpeaker: meeting.transcript?.[0]?.speakerName || meeting.transcript?.[0]?.speaker || 'N/A',
    allSpeakers: meeting.transcript?.map(t => t.speakerName || t.speaker) || []
  });

  // Show floating controls section for meeting detail view
  const floatingControls = document.querySelector('.floating-controls');
  if (floatingControls) {
    floatingControls.style.display = 'flex';
  }

  // Show Export to Obsidian button in floating controls
  const exportToObsidianBtn = document.getElementById('exportToObsidianBtn');
  if (exportToObsidianBtn) {
    exportToObsidianBtn.style.display = 'flex';
  }

  // Initialize the new meeting detail view
  initializeMeetingDetail(
    meetingId,
    meeting,
    // onBack callback
    () => {
      showHomeView();
      clearMeetingDetail();
    },
    // onUpdate callback
    async (updatedMeetingId, updatedMeeting) => {
      // Guard against null meeting (user navigated away during async operation)
      if (!updatedMeeting || !updatedMeetingId) {
        console.warn('[Renderer] Meeting update callback received null data, ignoring');
        return;
      }

      console.log('[Renderer] Meeting update callback received:', {
        meetingId: updatedMeetingId,
        participantCount: updatedMeeting.participants?.length || 0,
        hasTranscript: !!updatedMeeting.transcript,
        speakers: updatedMeeting.transcript?.map(t => t.speaker).slice(0, 3) || []
      });

      // Update the meeting in the local arrays
      const upcomingIndex = upcomingMeetings.findIndex(m => m.id === updatedMeetingId);
      if (upcomingIndex !== -1) {
        upcomingMeetings[upcomingIndex] = updatedMeeting;
        console.log('[Renderer] Updated in upcomingMeetings');
      }

      const pastIndex = pastMeetings.findIndex(m => m.id === updatedMeetingId);
      if (pastIndex !== -1) {
        pastMeetings[pastIndex] = updatedMeeting;
        console.log('[Renderer] Updated in pastMeetings');
      }

      // Update in meetingsData
      const upcomingDataIndex = meetingsData.upcomingMeetings.findIndex(m => m.id === updatedMeetingId);
      if (upcomingDataIndex !== -1) {
        meetingsData.upcomingMeetings[upcomingDataIndex] = updatedMeeting;
        console.log('[Renderer] Updated in meetingsData.upcomingMeetings');
      }

      const pastDataIndex = meetingsData.pastMeetings.findIndex(m => m.id === updatedMeetingId);
      if (pastDataIndex !== -1) {
        meetingsData.pastMeetings[pastDataIndex] = updatedMeeting;
        console.log('[Renderer] Updated in meetingsData.pastMeetings');
      }

      // Save the updated data
      console.log('[Renderer] Calling saveMeetingsData...');
      await saveMeetingsData();
      console.log('[Renderer] saveMeetingsData completed');
    }
  );
}

// Setup the title editing and save function
// Note: Currently unused - title editing handled inline
// eslint-disable-next-line no-unused-vars
function setupTitleEditing() {
  const titleElement = document.getElementById('noteTitle');

  // Remove existing event listeners if any
  titleElement.removeEventListener('blur', titleBlurHandler);
  titleElement.removeEventListener('keydown', titleKeydownHandler);

  // Add event listeners
  titleElement.addEventListener('blur', titleBlurHandler);
  titleElement.addEventListener('keydown', titleKeydownHandler);
}

// Event handler for title blur
async function titleBlurHandler() {
  await saveCurrentNote();
}

// Event handler for title keydown
function titleKeydownHandler(e) {
  if (e.key === 'Enter') {
    e.preventDefault(); // Prevent new line
    e.target.blur(); // Remove focus to trigger save
  }
}

// Create a single reference to the auto-save handler to ensure we can remove it properly
let currentAutoSaveHandler = null;

// Function to set up auto-save handler
function setupAutoSaveHandler() {
  // Create a debounced auto-save handler
  const autoSaveHandler = debounce(async () => {
    if (currentEditingMeetingId) {
      console.log(`Auto-save triggered for meeting: ${currentEditingMeetingId}`);
      await saveCurrentNote();
    }
    // Silently ignore if no meeting is active - this is expected behavior
  }, 1000);

  // First remove any existing handler
  if (currentAutoSaveHandler) {
    const editorElement = document.getElementById('simple-editor');
    if (editorElement) {
      console.log('Removing existing auto-save handler');
      editorElement.removeEventListener('input', currentAutoSaveHandler);
    }
  }

  // Store the reference for future cleanup
  currentAutoSaveHandler = autoSaveHandler;

  // Get the editor element and attach the new handler
  const editorElement = document.getElementById('simple-editor');
  if (editorElement) {
    editorElement.addEventListener('input', autoSaveHandler);
    console.log(
      `Set up editor auto-save handler for meeting: ${currentEditingMeetingId || 'none'}`
    );

    // Manually trigger a save once to ensure the content is saved
    setTimeout(() => {
      console.log('Triggering initial save after setup');
      editorElement.dispatchEvent(new Event('input'));
    }, 500);
  } else {
    console.warn('Editor element not found for auto-save setup');
  }
}

// Create a single reference to the obsidian link auto-save handler
let currentObsidianLinkAutoSaveHandler = null;

// Function to set up auto-save handler for Obsidian link input
// Note: Currently unused - auto-save handled inline
// eslint-disable-next-line no-unused-vars
function setupObsidianLinkAutoSave() {
  // Create a debounced auto-save handler
  const obsidianLinkAutoSaveHandler = debounce(async () => {
    if (!currentEditingMeetingId) {
      console.warn('Cannot save Obsidian link: No active meeting ID');
      return;
    }

    const obsidianLinkInput = document.getElementById('obsidianLinkInput');
    if (!obsidianLinkInput) {
      console.warn('Obsidian link input not found');
      return;
    }

    // Find the current meeting
    const meeting = [...upcomingMeetings, ...pastMeetings].find(
      m => m.id === currentEditingMeetingId
    );
    if (!meeting) {
      console.error(`Meeting not found for ID: ${currentEditingMeetingId}`);
      return;
    }

    // Get the new value (trim whitespace)
    const newValue = obsidianLinkInput.value.trim();

    // Only save if the value has actually changed
    if (meeting.obsidianLink !== newValue) {
      meeting.obsidianLink = newValue;
      await saveMeetingsData();
      console.log(`Auto-saved Obsidian link for meeting ${currentEditingMeetingId}: "${newValue}"`);

      // Update the Obsidian button state
      updateObsidianButton(meeting);
    }
  }, 1000);

  // First remove any existing handler
  if (currentObsidianLinkAutoSaveHandler) {
    const obsidianLinkInput = document.getElementById('obsidianLinkInput');
    if (obsidianLinkInput) {
      obsidianLinkInput.removeEventListener('input', currentObsidianLinkAutoSaveHandler);
    }
  }

  // Store the reference for future cleanup
  currentObsidianLinkAutoSaveHandler = obsidianLinkAutoSaveHandler;

  // Get the input element and attach the new handler
  const obsidianLinkInput = document.getElementById('obsidianLinkInput');
  if (obsidianLinkInput) {
    obsidianLinkInput.addEventListener('input', obsidianLinkAutoSaveHandler);
    console.log(
      `Set up Obsidian link auto-save handler for meeting: ${currentEditingMeetingId || 'none'}`
    );
  }
}

// Function to create a new meeting
async function createNewMeeting() {
  console.log('Creating new note...');

  // Save any existing note before creating a new one
  if (currentEditingMeetingId) {
    await saveCurrentNote();
    console.log('Saved current note before creating new one');
  }

  // Reset the current editing ID to ensure we start fresh
  currentEditingMeetingId = null;

  // Generate a unique ID
  const id = 'meeting-' + Date.now();
  console.log('Generated new meeting ID:', id);

  // Current date and time
  const now = new Date();

  // Generate the template for the content
  const template = `# Meeting Title\n• New Note\n\n# Meeting Date and Time\n• ${now.toLocaleString()}\n\n# Participants\n• \n\n# Description\n• \n\nChat with meeting transcript: `;

  // Create a new meeting object - ensure it's of type document
  const newMeeting = {
    id: id,
    type: 'document', // Explicitly set as document type, not calendar
    title: 'New Note',
    subtitle: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    hasDemo: false,
    date: now.toISOString(),
    participants: [],
    content: template, // Set the content directly
  };

  // Log what we're adding
  console.log(
    `Adding new meeting: id=${id}, title=${newMeeting.title}, content.length=${template.length}`
  );

  // Add to pastMeetings - make sure to push to both arrays
  pastMeetings.unshift(newMeeting);
  meetingsData.pastMeetings.unshift(newMeeting);

  // Update the grouped meetings
  const dateKey = formatDateHeader(newMeeting.date);
  if (!pastMeetingsByDate[dateKey]) {
    pastMeetingsByDate[dateKey] = [];
  }
  pastMeetingsByDate[dateKey].unshift(newMeeting);

  // Save the data to file
  try {
    await saveMeetingsData();
    console.log('New meeting created and saved:', newMeeting.title);
  } catch (error) {
    console.error('Error saving new meeting:', error);
  }

  // Set current editing ID to the new meeting ID BEFORE showing the editor
  currentEditingMeetingId = id;
  console.log('Set currentEditingMeetingId to:', id);

  // Force a reset of the editor before showing the new meeting
  const editorElement = document.getElementById('simple-editor');
  if (editorElement) {
    editorElement.value = '';
  }

  // Now show the editor view with the new meeting
  showEditorView(id);

  // Automatically start recording for the new note
  try {
    console.log('Auto-starting recording for new note');
    // Get transcription provider from localStorage
    const transcriptionProvider = localStorage.getItem('transcriptionProvider') || 'assemblyai';
    console.log('[Auto-start] Transcription provider from localStorage:', transcriptionProvider);
    console.log('[Auto-start] localStorage value:', localStorage.getItem('transcriptionProvider'));
    // Start manual recording for the new note
    window.electronAPI
      .startManualRecording(id, transcriptionProvider)
      .then(result => {
        if (result.success) {
          console.log('Auto-started recording for new note with ID:', result.recordingId);
          // Update recording button UI
          window.isRecording = true;
          window.currentRecordingId = result.recordingId;

          // Update recording button UI
          const recordButton = document.getElementById('recordButton');
          if (recordButton) {
            const recordIcon = recordButton.querySelector('.record-icon');
            const stopIcon = recordButton.querySelector('.stop-icon');

            recordButton.classList.add('recording');
            recordIcon.style.display = 'none';
            stopIcon.style.display = 'block';
          }
        } else {
          console.error('Failed to auto-start recording:', result.error);
        }
      })
      .catch(error => {
        console.error('Error auto-starting recording:', error);
      });
  } catch (error) {
    console.error('Exception auto-starting recording:', error);
  }

  return id;
}

// Function to render meetings to the page
/**
 * Filter meetings based on search query and filters
 * @param {Array} meetings - Array of meeting objects to filter
 * @returns {Array} - Filtered array of meetings
 */
function filterMeetings(meetings) {
  if (!searchState.query && !searchState.filters.dateFrom && !searchState.filters.dateTo) {
    return meetings; // No filters active, return all meetings
  }

  return meetings.filter(meeting => {
    // Search query filter (title, participants)
    if (searchState.query) {
      const query = searchState.query.toLowerCase();
      const titleMatch = meeting.title?.toLowerCase().includes(query);

      // Check participant names and emails
      let participantMatch = false;
      if (meeting.participants && Array.isArray(meeting.participants)) {
        participantMatch = meeting.participants.some(p => {
          const nameMatch = p.name?.toLowerCase().includes(query);
          const emailMatch = p.email?.toLowerCase().includes(query);
          return nameMatch || emailMatch;
        });
      }

      // Also check participantEmails array (fallback)
      if (!participantMatch && meeting.participantEmails && Array.isArray(meeting.participantEmails)) {
        participantMatch = meeting.participantEmails.some(email =>
          email?.toLowerCase().includes(query)
        );
      }

      if (!titleMatch && !participantMatch) {
        return false; // No match found
      }
    }

    // Date range filter
    if (searchState.filters.dateFrom || searchState.filters.dateTo) {
      const meetingDate = new Date(meeting.date);

      if (searchState.filters.dateFrom) {
        const fromDate = new Date(searchState.filters.dateFrom);
        if (meetingDate < fromDate) {
          return false;
        }
      }

      if (searchState.filters.dateTo) {
        const toDate = new Date(searchState.filters.dateTo);
        toDate.setHours(23, 59, 59, 999); // Include the entire day
        if (meetingDate > toDate) {
          return false;
        }
      }
    }

    return true; // Passed all filters
  });
}

function renderMeetings() {
  // Clear previous content
  const mainContent = document.querySelector('.main-content .content-container');
  mainContent.innerHTML = '';

  // Create upcoming meetings section (from Google Calendar)
  if (calendarMeetings.length > 0) {
    const upcomingSection = document.createElement('section');
    upcomingSection.className = 'meetings-section';
    upcomingSection.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Upcoming Meetings</h2>
        <button class="refresh-calendar-btn" title="Refresh calendar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div class="meetings-list" id="calendar-list"></div>
    `;
    mainContent.appendChild(upcomingSection);

    // Get the calendar container
    const calendarContainer = upcomingSection.querySelector('#calendar-list');

    // Add calendar meetings
    calendarMeetings.forEach(meeting => {
      calendarContainer.appendChild(createCalendarMeetingCard(meeting));
    });
  }

  // Create all notes section (replaces both upcoming and date-grouped sections)
  const notesSection = document.createElement('section');
  notesSection.className = 'meetings-section';
  notesSection.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Notes</h2>
      <div class="section-actions">
        <button class="btn btn-outline btn-icon-text" id="toggleBulkSelectBtn" title="Select multiple meetings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" fill="currentColor"/>
          </svg>
          Multi-Select
        </button>
      </div>
    </div>
    <div class="meetings-list" id="notes-list"></div>
  `;
  mainContent.appendChild(notesSection);

  // Re-attach the bulk select button event listener since it's dynamically created
  const toggleBulkSelectBtn = notesSection.querySelector('#toggleBulkSelectBtn');
  if (toggleBulkSelectBtn) {
    toggleBulkSelectBtn.addEventListener('click', toggleBulkSelectionMode);
  }

  // Get the notes container
  const notesContainer = notesSection.querySelector('#notes-list');

  // Add all meetings to the notes section (both upcoming and past)
  const allMeetings = [...upcomingMeetings, ...pastMeetings];

  // Sort by date, newest first
  allMeetings.sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  // Filter out calendar entries and apply search/filter
  const filteredMeetings = filterMeetings(
    allMeetings.filter(meeting => meeting.type !== 'calendar') // Skip calendar entries
  );

  // Show search results count if search is active
  if (searchState.query || searchState.filters.dateFrom || searchState.filters.dateTo) {
    const searchInfo = document.createElement('div');
    searchInfo.className = 'search-info';
    searchInfo.textContent = `Found ${filteredMeetings.length} meeting${filteredMeetings.length !== 1 ? 's' : ''}`;
    notesContainer.parentElement.insertBefore(searchInfo, notesContainer);
  }

  // Add filtered meetings to the container
  filteredMeetings.forEach(meeting => {
    notesContainer.appendChild(createMeetingCard(meeting));
  });

  // Show empty state if no meetings found
  if (filteredMeetings.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    if (searchState.query || searchState.filters.dateFrom || searchState.filters.dateTo) {
      emptyState.innerHTML = `
        <p>No meetings found matching your search criteria.</p>
        <button class="btn" onclick="clearSearch()">Clear Search</button>
      `;
    } else {
      emptyState.innerHTML = '<p>No meetings yet. Click "Record In-Person Meeting" to get started.</p>';
    }
    notesContainer.appendChild(emptyState);
  }
}

// Load meetings data from file
async function loadMeetingsDataFromFile() {
  console.log('Loading meetings data from file...');
  try {
    const result = await window.electronAPI.loadMeetingsData();
    console.log('Load result success:', result.success);

    if (result.success) {
      console.log(`Got data with ${result.data.pastMeetings?.length || 0} past meetings`);
      if (result.data.pastMeetings && result.data.pastMeetings.length > 0) {
        console.log('[Load] First past meeting loaded:', {
          id: result.data.pastMeetings[0].id,
          title: result.data.pastMeetings[0].title,
          participantCount: result.data.pastMeetings[0].participants?.length || 0,
          transcriptLength: result.data.pastMeetings[0].transcript?.length || 0,
          firstSpeakers: result.data.pastMeetings[0].transcript?.slice(0, 3).map(t => t.speaker) || []
        });
      }

      // Initialize arrays if they don't exist in the loaded data
      if (!result.data.upcomingMeetings) {
        result.data.upcomingMeetings = [];
      }

      if (!result.data.pastMeetings) {
        result.data.pastMeetings = [];
      }

      // Update the meetings data objects
      Object.assign(meetingsData, result.data);

      // Clear and reassign the references
      upcomingMeetings.length = 0;
      pastMeetings.length = 0;

      console.log('Before updating arrays, pastMeetings count:', pastMeetings.length);

      // Filter out calendar entries when loading data
      meetingsData.upcomingMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => upcomingMeetings.push(meeting));

      meetingsData.pastMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => pastMeetings.push(meeting));

      console.log('After updating arrays, pastMeetings count:', pastMeetings.length);
      if (pastMeetings.length > 0) {
        console.log('First past meeting:', pastMeetings[0].id, pastMeetings[0].title);
      }

      // Regroup past meetings by date
      pastMeetingsByDate = {};
      meetingsData.pastMeetings.forEach(meeting => {
        const dateKey = formatDateHeader(meeting.date);
        if (!pastMeetingsByDate[dateKey]) {
          pastMeetingsByDate[dateKey] = [];
        }
        pastMeetingsByDate[dateKey].push(meeting);
      });

      console.log('Meetings data loaded from file');

      // Re-render the meetings
      renderMeetings();
    } else {
      console.error('Failed to load meetings data from file:', result.error);
    }
  } catch (error) {
    console.error('Error loading meetings data from file:', error);
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM content loaded, loading data from file...');

  // Show body now that CSS is loaded (prevents FOUC)
  document.body.classList.add('loaded');

  // Initialize Settings UI (Phase 10.1)
  initializeSettingsUI();

  // Initialize Template Editor (Phase 10.3)
  initializeTemplateEditor();

  // Initialize Routing Editor (Phase 10.4)
  initializeRoutingEditor();

  // Initialize App Settings UI (Phase 10.7)
  await initAppSettingsUI();

  // Initialize Contacts Page (CS-1)
  initContactsPage();

  // Expose functions for cross-module navigation
  window.openContactsView = openContactsView;
  window.showMeetingDetail = showEditorView;

  // Initialize Quick Search (CS-2)
  initQuickSearch();

  // Initialize Google integration (Calendar + Contacts)
  await initializeGoogle();

  // Try to load the latest data from file - this is the only data source
  await loadMeetingsDataFromFile();

  // Fetch calendar meetings from Google Calendar (only if authenticated)
  if (googleAuthenticated) {
    await fetchCalendarMeetings();
  }

  // Render meetings only after loading from file
  console.log('Data loaded, rendering meetings...');
  renderMeetings();

  // Initially show home view
  showHomeView();

  // Listen for meeting detection status updates
  window.electronAPI.onMeetingDetectionStatus(data => {
    console.log('Meeting detection status update:', data);
    const joinMeetingBtn = document.getElementById('joinMeetingBtn');

    // Store the meeting detection state globally
    window.meetingDetected = data.detected;

    if (joinMeetingBtn) {
      // Only update button state if we're in the home view
      const inHomeView = document.getElementById('homeView').style.display !== 'none';

      if (inHomeView) {
        // Always show the button, but enable/disable based on meeting detection
        joinMeetingBtn.style.display = 'block';
        joinMeetingBtn.disabled = !data.detected;
      }
    }
  });

  // SDK initialization state - disable record button until SDK is ready
  {
    const sdkRecordButton = document.getElementById('recordButton');
    if (sdkRecordButton) {
      // Start with button disabled
      sdkRecordButton.disabled = true;
      sdkRecordButton.title = 'Initializing...';

      // Check if SDK is already ready (in case we loaded after initialization)
      const sdkReady = await window.electronAPI.sdkIsReady();
      if (sdkReady) {
        sdkRecordButton.disabled = false;
        sdkRecordButton.title = 'Start Recording';
        console.log('[SDK] Already initialized - recording enabled');
      } else {
        console.log('[SDK] Waiting for initialization to complete...');
      }

      // Listen for SDK ready event
      window.electronAPI.onSdkReady(() => {
        const btn = document.getElementById('recordButton');
        if (btn) {
          btn.disabled = false;
          btn.title = 'Start Recording';
        }
        console.log('[SDK] Initialization complete - recording enabled');
      });
    }
  }

  // Listen for toast notifications from main process
  window.electronAPI.onShowToast(data => {
    console.log('Received toast from main process:', data);
    showToast(data.message, data.type || 'info');
  });

  // Listen for authentication expiration notifications
  window.electronAPI.onAuthExpired(data => {
    console.log('Authentication expired:', data);

    // Show notification to user - sanitize service name and message
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'auth-expired-notification';
    notificationDiv.innerHTML = sanitizeHtml(`
      <div class="notification-content">
        <strong>${escapeHtml(data.service)} Authentication Expired</strong>
        <p>${escapeHtml(data.message)}</p>
        <button onclick="this.parentElement.parentElement.remove(); window.location.reload();">
          Sign In Again
        </button>
        <button onclick="this.parentElement.parentElement.remove();" style="margin-left: 10px;">
          Dismiss
        </button>
      </div>
    `);

    document.body.appendChild(notificationDiv);

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (notificationDiv.parentElement) {
        notificationDiv.remove();
      }
    }, 30000);
  });

  // Listen for requests to open a meeting note (from notification click)
  window.electronAPI.onOpenMeetingNote(meetingId => {
    console.log('Received request to open meeting note:', meetingId);

    // Ensure we have the latest data before showing the note
    loadMeetingsDataFromFile().then(() => {
      console.log('Data refreshed, checking for meeting ID:', meetingId);

      // Log the list of available meeting IDs to help with debugging
      console.log(
        'Available meeting IDs:',
        pastMeetings.map(m => m.id)
      );

      // Verify the meeting exists in our data
      const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

      if (meeting) {
        console.log('Found meeting to open:', meeting.title);
        setTimeout(() => {
          showEditorView(meetingId);
        }, 200); // Add a small delay to ensure UI is ready
      } else {
        console.error('Meeting not found with ID:', meetingId);
        // Attempt to reload data again after a delay
        setTimeout(() => {
          console.log('Retrying data load after delay...');
          loadMeetingsDataFromFile().then(() => {
            const retryMeeting = [...upcomingMeetings, ...pastMeetings].find(
              m => m.id === meetingId
            );
            if (retryMeeting) {
              console.log('Found meeting on second attempt:', retryMeeting.title);
              showEditorView(meetingId);
            } else {
              console.error(
                'Meeting still not found after retry. Available meetings:',
                pastMeetings.map(m => `${m.id}: ${m.title}`)
              );
            }
          });
        }, 1500);
      }
    });
  });

  // ===================================================================
  // Phase 10.7: Desktop App Polish Event Listeners
  // ===================================================================

  // Listen for open settings request (from system tray)
  window.electronAPI.onOpenSettings(() => {
    openSettingsTab('general');
  });

  // Listen for open logs viewer request (from system tray)
  window.electronAPI.onOpenLogsViewer(() => {
    openSettingsTab('logs');
  });

  // Listen for quick record shortcut (starts in-person meeting recording)
  window.electronAPI.onQuickRecordRequested(() => {
    // Switch to main view if settings are open
    const settingsView = document.getElementById('settingsView');
    const mainView = document.getElementById('mainView');
    if (settingsView && mainView && settingsView.style.display !== 'none') {
      settingsView.style.display = 'none';
      mainView.style.display = 'block';
    }

    const newNoteBtn = document.getElementById('newNoteBtn');
    if (newNoteBtn) {
      newNoteBtn.click();
    } else {
      console.warn('[Phase 10.7] Cannot quick record: New Note button not found');
    }
  });

  // Listen for toggle recording shortcut
  window.electronAPI.onToggleRecordingShortcut(() => {
    // Switch to main view if settings are open
    const settingsView = document.getElementById('settingsView');
    const mainView = document.getElementById('mainView');
    if (settingsView && mainView && settingsView.style.display !== 'none') {
      settingsView.style.display = 'none';
      mainView.style.display = 'block';
    }

    const stopRecordingBtn = document.getElementById('stopRecordingBtn');
    const joinMeetingBtn = document.getElementById('joinMeetingBtn');
    const newNoteBtn = document.getElementById('newNoteBtn');

    // If recording, stop it
    if (stopRecordingBtn && stopRecordingBtn.style.display !== 'none') {
      stopRecordingBtn.click();
    }
    // Otherwise, try to join a detected meeting first
    else if (joinMeetingBtn && !joinMeetingBtn.disabled) {
      joinMeetingBtn.click();
    }
    // If no meeting detected, start in-person recording
    else if (newNoteBtn) {
      newNoteBtn.click();
    } else {
      console.warn('[Phase 10.7] Cannot toggle recording: no buttons available');
    }
  });

  // Listen for stop recording request (from system tray or keyboard shortcut)
  window.electronAPI.onStopRecordingRequested(async () => {
    console.log('[Phase 10.7] Stop recording requested');

    // Check if we have an active recording
    if (window.currentRecordingId) {
      try {
        const result = await window.electronAPI.stopManualRecording(window.currentRecordingId);

        if (result.success) {
          console.log('[Phase 10.7] Recording stopped successfully');
          window.currentRecordingId = null;
          window.isRecording = false;

          // Update UI if the record button exists
          const recordButton = document.getElementById('recordButton');
          if (recordButton && recordButton.classList.contains('recording')) {
            recordButton.classList.remove('recording');
            const recordIcon = recordButton.querySelector('.record-icon');
            const stopIcon = recordButton.querySelector('.stop-icon');
            if (recordIcon) recordIcon.style.display = 'block';
            if (stopIcon) stopIcon.style.display = 'none';
            recordButton.disabled = false;
          }

          // Show a toast notification
          window.showToast('Recording stopped', 'info');
        } else {
          console.error('[Phase 10.7] Failed to stop recording:', result.error);
          alert('Failed to stop recording: ' + result.error);
        }
      } catch (error) {
        console.error('[Phase 10.7] Error stopping recording:', error);
        alert('Error stopping recording: ' + error.message);
      }
    } else {
      console.warn('[Phase 10.7] No active recording to stop');
      alert('No active recording to stop');
    }
  });

  // Listen for recording completed events
  window.electronAPI.onRecordingCompleted(meetingId => {
    console.log('Recording completed for meeting:', meetingId);
    // If this note is currently being viewed, reload its content
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        // Refresh the meeting detail view with updated content
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          updateMeetingDetail(meeting);
        }
      });
    }
  });

  // Listen for participants update events
  window.electronAPI.onParticipantsUpdated(meetingId => {
    console.log('Participants updated for meeting:', meetingId);

    // If this note is currently being edited, refresh the data
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.participants && meeting.participants.length > 0) {
          // Log the latest participant
          const latestParticipant = meeting.participants[meeting.participants.length - 1];
          console.log(`Participant updated: ${latestParticipant.name}`);
        }
      });
    }
  });

  // Listen for transcript update events
  window.electronAPI.onTranscriptUpdated(meetingId => {
    console.log('Transcript updated for meeting:', meetingId);

    // If this note is currently being edited, we can refresh the data
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.transcript && meeting.transcript.length > 0) {
          // Log the latest transcript entry
          const latestEntry = meeting.transcript[meeting.transcript.length - 1];
          console.log(`Latest transcript: ${latestEntry.speaker}: "${latestEntry.text}"`);
        }
      });
    }
  });

  // Listen for summary generation events
  window.electronAPI.onSummaryGenerated(meetingId => {
    console.log('Summary generated for meeting:', meetingId);

    // Always reload meeting data to update the meeting list (title may have changed!)
    loadMeetingsDataFromFile().then(() => {
      const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

      // If this note is currently being viewed, refresh the meeting detail view
      if (currentEditingMeetingId === meetingId && meeting) {
        console.log(`Updating meeting detail view for ${meetingId} - New title: ${meeting.title}`);

        // Update the meeting detail view with new data
        updateMeetingDetail(meeting);
      }
    });
  });

  // Listen for streaming summary updates (currently not used in new meeting detail view)
  window.electronAPI.onSummaryUpdate(data => {
    const { meetingId, content, timestamp: _timestamp } = data;

    // Note: Streaming updates are not currently displayed in the new meeting detail view
    // The view will be updated when the final summary is complete via onSummaryGenerated event
    console.log(`Streaming update received for meeting ${meetingId} (${content.length} chars)`);
  });

  // Listen for recording ended events (cleanup after AssemblyAI/Deepgram transcription)
  window.electronAPI.onRecordingEnded(data => {
    const { windowId, meetingId } = data;
    console.log(`Recording ended for meeting: ${meetingId}, windowId: ${windowId}`);

    // Clear the current recording ID if it matches
    if (window.currentRecordingId === windowId) {
      console.log('Clearing currentRecordingId in renderer');

      // Update the recording button state (false = inactive, null = no recording)
      updateRecordingButtonUI(false, null);
    }

    // Reload meetings data to update UI (this will show the updated title)
    loadMeetingsDataFromFile();
  });

  // Add event listeners for buttons
  console.log('[EventListeners] Setting up Record In-person Meeting button...');
  const newNoteBtn = document.getElementById('newNoteBtn');
  console.log('[EventListeners] newNoteBtn element:', newNoteBtn);

  if (newNoteBtn) {
    console.log('[EventListeners] Adding click listener to newNoteBtn');
    newNoteBtn.addEventListener('click', async () => {
      console.log('>>> Record In-person Meeting button clicked! <<<');
      try {
        await createNewMeeting();
      } catch (error) {
        console.error('Error creating new meeting:', error);
        alert('Failed to start in-person meeting recording: ' + error.message);
      }
    });
    console.log('[EventListeners] Click listener added successfully to newNoteBtn');
  } else {
    console.error('[EventListeners] ERROR: newNoteBtn element not found in DOM!');
  }

  // Join Meeting button handler
  document.getElementById('joinMeetingBtn').addEventListener('click', async () => {
    console.log('Join Meeting button clicked');

    // Get the button element
    const joinButton = document.getElementById('joinMeetingBtn');

    // Show loading state
    const originalText = joinButton.textContent;
    joinButton.disabled = true;
    joinButton.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Joining...
    `;

    // First check if there's a detected meeting
    if (window.electronAPI.checkForDetectedMeeting) {
      try {
        const hasDetectedMeeting = await window.electronAPI.checkForDetectedMeeting();
        if (hasDetectedMeeting) {
          console.log('Found detected meeting, joining...');
          // Get transcription provider from localStorage
          const transcriptionProvider = localStorage.getItem('transcriptionProvider') || 'assemblyai';
          console.log('[Join Meeting] Using transcription provider:', transcriptionProvider);
          await window.electronAPI.joinDetectedMeeting(transcriptionProvider);
          // Keep button disabled as we're navigating to a different view
        } else {
          console.log('No active meeting detected');

          // Reset button state
          joinButton.disabled = false;
          joinButton.textContent = originalText;

          // Show a little toast message
          window.showToast('No active meeting detected', 'info');
        }
      } catch (error) {
        console.error('Error joining meeting:', error);

        // Reset button state
        joinButton.disabled = false;
        joinButton.textContent = originalText;

        // Show error toast
        window.showToast('Error joining meeting', 'error');
      }
    } else {
      // Fallback for direct call
      try {
        await window.electronAPI.joinDetectedMeeting();
        // Keep button disabled as we're navigating to a different view
      } catch (error) {
        console.error('Error joining meeting:', error);

        // Reset button state
        joinButton.disabled = false;
        joinButton.textContent = originalText;
      }
    }
  });

  // Search input handler - debounced for performance
  const searchInput = document.querySelector('.search-input');
  const debouncedSearch = debounce(query => {
    console.log('Search query:', query);
    searchState.query = query.trim();
    renderMeetings();
  }, 300);

  searchInput.addEventListener('input', e => {
    debouncedSearch(e.target.value);
  });

  // Clear search on Escape key
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchState.query = '';
      renderMeetings();
    }
  });

  // Add click event delegation for meeting cards and their actions
  document.querySelector('.main-content').addEventListener('click', async e => {
    // Check if refresh calendar button was clicked
    if (e.target.closest('.refresh-calendar-btn')) {
      e.stopPropagation();
      const refreshBtn = e.target.closest('.refresh-calendar-btn');
      const originalHTML = refreshBtn.innerHTML;

      refreshBtn.disabled = true;
      refreshBtn.innerHTML =
        '<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

      await fetchCalendarMeetings();

      refreshBtn.disabled = false;
      refreshBtn.innerHTML = originalHTML;
      return;
    }

    // Check if join calendar meeting button was clicked
    if (e.target.closest('.join-calendar-meeting-btn')) {
      e.stopPropagation();
      const joinBtn = e.target.closest('.join-calendar-meeting-btn');
      const meetingLink = joinBtn.dataset.link;

      if (meetingLink) {
        // Open the meeting link in the default browser
        window.electronAPI.openExternal(meetingLink);
      }
      return;
    }

    // Check if record calendar meeting button was clicked
    if (e.target.closest('.record-calendar-meeting-btn')) {
      e.stopPropagation();
      const recordBtn = e.target.closest('.record-calendar-meeting-btn');
      const meetingId = recordBtn.dataset.id;

      console.log('Record calendar meeting:', meetingId);

      // Create a new note for this meeting
      const _noteId = await createNewMeeting();

      // TODO: Future enhancement - associate calendar meeting with this note
      // Could store calendar meeting ID in the note metadata

      return;
    }

    // Check if delete button was clicked
    if (e.target.closest('.delete-meeting-btn')) {
      e.stopPropagation(); // Prevent opening the note
      const deleteBtn = e.target.closest('.delete-meeting-btn');
      const meetingId = deleteBtn.dataset.id;

      if (confirm('Are you sure you want to delete this note? This cannot be undone.')) {
        console.log('Deleting meeting:', meetingId);

        // Show loading state
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;

        // Use the main process deletion via IPC
        window.electronAPI
          .deleteMeeting(meetingId)
          .then(result => {
            if (result.success) {
              console.log('Meeting deleted successfully on server');

              // After successful server deletion, update local data
              // Remove from local pastMeetings array
              const pastMeetingIndex = pastMeetings.findIndex(meeting => meeting.id === meetingId);
              if (pastMeetingIndex !== -1) {
                pastMeetings.splice(pastMeetingIndex, 1);
              }

              // Remove from meetingsData as well
              const pastDataIndex = meetingsData.pastMeetings.findIndex(
                meeting => meeting.id === meetingId
              );
              if (pastDataIndex !== -1) {
                meetingsData.pastMeetings.splice(pastDataIndex, 1);
              }

              // Also check upcomingMeetings
              const upcomingMeetingIndex = upcomingMeetings.findIndex(
                meeting => meeting.id === meetingId
              );
              if (upcomingMeetingIndex !== -1) {
                upcomingMeetings.splice(upcomingMeetingIndex, 1);
              }

              const upcomingDataIndex = meetingsData.upcomingMeetings.findIndex(
                meeting => meeting.id === meetingId
              );
              if (upcomingDataIndex !== -1) {
                meetingsData.upcomingMeetings.splice(upcomingDataIndex, 1);
              }

              // Update the grouped meetings
              pastMeetingsByDate = {};
              meetingsData.pastMeetings.forEach(meeting => {
                const dateKey = formatDateHeader(meeting.date);
                if (!pastMeetingsByDate[dateKey]) {
                  pastMeetingsByDate[dateKey] = [];
                }
                pastMeetingsByDate[dateKey].push(meeting);
              });

              // Re-render the meetings list
              renderMeetings();
            } else {
              // Server side deletion failed
              console.error('Server deletion failed:', result.error);
              alert('Failed to delete note: ' + (result.error || 'Unknown error'));
            }
          })
          .catch(error => {
            console.error('Error deleting meeting:', error);
            alert('Failed to delete note: ' + (error.message || 'Unknown error'));
          })
          .finally(() => {
            // Reset button state whether success or failure
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
            </svg>`;
          });
      }
      return;
    }

    // Find the meeting card that was clicked (for opening)
    const card = e.target.closest('.meeting-card');
    if (card) {
      // Don't open editor if in bulk selection mode
      if (bulkSelectionState.enabled) {
        return;
      }

      // Don't open editor for calendar meeting cards (they don't have saved notes yet)
      // Only the Join/Record buttons should work for calendar meetings
      if (card.classList.contains('calendar-meeting')) {
        return;
      }

      const meetingId = card.dataset.id;
      showEditorView(meetingId);
    }
  });

  // Back button event listener
  console.log('[EventListeners] Setting up back button...');
  const backButton = document.getElementById('backButton');
  console.log('[EventListeners] backButton element:', backButton);

  // Home button - always goes to main meeting list
  const homeButton = document.getElementById('homeButton');
  if (homeButton) {
    console.log('[EventListeners] Adding click listener to homeButton');
    homeButton.addEventListener('click', async () => {
      console.log('>>> Home button clicked! <<<');
      try {
        // Clear navigation context
        if (window.clearContactNavigationContext) {
          window.clearContactNavigationContext();
        }

        // Clear current editing state
        currentEditingMeetingId = null;

        // Clear meeting detail view if active
        clearMeetingDetail();

        // Show home view
        showHomeView();

        // Refresh the meeting list
        await loadMeetingsDataFromFile();
        renderMeetings();

        console.log('Returned to home view');
      } catch (error) {
        console.error('Error navigating home:', error);
        showHomeView();
        renderMeetings();
      }
    });
  }

  if (backButton) {
    console.log('[EventListeners] Adding click listener to backButton');
    backButton.addEventListener('click', async () => {
      console.log('>>> Back button clicked! <<<');
      try {
        // Clear current editing state
        currentEditingMeetingId = null;

        // Clear meeting detail view if active
        clearMeetingDetail();

        // Back button only shows when there's a contact context - return to contact
        const contactContext = window.getContactNavigationContext ? window.getContactNavigationContext() : null;
        if (contactContext && contactContext.type === 'contact') {
          console.log('Returning to contact:', contactContext.contact?.name);
          if (window.returnToContact) {
            window.returnToContact();
          } else {
            showHomeView();
          }
        } else {
          // Fallback to home view (shouldn't happen since back button is hidden without context)
          showHomeView();
        }

        // Refresh the meeting list
        await loadMeetingsDataFromFile();
        renderMeetings();

        console.log('Returned to previous view');
      } catch (error) {
        console.error('Error navigating back:', error);
        // Still try to show home view even if save failed
        showHomeView();
        renderMeetings();
      }
    });
    console.log('[EventListeners] Click listener added successfully to backButton');
  } else {
    console.error('[EventListeners] ERROR: backButton element not found in DOM!');
  }

  // Google button event listener (unified Calendar + Contacts)
  const googleBtn = document.getElementById('googleBtn');
  if (googleBtn) {
    googleBtn.addEventListener('click', handleGoogleButtonClick);
  }

  // Bulk selection event listeners
  const toggleBulkSelectBtn = document.getElementById('toggleBulkSelectBtn');
  if (toggleBulkSelectBtn) {
    toggleBulkSelectBtn.addEventListener('click', toggleBulkSelectionMode);
  }

  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', selectAllMeetings);
  }

  const deselectAllBtn = document.getElementById('deselectAllBtn');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', deselectAllMeetings);
  }

  const batchExportBtn = document.getElementById('batchExportBtn');
  if (batchExportBtn) {
    batchExportBtn.addEventListener('click', batchExportToObsidian);
  }

  const batchDeleteBtn = document.getElementById('batchDeleteBtn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', batchDeleteMeetings);
  }

  const cancelBulkSelectionBtn = document.getElementById('cancelBulkSelectionBtn');
  if (cancelBulkSelectionBtn) {
    cancelBulkSelectionBtn.addEventListener('click', toggleBulkSelectionMode);
  }

  // Transcription Provider Selection
  const transcriptionProviderSelect = document.getElementById('transcriptionProviderSelect');
  if (transcriptionProviderSelect) {
    // Load saved provider preference (default to AssemblyAI)
    const savedTranscriptionProvider = localStorage.getItem('transcriptionProvider') || 'assemblyai';
    transcriptionProviderSelect.value = savedTranscriptionProvider;
    console.log('Current transcription provider:', savedTranscriptionProvider);

    // Handle provider change
    transcriptionProviderSelect.addEventListener('change', e => {
      const newProvider = e.target.value;
      console.log('[Provider Change] Switching transcription provider to:', newProvider);
      localStorage.setItem('transcriptionProvider', newProvider);
      console.log(
        '[Provider Change] Saved to localStorage:',
        localStorage.getItem('transcriptionProvider')
      );

      // Show confirmation toast using global showToast
      const providerNames = {
        recallai: 'Recall.ai',
        assemblyai: 'AssemblyAI',
        deepgram: 'Deepgram',
      };
      showToast(`Transcription provider changed to ${providerNames[newProvider] || newProvider}`, 'success');
    });
  }

  // Set up the initial auto-save handler (legacy - not used in new meeting detail view)
  setupAutoSaveHandler();

  // Toggle sidebar button with initial state (legacy template code - may be removed)
  const toggleSidebarBtn = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  const editorContent = document.querySelector('.editor-content');
  const chatInputContainer = document.querySelector('.chat-input-container');

  // Only set up old sidebar UI if elements exist (they don't in new design)
  if (sidebar && editorContent && chatInputContainer && toggleSidebarBtn) {
    // Start with sidebar hidden
    sidebar.classList.add('hidden');
    editorContent.classList.add('full-width');
    chatInputContainer.style.display = 'none';

    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      editorContent.classList.toggle('full-width');

      // Show/hide chat input with sidebar
      if (sidebar.classList.contains('hidden')) {
        chatInputContainer.style.display = 'none';
      } else {
        chatInputContainer.style.display = 'block';
      }
    });
  }

  // Chat input handling (legacy)
  const chatInput = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendButton');

  // Only set up chat handlers if elements exist (they don't in new design)
  if (chatInput && sendButton) {
    // When send button is clicked
    sendButton.addEventListener('click', () => {
      const message = chatInput.value.trim();
      if (message) {
        console.log('Sending message:', message);
        // Here you would handle the AI chat functionality
        // For now, just clear the input
        chatInput.value = '';
      }
    });

    // Send message on Enter key
    chatInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        sendButton.click();
      }
    });
  }

  // Handle share buttons
  const shareButtons = document.querySelectorAll('.share-btn');
  shareButtons.forEach(button => {
    button.addEventListener('click', () => {
      const action = button.textContent.trim();
      console.log(`Share action: ${action}`);
      // Implement actual sharing functionality here
    });
  });

  // Handle AI option buttons
  const aiButtons = document.querySelectorAll('.ai-btn');
  aiButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.textContent.trim();
      console.log(`AI action: ${action}`);

      // Handle different AI actions
      if (action === 'Generate meeting summary') {
        if (!currentEditingMeetingId) {
          alert('No meeting is currently open');
          return;
        }

        // Show loading state
        const originalText = button.textContent;
        button.textContent = 'Generating summary...';
        button.disabled = true;

        try {
          // Use streaming version instead of standard version
          console.log('Starting streaming summary generation');
          console.log('Requesting AI summary generation for meeting: ' + currentEditingMeetingId);

          window.electronAPI
            .generateMeetingSummaryStreaming(currentEditingMeetingId)
            .then(result => {
              if (result.success) {
                console.log('Summary generated successfully (streaming)');
              } else {
                console.error('Failed to generate summary:', result.error);
                alert('Failed to generate summary: ' + result.error);
              }
            })
            .catch(error => {
              console.error('Error generating summary:', error);
              alert('Error generating summary: ' + (error.message || error));
            })
            .finally(() => {
              // Reset button state
              button.textContent = originalText;
              button.disabled = false;
            });
        } catch (error) {
          console.error('Error starting streaming summary generation:', error);
          alert('Error starting summary generation: ' + (error.message || error));

          // Reset button state
          button.textContent = originalText;
          button.disabled = false;
        }
      } else if (action === 'List action items') {
        alert('List action items functionality coming soon');
      } else if (action === 'Write follow-up email') {
        alert('Write follow-up email functionality coming soon');
      } else if (action === 'List Q&A') {
        alert('List Q&A functionality coming soon');
      }
    });
  });

  // UI variables will be initialized when the recording button is set up

  // Listen for recording state change events
  window.electronAPI.onRecordingStateChange(data => {
    console.log('Recording state change received:', data);

    // Handle upload progress updates
    if (data.state === 'uploading') {
      const uploadProgress = document.getElementById('uploadProgress');
      const uploadProgressFill = document.getElementById('uploadProgressFill');
      const uploadProgressText = document.getElementById('uploadProgressText');

      if (uploadProgress && uploadProgressFill && uploadProgressText) {
        uploadProgress.style.display = 'block';
        uploadProgressFill.style.width = `${data.progress}%`;
        uploadProgressText.textContent = `Uploading ${data.progress}%`;

        // Hide progress bar when upload is complete
        if (data.progress >= 100) {
          setTimeout(() => {
            uploadProgress.style.display = 'none';
          }, 2000); // Show 100% for 2 seconds before hiding
        }
      }
    }

    // Handle transcription completion
    if (data.state === 'completed') {
      const uploadProgress = document.getElementById('uploadProgress');
      const uploadProgressFill = document.getElementById('uploadProgressFill');
      const uploadProgressText = document.getElementById('uploadProgressText');

      if (uploadProgress && uploadProgressFill && uploadProgressText) {
        uploadProgressFill.style.width = '100%';
        uploadProgressText.textContent = 'Transcription complete';

        // Hide progress bar after showing completion
        setTimeout(() => {
          uploadProgress.style.display = 'none';
        }, 2000);
      }
    }

    // If this state change is for the current note, update the UI
    if (data.noteId === currentEditingMeetingId) {
      console.log('Updating recording button for current note');
      const isActive = data.state === 'recording' || data.state === 'paused';
      updateRecordingButtonUI(isActive, isActive ? data.recordingId : null);
    }
  });

  // Setup record/stop button toggle
  const recordButton = document.getElementById('recordButton');
  if (recordButton) {
    recordButton.addEventListener('click', async () => {
      // Only allow recording if we're in a note
      if (!currentEditingMeetingId) {
        alert('You need to be in a note to start recording');
        return;
      }

      window.isRecording = !window.isRecording;

      // Get the elements inside the button
      const recordIcon = recordButton.querySelector('.record-icon');
      const stopIcon = recordButton.querySelector('.stop-icon');

      if (window.isRecording) {
        // Check if meeting already has a transcript
        const meeting = [...upcomingMeetings, ...pastMeetings].find(
          m => m.id === currentEditingMeetingId
        );

        if (meeting && meeting.transcript && meeting.transcript.length > 0) {
          // Show re-record confirmation modal
          window.isRecording = false; // Reset state
          showReRecordModal(meeting);
          return;
        }

        // No existing transcript, proceed with recording
        await startRecording('new');
      } else {
        // Stop recording
        if (window.currentRecordingId) {
          try {
            console.log('Stopping manual recording:', window.currentRecordingId);
            recordButton.disabled = true; // Temporarily disable

            // Call the API to stop recording
            const result = await window.electronAPI.stopManualRecording(window.currentRecordingId);

            // Change to record mode
            recordButton.classList.remove('recording');
            recordIcon.style.display = 'block';
            stopIcon.style.display = 'none';
            recordButton.disabled = false;

            if (result.success) {
              console.log('Manual recording stopped successfully');

              // Show a little toast message
              window.showToast('Recording stopped. Transcript saved.', 'success');

              // The recording-completed event handler will take care of refreshing the content
            } else {
              console.error('Failed to stop recording:', result.error);
              alert('Failed to stop recording: ' + result.error);
            }

            // Reset recording ID
            window.currentRecordingId = null;
          } catch (error) {
            console.error('Error stopping recording:', error);
            alert('Error stopping recording: ' + (error.message || error));
            recordButton.disabled = false;
          }
        } else {
          console.warn('No active recording ID found');
          // Reset UI anyway
          recordButton.classList.remove('recording');
          recordIcon.style.display = 'block';
          stopIcon.style.display = 'none';
        }
      }
    });
  }

  // Re-record Confirmation Modal Logic
  // ===================================

  function showReRecordModal(_meeting) {
    const modal = document.getElementById('reRecordModal');
    const closeBtn = document.getElementById('closeReRecordModal');
    const options = document.querySelectorAll('.re-record-option');

    // Show modal
    modal.style.display = 'flex';

    // Handle close button
    const closeModal = () => {
      modal.style.display = 'none';
    };

    closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    // Handle option selection
    options.forEach(option => {
      option.onclick = async () => {
        const action = option.getAttribute('data-action');
        closeModal();

        if (action === 'cancel') {
          // Do nothing, just close
          return;
        }

        // Start recording with the selected action
        await startRecording(action);
      };
    });
  }

  async function startRecording(action) {
    const recordButton = document.getElementById('recordButton');
    const recordIcon = recordButton.querySelector('.record-icon');
    const stopIcon = recordButton.querySelector('.stop-icon');

    try {
      console.log(`Starting manual recording for meeting: ${currentEditingMeetingId}, action: ${action}`);
      recordButton.disabled = true;

      // Change to stop mode immediately for better feedback
      window.isRecording = true;
      recordButton.classList.add('recording');
      recordIcon.style.display = 'none';
      stopIcon.style.display = 'block';

      // Get transcription provider from localStorage
      const transcriptionProvider = localStorage.getItem('transcriptionProvider') || 'recallai';

      // Call the API to start recording with action
      const result = await window.electronAPI.startManualRecording(
        currentEditingMeetingId,
        transcriptionProvider,
        action
      );
      recordButton.disabled = false;

      if (result.success) {
        console.log('Manual recording started with ID:', result.recordingId);
        window.currentRecordingId = result.recordingId;
        window.showToast('Recording started...', 'info');
      } else {
        // If starting failed, revert UI
        console.error('Failed to start recording:', result.error);
        alert('Failed to start recording: ' + result.error);
        window.isRecording = false;
        recordButton.classList.remove('recording');
        recordIcon.style.display = 'block';
        stopIcon.style.display = 'none';
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error starting recording: ' + (error.message || error));

      // Reset UI state
      window.isRecording = false;
      recordButton.classList.remove('recording');
      recordIcon.style.display = 'block';
      stopIcon.style.display = 'none';
      recordButton.disabled = false;
    }
  }

  // Phase 4: Template Selection Modal Logic
  // ========================================

  let availableTemplates = [];
  let selectedTemplateIds = [];
  let routingOverride = null; // CS-4.4: Manual routing override
  let originalRoutes = null; // Store original routes for reference

  // Load templates on page load
  async function loadTemplates() {
    try {
      const result = await window.electronAPI.templatesGetAll();
      if (result.success) {
        availableTemplates = result.templates;
        console.log('Loaded', availableTemplates.length, 'templates');
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }

  // Open template selection modal
  function openTemplateModal() {
    const modal = document.getElementById('templateModal');
    const templateList = document.getElementById('templateList');

    // Clear previous content
    templateList.innerHTML = '';

    // Render template items (exclude auto-summary template - only used for regenerate button)
    const selectableTemplates = availableTemplates.filter(t => t.id !== 'auto-summary-prompt');

    if (selectableTemplates.length === 0) {
      templateList.innerHTML =
        '<p style="text-align: center; color: #999;">No templates found. Add templates to config/templates/</p>';
    } else {
      selectableTemplates.forEach(template => {
        const templateItem = document.createElement('div');
        templateItem.className = 'template-item';
        templateItem.dataset.templateId = template.id;

        templateItem.innerHTML = `
          <div class="template-checkbox">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="white"/>
            </svg>
          </div>
          <div class="template-info">
            <div class="template-name">${template.name}</div>
            <div class="template-description-text">${template.description}</div>
            <div class="template-meta">
              <span class="template-type">${template.type}</span>
              <span class="template-sections">${template.sections.length} sections</span>
            </div>
          </div>
        `;

        templateItem.addEventListener('click', () => {
          toggleTemplateSelection(template.id);
        });

        templateList.appendChild(templateItem);
      });
    }

    // Show modal
    modal.style.display = 'flex';
    updateCostEstimate();

    // Load routing preview (CS-4)
    loadRoutingPreview();
  }

  // CS-4: Load and display routing preview
  async function loadRoutingPreview() {
    const previewContent = document.getElementById('routingPreviewContent');
    if (!previewContent || !currentEditingMeetingId) return;

    previewContent.innerHTML = '<div class="routing-preview-loading">Loading...</div>';

    try {
      const preview = await window.electronAPI.routingPreviewMeetingRoute(currentEditingMeetingId);

      if (!preview || !preview.routes || preview.routes.length === 0) {
        previewContent.innerHTML = '<div class="routing-preview-error">Unable to determine save location</div>';
        return;
      }

      // Store original routes for reference
      originalRoutes = preview.routes;

      // CS-4.4: Display override if set, otherwise show original routes
      const routesToDisplay = routingOverride ? [routingOverride] : preview.routes;

      const html = routesToDisplay.map(route => {
        const iconSvg = getRouteTypeIcon(route.type);
        const isOverride = routingOverride && route === routingOverride;

        return `
          <div class="routing-preview-path${isOverride ? ' override' : ''}">
            ${isOverride ? '<span class="routing-override-badge">Manual</span>' : ''}
            <div class="routing-preview-icon ${route.type}">
              ${iconSvg}
            </div>
            <div class="routing-preview-info">
              <div class="routing-preview-folder">${escapeHtml(route.path)}</div>
              <div class="routing-preview-reason">${escapeHtml(route.reason || 'Manually selected destination')}</div>
            </div>
            <span class="routing-preview-type-badge">${route.type}</span>
          </div>
        `;
      }).join('');

      previewContent.innerHTML = html;
    } catch (error) {
      console.error('[Templates] Error loading routing preview:', error);
      previewContent.innerHTML = `<div class="routing-preview-error">Error: ${escapeHtml(error.message)}</div>`;
    }
  }

  // CS-4.4: Show destination picker
  async function showDestinationPicker() {
    const picker = document.getElementById('routingDestinationPicker');
    const select = document.getElementById('routingDestinationSelect');

    if (!picker || !select) return;

    // Load destinations
    select.innerHTML = '<option value="">Loading destinations...</option>';
    picker.style.display = 'block';

    try {
      const result = await window.electronAPI.routingGetAllDestinations();

      // Group by type
      const clients = result.destinations?.filter(d => d.type === 'client') || [];
      const industry = result.destinations?.filter(d => d.type === 'industry') || [];
      const other = result.destinations?.filter(d => d.type !== 'client' && d.type !== 'industry') || [];

      let html = '';

      // CS-4.6: Add "Create New Organization" option at the top
      html += '<option value="__create_new__">+ Create New Organization...</option>';

      if (clients.length > 0) {
        html += '<optgroup label="Clients">';
        clients.forEach(d => {
          html += `<option value="${d.type}:${d.slug}" data-path="${escapeHtml(d.path)}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
        });
        html += '</optgroup>';
      }

      if (industry.length > 0) {
        html += '<optgroup label="Industry">';
        industry.forEach(d => {
          html += `<option value="${d.type}:${d.slug}" data-path="${escapeHtml(d.path)}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
        });
        html += '</optgroup>';
      }

      if (other.length > 0) {
        html += '<optgroup label="Other">';
        other.forEach(d => {
          html += `<option value="${d.type}:${d.slug}" data-path="${escapeHtml(d.path)}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
        });
        html += '</optgroup>';
      }

      select.innerHTML = '<option value="">Select a destination...</option>' + html;
    } catch (error) {
      console.error('[Templates] Error loading destinations:', error);
      select.innerHTML = '<option value="">Error loading destinations</option>';
    }
  }

  // CS-4.4: Hide destination picker
  function hideDestinationPicker() {
    const picker = document.getElementById('routingDestinationPicker');
    if (picker) picker.style.display = 'none';
  }

  // CS-4.4: Apply selected destination
  async function applyDestinationOverride() {
    const select = document.getElementById('routingDestinationSelect');
    if (!select || !select.value) return;

    // CS-4.6: Check if "Create New Organization" was selected
    if (select.value === '__create_new__') {
      hideDestinationPicker();
      showNewOrgForm();
      return;
    }

    const selectedOption = select.options[select.selectedIndex];
    const [type, slug] = select.value.split(':');
    const path = selectedOption.dataset.path;
    const name = selectedOption.dataset.name;

    routingOverride = {
      type,
      slug,
      path,
      organization: name,
      reason: `Manually selected: ${name}`,
    };

    hideDestinationPicker();
    // Re-render preview with override
    await loadRoutingPreview();

    // CS-4.5: Show create rule prompt if applicable
    await showCreateRulePrompt();
  }

  // CS-4.4: Initialize destination picker event listeners
  function initDestinationPicker() {
    const changeBtn = document.getElementById('routingChangeBtn');
    const applyBtn = document.getElementById('routingDestinationApply');
    const cancelBtn = document.getElementById('routingDestinationCancel');
    const select = document.getElementById('routingDestinationSelect');

    if (changeBtn) {
      changeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showDestinationPicker();
      });
    }

    // CS-4.6: Auto-show new org form when "Create New" is selected
    if (select) {
      select.addEventListener('change', (e) => {
        if (e.target.value === '__create_new__') {
          hideDestinationPicker();
          showNewOrgForm();
        }
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        applyDestinationOverride();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideDestinationPicker();
      });
    }
  }

  // Initialize destination picker on load
  initDestinationPicker();

  // CS-4.6: New organization form state
  let newOrgDomains = [];
  let selectedNewOrgDomains = new Set();

  // CS-4.6: Get participant domains from meeting (excluding user's own domain)
  async function getMeetingParticipantDomains() {
    if (!currentEditingMeetingId) return [];

    const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
    if (!meeting) return [];

    // Get user's domain to exclude it
    let userDomain = null;
    try {
      const result = await window.electronAPI.getUserProfile();
      if (result.success && result.profile && result.profile.email) {
        userDomain = result.profile.email.split('@')[1]?.toLowerCase();
        console.log('[Templates] Excluding user domain:', userDomain);
      }
    } catch (error) {
      console.warn('[Templates] Could not get user profile:', error);
    }

    const emails = new Set();
    if (meeting.participantEmails) {
      meeting.participantEmails.forEach(e => emails.add(e));
    }
    if (meeting.participants) {
      meeting.participants.forEach(p => p.email && emails.add(p.email));
    }
    if (meeting.attendees) {
      meeting.attendees.forEach(a => a.email && emails.add(a.email));
    }

    const domains = new Set();
    const personalDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];
    emails.forEach(email => {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain &&
          !personalDomains.includes(domain) &&
          domain !== userDomain) {
        domains.add(domain);
      }
    });

    return [...domains];
  }

  // CS-4.6: Generate slug from name
  function generateSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // CS-4.6: Show new organization form
  async function showNewOrgForm() {
    const form = document.getElementById('routingNewOrgForm');
    const nameInput = document.getElementById('routingNewOrgName');
    const slugInput = document.getElementById('routingNewOrgSlug');
    const typeSelect = document.getElementById('routingNewOrgType');
    const domainsDiv = document.getElementById('routingNewOrgDomains');

    if (!form) return;

    // Reset form
    nameInput.value = '';
    slugInput.value = '';
    typeSelect.value = 'client';

    // Get domains from meeting participants (excludes user's domain)
    newOrgDomains = await getMeetingParticipantDomains();
    selectedNewOrgDomains = new Set(newOrgDomains);

    // Build domain chips
    if (newOrgDomains.length > 0) {
      domainsDiv.innerHTML = newOrgDomains.map(domain => `
        <label class="routing-domain-chip selected">
          <input type="checkbox" value="${escapeHtml(domain)}" checked>
          <span>${escapeHtml(domain)}</span>
        </label>
      `).join('');

      // Add change listeners
      domainsDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const domain = e.target.value;
          const chip = e.target.closest('.routing-domain-chip');
          if (e.target.checked) {
            selectedNewOrgDomains.add(domain);
            chip.classList.add('selected');
          } else {
            selectedNewOrgDomains.delete(domain);
            chip.classList.remove('selected');
          }
        });
      });
    } else {
      domainsDiv.innerHTML = '<span style="color: var(--text-secondary); font-size: 12px;">No domains detected from meeting participants</span>';
    }

    form.style.display = 'block';

    // Auto-generate slug when name changes
    nameInput.addEventListener('input', () => {
      slugInput.value = generateSlug(nameInput.value);
    });
  }

  // CS-4.6: Hide new organization form
  function hideNewOrgForm() {
    const form = document.getElementById('routingNewOrgForm');
    if (form) form.style.display = 'none';
    newOrgDomains = [];
    selectedNewOrgDomains = new Set();
  }

  // CS-4.6: Create new organization
  async function createNewOrganization() {
    const nameInput = document.getElementById('routingNewOrgName');
    const slugInput = document.getElementById('routingNewOrgSlug');
    const typeSelect = document.getElementById('routingNewOrgType');
    const createBtn = document.getElementById('routingNewOrgCreate');

    const name = nameInput.value.trim();
    const slug = slugInput.value.trim() || generateSlug(name);
    const type = typeSelect.value;
    const emails = [...selectedNewOrgDomains];

    if (!name) {
      window.showToast('Please enter an organization name', 'error');
      return;
    }

    if (!slug) {
      window.showToast('Please enter a folder name', 'error');
      return;
    }

    const originalText = createBtn.textContent;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      // Generate vault path based on type
      const vaultPath = type === 'client' ? `clients/${slug}` : `industry/${slug}`;
      // Convert route type to YAML section name for API call
      const yamlSectionType = type === 'client' ? 'clients' : 'industry';

      const result = await window.electronAPI.routingAddOrganization(
        yamlSectionType,
        slug,
        vaultPath,
        emails,
        [] // No specific contacts
      );

      if (result.success) {
        window.showToast(`Created ${name} and added ${emails.length} domain(s)`, 'success');

        // Set as routing override
        routingOverride = {
          type,
          slug,
          path: vaultPath,
          organization: name,
          reason: `Newly created: ${name}`,
        };

        hideNewOrgForm();
        // Re-render preview with new override
        await loadRoutingPreview();

        // Note: No need to show create rule prompt since domains were already added
      } else {
        window.showToast(`Failed to create organization: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('[Templates] Error creating organization:', error);
      window.showToast(`Error: ${error.message}`, 'error');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = originalText;
    }
  }

  // CS-4.6: Initialize new org form event listeners
  function initNewOrgForm() {
    const closeBtn = document.getElementById('routingNewOrgClose');
    const createBtn = document.getElementById('routingNewOrgCreate');
    const cancelBtn = document.getElementById('routingNewOrgCancel');

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideNewOrgForm();
      });
    }

    if (createBtn) {
      createBtn.addEventListener('click', (e) => {
        e.preventDefault();
        createNewOrganization();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideNewOrgForm();
      });
    }
  }

  // Initialize new org form on load
  initNewOrgForm();

  // CS-4.5: Variables for create rule feature
  let unmatchedDomains = []; // Domains that don't match the selected destination
  let selectedDomainsForRule = new Set();

  // CS-4.5: Show create rule prompt after applying override
  async function showCreateRulePrompt() {
    const createRuleDiv = document.getElementById('routingCreateRule');
    const domainsDiv = document.getElementById('routingCreateRuleDomains');

    if (!createRuleDiv || !domainsDiv || !routingOverride || !currentEditingMeetingId) return;

    // Only show for client/industry destinations (not internal/unfiled)
    if (routingOverride.type === 'internal' || routingOverride.type === 'unfiled') {
      createRuleDiv.style.display = 'none';
      return;
    }

    // Get meeting participants to extract domains
    const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
    if (!meeting) {
      createRuleDiv.style.display = 'none';
      return;
    }

    // Get user's domain to exclude it
    let userDomain = null;
    try {
      const result = await window.electronAPI.getUserProfile();
      if (result.success && result.profile && result.profile.email) {
        userDomain = result.profile.email.split('@')[1]?.toLowerCase();
      }
    } catch (error) {
      console.warn('[Templates] Could not get user profile for domain exclusion:', error);
    }

    // Collect all participant emails
    const emails = new Set();
    if (meeting.participantEmails) {
      meeting.participantEmails.forEach(e => emails.add(e));
    }
    if (meeting.participants) {
      meeting.participants.forEach(p => p.email && emails.add(p.email));
    }
    if (meeting.attendees) {
      meeting.attendees.forEach(a => a.email && emails.add(a.email));
    }

    // Extract unique domains (exclude personal domains and user's own domain)
    const personalDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];
    const domains = new Set();
    emails.forEach(email => {
      const domain = email.split('@')[1]?.toLowerCase();
      if (domain &&
          !personalDomains.includes(domain) &&
          domain !== userDomain) {
        domains.add(domain);
      }
    });

    // Get current routing config to find which domains are already mapped
    try {
      const { config } = await window.electronAPI.routingGetConfig();
      const existingDomains = new Set();

      // Collect all already-mapped domains
      if (config.clients) {
        Object.values(config.clients).forEach(client => {
          (client.emails || []).forEach(d => existingDomains.add(d.toLowerCase()));
        });
      }
      if (config.industry) {
        Object.values(config.industry).forEach(ind => {
          (ind.emails || []).forEach(d => existingDomains.add(d.toLowerCase()));
        });
      }
      if (config.internal && config.internal.team_emails) {
        config.internal.team_emails.forEach(d => existingDomains.add(d.toLowerCase()));
      }

      // Find domains not already mapped
      unmatchedDomains = [...domains].filter(d => !existingDomains.has(d));
    } catch (error) {
      console.error('[Templates] Error getting routing config:', error);
      unmatchedDomains = [...domains];
    }

    // If no unmatched domains, don't show the prompt
    if (unmatchedDomains.length === 0) {
      createRuleDiv.style.display = 'none';
      return;
    }

    // Reset selected domains
    selectedDomainsForRule = new Set(unmatchedDomains); // Default all selected

    // Build domain chips HTML
    domainsDiv.innerHTML = unmatchedDomains.map(domain => `
      <label class="routing-domain-chip selected">
        <input type="checkbox" value="${escapeHtml(domain)}" checked>
        <span>${escapeHtml(domain)}</span>
      </label>
    `).join('');

    // Add change listeners to checkboxes
    domainsDiv.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const domain = e.target.value;
        const chip = e.target.closest('.routing-domain-chip');
        if (e.target.checked) {
          selectedDomainsForRule.add(domain);
          chip.classList.add('selected');
        } else {
          selectedDomainsForRule.delete(domain);
          chip.classList.remove('selected');
        }
        // Update create button state
        document.getElementById('routingCreateRuleBtn').disabled = selectedDomainsForRule.size === 0;
      });
    });

    createRuleDiv.style.display = 'block';
  }

  // CS-4.5: Hide create rule prompt
  function hideCreateRulePrompt() {
    const createRuleDiv = document.getElementById('routingCreateRule');
    if (createRuleDiv) createRuleDiv.style.display = 'none';
    unmatchedDomains = [];
    selectedDomainsForRule = new Set();
  }

  // CS-4.5: Create routing rule
  async function createRoutingRule() {
    if (!routingOverride || selectedDomainsForRule.size === 0) return;

    const createBtn = document.getElementById('routingCreateRuleBtn');
    const originalText = createBtn.textContent;
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const result = await window.electronAPI.routingAddEmailsToOrganization(
        routingOverride.type,
        routingOverride.slug,
        [...selectedDomainsForRule],
        [] // No specific contacts to add
      );

      if (result.success) {
        window.showToast(`Added ${selectedDomainsForRule.size} domain(s) to ${routingOverride.organization}`, 'success');
        hideCreateRulePrompt();
      } else {
        window.showToast('Failed to create routing rule', 'error');
      }
    } catch (error) {
      console.error('[Templates] Error creating routing rule:', error);
      window.showToast(`Error: ${error.message}`, 'error');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = originalText;
    }
  }

  // CS-4.5: Initialize create rule event listeners
  function initCreateRulePrompt() {
    const createBtn = document.getElementById('routingCreateRuleBtn');
    const dismissBtn = document.getElementById('routingCreateRuleDismiss');

    if (createBtn) {
      createBtn.addEventListener('click', (e) => {
        e.preventDefault();
        createRoutingRule();
      });
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.preventDefault();
        hideCreateRulePrompt();
      });
    }
  }

  // Initialize create rule prompt on load
  initCreateRulePrompt();

  // Get icon SVG for route type
  function getRouteTypeIcon(type) {
    switch (type) {
      case 'client':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
        </svg>`;
      case 'industry':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 22h20V8L14 4v4l-8-4v18zm2-2v-4h4v4H4zm0-6v-4h4v4H4zm6 6v-4h4v4h-4zm0-6v-4h4v4h-4zm6 6v-4h4v4h-4zm0-6V9.95l4 2V14h-4z"/>
        </svg>`;
      case 'internal':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>`;
      case 'unfiled':
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 12H5c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1z"/>
        </svg>`;
      default:
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>`;
    }
  }

  // Close template modal
  function closeTemplateModal() {
    const modal = document.getElementById('templateModal');
    modal.style.display = 'none';
    selectedTemplateIds = [];
    routingOverride = null; // CS-4.4: Reset routing override
    originalRoutes = null;
    // Hide destination picker if open
    const picker = document.getElementById('routingDestinationPicker');
    if (picker) picker.style.display = 'none';
    // CS-4.5: Hide create rule prompt
    const createRule = document.getElementById('routingCreateRule');
    if (createRule) createRule.style.display = 'none';
    // CS-4.6: Hide new org form if open
    const newOrgForm = document.getElementById('routingNewOrgForm');
    if (newOrgForm) newOrgForm.style.display = 'none';
    updateConfirmButton();
  }

  // Toggle template selection
  function toggleTemplateSelection(templateId) {
    const index = selectedTemplateIds.indexOf(templateId);
    if (index > -1) {
      selectedTemplateIds.splice(index, 1);
    } else {
      selectedTemplateIds.push(templateId);
    }

    // Update UI
    const templateItem = document.querySelector(`[data-template-id="${templateId}"]`);
    if (templateItem) {
      if (selectedTemplateIds.includes(templateId)) {
        templateItem.classList.add('selected');
      } else {
        templateItem.classList.remove('selected');
      }
    }

    updateCostEstimate();
    updateConfirmButton();
  }

  // Update cost estimate
  async function updateCostEstimate() {
    const costEstimateDiv = document.getElementById('costEstimate');

    if (selectedTemplateIds.length === 0) {
      costEstimateDiv.style.display = 'none';
      return;
    }

    // Get current meeting transcript
    const meeting = [...upcomingMeetings, ...pastMeetings].find(
      m => m.id === currentEditingMeetingId
    );
    if (!meeting || !meeting.transcript) {
      costEstimateDiv.style.display = 'none';
      return;
    }

    try {
      // Get current template summary provider setting
      const settings = JSON.parse(localStorage.getItem('jd-notes-settings') || '{}');
      const provider = settings.templateSummaryProvider || 'azure-gpt-5-mini';

      const result = await window.electronAPI.templatesEstimateCost(
        selectedTemplateIds,
        meeting.transcript,
        provider
      );
      if (result.success) {
        const estimate = result.estimate;
        document.getElementById('totalTokens').textContent = estimate.totalTokens.toLocaleString();
        document.getElementById('totalCost').textContent = `$${estimate.totalCost.toFixed(4)}`;
        costEstimateDiv.style.display = 'block';
      }
    } catch (error) {
      console.error('Error estimating cost:', error);
    }
  }

  // Update confirm button state
  function updateConfirmButton() {
    const confirmButton = document.getElementById('confirmGenerate');
    confirmButton.disabled = selectedTemplateIds.length === 0;
  }

  // Generate summaries with selected templates
  async function generateWithTemplates() {
    if (selectedTemplateIds.length === 0) return;

    // Save selected templates before closing modal (closeTemplateModal clears the array!)
    const templatesToGenerate = [...selectedTemplateIds];
    // CS-4.4: Save routing override before closing modal
    const savedRoutingOverride = routingOverride ? { ...routingOverride } : null;

    const generateButton = document.getElementById('generateButton');
    const originalHTML = generateButton.innerHTML;

    try {
      // Close modal
      closeTemplateModal();

      // Show generating state
      generateButton.classList.add('generating');
      generateButton.disabled = true;
      generateButton.textContent = 'Generating';

      console.log('Generating summaries with templates:', templatesToGenerate);
      if (savedRoutingOverride) {
        console.log('Using routing override:', savedRoutingOverride);
      }

      const result = await window.electronAPI.templatesGenerateSummaries(
        currentEditingMeetingId,
        templatesToGenerate,
        savedRoutingOverride
      );

      if (result.success) {
        console.log('Generated', result.summaries.length, 'summaries');

        // Show success toast with export status
        const exportStatus = result.exported ? ' and exported to Obsidian' : '';
        const message = `Generated ${result.summaries.length} summaries successfully${exportStatus}!`;
        window.showToast(message, 'success');

        // Update meeting data (summaries already saved by backend, but update obsidianLink if exported)
        const meeting = [...upcomingMeetings, ...pastMeetings].find(
          m => m.id === currentEditingMeetingId
        );
        if (meeting) {
          meeting.summaries = result.summaries;
          if (result.obsidianLink) {
            meeting.obsidianLink = result.obsidianLink;
          }
          await loadMeetingsDataFromFile(); // Reload to ensure we have latest data

          // Update the meeting detail view to show new summaries
          updateMeetingDetail(meeting);
        }

        // Update UI to show Obsidian sync status if exported
        if (result.exported && result.obsidianLink) {
          console.log('Meeting exported to:', result.obsidianLink);
          // Update any Obsidian status indicators (will add later)
        }

        console.log('Summaries:', result.summaries);
      } else {
        console.error('[Renderer] Failed to generate summaries:', result.error);
        alert('Failed to generate summaries: ' + result.error);
      }
    } catch (error) {
      console.error('Error generating summaries:', error);
      alert('Error: ' + error.message);
    } finally {
      generateButton.classList.remove('generating');
      generateButton.disabled = false;
      generateButton.innerHTML = originalHTML;
    }
  }

  // Initialize templates
  loadTemplates();

  // Modal event listeners
  document.getElementById('closeTemplateModal').addEventListener('click', closeTemplateModal);
  document.getElementById('cancelGenerate').addEventListener('click', closeTemplateModal);
  document.getElementById('confirmGenerate').addEventListener('click', generateWithTemplates);

  // Close modal on overlay click
  document.getElementById('templateModal').addEventListener('click', e => {
    if (e.target.id === 'templateModal') {
      closeTemplateModal();
    }
  });

  // ========================================
  // End Template Selection Modal Logic
  // ========================================

  // ========================================
  // Import Modal (Phase 8)
  // ========================================

  let selectedFiles = [];

  // Open import modal
  async function openImportModal() {
    const modal = document.getElementById('importModal');
    modal.style.display = 'flex';
    selectedFiles = [];
    updateImportUI();

    // Load templates and create checkboxes
    try {
      const result = await window.electronAPI.templatesGetAll();
      if (!result.success) {
        console.error('Failed to load templates:', result.error);
        return;
      }

      const templates = result.templates;
      const templateCheckboxesContainer = document.getElementById('templateCheckboxes');
      templateCheckboxesContainer.innerHTML = ''; // Clear existing

      // Filter out auto-summary-prompt (it's not a section template)
      const sectionTemplates = templates.filter(t => t.id !== 'auto-summary-prompt');

      sectionTemplates.forEach(template => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        label.innerHTML = `
          <input type="checkbox" class="template-checkbox" data-template-id="${template.id}" />
          <span>${template.name}</span>
        `;
        templateCheckboxesContainer.appendChild(label);
      });
    } catch (error) {
      console.error('Error loading templates for import modal:', error);
    }
  }

  // Close import modal
  function closeImportModal() {
    const modal = document.getElementById('importModal');
    modal.style.display = 'none';
    selectedFiles = [];
    updateImportUI();
  }

  // Update background import indicator
  function updateBackgroundImportIndicator(current = 0, total = 0, customMessage = null) {
    const indicator = document.getElementById('backgroundImportIndicator');
    if (!indicator) {
      // Create indicator if it doesn't exist
      const newIndicator = document.createElement('div');
      newIndicator.id = 'backgroundImportIndicator';
      newIndicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2196F3;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-size: 14px;
        font-weight: 500;
        display: none;
        min-width: 200px;
      `;
      document.body.appendChild(newIndicator);
    }

    const ind = document.getElementById('backgroundImportIndicator');
    if (backgroundImportRunning) {
      ind.style.display = 'block';
      if (customMessage) {
        ind.textContent = customMessage;
      } else if (total > 0) {
        ind.textContent = `Importing files... (${current}/${total})`;
      } else {
        ind.textContent = 'Starting import...';
      }
    } else {
      ind.style.display = 'none';
    }
  }

  // Update import UI based on selected files
  function updateImportUI() {
    const dropZone = document.getElementById('fileDropZone');
    const filesList = document.getElementById('selectedFilesList');
    const importOptions = document.getElementById('importOptions');
    const startImportBtn = document.getElementById('startImport');
    const fileCount = document.getElementById('fileCount');
    const filesListContainer = document.getElementById('filesListContainer');
    const audioProviderGroup = document.getElementById('audioProviderGroup');
    const audioProviderSpacer = document.getElementById('audioProviderSpacer');
    const audioFileCountEl = document.getElementById('audioFileCount');

    if (selectedFiles.length === 0) {
      dropZone.style.display = 'block';
      filesList.style.display = 'none';
      importOptions.style.display = 'none';
      startImportBtn.disabled = true;
      // Hide audio provider when no files
      if (audioProviderGroup) audioProviderGroup.style.display = 'none';
      if (audioProviderSpacer) audioProviderSpacer.style.display = 'none';
    } else {
      dropZone.style.display = 'none';
      filesList.style.display = 'block';
      importOptions.style.display = 'block';
      startImportBtn.disabled = false;

      fileCount.textContent = selectedFiles.length;

      // IM-1.3: Count audio files and show provider selector if needed
      const audioFiles = selectedFiles.filter(
        f => f.isAudio || f.type === 'audio' || isAudioFileByExtension(f.name)
      );
      const hasAudioFiles = audioFiles.length > 0;

      if (audioProviderGroup) {
        audioProviderGroup.style.display = hasAudioFiles ? 'block' : 'none';
      }
      if (audioProviderSpacer) {
        audioProviderSpacer.style.display = hasAudioFiles ? 'block' : 'none';
      }
      if (audioFileCountEl) {
        audioFileCountEl.textContent = audioFiles.length;
      }

      // Render file list
      filesListContainer.innerHTML = selectedFiles
        .map((file, index) => {
          const ext = file.name.split('.').pop().toUpperCase();
          const sizeKB = (file.size / 1024).toFixed(1);
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          const sizeDisplay = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
          const isAudio = file.isAudio || file.type === 'audio' || isAudioFileByExtension(file.name);
          const fileIconClass = isAudio ? 'file-icon audio-file' : 'file-icon';
          const typeLabel = isAudio ? 'Audio' : ext;

          return `
          <div class="file-item ${isAudio ? 'audio-file-item' : ''}" data-index="${index}">
            <div class="file-item-info">
              <div class="${fileIconClass}">${isAudio ? '🎵' : ext}</div>
              <div class="file-details">
                <div class="file-name">${file.name}</div>
                <div class="file-size">${sizeDisplay}${isAudio ? ' • Will transcribe' : ''}</div>
              </div>
            </div>
            <button class="file-remove" data-index="${index}" title="Remove file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        `;
        })
        .join('');

      // Add event listeners to remove buttons
      filesListContainer.querySelectorAll('.file-remove').forEach(btn => {
        btn.addEventListener('click', e => {
          const index = parseInt(e.currentTarget.getAttribute('data-index'));
          selectedFiles.splice(index, 1);
          updateImportUI();
        });
      });
    }
  }

  // Handle file selection from browser File API
  function handleFiles(files) {
    const fileArray = Array.from(files);
    const validExtensions = ['.txt', '.md', '.vtt', '.srt'];

    const validFiles = fileArray.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return validExtensions.includes(ext);
    });

    if (validFiles.length === 0) {
      console.warn('[Import] No valid files selected');
      alert('No valid files selected. Please choose .txt, .md, .vtt, or .srt files.');
      return;
    }

    // Add to selected files (avoid duplicates)
    validFiles.forEach(file => {
      const exists = selectedFiles.some(f => f.name === file.name && f.size === file.size);
      if (!exists) {
        selectedFiles.push(file);
      }
    });

    updateImportUI();
  }

  // IM-1: Valid file extensions for import
  const TRANSCRIPT_EXTENSIONS = ['.txt', '.md', '.vtt', '.srt'];
  const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac', '.aac'];
  const ALL_VALID_EXTENSIONS = [...TRANSCRIPT_EXTENSIONS, ...AUDIO_EXTENSIONS];

  // Handle file paths from Electron dialog or drag-and-drop
  function handleFilePaths(fileObjects) {
    console.log('[Import] handleFilePaths called with', fileObjects.length, 'files');

    const validFiles = fileObjects.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValid = ALL_VALID_EXTENSIONS.includes(ext);
      const isAudio = AUDIO_EXTENSIONS.includes(ext);
      console.log(
        '[Import] File validation:',
        file.name,
        'ext:',
        ext,
        'valid:',
        isValid,
        'audio:',
        isAudio,
        'has path:',
        !!file.path
      );
      // Tag the file with its type if not already tagged by main process
      if (isValid && !file.type) {
        file.type = isAudio ? 'audio' : 'transcript';
        file.isAudio = isAudio;
      }
      return isValid;
    });

    if (validFiles.length === 0) {
      console.warn('[Import] No valid files selected');
      alert('No valid files selected. Please choose transcript files (.txt, .md, .vtt, .srt) or audio files (.mp3, .wav, .m4a).');
      return;
    }

    // Add to selected files (avoid duplicates)
    validFiles.forEach(file => {
      const exists = selectedFiles.some(f => f.path === file.path);
      if (!exists) {
        console.log('[Import] Adding file to selection:', file.name, 'path:', file.path, 'type:', file.type);
        selectedFiles.push(file);
      } else {
        console.log('[Import] Skipping duplicate:', file.name);
      }
    });

    console.log('[Import] Total selected files:', selectedFiles.length);
    updateImportUI();
  }

  // Import button click handler
  document.getElementById('importBtn').addEventListener('click', openImportModal);

  // Close modal buttons
  document.getElementById('closeImportModal').addEventListener('click', closeImportModal);
  document.getElementById('cancelImport').addEventListener('click', closeImportModal);

  // File input browse - Use Electron dialog instead of HTML file input
  const fileInput = document.getElementById('fileInput');
  const fileDropZone = document.getElementById('fileDropZone');

  // Browse Files button
  document.getElementById('browseFilesBtn').addEventListener('click', async e => {
    e.stopPropagation(); // Prevent drop zone click
    const files = await window.electronAPI.selectImportFiles();

    if (files && files.length > 0) {
      // Files already have the right format: { path, name, size }
      handleFilePaths(files);
    }
  });

  // Browse Folder button
  document.getElementById('browseFolderBtn').addEventListener('click', async e => {
    e.stopPropagation(); // Prevent drop zone click
    const files = await window.electronAPI.selectImportFolder();

    if (files && files.length > 0) {
      // Filter to only supported formats
      const supportedExts = ['.txt', '.md', '.vtt', '.srt'];
      const validFiles = files.filter(f => {
        const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0];
        return ext && supportedExts.includes(ext);
      });

      if (validFiles.length > 0) {
        handleFilePaths(validFiles);
        if (validFiles.length < files.length) {
          showToast(
            `Imported ${validFiles.length} of ${files.length} files (filtered unsupported formats)`,
            'info'
          );
        }
      } else {
        showToast('No supported transcript files found in folder', 'warning');
      }
    }
  });

  // Keep this for drag-and-drop (won't work in Electron, but keep for completeness)
  fileInput.addEventListener('change', e => {
    // This won't work in Electron due to security, but keep it
    handleFiles(e.target.files);
    e.target.value = ''; // Reset input
  });

  // Drag and drop - Handle Electron file paths
  fileDropZone.addEventListener('dragover', e => {
    e.preventDefault();
    fileDropZone.classList.add('drag-over');
  });

  fileDropZone.addEventListener('dragleave', () => {
    fileDropZone.classList.remove('drag-over');
  });

  fileDropZone.addEventListener('drop', async e => {
    e.preventDefault();
    fileDropZone.classList.remove('drag-over');

    // In modern Electron, use webUtils.getPathForFile() to get file paths
    const files = [];
    for (const file of e.dataTransfer.files) {
      try {
        // Use Electron's webUtils to get the real file path
        const filePath = window.electronAPI.getPathForFile(file);

        console.log('[Import] Drag-and-drop file:', {
          name: file.name,
          path: filePath,
          size: file.size,
        });

        files.push({
          name: file.name,
          path: filePath,
          size: file.size,
          type: file.name.split('.').pop(),
        });
      } catch (error) {
        console.error('[Import] Error getting path for file:', file.name, error);
        alert(
          `Could not get path for file "${file.name}". Please use the file browser button instead.`
        );
        return;
      }
    }

    if (files.length > 0) {
      console.log('[Import] Processing', files.length, 'dropped files');
      handleFilePaths(files);
    }
  });

  // Clear all files
  document.getElementById('clearFilesBtn').addEventListener('click', () => {
    selectedFiles = [];
    updateImportUI();
  });

  // Close modal on overlay click
  document.getElementById('importModal').addEventListener('click', e => {
    if (e.target.id === 'importModal') {
      closeImportModal();
    }
  });

  // Start import button
  // Background import state
  let backgroundImportRunning = false;

  document.getElementById('startImport').addEventListener('click', async () => {
    // Read import options
    const generateAutoSummary = document.getElementById('generateAutoSummaryCheck').checked;
    const autoExport = document.getElementById('autoExportCheck').checked;
    const previewParsing = document.getElementById('previewParsingCheck').checked;

    // Get selected template IDs
    const selectedTemplateIds = [];
    document.querySelectorAll('.template-checkbox:checked').forEach(checkbox => {
      selectedTemplateIds.push(checkbox.getAttribute('data-template-id'));
    });

    console.log('Starting background import of', selectedFiles.length, 'files');
    console.log('Generate auto-summary:', generateAutoSummary);
    console.log('Selected templates:', selectedTemplateIds);
    console.log('Preview parsing:', previewParsing);

    // Validate that we have valid paths
    const invalidFiles = selectedFiles.filter(f => !f.path);
    if (invalidFiles.length > 0) {
      console.error(
        '[Import] Files missing paths:',
        invalidFiles.map(f => f.name)
      );
      alert(
        `Some files do not have valid paths: ${invalidFiles.map(f => f.name).join(', ')}. Please use the file browser button.`
      );
      return;
    }

    // If preview is enabled, show pattern preview modal for first file
    if (previewParsing && selectedFiles.length > 0) {
      await showImportPreview(selectedFiles[0], {
        generateAutoSummary,
        selectedTemplateIds,
        autoExport,
      });
      return; // Modal will handle the import on confirm
    }

    // Otherwise, proceed directly with import
    await performBatchImport({
      generateAutoSummary,
      selectedTemplateIds,
      autoExport,
    });
  });

  /**
   * Show pattern preview modal for import (Phase 10.8.2)
   */
  async function showImportPreview(file, importOptions) {
    const { initialize } = await import('./renderer/components/PatternTestingPanel.js');

    // Read file content via IPC (can't use fs directly in renderer)
    const response = await window.electronAPI.readTranscriptFile(file.path);

    if (!response.success) {
      showToast('Failed to read file for preview: ' + response.error, 'error');
      return;
    }

    const fileContent = response.content;

    // Show preview modal
    const previewModal = document.getElementById('patternPreviewModal');
    const importModal = document.getElementById('importModal');

    importModal.style.display = 'none';
    previewModal.style.display = 'flex';

    // Initialize pattern testing panel in import-preview mode
    await initialize('import-preview', {
      fileContent,
      filePath: file.path,
      fileSize: file.size,
      onConfirm: async () => {
        // Close preview modal
        previewModal.style.display = 'none';

        // Start the import
        await performBatchImport(importOptions);
      },
      onCancel: () => {
        // Close preview modal and return to import modal
        previewModal.style.display = 'none';
        importModal.style.display = 'flex';
      },
    });
  }

  /**
   * Check if a file is an audio file based on extension
   */
  function isAudioFileByExtension(fileName) {
    const ext = '.' + fileName.split('.').pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }

  /**
   * Perform the actual batch import (IM-1: supports both transcripts and audio files)
   */
  async function performBatchImport(options) {
    const { generateAutoSummary, selectedTemplateIds, autoExport } = options;

    // IM-1.6: Separate audio files from transcript files BEFORE closing modal
    // Use multiple checks for robustness: isAudio flag, type property, or extension check
    const audioFiles = selectedFiles.filter(f =>
      f.isAudio === true || f.type === 'audio' || isAudioFileByExtension(f.name)
    );
    const transcriptFiles = selectedFiles.filter(f =>
      f.isAudio !== true && f.type !== 'audio' && !isAudioFileByExtension(f.name)
    );
    const transcriptPaths = transcriptFiles.map(file => file.path);

    console.log('[Import] File separation:', {
      total: selectedFiles.length,
      audio: audioFiles.map(f => f.name),
      transcripts: transcriptFiles.map(f => f.name),
    });

    // Get selected audio provider
    const audioProviderSelect = document.getElementById('audioProviderSelect');
    const audioProvider = audioProviderSelect?.value || 'assemblyai';

    // UI-1.6: Get selected platform
    const platformSelect = document.getElementById('importPlatformSelect');
    const selectedPlatform = platformSelect?.value || 'unknown';

    // Close modal immediately and run in background
    closeImportModal();
    backgroundImportRunning = true;
    updateBackgroundImportIndicator();

    // Calculate total files for progress
    const totalFiles = audioFiles.length + transcriptFiles.length;
    let processedFiles = 0;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    // Show starting notification
    const fileTypes = [];
    if (audioFiles.length > 0) fileTypes.push(`${audioFiles.length} audio`);
    if (transcriptFiles.length > 0) fileTypes.push(`${transcriptFiles.length} transcript`);
    showToast(`Importing ${fileTypes.join(' and ')} file${totalFiles > 1 ? 's' : ''}...`);

    // Listen for progress updates
    window.electronAPI.onImportProgress(progress => {
      if (progress.step === 'transcribing') {
        updateBackgroundImportIndicator(processedFiles + 1, totalFiles, 'Transcribing...');
      } else if (progress.step === 'batch-progress') {
        updateBackgroundImportIndicator(audioFiles.length + progress.current, totalFiles);
      }
    });

    try {
      // IM-1.4/1.5: Process audio files first (transcribe then import)
      if (audioFiles.length > 0) {
        console.log(`[Import] Processing ${audioFiles.length} audio files with provider: ${audioProvider}`);

        for (const audioFile of audioFiles) {
          try {
            console.log(`[Import] Transcribing audio file: ${audioFile.name}`);
            updateBackgroundImportIndicator(processedFiles + 1, totalFiles, `Transcribing ${audioFile.name}...`);

            const result = await window.electronAPI.importAudioFile(audioFile.path, audioProvider, {
              generateAutoSummary,
              templateIds: selectedTemplateIds,
              autoExport,
              platform: selectedPlatform, // UI-1.6
            });

            if (result.success) {
              successCount++;
              console.log(`[Import] Audio import successful: ${audioFile.name}`);
            } else {
              failCount++;
              errors.push({ file: audioFile.path, error: result.error });
              console.error(`[Import] Audio import failed: ${audioFile.name}`, result.error);
            }
          } catch (err) {
            failCount++;
            errors.push({ file: audioFile.path, error: err.message });
            console.error(`[Import] Audio import error: ${audioFile.name}`, err);
          }
          processedFiles++;
          updateBackgroundImportIndicator(processedFiles, totalFiles);
        }
      }

      // Process transcript files using existing batch import
      if (transcriptPaths.length > 0) {
        console.log(`[Import] Processing ${transcriptPaths.length} transcript files`);

        const result = await window.electronAPI.importBatch(transcriptPaths, {
          generateAutoSummary,
          templateIds: selectedTemplateIds,
          autoExport,
          platform: selectedPlatform, // UI-1.6
        });

        successCount += result.successful || 0;
        failCount += result.failed || 0;
        if (result.errors) {
          errors.push(...result.errors);
        }
      }

      // Show completion notification
      if (successCount > 0) {
        const message = `Successfully imported ${successCount} of ${totalFiles} file${totalFiles > 1 ? 's' : ''}!`;

        if (failCount > 0) {
          showToast(`${message} (${failCount} failed)`, 'warning');
          if (errors.length > 0) {
            console.error('Import errors:', errors);
          }
        } else {
          showToast(message, 'success');
        }

        // Reload meetings data to show imported meetings
        await loadMeetingsDataFromFile();
        renderMeetings();

      } else {
        showToast(`Import failed: All ${totalFiles} file(s) failed`, 'error');
        if (errors.length > 0) {
          console.error('Import errors:', errors);
        }
      }
    } catch (error) {
      console.error('Import error:', error);
      showToast('Import failed: ' + error.message, 'error');
    } finally {
      backgroundImportRunning = false;
      updateBackgroundImportIndicator();
    }
  }

  // Close pattern preview modal
  document.getElementById('closePatternPreviewModal')?.addEventListener('click', () => {
    document.getElementById('patternPreviewModal').style.display = 'none';
    document.getElementById('importModal').style.display = 'flex';
  });

  // ========================================
  // End Import Modal Logic
  // ========================================

  // Handle generate notes button - opens template modal
  const generateButton = document.querySelector('.generate-btn');
  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      console.log('Opening template selection...');

      // Check if we have an active meeting
      if (!currentEditingMeetingId) {
        alert('No meeting is currently open');
        return;
      }

      // Check if meeting has transcript
      const meeting = [...upcomingMeetings, ...pastMeetings].find(
        m => m.id === currentEditingMeetingId
      );
      if (!meeting || !meeting.transcript) {
        alert('No transcript available yet. Please record a meeting first.');
        return;
      }

      // Open template selection modal
      openTemplateModal();
    });
  }

  // Handle Obsidian publish/republish button
  const obsidianButton = document.getElementById('obsidianButton');
  if (obsidianButton) {
    obsidianButton.addEventListener('click', async () => {
      console.log('Obsidian button clicked');

      if (!currentEditingMeetingId) {
        alert('No meeting is currently open');
        return;
      }

      const meeting = [...upcomingMeetings, ...pastMeetings].find(
        m => m.id === currentEditingMeetingId
      );
      if (!meeting) {
        alert('Meeting not found');
        return;
      }

      // Check if this is a republish (meeting already has obsidianLink)
      const isRepublish = !!meeting.obsidianLink;

      if (isRepublish) {
        // Confirm republish
        if (!confirm('This will overwrite the existing files in Obsidian. Continue?')) {
          return;
        }
      }

      // Check if meeting has content to export
      if (!meeting.content && (!meeting.summaries || meeting.summaries.length === 0)) {
        alert(
          'No content to export. Please generate summaries first or wait for automatic summary.'
        );
        return;
      }

      const originalText = obsidianButton.querySelector('#obsidianButtonText').textContent;
      obsidianButton.disabled = true;
      obsidianButton.querySelector('#obsidianButtonText').textContent = 'Publishing...';

      try {
        const result = await window.electronAPI.obsidianExportMeeting(meeting.id);

        if (result.success) {
          console.log('Export successful:', result.obsidianLink);

          // Update meeting data
          meeting.obsidianLink = result.obsidianLink;
          await loadMeetingsDataFromFile();

          // Show success message
          const message = isRepublish ? 'Republished to Obsidian!' : 'Published to Obsidian!';
          window.showToast(message, 'success');

          // Update button to show "Republish"
          updateObsidianButton(meeting);
        } else {
          alert('Export failed: ' + result.error);
          obsidianButton.querySelector('#obsidianButtonText').textContent = originalText;
        }
      } catch (error) {
        console.error('Export error:', error);
        alert('Export error: ' + error.message);
        obsidianButton.querySelector('#obsidianButtonText').textContent = originalText;
      } finally {
        obsidianButton.disabled = false;
      }
    });
  }

  // Note: onRecordingCompleted event listener is registered earlier in the file (line ~2213)
  // Duplicate removed to prevent multiple handlers
});
