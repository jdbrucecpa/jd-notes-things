/**
 * Background Task Manager
 *
 * Singleton service for tracking background operations across the application.
 * Provides real-time updates to the renderer via IPC events.
 *
 * Task Types:
 * - regenerate-summary: Summary regeneration
 * - generate-templates: Template generation (future)
 * - import: File imports (future)
 * - transcription: Audio transcription (future)
 */

const crypto = require('crypto');

class BackgroundTaskManager {
  constructor() {
    this.tasks = new Map();
    this.mainWindow = null;

    // Auto-cleanup intervals
    this.COMPLETED_CLEANUP_DELAY = 30000; // 30 seconds
    this.FAILED_CLEANUP_DELAY = 60000; // 60 seconds
  }

  /**
   * Set the main window reference for IPC communication
   * @param {BrowserWindow} window - Electron BrowserWindow instance
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Emit an IPC event to the renderer
   * @param {string} channel - IPC channel name
   * @param {object} data - Data to send
   */
  emit(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Add a new background task
   * @param {object} taskData - Task configuration
   * @param {string} taskData.type - Task type (e.g., 'regenerate-summary')
   * @param {string} taskData.description - Human-readable description
   * @param {string} [taskData.meetingId] - Associated meeting ID (if applicable)
   * @param {object} [taskData.metadata] - Additional task metadata
   * @returns {string} The task ID
   */
  addTask({ type, description, meetingId = null, metadata = {} }) {
    const id = crypto.randomUUID();
    const task = {
      id,
      type,
      description,
      meetingId,
      status: 'in-progress',
      progress: 0,
      startTime: Date.now(),
      endTime: null,
      error: null,
      metadata,
    };

    this.tasks.set(id, task);
    console.log(`[BackgroundTask] Started: ${description} (${id})`);

    this.emit('background:task-started', task);
    this.emit('background:tasks-list', this.getAllTasks());

    return id;
  }

  /**
   * Update task progress
   * @param {string} taskId - Task ID
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} [statusMessage] - Optional status message
   */
  updateTask(taskId, progress, statusMessage = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[BackgroundTask] Task not found for update: ${taskId}`);
      return;
    }

    task.progress = Math.min(100, Math.max(0, progress));
    if (statusMessage) {
      task.statusMessage = statusMessage;
    }

    console.log(`[BackgroundTask] Progress: ${task.description} - ${progress}%`);

    this.emit('background:task-progress', {
      taskId,
      progress: task.progress,
      statusMessage: task.statusMessage,
    });
    this.emit('background:tasks-list', this.getAllTasks());
  }

  /**
   * Mark a task as completed
   * @param {string} taskId - Task ID
   * @param {object} [result] - Optional result data
   */
  completeTask(taskId, result = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[BackgroundTask] Task not found for completion: ${taskId}`);
      return;
    }

    task.status = 'completed';
    task.progress = 100;
    task.endTime = Date.now();
    task.result = result;

    const duration = ((task.endTime - task.startTime) / 1000).toFixed(1);
    console.log(`[BackgroundTask] Completed: ${task.description} (${duration}s)`);

    this.emit('background:task-completed', {
      taskId,
      task,
      duration: parseFloat(duration),
    });
    this.emit('background:tasks-list', this.getAllTasks());

    // Schedule cleanup
    task._cleanupTimer = setTimeout(() => this.removeTask(taskId), this.COMPLETED_CLEANUP_DELAY);
  }

  /**
   * Mark a task as failed
   * @param {string} taskId - Task ID
   * @param {string|Error} error - Error message or Error object
   */
  failTask(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[BackgroundTask] Task not found for failure: ${taskId}`);
      return;
    }

    task.status = 'failed';
    task.endTime = Date.now();
    task.error = error instanceof Error ? error.message : String(error);

    const duration = ((task.endTime - task.startTime) / 1000).toFixed(1);
    console.log(`[BackgroundTask] Failed: ${task.description} - ${task.error} (${duration}s)`);

    this.emit('background:task-failed', {
      taskId,
      task,
      error: task.error,
      duration: parseFloat(duration),
    });
    this.emit('background:tasks-list', this.getAllTasks());

    // Schedule cleanup (longer delay for failed tasks)
    task._cleanupTimer = setTimeout(() => this.removeTask(taskId), this.FAILED_CLEANUP_DELAY);
  }

  /**
   * Cancel a running task (marks as failed with cancellation message)
   * @param {string} taskId - Task ID
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'in-progress') {
      return { success: false, error: 'Task is not in progress' };
    }

    this.failTask(taskId, 'Cancelled by user');
    return { success: true };
  }

  /**
   * Remove a task from tracking
   * @param {string} taskId - Task ID
   */
  removeTask(taskId) {
    if (this.tasks.has(taskId)) {
      const task = this.tasks.get(taskId);
      if (task._cleanupTimer) {
        clearTimeout(task._cleanupTimer);
        task._cleanupTimer = null;
      }
      this.tasks.delete(taskId);
      console.log(`[BackgroundTask] Removed task: ${taskId}`);
      this.emit('background:tasks-list', this.getAllTasks());
    }
  }

  /**
   * Get a task by ID
   * @param {string} taskId - Task ID
   * @returns {object|null} Task object or null if not found
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get all tasks as an array
   * @returns {Array} Array of task objects
   */
  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks filtered by status
   * @param {string} status - Status to filter by ('in-progress', 'completed', 'failed')
   * @returns {Array} Filtered array of tasks
   */
  getTasksByStatus(status) {
    return this.getAllTasks().filter(task => task.status === status);
  }

  /**
   * Get tasks filtered by type
   * @param {string} type - Task type to filter by
   * @returns {Array} Filtered array of tasks
   */
  getTasksByType(type) {
    return this.getAllTasks().filter(task => task.type === type);
  }

  /**
   * Check if there are any active (in-progress) tasks
   * @returns {boolean}
   */
  hasActiveTasks() {
    return this.getAllTasks().some(task => task.status === 'in-progress');
  }

  /**
   * Get count of active tasks
   * @returns {number}
   */
  getActiveTaskCount() {
    return this.getTasksByStatus('in-progress').length;
  }
}

// Export singleton instance
const backgroundTaskManager = new BackgroundTaskManager();
module.exports = backgroundTaskManager;
