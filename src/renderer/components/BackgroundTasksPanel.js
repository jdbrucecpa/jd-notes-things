/**
 * Background Tasks Panel
 *
 * Floating status panel that shows all running background operations.
 * Displays in the bottom-right corner of the window.
 *
 * Features:
 * - Collapsed state: Shows count badge with spinner when tasks are active
 * - Expanded state: Shows task list with progress bars
 * - Click task to navigate to associated meeting
 * - Toast notifications on completion/failure
 * - Auto-hides when no active tasks
 */

import { notifySuccess, notifyError, notifyInfo } from '../utils/notificationHelper.js';

let isExpanded = false;
let tasks = [];
let panelElement = null;
let listenersInitialized = false;

/**
 * Initialize the background tasks panel
 * Creates the DOM elements and sets up IPC listeners
 */
export function initialize() {
  if (listenersInitialized) {
    console.log('[BackgroundTasksPanel] Already initialized');
    return;
  }

  console.log('[BackgroundTasksPanel] Initializing...');

  // Create the panel element
  createPanelElement();

  // Set up IPC listeners
  setupIpcListeners();

  // Fetch initial task list
  fetchInitialTasks();

  listenersInitialized = true;
  console.log('[BackgroundTasksPanel] Initialization complete');
}

/**
 * Create the panel DOM element
 */
function createPanelElement() {
  // Remove existing panel if present
  const existing = document.getElementById('backgroundTasksPanel');
  if (existing) {
    existing.remove();
  }

  panelElement = document.createElement('div');
  panelElement.id = 'backgroundTasksPanel';
  panelElement.className = 'background-tasks-panel hidden';
  panelElement.innerHTML = `
    <div class="background-tasks-header" id="backgroundTasksHeader">
      <div class="background-tasks-indicator">
        <svg class="background-tasks-spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="31.4 31.4" />
        </svg>
        <span class="background-tasks-count" id="backgroundTasksCount">0</span>
      </div>
      <span class="background-tasks-label">Background Tasks</span>
      <svg class="background-tasks-chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="background-tasks-list" id="backgroundTasksList">
      <div class="background-tasks-empty">No active tasks</div>
    </div>
  `;

  document.body.appendChild(panelElement);

  // Set up click handler for expand/collapse
  const header = document.getElementById('backgroundTasksHeader');
  header.addEventListener('click', toggleExpanded);
}

/**
 * Set up IPC listeners for task events
 */
function setupIpcListeners() {
  // Task started
  window.electronAPI.onBackgroundTaskStarted(task => {
    console.log('[BackgroundTasksPanel] Task started:', task);
    addTask(task);
    notifyInfo(`Started: ${task.description}`, { context: 'BackgroundTask' });
  });

  // Task progress update
  window.electronAPI.onBackgroundTaskProgress(({ taskId, progress, statusMessage }) => {
    console.log('[BackgroundTasksPanel] Task progress:', taskId, progress);
    updateTaskProgress(taskId, progress, statusMessage);
  });

  // Task completed
  window.electronAPI.onBackgroundTaskCompleted(({ taskId, task, duration }) => {
    console.log('[BackgroundTasksPanel] Task completed:', taskId, duration);
    markTaskCompleted(taskId);
    notifySuccess(`Completed: ${task.description} (${duration}s)`, { context: 'BackgroundTask' });
  });

  // Task failed
  window.electronAPI.onBackgroundTaskFailed(({ taskId, task, error }) => {
    console.log('[BackgroundTasksPanel] Task failed:', taskId, error);
    markTaskFailed(taskId, error);
    notifyError(`Failed: ${task.description} - ${error}`, { context: 'BackgroundTask' });
  });

  // Full task list update
  window.electronAPI.onBackgroundTasksList(taskList => {
    console.log('[BackgroundTasksPanel] Tasks list update:', taskList.length);
    tasks = taskList;
    renderTasks();
    updateVisibility();
  });
}

/**
 * Fetch initial task list from main process
 */
async function fetchInitialTasks() {
  try {
    const taskList = await window.electronAPI.backgroundGetTasks();
    tasks = taskList || [];
    renderTasks();
    updateVisibility();
  } catch (err) {
    console.error('[BackgroundTasksPanel] Failed to fetch initial tasks:', err);
  }
}

/**
 * Add a task to the list
 */
function addTask(task) {
  // Check if task already exists
  const existingIndex = tasks.findIndex(t => t.id === task.id);
  if (existingIndex >= 0) {
    tasks[existingIndex] = task;
  } else {
    tasks.push(task);
  }
  renderTasks();
  updateVisibility();
}

/**
 * Update task progress
 */
function updateTaskProgress(taskId, progress, statusMessage) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.progress = progress;
    if (statusMessage) {
      task.statusMessage = statusMessage;
    }
    renderTasks();
  }
}

/**
 * Mark a task as completed
 */
function markTaskCompleted(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'completed';
    task.progress = 100;
    renderTasks();
  }
}

/**
 * Mark a task as failed
 */
function markTaskFailed(taskId, error) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'failed';
    task.error = error;
    renderTasks();
  }
}

/**
 * Toggle panel expanded/collapsed state
 */
function toggleExpanded() {
  isExpanded = !isExpanded;
  if (panelElement) {
    panelElement.classList.toggle('expanded', isExpanded);
  }
}

/**
 * Update panel visibility based on task count
 */
function updateVisibility() {
  if (!panelElement) return;

  const hasActiveTasks = tasks.some(t => t.status === 'in-progress');
  const hasRecentTasks = tasks.length > 0;

  // Show panel if there are any tasks (active or recently completed/failed)
  if (hasRecentTasks) {
    panelElement.classList.remove('hidden');
    panelElement.classList.toggle('has-active', hasActiveTasks);
  } else {
    panelElement.classList.add('hidden');
    isExpanded = false;
    panelElement.classList.remove('expanded');
  }

  // Update count badge
  const countEl = document.getElementById('backgroundTasksCount');
  if (countEl) {
    const activeCount = tasks.filter(t => t.status === 'in-progress').length;
    countEl.textContent = activeCount;
  }
}

/**
 * Render the task list
 */
function renderTasks() {
  const listEl = document.getElementById('backgroundTasksList');
  if (!listEl) return;

  if (tasks.length === 0) {
    listEl.innerHTML = '<div class="background-tasks-empty">No active tasks</div>';
    return;
  }

  listEl.innerHTML = tasks.map(task => {
    const elapsed = getElapsedTime(task.startTime);
    const statusClass = `task-status-${task.status}`;
    const progressWidth = task.progress || 0;

    return `
      <div class="background-task-item ${statusClass}" data-task-id="${task.id}" data-meeting-id="${task.meetingId || ''}">
        <div class="background-task-header">
          <span class="background-task-description">${escapeHtml(task.description)}</span>
          <span class="background-task-time">${elapsed}</span>
        </div>
        ${task.status === 'in-progress' ? `
          <div class="background-task-progress">
            <div class="background-task-progress-bar" style="width: ${progressWidth}%"></div>
          </div>
          ${task.statusMessage ? `<div class="background-task-status-message">${escapeHtml(task.statusMessage)}</div>` : ''}
        ` : ''}
        ${task.status === 'completed' ? `
          <div class="background-task-completed">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Completed
          </div>
        ` : ''}
        ${task.status === 'failed' ? `
          <div class="background-task-failed">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            ${escapeHtml(task.error || 'Failed')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Add click handlers for meeting navigation
  listEl.querySelectorAll('.background-task-item[data-meeting-id]').forEach(item => {
    item.addEventListener('click', (_e) => {
      const meetingId = item.getAttribute('data-meeting-id');
      if (meetingId && meetingId !== 'null' && meetingId !== '') {
        navigateToMeeting(meetingId);
      }
    });
  });
}

/**
 * Navigate to a meeting in the main view
 */
function navigateToMeeting(meetingId) {
  console.log('[BackgroundTasksPanel] Navigate to meeting:', meetingId);
  // Trigger the meeting open event (same as clicking on a meeting in the list)
  const event = new CustomEvent('open-meeting-detail', { detail: { meetingId } });
  document.dispatchEvent(event);
}

/**
 * Get elapsed time string from start time
 */
function getElapsedTime(startTime) {
  if (!startTime) return '';

  const elapsed = Date.now() - startTime;
  const seconds = Math.floor(elapsed / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
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
 * Clean up the panel
 */
export function destroy() {
  if (panelElement) {
    panelElement.remove();
    panelElement = null;
  }
  tasks = [];
  isExpanded = false;
  listenersInitialized = false;
}
