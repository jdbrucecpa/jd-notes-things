/**
 * TemplateManager - Scan, load, and manage meeting summary templates
 * Phase 4: Enhanced AI Summaries
 */

const fs = require('fs');
const path = require('path');
const TemplateParser = require('./TemplateParser');

class TemplateManager {
  // Supported template file extensions (kept in sync with scanTemplates)
  static VALID_EXTENSIONS = ['.yaml', '.yml', '.json', '.md', '.txt'];

  constructor(templatesPath = null) {
    // Determine templates path
    if (templatesPath) {
      this.templatesPath = templatesPath;
    } else {
      // Default: config/templates in user data directory or project root
      const { app } = require('electron');
      const userDataPath = app ? app.getPath('userData') : process.cwd();
      this.templatesPath = path.join(userDataPath, 'config', 'templates');
    }

    this.templates = new Map(); // Map<templateId, template>
    console.log('[TemplateManager] Templates path:', this.templatesPath);
  }

  /**
   * Scan templates directory and load all templates
   * @returns {number} Number of templates loaded
   */
  scanTemplates() {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.templatesPath)) {
        console.log(
          '[TemplateManager] Templates directory does not exist, creating:',
          this.templatesPath
        );
        fs.mkdirSync(this.templatesPath, { recursive: true });
        return 0;
      }

      // Read all files in templates directory
      const files = fs.readdirSync(this.templatesPath);
      let loadedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.templatesPath, file);
        const ext = path.extname(file).toLowerCase();

        // Only process template files
        if (['.yaml', '.yml', '.json', '.md', '.txt'].includes(ext)) {
          try {
            const template = TemplateParser.parseFile(filePath);
            this.templates.set(template.id, template);
            console.log(`[TemplateManager] Loaded template: ${template.name} (${template.id})`);
            loadedCount++;
          } catch (error) {
            console.error(`[TemplateManager] Failed to load template ${file}:`, error.message);
          }
        }
      }

      console.log(`[TemplateManager] Loaded ${loadedCount} templates`);
      return loadedCount;
    } catch (error) {
      console.error('[TemplateManager] Error scanning templates:', error);
      return 0;
    }
  }

  /**
   * Get all templates
   * @returns {Array} Array of template objects
   */
  getAllTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   * @param {string} templateId - Template ID
   * @returns {Object|null} Template object or null if not found
   */
  getTemplate(templateId) {
    return this.templates.get(templateId) || null;
  }

  /**
   * Get templates by type
   * @param {string} type - Template type (client, internal, etc.)
   * @returns {Array} Array of matching templates
   */
  getTemplatesByType(type) {
    return this.getAllTemplates().filter(t => t.type === type);
  }

  /**
   * Check if a template exists
   * @param {string} templateId - Template ID
   * @returns {boolean}
   */
  hasTemplate(templateId) {
    return this.templates.has(templateId);
  }

  /**
   * Get template count
   * @returns {number}
   */
  getTemplateCount() {
    return this.templates.size;
  }

  /**
   * Reload templates from disk
   * @returns {number} Number of templates loaded
   */
  reload() {
    this.templates.clear();
    return this.scanTemplates();
  }

  /**
   * Get estimated cost for generating summaries with multiple templates
   * @param {Array<string>} templateIds - Array of template IDs
   * @param {string} transcriptText - Meeting transcript
   * @param {string} provider - Model provider (e.g., 'gemini-3.1-flash-lite', 'claude-haiku-4-5', 'claude-sonnet-5')
   * @returns {Object} Combined cost estimate
   */
  estimateCost(templateIds, transcriptText, provider = 'gemini-3.1-flash-lite') {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    const templateEstimates = [];

    for (const templateId of templateIds) {
      const template = this.getTemplate(templateId);
      if (!template) continue;

      const estimate = TemplateParser.estimateTokens(template, transcriptText, provider);
      totalInputTokens += estimate.inputTokens;
      totalOutputTokens += estimate.outputTokens;
      totalCost += estimate.totalCost;

      templateEstimates.push({
        templateId,
        templateName: template.name,
        ...estimate,
      });
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost,
      provider,
      templateEstimates,
    };
  }

  /**
   * Ensure a resolved file path lives inside the templates directory.
   * Defense-in-depth against path traversal via crafted ids/names.
   * @param {string} filePath - Candidate file path
   * @throws {Error} If the path escapes the templates directory
   * @private
   */
  _assertWithinTemplates(filePath) {
    const base = path.resolve(this.templatesPath);
    const resolved = path.resolve(filePath);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error('Template path escapes templates directory');
    }
  }

  /**
   * Resolve the on-disk path for an existing template.
   * @param {Object} template - Parsed template object
   * @param {string} templateId - Template ID
   * @returns {string} Absolute file path
   * @private
   */
  _templateFilePath(template, templateId) {
    return template.filePath || path.join(this.templatesPath, `${templateId}${template.format}`);
  }

  /**
   * Convert a human template name into a safe, slug-style file id.
   * @param {string} name - Desired template name
   * @returns {string} Slugified id (lowercase, alphanumeric + dashes)
   * @private
   */
  _slugifyId(name) {
    return String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Generate valid starter content for a new template so it parses immediately.
   * @param {string} name - Template display name
   * @param {string} format - File extension (with dot)
   * @returns {string} Scaffold content
   * @private
   */
  _scaffold(name, format) {
    switch (format) {
      case '.md':
        return `<!-- Template Metadata:
name: ${name}
description: New template
type: general
cost_estimate: 0.01
-->

## Summary

<!-- Prompt: Describe what this section should produce from the transcript. -->
`;
      case '.yaml':
      case '.yml':
        return `name: ${name}
description: New template
type: general
cost_estimate: 0.01
sections:
  - title: Summary
    prompt: Describe what this section should produce from the transcript.
`;
      case '.json':
        return JSON.stringify(
          {
            name,
            description: 'New template',
            type: 'general',
            cost_estimate: 0.01,
            sections: [
              { title: 'Summary', prompt: 'Describe what this section should produce from the transcript.' },
            ],
          },
          null,
          2
        );
      case '.txt':
      default:
        return 'Describe what this template should produce from the transcript.\n';
    }
  }

  /**
   * Create a new template file on disk and load it.
   * @param {Object} params
   * @param {string} params.name - Display name (also basis for the file id)
   * @param {string} [params.format='.md'] - File extension (with dot)
   * @param {string} [params.content] - Optional initial content; scaffolded if empty
   * @returns {Object} The newly created, parsed template
   */
  createTemplate({ name, format = '.md', content = '' } = {}) {
    if (!name || !String(name).trim()) {
      throw new Error('Template name is required');
    }
    if (!TemplateManager.VALID_EXTENSIONS.includes(format)) {
      throw new Error(`Unsupported template format: ${format}`);
    }

    const id = this._slugifyId(name);
    if (!id) {
      throw new Error('Template name must contain letters or numbers');
    }

    const filePath = path.join(this.templatesPath, `${id}${format}`);
    this._assertWithinTemplates(filePath);

    if (fs.existsSync(filePath)) {
      throw new Error(`A template file "${id}${format}" already exists`);
    }

    if (!fs.existsSync(this.templatesPath)) {
      fs.mkdirSync(this.templatesPath, { recursive: true });
    }

    const body = content && String(content).trim() ? content : this._scaffold(String(name).trim(), format);
    fs.writeFileSync(filePath, body, 'utf8');
    console.log(`[TemplateManager] Created template: ${id}${format}`);

    this.reload();
    return this.getTemplate(id);
  }

  /**
   * Overwrite an existing template's file content and reload it.
   * @param {string} templateId - Template ID
   * @param {string} content - New raw file content
   * @returns {Object|null} The re-parsed template, or null if content no longer parses
   */
  saveTemplate(templateId, content) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const filePath = this._templateFilePath(template, templateId);
    this._assertWithinTemplates(filePath);

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[TemplateManager] Saved template: ${templateId}`);

    this.reload();
    // May be null if the user saved content that no longer parses (still written to disk)
    return this.getTemplate(templateId);
  }

  /**
   * Delete a template file from disk and unload it.
   * @param {string} templateId - Template ID
   * @returns {boolean} True on success
   */
  deleteTemplate(templateId) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const filePath = this._templateFilePath(template, templateId);
    this._assertWithinTemplates(filePath);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    console.log(`[TemplateManager] Deleted template: ${templateId}`);

    this.reload();
    return true;
  }
}

module.exports = TemplateManager;
