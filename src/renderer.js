/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 */

import './index.css';

// Create empty meetings data structure to be filled from the file
const meetingsData = {
  upcomingMeetings: [],
  pastMeetings: []
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


// Function to check if there's an active recording for the current note
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
  const activeMeeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);

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

    const upcomingIndex = meetingsData.upcomingMeetings.findIndex(m => m.id === currentEditingMeetingId);
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
    console.log('Available meeting IDs:', [...upcomingMeetings, ...pastMeetings].map(m => m.id).join(', '));
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
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// ========================================
// Display AI Generated Summaries
// ========================================

function displaySummaries(summaries) {
  const summariesSection = document.getElementById('summariesSection');
  const summariesContent = document.getElementById('summariesContent');

  if (!summaries || summaries.length === 0) {
    summariesSection.style.display = 'none';
    return;
  }

  // Clear existing content
  summariesContent.innerHTML = '';

  // Create summary cards
  summaries.forEach((summary, index) => {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.dataset.summaryId = summary.templateId;

    card.innerHTML = `
      <div class="summary-card-header">
        <div class="summary-card-title">${summary.templateName}</div>
        <div class="summary-card-toggle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 10L12 15L17 10H7Z" fill="currentColor"/>
          </svg>
        </div>
      </div>
      <div class="summary-card-body">
        ${markdownToHtml(summary.content)}
      </div>
    `;

    // Add click handler to toggle collapse
    const header = card.querySelector('.summary-card-header');
    header.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });

    summariesContent.appendChild(card);
  });

  // Show the summaries section
  summariesSection.style.display = 'block';

  // Add collapse all button handler
  const collapseBtn = document.getElementById('collapseSummaries');
  collapseBtn.onclick = () => {
    const allCards = summariesContent.querySelectorAll('.summary-card');
    const allCollapsed = Array.from(allCards).every(card => card.classList.contains('collapsed'));

    allCards.forEach(card => {
      if (allCollapsed) {
        card.classList.remove('collapsed');
      } else {
        card.classList.add('collapsed');
      }
    });
  };
}

// Simple markdown to HTML converter
function markdownToHtml(markdown) {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Lists
  html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
  html = html.replace(/^- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');

  return html;
}



// Function to create meeting card elements
function createMeetingCard(meeting) {
  const card = document.createElement('div');
  card.className = 'meeting-card';
  card.dataset.id = meeting.id;

  let iconHtml = '';

  if (meeting.type === 'profile') {
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
  }

  let subtitleHtml = meeting.hasDemo
    ? `<div class="meeting-time"><a class="meeting-demo-link">${meeting.subtitle}</a></div>`
    : `<div class="meeting-time">${meeting.subtitle}</div>`;

  card.innerHTML = `
    ${iconHtml}
    <div class="meeting-content">
      <div class="meeting-title">${meeting.title}</div>
      ${subtitleHtml}
    </div>
    <div class="meeting-actions">
      <button class="delete-meeting-btn" data-id="${meeting.id}" title="Delete note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  return card;
}

// Function to create calendar meeting card
function createCalendarMeetingCard(meeting) {
  const card = document.createElement('div');
  card.className = 'meeting-card calendar-meeting';
  card.dataset.id = meeting.id;

  // Platform icon colors
  const platformColors = {
    'zoom': '#2D8CFF',
    'teams': '#6264A7',
    'google-meet': '#0F9D58',
    'webex': '#00BCEB',
    'whereby': '#6366F1',
    'unknown': '#999'
  };

  const platformColor = platformColors[meeting.platform] || platformColors['unknown'];

  // Format the meeting time
  const startTime = new Date(meeting.startTime);
  const endTime = new Date(meeting.endTime);
  const timeString = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Platform display name
  const platformNames = {
    'zoom': 'Zoom',
    'teams': 'Teams',
    'google-meet': 'Google Meet',
    'webex': 'Webex',
    'whereby': 'Whereby',
    'unknown': 'Meeting'
  };
  const platformName = platformNames[meeting.platform] || 'Meeting';

  card.innerHTML = `
    <div class="meeting-icon calendar" style="background-color: ${platformColor}20;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3.01 4.9 3.01 6L3 20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 20H5V10H19V20ZM19 8H5V6H19V8Z" fill="${platformColor}"/>
      </svg>
    </div>
    <div class="meeting-content">
      <div class="meeting-title">${meeting.title}</div>
      <div class="meeting-time">${timeString} • ${platformName}</div>
      <div class="meeting-participants">${meeting.participants.length} participant${meeting.participants.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="meeting-actions">
      ${meeting.meetingLink ? `
        <button class="join-calendar-meeting-btn" data-id="${meeting.id}" data-link="${meeting.meetingLink}" title="Join meeting">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="currentColor"/>
          </svg>
        </button>
      ` : ''}
      <button class="record-calendar-meeting-btn" data-id="${meeting.id}" title="Record meeting">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  return card;
}

// Google authentication state (unified for Calendar and Contacts)
let googleAuthenticated = false;
let contactsCount = 0;

// Function to initialize Google integration (unified for Calendar and Contacts)
async function initializeGoogle() {
  try {
    console.log('Initializing Google integration...');
    const isAuthenticated = await window.electronAPI.googleIsAuthenticated();
    const statusResult = await window.electronAPI.googleGetStatus();

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
  document.getElementById('backButton').style.display = 'none';
  document.getElementById('newNoteBtn').style.display = 'block';
  document.getElementById('toggleSidebar').style.display = 'none';

  // Show Record Meeting button and set its state based on meeting detection
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    // Always show the button
    joinMeetingBtn.style.display = 'block';
    joinMeetingBtn.innerHTML = 'Record Meeting';

    // Enable/disable based on meeting detection
    if (window.meetingDetected) {
      joinMeetingBtn.disabled = false;
    } else {
      joinMeetingBtn.disabled = true;
    }
  }
}

// Function to show editor view
function showEditorView(meetingId) {
  console.log(`Showing editor view for meeting ID: ${meetingId}`);

  // Make the views visible/hidden
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('editorView').style.display = 'block';
  document.getElementById('backButton').style.display = 'block';
  document.getElementById('newNoteBtn').style.display = 'none';
  document.getElementById('toggleSidebar').style.display = 'none'; // Hide the sidebar toggle

  // Always hide the join meeting button when in editor view
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    joinMeetingBtn.style.display = 'none';
  }

  // Find the meeting in either upcoming or past meetings
  let meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

  if (!meeting) {
    console.error(`Meeting not found: ${meetingId}`);
    return;
  }

  // Set the current editing meeting ID
  currentEditingMeetingId = meetingId;
  console.log(`Now editing meeting: ${meetingId} - ${meeting.title}`);



  // Set the meeting title
  document.getElementById('noteTitle').textContent = meeting.title;

  // Set the date display
  const dateObj = new Date(meeting.date);
  document.getElementById('noteDate').textContent = formatDate(dateObj);

  // Get the editor element
  const editorElement = document.getElementById('simple-editor');

  // Important: Reset the editor content completely
  if (editorElement) {
    editorElement.value = '';
  }

  // Add a small delay to ensure the DOM has updated before setting content
  setTimeout(() => {
    if (meeting.content) {
      editorElement.value = meeting.content;
      console.log(`Loaded content for meeting: ${meetingId}, length: ${meeting.content.length} characters`);
    } else {
      // If content is missing, create template
      const now = new Date();
      const template = `# Meeting Title\n• ${meeting.title}\n\n# Meeting Date and Time\n• ${now.toLocaleString()}\n\n# Participants\n• \n\n# Description\n• \n\nChat with meeting transcript: `;
      editorElement.value = template;

      // Save this template to the meeting
      meeting.content = template;
      saveMeetingsData();
      console.log(`Created new template for meeting: ${meetingId}`);
    }

    // Set up auto-save handler for this specific note
    setupAutoSaveHandler();

    // Add event listener to the title
    setupTitleEditing();

    // Check if this note has an active recording and update the record button
    checkActiveRecordingState();

    // Display summaries if they exist
    if (meeting.summaries && meeting.summaries.length > 0) {
      displaySummaries(meeting.summaries);
    } else {
      displaySummaries([]); // Hide summaries section if none exist
    }

    // Update debug panel with any available data if it's open
    const debugPanel = document.getElementById('debugPanel');
    if (debugPanel && !debugPanel.classList.contains('hidden')) {
      // Update transcript if available
      if (meeting.transcript && meeting.transcript.length > 0) {
        updateDebugTranscript(meeting.transcript);
      } else {
        // Clear transcript area if no transcript
        const transcriptContent = document.getElementById('transcriptContent');
        if (transcriptContent) {
          transcriptContent.innerHTML = `
            <div class="placeholder-content">
              <p>No transcript available yet</p>
            </div>
          `;
        }
      }

      // Update participants if available
      if (meeting.participants && meeting.participants.length > 0) {
        updateDebugParticipants(meeting.participants);
      } else {
        // Clear participants area if no participants
        const participantsContent = document.getElementById('participantsContent');
        if (participantsContent) {
          participantsContent.innerHTML = `
            <div class="placeholder-content">
              <p>No participants detected yet</p>
            </div>
          `;
        }
      }

      // Reset video preview when changing notes
      const videoContent = document.getElementById('videoContent');
      if (videoContent) {
        videoContent.innerHTML = `
          <div class="placeholder-content video-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#999"/>
            </svg>
            <p>Video preview will appear here</p>
          </div>
        `;
      }
    }
  }, 50);
}

// Setup the title editing and save function
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
    console.log('Auto-saving note due to content change');
    if (currentEditingMeetingId) {
      console.log(`Auto-save triggered for meeting: ${currentEditingMeetingId}`);
      await saveCurrentNote();
    } else {
      console.warn('Cannot auto-save: No active meeting ID');
    }
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
    console.log(`Set up editor auto-save handler for meeting: ${currentEditingMeetingId || 'none'}`);

    // Manually trigger a save once to ensure the content is saved
    setTimeout(() => {
      console.log('Triggering initial save after setup');
      editorElement.dispatchEvent(new Event('input'));
    }, 500);
  } else {
    console.warn('Editor element not found for auto-save setup');
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
    content: template // Set the content directly
  };

  // Log what we're adding
  console.log(`Adding new meeting: id=${id}, title=${newMeeting.title}, content.length=${template.length}`);

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
    // Start manual recording for the new note
    window.electronAPI.startManualRecording(id)
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
    <h2 class="section-title">Notes</h2>
    <div class="meetings-list" id="notes-list"></div>
  `;
  mainContent.appendChild(notesSection);

  // Get the notes container
  const notesContainer = notesSection.querySelector('#notes-list');

  // Add all meetings to the notes section (both upcoming and past)
  const allMeetings = [...upcomingMeetings, ...pastMeetings];

  // Sort by date, newest first
  allMeetings.sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  // Filter out calendar entries and add only document type meetings to the container
  allMeetings
    .filter(meeting => meeting.type !== 'calendar') // Skip calendar entries
    .forEach(meeting => {
      notesContainer.appendChild(createMeetingCard(meeting));
    });
}

// Load meetings data from file
async function loadMeetingsDataFromFile() {
  console.log("Loading meetings data from file...");
  try {
    const result = await window.electronAPI.loadMeetingsData();
    console.log("Load result success:", result.success);

    if (result.success) {
      console.log(`Got data with ${result.data.pastMeetings?.length || 0} past meetings`);
      if (result.data.pastMeetings && result.data.pastMeetings.length > 0) {
        console.log("Most recent meeting:", result.data.pastMeetings[0].id, result.data.pastMeetings[0].title);
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

      console.log("Before updating arrays, pastMeetings count:", pastMeetings.length);

      // Filter out calendar entries when loading data
      meetingsData.upcomingMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => upcomingMeetings.push(meeting));

      meetingsData.pastMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => pastMeetings.push(meeting));

      console.log("After updating arrays, pastMeetings count:", pastMeetings.length);
      if (pastMeetings.length > 0) {
        console.log("First past meeting:", pastMeetings[0].id, pastMeetings[0].title);
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

// Function to update the transcript section in the debug panel
function updateDebugTranscript(transcript) {
  const transcriptContent = document.getElementById('transcriptContent');
  if (!transcriptContent) return;

  // Check if user was at bottom before clearing content
  const wasAtBottom = transcriptContent.scrollTop + transcriptContent.clientHeight >= transcriptContent.scrollHeight - 5;

  // Clear previous content
  transcriptContent.innerHTML = '';

  if (!transcript || transcript.length === 0) {
    // Show placeholder if no transcript is available
    transcriptContent.innerHTML = `
      <div class="placeholder-content">
        <p>No transcript available yet</p>
      </div>
    `;
    return;
  }

  // Create transcript entries
  const transcriptDiv = document.createElement('div');
  transcriptDiv.className = 'transcript-entries';

  // Add each transcript entry
  transcript.forEach((entry, index) => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'transcript-entry';

    // Format timestamp
    const timestamp = new Date(entry.timestamp);
    const formattedTime = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Create HTML for this entry
    entryDiv.innerHTML = `
      <div class="transcript-speaker">${entry.speaker || 'Unknown'}</div>
      <div class="transcript-text">${entry.text}</div>
      <div class="transcript-timestamp">${formattedTime}</div>
    `;

    // Add a highlight class for the newest entry
    if (index === transcript.length - 1) {
      entryDiv.classList.add('newest-entry');
    }

    transcriptDiv.appendChild(entryDiv);
  });

  transcriptContent.appendChild(transcriptDiv);

  // Only auto-scroll to bottom if user was at the bottom before the update
  if (wasAtBottom) {
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }, 0);
  }
}

// Function to update the video preview in the debug panel
function updateDebugVideoPreview(frameData) {
  // Get the image data from the frame
  const { buffer, participantId, participantName, frameType } = frameData;

  // Determine if this is a screenshare or participant video
  const isScreenshare = frameType !== 'webcam';

  if (isScreenshare) {
    updateScreensharePreview(frameData);
  } else {
    updateParticipantVideoPreview(frameData);
  }

  // Make sure debug panel toggle shows new content notification if panel is closed
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel && debugPanel.classList.contains('hidden')) {
    const debugPanelToggle = document.getElementById('debugPanelToggle');
    if (debugPanelToggle && !debugPanelToggle.classList.contains('has-new-content')) {
      debugPanelToggle.classList.add('has-new-content');
    }
  }
}

// Function to update participant video preview
function updateParticipantVideoPreview(frameData) {
  const videoContent = document.getElementById('videoContent');
  if (!videoContent) return;

  const { buffer, participantId, participantName, frameType } = frameData;

  // Check if we already have a container for this participant
  let participantVideoContainer = document.getElementById(`video-participant-${participantId}`);

  // If no container exists, create one
  if (!participantVideoContainer) {
    // Clear the placeholder content if this is the first frame
    if (videoContent.querySelector('.placeholder-content')) {
      videoContent.innerHTML = '';
    }

    // Create a container for this participant's video
    participantVideoContainer = document.createElement('div');
    participantVideoContainer.id = `video-participant-${participantId}`;
    participantVideoContainer.className = 'video-participant-container';

    // Add the name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'video-participant-name';
    nameLabel.textContent = participantName;
    participantVideoContainer.appendChild(nameLabel);

    // Create an image element for the video frame
    const videoImg = document.createElement('img');
    videoImg.className = 'video-frame';
    videoImg.id = `video-frame-${participantId}`;
    participantVideoContainer.appendChild(videoImg);

    // Add the frame type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'video-frame-type';
    typeLabel.textContent = 'Camera';
    participantVideoContainer.appendChild(typeLabel);

    // Add to the video content area
    videoContent.appendChild(participantVideoContainer);
  }

  // Update the image with the new frame
  const videoImg = document.getElementById(`video-frame-${participantId}`);
  if (videoImg) {
    videoImg.src = `data:image/png;base64,${buffer}`;
  }
}

// Function to update screenshare preview
function updateScreensharePreview(frameData) {
  const screenshareContent = document.getElementById('screenshareContent');
  if (!screenshareContent) return;

  const { buffer, participantId, participantName, frameType } = frameData;

  // Check if we already have a container for this screenshare
  let screenshareContainer = document.getElementById(`screenshare-participant-${participantId}`);

  // If no container exists, create one
  if (!screenshareContainer) {
    // Clear the placeholder content if this is the first frame
    if (screenshareContent.querySelector('.placeholder-content')) {
      screenshareContent.innerHTML = '';
    }

    // Create a container for this participant's screenshare
    screenshareContainer = document.createElement('div');
    screenshareContainer.id = `screenshare-participant-${participantId}`;
    screenshareContainer.className = 'video-participant-container';

    // Create an image element for the screenshare frame
    const screenshareImg = document.createElement('img');
    screenshareImg.className = 'video-frame';
    screenshareImg.id = `screenshare-frame-${participantId}`;
    screenshareContainer.appendChild(screenshareImg);

    // Add the frame type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'video-frame-type';
    typeLabel.textContent = 'Screen';
    screenshareContainer.appendChild(typeLabel);

    // Add to the screenshare content area
    screenshareContent.appendChild(screenshareContainer);
  }

  // Update the image with the new frame
  const screenshareImg = document.getElementById(`screenshare-frame-${participantId}`);
  if (screenshareImg) {
    screenshareImg.src = `data:image/png;base64,${buffer}`;
  }
}

// Function to update the participants section in the debug panel
function updateDebugParticipants(participants) {
  const participantsContent = document.getElementById('participantsContent');
  if (!participantsContent) return;

  // Clear previous content
  participantsContent.innerHTML = '';

  if (!participants || participants.length === 0) {
    // Show placeholder if no participants are available
    participantsContent.innerHTML = `
      <div class="placeholder-content">
        <p>No participants detected yet</p>
      </div>
    `;
    return;
  }

  // Create participants list
  const participantsList = document.createElement('div');
  participantsList.className = 'participants-list';

  // Add each participant
  participants.forEach(participant => {
    const participantDiv = document.createElement('div');
    participantDiv.className = 'participant-entry';

    participantDiv.innerHTML = `
      <div class="participant-avatar">
        <svg width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx="20" fill="#f0f0f0"/>
          <path d="M20 20C22.7614 20 25 17.7614 25 15C25 12.2386 22.7614 10 20 10C17.2386 10 15 12.2386 15 15C15 17.7614 17.2386 20 20 20Z" fill="#a0a0a0"/>
          <path d="M12 31C12 26.0294 15.5817 22 20 22C24.4183 22 28 26.0294 28 31" stroke="#a0a0a0" stroke-width="4"/>
        </svg>
      </div>
      <div class="participant-name">${participant.name || 'Unknown'}</div>
      <div class="participant-status">${participant.status || 'Active'}</div>
    `;

    participantsList.appendChild(participantDiv);
  });

  participantsContent.appendChild(participantsList);
}

// Function to initialize the debug panel
function initDebugPanel() {
  const debugPanelToggle = document.getElementById('debugPanelToggle');
  const debugPanel = document.getElementById('debugPanel');
  const closeDebugPanelBtn = document.getElementById('closeDebugPanelBtn');

  // Set up toggle button for the debug panel
  if (debugPanelToggle && debugPanel) {
    debugPanelToggle.addEventListener('click', () => {
      // Toggle the debug panel visibility
      if (debugPanel.classList.contains('hidden')) {
        debugPanel.classList.remove('hidden');
        document.querySelector('.app-container').classList.add('debug-panel-open');

        // Update the toggle button position and remove any notification indicators
        debugPanelToggle.style.right = '50%';
        debugPanelToggle.classList.remove('has-new-content');
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.99 11H20v2H7.99v3L4 12l3.99-4v3z" fill="currentColor"/>
          </svg>
        `;

        // If there's an active meeting, refresh the debug panels with latest data
        if (currentEditingMeetingId) {
          const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
          if (meeting) {
            // Update transcript if available
            if (meeting.transcript && meeting.transcript.length > 0) {
              updateDebugTranscript(meeting.transcript);
            } else {
              // Clear transcript area if no transcript
              const transcriptContent = document.getElementById('transcriptContent');
              if (transcriptContent) {
                transcriptContent.innerHTML = `
                  <div class="placeholder-content">
                    <p>No transcript available yet</p>
                  </div>
                `;
              }
            }

            // Update participants if available
            if (meeting.participants && meeting.participants.length > 0) {
              updateDebugParticipants(meeting.participants);
            } else {
              // Clear participants area if no participants
              const participantsContent = document.getElementById('participantsContent');
              if (participantsContent) {
                participantsContent.innerHTML = `
                  <div class="placeholder-content">
                    <p>No participants detected yet</p>
                  </div>
                `;
              }
            }

            // Reset video preview when opening debug panel
            const videoContent = document.getElementById('videoContent');
            if (videoContent) {
              videoContent.innerHTML = `
                <div class="placeholder-content video-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#999"/>
                  </svg>
                  <p>Video preview will appear here</p>
                </div>
              `;
            }
          }
        }
      } else {
        debugPanel.classList.add('hidden');
        document.querySelector('.app-container').classList.remove('debug-panel-open');

        // Reset the toggle button position
        debugPanelToggle.style.right = '0';
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z" fill="currentColor"/>
          </svg>
        `;
      }
    });
  }

  // Set up close button for the debug panel
  if (closeDebugPanelBtn && debugPanel) {
    closeDebugPanelBtn.addEventListener('click', () => {
      debugPanel.classList.add('hidden');
      // Restore the editorView to full width
      document.querySelector('.app-container').classList.remove('debug-panel-open');

      // Reset the toggle button position and icon
      const debugPanelToggle = document.getElementById('debugPanelToggle');
      if (debugPanelToggle) {
        debugPanelToggle.style.right = '0';
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z" fill="currentColor"/>
          </svg>
        `;
      }
    });
  }

  // Set up clear button for the logger section
  const clearLoggerBtn = document.getElementById('clearLoggerBtn');
  if (clearLoggerBtn) {
    clearLoggerBtn.addEventListener('click', () => {
      sdkLogger.clear();
    });
  }
}

// SDK Logger functions
const sdkLogger = {
  logs: [],
  maxLogs: 100,

  // Initialize the logger
  init() {
    // Listen for logs from the main process
    window.sdkLoggerBridge?.onSdkLog(logEntry => {
      // Add an origin flag to logs created in this renderer to prevent duplicates
      if (!logEntry.originatedFromRenderer) {
        this.addLogEntry(logEntry);
      }
    });

    // Log initialization
    this.log('SDK Logger initialized', 'info');
  },

  // Log an API call
  logApiCall(method, params = {}) {
    const logEntry = {
      type: 'api-call',
      method,
      params,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log an event
  logEvent(eventType, data = {}) {
    const logEntry = {
      type: 'event',
      eventType,
      data,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log an error
  logError(errorType, message) {
    const logEntry = {
      type: 'error',
      errorType,
      message,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log a generic message
  log(message, level = 'info') {
    const logEntry = {
      type: level,
      message,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Helper to send logs to main process
  _sendToMainProcess(logEntry) {
    if (window.sdkLoggerBridge?.sendSdkLog) {
      // Mark this log entry as originating from this renderer to prevent duplicates
      const markedLogEntry = { ...logEntry, originatedFromRenderer: true };
      window.sdkLoggerBridge.sendSdkLog(markedLogEntry);
    }
  },

  // Add a log entry to the UI and internal array
  addLogEntry(entry) {
    // Add to internal logs array
    this.logs.push(entry);

    // Trim logs if we have too many
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Add to UI
    const loggerContent = document.getElementById('sdkLoggerContent');
    if (loggerContent) {
      const logElement = document.createElement('div');
      logElement.className = `sdk-log-entry ${entry.type}`;

      const timestamp = document.createElement('div');
      timestamp.className = 'timestamp';
      timestamp.textContent = this.formatTimestamp(entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp));
      logElement.appendChild(timestamp);

      // Format content based on log type
      let content = '';

      switch (entry.type) {
        case 'api-call':
          content = `<span class="method">RecallAiSdk.${entry.method}()</span>`;
          if (entry.params && Object.keys(entry.params).length > 0) {
            content += `<div class="params">${this.formatParams(entry.params)}</div>`;
          }
          break;

        case 'event':
          content = `<span class="event-type">Event: ${entry.eventType}</span>`;
          if (entry.data && Object.keys(entry.data).length > 0) {
            content += `<div class="params">${this.formatParams(entry.data)}</div>`;
          }
          break;

        case 'error':
          content = `<span class="error-type">Error: ${entry.errorType}</span>`;
          if (entry.message) {
            content += `<div class="params">${entry.message}</div>`;
          }
          break;

        default:
          content = entry.message;
      }

      logElement.innerHTML += content;

      // Add to the top of the log
      loggerContent.insertBefore(logElement, loggerContent.firstChild);

      // Only auto-scroll to top if user is already at the top
      const isAtTop = loggerContent.scrollTop <= 5;
      if (isAtTop) {
        loggerContent.scrollTop = 0;
      }
    }
  },

  // Clear all logs
  clear() {
    this.logs = [];
    const loggerContent = document.getElementById('sdkLoggerContent');
    if (loggerContent) {
      loggerContent.innerHTML = '';
    }
  },

  // Format timestamp to readable string
  formatTimestamp(date) {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  },

  // Format parameters object to JSON string
  formatParams(params) {
    try {
      return JSON.stringify(params, null, 2)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>')
        .replace(/ /g, '&nbsp;');
    } catch (e) {
      return String(params);
    }
  }
};

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM content loaded, loading data from file...');

  // Initialize the SDK Logger
  sdkLogger.init();

  // Initialize the debug panel
  initDebugPanel();

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
  window.electronAPI.onMeetingDetectionStatus((data) => {
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

  // Listen for authentication expiration notifications
  window.electronAPI.onAuthExpired((data) => {
    console.log('Authentication expired:', data);

    // Show notification to user
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'auth-expired-notification';
    notificationDiv.innerHTML = `
      <div class="notification-content">
        <strong>${data.service} Authentication Expired</strong>
        <p>${data.message}</p>
        <button onclick="this.parentElement.parentElement.remove(); window.location.reload();">
          Sign In Again
        </button>
        <button onclick="this.parentElement.parentElement.remove();" style="margin-left: 10px;">
          Dismiss
        </button>
      </div>
    `;

    document.body.appendChild(notificationDiv);

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (notificationDiv.parentElement) {
        notificationDiv.remove();
      }
    }, 30000);
  });

  // Listen for requests to open a meeting note (from notification click)
  window.electronAPI.onOpenMeetingNote((meetingId) => {
    console.log('Received request to open meeting note:', meetingId);

    // Ensure we have the latest data before showing the note
    loadMeetingsDataFromFile().then(() => {
      console.log('Data refreshed, checking for meeting ID:', meetingId);

      // Log the list of available meeting IDs to help with debugging
      console.log('Available meeting IDs:', pastMeetings.map(m => m.id));

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
            const retryMeeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
            if (retryMeeting) {
              console.log('Found meeting on second attempt:', retryMeeting.title);
              showEditorView(meetingId);
            } else {
              console.error('Meeting still not found after retry. Available meetings:',
                pastMeetings.map(m => `${m.id}: ${m.title}`));
            }
          });
        }, 1500);
      }
    });
  });

  // Listen for recording completed events
  window.electronAPI.onRecordingCompleted((meetingId) => {
    console.log('Recording completed for meeting:', meetingId);
    // If this note is currently being edited, reload its content
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        // Refresh the editor with the updated content
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          document.getElementById('simple-editor').value = meeting.content;
        }
      });
    }
  });

  // Listen for video frame events
  window.electronAPI.onVideoFrame((data) => {
    // Only handle video frames for the currently open meeting
    if (data.noteId === currentEditingMeetingId) {
      console.log(`Video frame received for participant: ${data.participantName}`);

      // Update the video preview in the debug panel
      updateDebugVideoPreview(data);
    }
  });

  // Listen for participants update events
  window.electronAPI.onParticipantsUpdated((meetingId) => {
    console.log('Participants updated for meeting:', meetingId);

    // If this note is currently being edited, refresh the data
    // and update the debug panel's participants section
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.participants && meeting.participants.length > 0) {
          // Log the latest participant
          const latestParticipant = meeting.participants[meeting.participants.length - 1];
          console.log(`Participant updated: ${latestParticipant.name}`);

          // Update the participants area in the debug panel
          updateDebugParticipants(meeting.participants);

          // Show notification about new participant if debug panel is closed
          const debugPanel = document.getElementById('debugPanel');
          if (debugPanel && debugPanel.classList.contains('hidden')) {
            const debugPanelToggle = document.getElementById('debugPanelToggle');
            if (debugPanelToggle) {
              // Add pulse effect to show there's new content
              debugPanelToggle.classList.add('has-new-content');

              // Create a mini notification for participant join
              const miniNotification = document.createElement('div');
              miniNotification.className = 'debug-notification participant-notification';
              miniNotification.innerHTML = `
                <span class="debug-notification-title">New Participant:</span>
                <span class="debug-notification-name">${latestParticipant.name || 'Unknown'}</span>
              `;

              // Add to document
              document.body.appendChild(miniNotification);

              // Remove after a short time
              setTimeout(() => {
                miniNotification.classList.add('fade-out');
                setTimeout(() => {
                  document.body.removeChild(miniNotification);
                }, 500);
              }, 5000);
            }
          }
        }
      });
    }
  });

  // Listen for transcript update events
  window.electronAPI.onTranscriptUpdated((meetingId) => {
    console.log('Transcript updated for meeting:', meetingId);

    // If this note is currently being edited, we can refresh the data
    // and update the debug panel's transcript section
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.transcript && meeting.transcript.length > 0) {
          // Log the latest transcript entry
          const latestEntry = meeting.transcript[meeting.transcript.length - 1];
          console.log(`Latest transcript: ${latestEntry.speaker}: "${latestEntry.text}"`);

          // Update the transcript area in the debug panel
          updateDebugTranscript(meeting.transcript);

          // Show notification about new transcript if debug panel is closed
          const debugPanel = document.getElementById('debugPanel');
          if (debugPanel && debugPanel.classList.contains('hidden')) {
            const debugPanelToggle = document.getElementById('debugPanelToggle');
            if (debugPanelToggle) {
              // Add pulse effect to show there's new content
              debugPanelToggle.classList.add('has-new-content');

              // Create a mini notification if we're recording
              if (window.isRecording) {
                const miniNotification = document.createElement('div');
                miniNotification.className = 'debug-notification transcript-notification';
                miniNotification.innerHTML = `
                  <span class="debug-notification-speaker">${latestEntry.speaker || 'Unknown'}</span>:
                  <span class="debug-notification-text">${latestEntry.text.slice(0, 40)}${latestEntry.text.length > 40 ? '...' : ''}</span>
                `;

                // Add to document
                document.body.appendChild(miniNotification);

                // Remove after a short time
                setTimeout(() => {
                  miniNotification.classList.add('fade-out');
                  setTimeout(() => {
                    document.body.removeChild(miniNotification);
                  }, 500);
                }, 5000);
              }
            }
          }
        }
      });
    }
  });

  // Listen for summary generation events
  window.electronAPI.onSummaryGenerated((meetingId) => {
    console.log('Summary generated for meeting:', meetingId);

    // If this note is currently being edited, refresh the content
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          // Update the editor with the new content containing the summary
          document.getElementById('simple-editor').value = meeting.content;
        }
      });
    }
  });

  // Listen for streaming summary updates
  window.electronAPI.onSummaryUpdate((data) => {
    const { meetingId, content, timestamp } = data;

    // If this note is currently being edited, update the content immediately
    if (currentEditingMeetingId === meetingId) {
      // Get the editor element
      const editorElement = document.getElementById('simple-editor');

      // Update the editor with the latest streamed content
      // Use requestAnimationFrame for smoother updates that don't block the main thread
      requestAnimationFrame(() => {
        editorElement.value = content;

        // Force the editor to scroll to the bottom to follow the new text
        // This creates a better experience of watching text appear
        editorElement.scrollTop = editorElement.scrollHeight;
      });
    }
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
          await window.electronAPI.joinDetectedMeeting();
          // Keep button disabled as we're navigating to a different view
        } else {
          console.log('No active meeting detected');

          // Reset button state
          joinButton.disabled = false;
          joinButton.textContent = originalText;

          // Show a little toast message
          const toast = document.createElement('div');
          toast.className = 'toast';
          toast.textContent = 'No active meeting detected';
          document.body.appendChild(toast);

          // Remove toast after 3 seconds
          setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
              document.body.removeChild(toast);
            }, 300);
          }, 3000);
        }
      } catch (error) {
        console.error('Error joining meeting:', error);

        // Reset button state
        joinButton.disabled = false;
        joinButton.textContent = originalText;

        // Show error toast
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = 'Error joining meeting';
        document.body.appendChild(toast);

        // Remove toast after 3 seconds
        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => {
            document.body.removeChild(toast);
          }, 300);
        }, 3000);
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

  document.querySelector('.search-input').addEventListener('input', (e) => {
    console.log('Search query:', e.target.value);
    // TODO: Implement search functionality
  });

  // Add click event delegation for meeting cards and their actions
  document.querySelector('.main-content').addEventListener('click', async (e) => {
    // Check if refresh calendar button was clicked
    if (e.target.closest('.refresh-calendar-btn')) {
      e.stopPropagation();
      const refreshBtn = e.target.closest('.refresh-calendar-btn');
      const originalHTML = refreshBtn.innerHTML;

      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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
      const noteId = await createNewMeeting();

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
        window.electronAPI.deleteMeeting(meetingId)
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
              const pastDataIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === meetingId);
              if (pastDataIndex !== -1) {
                meetingsData.pastMeetings.splice(pastDataIndex, 1);
              }

              // Also check upcomingMeetings
              const upcomingMeetingIndex = upcomingMeetings.findIndex(meeting => meeting.id === meetingId);
              if (upcomingMeetingIndex !== -1) {
                upcomingMeetings.splice(upcomingMeetingIndex, 1);
              }

              const upcomingDataIndex = meetingsData.upcomingMeetings.findIndex(meeting => meeting.id === meetingId);
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

  if (backButton) {
    console.log('[EventListeners] Adding click listener to backButton');
    backButton.addEventListener('click', async () => {
      console.log('>>> Back button clicked! <<<');
      try {
        // Save content before going back to home
        await saveCurrentNote();
        console.log('Note saved, returning to home view');

        // Clear current editing state
        currentEditingMeetingId = null;

        // Show home view
        showHomeView();

        // Refresh the meeting list
        await loadMeetingsDataFromFile();
        renderMeetings();

        console.log('Returned to home view');
      } catch (error) {
        console.error('Error navigating back to home:', error);
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

  // Set up the initial auto-save handler
  setupAutoSaveHandler();

  // Toggle sidebar button with initial state
  const toggleSidebarBtn = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  const editorContent = document.querySelector('.editor-content');
  const chatInputContainer = document.querySelector('.chat-input-container');

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

  // Chat input handling
  const chatInput = document.getElementById('chatInput');
  const sendButton = document.getElementById('sendButton');

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
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendButton.click();
    }
  });

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

          // Log the summary generation request to the SDK logger
          sdkLogger.log('Requesting AI summary generation for meeting: ' + currentEditingMeetingId);

          window.electronAPI.generateMeetingSummaryStreaming(currentEditingMeetingId)
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
  window.electronAPI.onRecordingStateChange((data) => {
    console.log('Recording state change received:', data);

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
        try {
          // Start recording
          console.log('Starting manual recording for meeting:', currentEditingMeetingId);
          recordButton.disabled = true; // Temporarily disable to prevent double-clicks

          // Change to stop mode immediately for better feedback
          recordButton.classList.add('recording');
          recordIcon.style.display = 'none';
          stopIcon.style.display = 'block';

          // Call the API to start recording
          const result = await window.electronAPI.startManualRecording(currentEditingMeetingId);
          recordButton.disabled = false;

          if (result.success) {
            console.log('Manual recording started with ID:', result.recordingId);
            window.currentRecordingId = result.recordingId;

            // Show a little toast message
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = 'Recording started...';
            document.body.appendChild(toast);

            // Remove toast after 3 seconds
            setTimeout(() => {
              toast.style.opacity = '0';
              setTimeout(() => {
                document.body.removeChild(toast);
              }, 300);
            }, 3000);
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
          // Handle errors
          console.error('Error starting recording:', error);
          alert('Error starting recording: ' + (error.message || error));

          // Reset UI state
          window.isRecording = false;
          recordButton.classList.remove('recording');
          recordIcon.style.display = 'block';
          stopIcon.style.display = 'none';
          recordButton.disabled = false;
        }
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
              const toast = document.createElement('div');
              toast.className = 'toast';
              toast.textContent = 'Recording stopped. Transcript saved.';
              document.body.appendChild(toast);

              // Remove toast after 3 seconds
              setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                  document.body.removeChild(toast);
                }, 300);
              }, 3000);

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

  // Phase 4: Template Selection Modal Logic
  // ========================================

  let availableTemplates = [];
  let selectedTemplateIds = [];

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

    // Render template items
    if (availableTemplates.length === 0) {
      templateList.innerHTML = '<p style="text-align: center; color: #999;">No templates found. Add templates to config/templates/</p>';
    } else {
      availableTemplates.forEach(template => {
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
  }

  // Close template modal
  function closeTemplateModal() {
    const modal = document.getElementById('templateModal');
    modal.style.display = 'none';
    selectedTemplateIds = [];
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
    const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
    if (!meeting || !meeting.transcript) {
      costEstimateDiv.style.display = 'none';
      return;
    }

    try {
      const result = await window.electronAPI.templatesEstimateCost(selectedTemplateIds, meeting.transcript);
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

      const result = await window.electronAPI.templatesGenerateSummaries(currentEditingMeetingId, templatesToGenerate);

      if (result.success) {
        console.log('Generated', result.summaries.length, 'summaries');

        // Show success toast
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = `Generated ${result.summaries.length} summaries successfully!`;
        document.body.appendChild(toast);

        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => toast.remove(), 300);
        }, 3000);

        // Save summaries to meeting data
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
        if (meeting) {
          meeting.summaries = result.summaries;
          await saveMeetingsData();
        }

        // Display summaries in UI
        displaySummaries(result.summaries);

        console.log('Summaries:', result.summaries);
      } else {
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
  document.getElementById('templateModal').addEventListener('click', (e) => {
    if (e.target.id === 'templateModal') {
      closeTemplateModal();
    }
  });

  // ========================================
  // End Template Selection Modal Logic
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
      const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
      if (!meeting || !meeting.transcript) {
        alert('No transcript available yet. Please record a meeting first.');
        return;
      }

      // Open template selection modal
      openTemplateModal();
    });
  }



  // Listen for recording completed events
  window.electronAPI.onRecordingCompleted((meetingId) => {
    console.log('Recording completed for meeting:', meetingId);
    if (currentEditingMeetingId === meetingId) {
      // Reload the meeting data first
      loadMeetingsDataFromFile().then(() => {
        // Refresh the editor with the updated content
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          document.getElementById('simple-editor').value = meeting.content;
        }
      });
    }
  });

});
