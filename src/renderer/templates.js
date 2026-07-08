/**
 * Template Editor Module - Clean redesign
 * Phase 10.3: Monaco Editor + Template Management
 */

import * as monaco from 'monaco-editor';
import { initializeTabs } from './utils/tabHelper.js';
import { notifyInfo, notifyError } from './utils/notificationHelper.js';
import { escapeHtml } from './security.js';

let editor = null;
let currentTemplateId = null;
let templates = [];
// True while the user is composing a brand-new template (before first save)
let creatingNew = false;

const VALID_TEMPLATE_EXTENSIONS = ['.md', '.yaml', '.yml', '.json', '.txt'];

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
  initializeTabs(
    [
      { buttonId: 'editorTabBtn', contentId: 'editorTabContent' },
      { buttonId: 'previewTabBtn', contentId: 'previewTabContent' },
    ],
    tabId => {
      // Update preview when switching to preview tab
      if (tabId === 'previewTabBtn') {
        updatePreview();
      }
    }
  );

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

  // Refresh templates button
  const refreshTemplatesBtn = document.getElementById('refreshTemplatesBtn');
  if (refreshTemplatesBtn) {
    refreshTemplatesBtn.addEventListener('click', async () => {
      try {
        // Add spinning animation
        refreshTemplatesBtn.classList.add('refreshing');

        // Reload templates from backend (which re-scans disk)
        await window.electronAPI.templatesReload();
        await loadTemplates();

        notifyInfo('Templates refreshed from disk');
      } catch (error) {
        console.error('[TemplateEditor] Failed to refresh templates:', error);
        notifyError('Failed to refresh templates');
      } finally {
        refreshTemplatesBtn.classList.remove('refreshing');
      }
    });
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
    templateList.innerHTML =
      '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No templates found</p>';
    return;
  }

  console.log('[TemplateEditor] Rendering', templates.length, 'templates');

  let html = '';
  templates.forEach(t => {
    html += `<div class="template-list-item" data-id="${escapeHtml(t.id)}">`;
    html += `<strong>${escapeHtml(t.name)}</strong>`;
    html += `<small>${escapeHtml(t.id)}${escapeHtml(t.format)}</small>`;
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

    // Leaving "new template" composition mode when an existing one is opened
    creatingNew = false;
    currentTemplateId = templateId;
    const template = templates.find(t => t.id === templateId);

    // Update UI
    const nameInput = document.getElementById('templateNameInput');
    nameInput.value = `${templateId}${template.format}`;
    nameInput.readOnly = true;
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
    notifyError(error, { prefix: 'Failed to load template:' });
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
    previewContent.innerHTML =
      '<p style="color: var(--text-secondary); text-align: center; margin-top: 60px;">No template selected</p>';
    return;
  }

  // Simple preview based on format
  if (template.format === '.md') {
    previewContent.innerHTML = `<div style="font-size: 14px; line-height: 1.6;">${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
  } else if (template.format === '.yaml' || template.format === '.yml') {
    previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${escapeHtml(content)}</pre>`;
  } else if (template.format === '.json') {
    try {
      const parsed = JSON.parse(content);
      previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
    } catch {
      previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${escapeHtml(content)}</pre>`;
    }
  } else {
    previewContent.innerHTML = `<pre style="font-size: 13px; font-family: monospace; white-space: pre-wrap;">${escapeHtml(content)}</pre>`;
  }
}

/**
 * Split a typed file name into a base name and a valid template format.
 * "weekly-review.yaml" → { name: 'weekly-review', format: '.yaml' }
 * "weekly review"      → { name: 'weekly review', format: '.md' }  (default)
 */
function splitNameAndFormat(raw) {
  const value = (raw || '').trim();
  const dot = value.lastIndexOf('.');
  if (dot > 0) {
    const ext = value.slice(dot).toLowerCase();
    if (VALID_TEMPLATE_EXTENSIONS.includes(ext)) {
      return { name: value.slice(0, dot), format: ext };
    }
  }
  return { name: value, format: '.md' };
}

/**
 * Begin composing a new template. The user types a file name in the toolbar
 * input and edits the scaffold in Monaco; "Save Template" persists it.
 */
function createNewTemplate() {
  creatingNew = true;
  currentTemplateId = null;

  const nameInput = document.getElementById('templateNameInput');
  nameInput.readOnly = false;
  nameInput.value = '';
  nameInput.placeholder = 'new-template-name.md';
  nameInput.focus();

  // Clear the visual selection in the list
  document.querySelectorAll('.template-list-item').forEach(item => item.classList.remove('selected'));

  // Seed the editor with an editable Markdown scaffold
  const scaffold = `<!-- Template Metadata:
name: New Template
description: New template
type: general
cost_estimate: 0.01
-->

## Summary

<!-- Prompt: Describe what this section should produce from the transcript. -->
`;
  monaco.editor.setModelLanguage(editor.getModel(), 'markdown');
  editor.setValue(scaffold);
  editor.updateOptions({ readOnly: false });

  document.getElementById('saveTemplateBtn').disabled = false;
  document.getElementById('deleteTemplateBtn').disabled = true;

  notifyInfo('Enter a file name (e.g. my-template.md), edit the content, then click Save Template');
}

/**
 * Delete the currently selected template file.
 */
async function deleteTemplate() {
  if (!currentTemplateId) return;

  const template = templates.find(t => t.id === currentTemplateId);
  const label = template ? `${currentTemplateId}${template.format}` : currentTemplateId;
  if (!window.confirm(`Delete template "${label}"? This removes the file from disk.`)) {
    return;
  }

  try {
    const response = await window.electronAPI.templatesDelete(currentTemplateId);
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to delete template');
    }

    notifyInfo(`Deleted template "${label}"`);

    // Reset editor state
    currentTemplateId = null;
    editor.setValue('// Select a template to edit');
    editor.updateOptions({ readOnly: true });
    document.getElementById('templateNameInput').value = '';
    document.getElementById('saveTemplateBtn').disabled = true;
    document.getElementById('deleteTemplateBtn').disabled = true;

    await loadTemplates();
  } catch (error) {
    console.error('[TemplateEditor] Failed to delete template:', error);
    notifyError(error, { prefix: 'Failed to delete template:' });
  }
}

/**
 * Save the current editor content — either creating a new template file
 * (when in "new" mode) or overwriting the selected one.
 */
async function saveTemplate() {
  const content = editor.getValue();

  try {
    if (creatingNew) {
      const { name, format } = splitNameAndFormat(
        document.getElementById('templateNameInput').value
      );
      if (!name) {
        notifyError('Please enter a name for the new template');
        return;
      }

      const response = await window.electronAPI.templatesCreate(name, format, content);
      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to create template');
      }

      creatingNew = false;
      const newId = response.template?.id;
      notifyInfo(`Created template "${newId || name}"`);

      await loadTemplates();
      if (newId) {
        await selectTemplate(newId);
      }
      return;
    }

    if (!currentTemplateId) {
      notifyError('No template selected');
      return;
    }

    const response = await window.electronAPI.templatesSave(currentTemplateId, content);
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to save template');
    }

    if (response.warning) {
      notifyError(response.warning);
    } else {
      notifyInfo(`Saved template "${currentTemplateId}"`);
    }

    // Refresh the list so name/metadata changes are reflected
    await loadTemplates();
  } catch (error) {
    console.error('[TemplateEditor] Failed to save template:', error);
    notifyError(error, { prefix: 'Failed to save template:' });
  }
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
