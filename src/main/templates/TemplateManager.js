/**
 * TemplateManager - Scan, load, and manage meeting summary templates
 * Phase 4: Enhanced AI Summaries
 */

const fs = require('fs');
const path = require('path');
const TemplateParser = require('./TemplateParser');

class TemplateManager {
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
        if (['.yaml', '.yml', '.json', '.md'].includes(ext)) {
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
   * @returns {Object} Combined cost estimate
   */
  estimateCost(templateIds, transcriptText) {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    const templateEstimates = [];

    for (const templateId of templateIds) {
      const template = this.getTemplate(templateId);
      if (!template) continue;

      const estimate = TemplateParser.estimateTokens(template, transcriptText);
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
      templateEstimates,
    };
  }
}

module.exports = TemplateManager;
