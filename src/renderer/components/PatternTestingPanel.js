/**
 * Pattern Testing Panel - Dual Mode Component
 * Phase 10.8.2: Unified Pattern Testing Component
 *
 * Two modes:
 * 1. Import Preview - Shows parsed results before importing
 * 2. Pattern Editor - Standalone testing sandbox in settings
 */

import * as monaco from 'monaco-editor';
import { notifySuccess, notifyError } from '../utils/notificationHelper.js';

let editor = null;
let currentMode = null;
let parseResults = null;
let onConfirmCallback = null;
let onCancelCallback = null;
let listenersInitialized = false;

/**
 * Get element ID with correct prefix based on current mode
 * @param {string} baseName - Base element name (e.g., 'Stats', 'SpeakerDist')
 * @returns {string} - Full element ID
 */
function getElementId(baseName) {
  const prefix = currentMode === 'import-preview' ? 'patternPreview' : 'patternTest';
  return prefix + baseName;
}

/**
 * Initialize the pattern testing panel
 * @param {string} mode - "import-preview" or "pattern-editor"
 * @param {Object} options - Configuration options
 */
export async function initialize(mode, options = {}) {
  console.log(`[PatternTestingPanel] Initializing in ${mode} mode`, options);
  currentMode = mode;

  if (mode === 'import-preview') {
    await initializeImportPreview(options);
  } else if (mode === 'pattern-editor') {
    await initializePatternEditor(options);
  } else {
    console.error('[PatternTestingPanel] Invalid mode:', mode);
  }

  console.log(`[PatternTestingPanel] Initialization complete for ${mode} mode`);
}

/**
 * Initialize Import Preview Mode
 * Shows parsed results before importing transcript
 */
async function initializeImportPreview(options) {
  const { fileContent, filePath, fileSize, onConfirm, onCancel } = options;

  onConfirmCallback = onConfirm;
  onCancelCallback = onCancel;

  // Set up event listeners
  const confirmBtn = document.getElementById('patternPreviewConfirmBtn');
  const cancelBtn = document.getElementById('patternPreviewCancelBtn');

  if (confirmBtn) {
    confirmBtn.addEventListener('click', handleConfirm);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', handleCancel);
  }

  // Load and display file
  if (fileContent && filePath) {
    await loadAndPreviewFile(fileContent, filePath, fileSize);
  }
}

/**
 * Initialize Pattern Editor Mode
 * Standalone testing sandbox with Monaco editor
 */
async function initializePatternEditor(_options) {
  const container = document.getElementById('patternEditorMonaco');

  if (!container) {
    console.error('[PatternTestingPanel] Monaco container not found');
    return;
  }

  // Detect theme
  const isDarkTheme = document.body.classList.contains('dark-theme');

  // Load current config as YAML string (via new IPC handler)
  const configResponse = await window.electronAPI.patternsGetConfigYaml();
  let configYaml = '';

  if (configResponse.success) {
    configYaml = configResponse.yaml;
  } else {
    console.error('[PatternTestingPanel] Failed to load config:', configResponse.error);
    configYaml =
      '# Failed to load configuration\n# Error: ' + (configResponse.error || 'Unknown error');
  }

  // If editor already exists, dispose of it first to prevent duplicates
  if (editor) {
    console.log('[PatternTestingPanel] Disposing existing Monaco editor');
    editor.dispose();
    editor = null;
  }

  // Create Monaco editor for YAML
  editor = monaco.editor.create(container, {
    value: configYaml,
    language: 'yaml',
    theme: isDarkTheme ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    readOnly: false,
  });

  console.log('[PatternTestingPanel] Monaco Editor initialized');

  // Set up event listeners
  setupPatternEditorListeners();

  // Load first sample and auto-preview on load
  await loadTestSample();
}

/**
 * Set up event listeners for pattern editor mode
 */
function setupPatternEditorListeners() {
  // Only set up listeners once to prevent duplicates
  if (listenersInitialized) {
    console.log('[PatternTestingPanel] Listeners already initialized, skipping');
    return;
  }

  console.log('[PatternTestingPanel] Setting up event listeners');

  // Save button
  const saveBtn = document.getElementById('patternEditorSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', savePatternConfig);
  }

  // Test button
  const testBtn = document.getElementById('patternEditorTestBtn');
  if (testBtn) {
    testBtn.addEventListener('click', testCurrentSample);
  }

  // Sample select dropdown
  const sampleSelect = document.getElementById('patternTestSampleSelect');
  if (sampleSelect) {
    sampleSelect.addEventListener('change', loadTestSample);
  }

  // AI Pattern Generation removed (Phase 10.8.3 removed)

  // Mark listeners as initialized
  listenersInitialized = true;
}

/**
 * Load and preview a transcript file (import preview mode)
 */
async function loadAndPreviewFile(fileContent, filePath, fileSize) {
  try {
    // Test parse the content (file content passed from main process)
    const response = await window.electronAPI.patternsTestParse(fileContent, filePath);

    if (!response.success) {
      throw new Error(response.error);
    }

    parseResults = response.result;

    // Display results
    displayParseResults();
    displayFileInfo(filePath, fileSize);
  } catch (error) {
    console.error('[PatternTestingPanel] Failed to preview file:', error);
    showError(`Failed to preview file: ${error.message}`);
  }
}

/**
 * Display file information header (import preview mode)
 */
function displayFileInfo(filePath, fileSize) {
  const fileInfoEl = document.getElementById('patternPreviewFileInfo');
  if (!fileInfoEl) return;

  const fileName = filePath.split(/[\\/]/).pop();
  const fileSizeKB = fileSize ? (fileSize / 1024).toFixed(1) : '?';

  fileInfoEl.innerHTML = `
    <div class="file-info-header">
      <strong>${fileName}</strong>
      <span>${fileSizeKB} KB</span>
    </div>
  `;
}

/**
 * Display parse results (both modes)
 */
function displayParseResults() {
  console.log('[PatternTestingPanel] displayParseResults called, results:', parseResults);

  if (!parseResults) {
    console.warn('[PatternTestingPanel] No parse results to display');
    return;
  }

  // Update statistics
  displayStatistics();

  // Update speaker distribution
  displaySpeakerDistribution();

  // Update sample entries
  displaySampleEntries();

  // Show warnings if needed
  displayWarnings();
}

/**
 * Display parsing statistics
 */
function displayStatistics() {
  const statsEl = document.getElementById(getElementId('Stats'));
  if (!statsEl) {
    console.error(`[PatternTestingPanel] ${getElementId('Stats')} element not found!`);
    return;
  }
  console.log('[PatternTestingPanel] Displaying statistics');

  const { totalEntries, matchRate, speakers, hasTimestamps } = parseResults;

  const matchRateNum = parseFloat(matchRate);
  const matchRateClass = matchRateNum >= 90 ? 'success' : matchRateNum >= 70 ? 'warning' : 'error';

  const html = `
    <div class="pattern-stats-grid">
      <div class="stat-item">
        <div class="stat-label">Total Entries</div>
        <div class="stat-value">${totalEntries}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Unique Speakers</div>
        <div class="stat-value">${speakers.length}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Match Rate</div>
        <div class="stat-value stat-${matchRateClass}">${matchRate}%</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Has Timestamps</div>
        <div class="stat-value">${hasTimestamps ? '✓ Yes' : '✗ No'}</div>
      </div>
    </div>
  `;

  console.log('[PatternTestingPanel] Stats HTML:', html);
  statsEl.innerHTML = html;
  console.log('[PatternTestingPanel] Stats element after update:', statsEl);
}

/**
 * Display speaker distribution chart
 */
function displaySpeakerDistribution() {
  const distEl = document.getElementById(getElementId('SpeakerDist'));
  if (!distEl) return;

  const { speakerDistribution, totalEntries } = parseResults;

  let html = '<div class="speaker-distribution">';

  speakerDistribution.forEach(({ speaker, count }) => {
    const percentage = ((count / totalEntries) * 100).toFixed(1);
    const isUnknown = speaker === 'Unknown';

    html += `
      <div class="speaker-dist-item ${isUnknown ? 'unknown' : ''}">
        <div class="speaker-dist-header">
          <span class="speaker-name">${speaker}</span>
          <span class="speaker-count">${count} (${percentage}%)</span>
        </div>
        <div class="speaker-dist-bar">
          <div class="speaker-dist-fill ${isUnknown ? 'unknown' : ''}" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  distEl.innerHTML = html;
}

/**
 * Display sample parsed entries
 */
function displaySampleEntries() {
  const samplesEl = document.getElementById(getElementId('SampleEntries'));
  if (!samplesEl) return;

  const { entries } = parseResults;
  const sampleSize = Math.min(10, entries.length);
  const samples = entries.slice(0, sampleSize);

  let html = '<div class="sample-entries-list">';

  samples.forEach((entry, index) => {
    const timestamp = entry.timestamp
      ? `<span class="entry-timestamp">[${entry.timestamp}s]</span>`
      : '';
    const text = entry.text.length > 100 ? entry.text.substring(0, 100) + '...' : entry.text;
    const isUnknown = entry.speaker === 'Unknown';

    html += `
      <div class="sample-entry ${isUnknown ? 'unknown' : ''}">
        <div class="entry-header">
          <span class="entry-number">#${index + 1}</span>
          <span class="entry-speaker ${isUnknown ? 'unknown' : ''}">${entry.speaker}</span>
          ${timestamp}
        </div>
        <div class="entry-text">${text}</div>
      </div>
    `;
  });

  html += '</div>';

  if (entries.length > sampleSize) {
    html += `<p class="sample-more-text">Showing first ${sampleSize} of ${entries.length} total entries</p>`;
  }

  samplesEl.innerHTML = html;
}

/**
 * Display warnings if parse quality is poor
 */
function displayWarnings() {
  const warningsEl = document.getElementById(getElementId('Warnings'));
  if (!warningsEl) return;

  const { unknownCount, matchRate } = parseResults;
  const matchRateNum = parseFloat(matchRate);

  if (unknownCount > 0 && matchRateNum < 90) {
    warningsEl.innerHTML = `
      <div class="pattern-warning">
        <span class="warning-icon">⚠️</span>
        <div class="warning-content">
          <strong>Low Match Rate Detected</strong>
          <p>${unknownCount} entries could not be parsed. You may want to adjust patterns or check the transcript format.</p>
        </div>
      </div>
    `;
    warningsEl.style.display = 'block';
  } else {
    warningsEl.style.display = 'none';
  }
}

/**
 * Handle confirm button (import preview mode)
 */
function handleConfirm() {
  if (onConfirmCallback) {
    onConfirmCallback(parseResults);
  }
}

/**
 * Handle cancel button (import preview mode)
 */
function handleCancel() {
  if (onCancelCallback) {
    onCancelCallback();
  }
}

/**
 * Save pattern configuration (pattern editor mode)
 */
async function savePatternConfig() {
  if (!editor) return;

  const configYaml = editor.getValue();
  const saveBtn = document.getElementById('patternEditorSaveBtn');

  // Disable button and show saving state
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const response = await window.electronAPI.patternsSaveConfig(configYaml);

    if (!response.success) {
      throw new Error(response.error);
    }

    notifySuccess('Pattern configuration saved successfully');

    // Re-test with new patterns
    await testCurrentSample();
  } catch (error) {
    console.error('[PatternTestingPanel] Failed to save config:', error);
    notifyError(error, { prefix: 'Failed to save:' });
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Patterns';
    }
  }
}

/**
 * Test current sample with patterns (pattern editor mode)
 */
async function testCurrentSample() {
  console.log('[PatternTestingPanel] testCurrentSample called');

  const sampleTextarea = document.getElementById('patternTestSampleText');
  if (!sampleTextarea) {
    console.error('[PatternTestingPanel] Sample textarea not found');
    return;
  }

  const sampleText = sampleTextarea.value.trim();
  if (!sampleText) {
    console.warn('[PatternTestingPanel] No sample text to test');
    showError('Please enter sample transcript text to test');
    return;
  }

  console.log('[PatternTestingPanel] Testing sample, length:', sampleText.length);

  // Determine file type from sample select
  const sampleSelect = document.getElementById('patternTestSampleSelect');
  const fileType = sampleSelect?.value || 'txt';

  console.log('[PatternTestingPanel] File type:', fileType);

  try {
    const response = await window.electronAPI.patternsTestParse(sampleText, `sample.${fileType}`);

    console.log('[PatternTestingPanel] Parse response:', response);

    if (!response.success) {
      throw new Error(response.error);
    }

    parseResults = response.result;
    console.log('[PatternTestingPanel] Parse results:', parseResults);

    displayParseResults();
  } catch (error) {
    console.error('[PatternTestingPanel] Failed to test parse:', error);
    showError(`Parse failed: ${error.message}`);
  }
}

/**
 * Load a test sample (pattern editor mode)
 */
async function loadTestSample() {
  const sampleSelect = document.getElementById('patternTestSampleSelect');
  const sampleTextarea = document.getElementById('patternTestSampleText');

  if (!sampleSelect || !sampleTextarea) return;

  const sampleType = sampleSelect.value;

  // Pre-defined test samples
  const samples = {
    inline: `John Smith: Hello everyone, thanks for joining.
Mary Johnson: Hi John, happy to be here.
John Smith: Let's get started with the agenda.`,

    header: `John Smith:
"Hello everyone, thanks for joining."

Mary Johnson:
"Hi John, happy to be here."`,

    krisp: `Speaker 1
2:09 - Hello everyone, thanks for joining.
Speaker 2
2:15 - Hi, happy to be here.`,

    markdown: `## John Smith

Hello everyone, thanks for joining.

## Mary Johnson

Hi John, happy to be here.`,

    timestamp: `[10:23:45] Hello everyone, thanks for joining.
[10:24:12] Hi, happy to be here.`,
  };

  sampleTextarea.value = samples[sampleType] || '';

  // Auto-test
  await testCurrentSample();
}

/**
 * Show error message
 */
function showError(message) {
  const errorEl = document.getElementById(getElementId('Error'));
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';

    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 5000);
  } else {
    console.error('[PatternTestingPanel] Error:', message);
  }
}

// AI Pattern Generator functions removed (Phase 10.8.3 removed)

/**
 * Update Monaco editor theme (called when app theme changes)
 */
export function updateEditorTheme(isDarkTheme) {
  if (editor) {
    monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
    console.log('[PatternTestingPanel] Theme updated to', isDarkTheme ? 'dark' : 'light');
  }
}

/**
 * Cleanup - destroy editor instance
 */
export function destroy() {
  if (editor) {
    editor.dispose();
    editor = null;
  }
  currentMode = null;
  parseResults = null;
  onConfirmCallback = null;
  onCancelCallback = null;
}
