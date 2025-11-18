/**
 * Template Editor Module - Clean redesign
 * Phase 10.3: Monaco Editor + Template Management
 */

import * as monaco from 'monaco-editor';
import { initializeTabs } from './utils/tabHelper.js';

let editor = null;
let currentTemplateId = null;
let templates = [];

/**
 * Initialize the template editor
 */
export function initializeTemplateEditor() {
  console.log('[TemplateEditor] Initializing...');

  // Initialize Monaco Editor
  const container = document.getElementById('monacoEditorContainer');
  if (!container) {
    console.error('[TemplateEditor] Monaco container not found');
    return;
  }

  // Detect current theme
  const isDarkTheme = document.body.classList.contains('dark-theme');

  editor = monaco.editor.create(container, {
    value: '// Select a template to edit',
    language: 'markdown',
    theme: isDarkTheme ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    readOnly: true,
  });

  console.log('[TemplateEditor] Monaco Editor initialized');

  // Set up event listeners
  setupEventListeners();

  // Expose loadTemplates globally
  window.loadTemplates = loadTemplates;

  console.log('[TemplateEditor] Initialization complete');
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Tab switching
  initializeTabs([
    { buttonId: 'editorTabBtn', contentId: 'editorTabContent' },
    { buttonId: 'previewTabBtn', contentId: 'previewTabContent' }
  ], (tabId) => {
    // Update preview when switching to preview tab
    if (tabId === 'previewTabBtn') {
      updatePreview();
    }
  });

  // New template button
  const newTemplateBtn = document.getElementById('newTemplateBtn');
  if (newTemplateBtn) {
    newTemplateBtn.addEventListener('click', createNewTemplate);
  }

  // Delete template button
  const deleteTemplateBtn = document.getElementById('deleteTemplateBtn');
  if (deleteTemplateBtn) {
    deleteTemplateBtn.addEventListener('click', deleteTemplate);
  }

  // Save template button
  const saveTemplateBtn = document.getElementById('saveTemplateBtn');
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener('click', saveTemplate);
  }

  // Editor change listener for live preview
  if (editor) {
    editor.onDidChangeModelContent(() => {
      if (document.getElementById('previewTabContent').style.display === 'block') {
        updatePreview();
      }
    });
  }
}

/**
 * Load templates from backend
 */
async function loadTemplates() {
  console.log('[TemplateEditor] Loading templates...');

  try {
    const response = await window.electronAPI.templatesGetAll();

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to load templates');
    }

    templates = response.templates || [];
    console.log(`[TemplateEditor] Loaded ${templates.length} templates`);

    renderTemplateList();
  } catch (error) {
    console.error('[TemplateEditor] Failed to load templates:', error);
    const templateList = document.getElementById('templateList');
    if (templateList) {
      templateList.innerHTML = `<p style="color: var(--error-color); padding: 20px; text-align: center;">Error loading templates: ${error.message}</p>`;
    }
  }
}

/**
 * Render template list in sidebar
 */
function renderTemplateList() {
  const templateList = document.getElementById('templateEditorList');

  if (!templateList) {
    console.error('[TemplateEditor] templateEditorList element not found!');
    return;
  }

  if (templates.length === 0) {
    templateList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No templates found</p>';
    return;
  }

  console.log('[TemplateEditor] Rendering', templates.length, 'templates');

  let html = '';
  templates.forEach(t => {
    html += `<div class="template-list-item" data-id="${t.id}">`;
    html += `<strong>${t.name}</strong>`;
    html += `<small>${t.id}${t.format}</small>`;
    html += `</div>`;
  });

  templateList.innerHTML = html;

  // Add click handlers
  templateList.querySelectorAll('.template-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.getAttribute('data-id');
      console.log('[TemplateEditor] Clicked template:', id);
      selectTemplate(id);
    });
  });

  console.log('[TemplateEditor] Rendered', templates.length, 'templates successfully');
}

/**
 * Select and load a template
 */
async function selectTemplate(templateId) {
  console.log('[TemplateEditor] Selecting template:', templateId);

  try {
    const response = await window.electronAPI.templatesGetContent(templateId);

    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to load template content');
    }

    currentTemplateId = templateId;
    const template = templates.find(t => t.id === templateId);

    // Update UI
    document.getElementById('templateNameInput').value = `${templateId}${template.format}`;
    document.getElementById('saveTemplateBtn').disabled = false;
    document.getElementById('deleteTemplateBtn').disabled = false;

    // Update Monaco editor
    const language = getLanguageFromFormat(template.format);
    editor.setValue(response.content);
    monaco.editor.setModelLanguage(editor.getModel(), language);
    editor.updateOptions({ readOnly: false });

    // Highlight selected template
    document.querySelectorAll('.template-list-item').forEach(item => {
      if (item.dataset.id === templateId) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    console.log('[TemplateEditor] Template loaded successfully');
  } catch (error) {
    console.error('[TemplateEditor] Failed to load template:', error);
    window.showToast('Failed to load template: ' + error.message, 'error');
  }
}

/**
 * Get Monaco language from file format
 */
function getLanguageFromFormat(format) {
  const map = {
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.md': 'markdown',
    '.txt': 'plaintext',
  };
  return map[format] || 'plaintext';
}

/**
 * Update preview panel
 */
function updatePreview() {
  const previewContent = document.getElementById('previewTabContent');
  if (!previewContent || !editor) return;

  const content = editor.getValue();
  const template = templates.find(t => t.id === currentTemplateId);

  if (!template) {
    previewContent.innerHTML = '<p style="color: var(--text-secondary); text-align: center; margin-top: 60px;">No template selected</p>';
    return;
  }

  // Simple preview based on format
  if (template.format === '.md') {
    previewContent.innerHTML = `<div style="font-size: 14px; line-height: 1.6;">${content.replace(/\n/g, '<br>')}</div>`;
  } else if (template.format === '.yaml' || template.format === '.yml') {
    previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${content}</pre>`;
  } else if (template.format === '.json') {
    try {
      const parsed = JSON.parse(content);
      previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${JSON.stringify(parsed, null, 2)}</pre>`;
    } catch {
      previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${content}</pre>`;
    }
  } else {
    previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${content}</pre>`;
  }
}

/**
 * Create new template
 */
function createNewTemplate() {
  window.showToast('Create new template feature coming soon', 'info');
  // TODO: Implement create new template
}

/**
 * Delete current template
 */
function deleteTemplate() {
  if (!currentTemplateId) return;
  window.showToast('Delete template feature coming soon', 'info');
  // TODO: Implement delete template
}

/**
 * Save current template
 */
function saveTemplate() {
  if (!currentTemplateId) return;
  window.showToast('Save template feature coming soon', 'info');
  // TODO: Implement save template (needs IPC handler)
}

/**
 * Update Monaco editor theme (called when app theme changes)
 */
export function updateEditorTheme(isDarkTheme) {
  if (editor) {
    monaco.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
    console.log('[TemplateEditor] Theme updated to', isDarkTheme ? 'dark' : 'light');
  }
}
