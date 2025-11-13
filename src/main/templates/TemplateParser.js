/**
 * TemplateParser - Parse meeting summary templates from various formats
 * Phase 4: Enhanced AI Summaries
 *
 * Supports:
 * - YAML templates (.yaml, .yml)
 * - Markdown templates (.md)
 * - JSON templates (.json)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class TemplateParser {
  /**
   * Parse a template file and return standardized template object
   * @param {string} filePath - Path to template file
   * @returns {Object} Parsed template object
   */
  static parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fileContent = fs.readFileSync(filePath, 'utf8');

    try {
      switch (ext) {
        case '.yaml':
        case '.yml':
          return this.parseYAML(fileContent, filePath);

        case '.md':
          return this.parseMarkdown(fileContent, filePath);

        case '.json':
          return this.parseJSON(fileContent, filePath);

        default:
          throw new Error(`Unsupported template format: ${ext}`);
      }
    } catch (error) {
      console.error(`[TemplateParser] Error parsing ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Parse YAML template
   * @private
   */
  static parseYAML(content, filePath) {
    const data = yaml.load(content);
    return this.validateTemplate(data, filePath);
  }

  /**
   * Parse JSON template
   * @private
   */
  static parseJSON(content, filePath) {
    const data = JSON.parse(content);
    return this.validateTemplate(data, filePath);
  }

  /**
   * Parse Markdown template
   * Extracts metadata from HTML comments and prompts from comment blocks
   * @private
   */
  static parseMarkdown(content, filePath) {
    // Extract metadata from comment block at the top
    const metadataMatch = content.match(/<!--\s*Template Metadata:([\s\S]*?)-->/);

    if (!metadataMatch) {
      throw new Error('Markdown template missing metadata comment block');
    }

    // Parse metadata (key: value format)
    const metadata = {};
    const metadataText = metadataMatch[1];
    const metadataLines = metadataText.split('\n').filter(line => line.trim());

    for (const line of metadataLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
    }

    // Extract sections from markdown headers and their prompt comments
    const sections = [];

    // Match ## headers followed by <!-- Prompt: ... --> comments
    const sectionRegex = /##\s+([^\n]+)\s*\n<!--\s*Prompt:\s*([^-]+?)-->/g;
    let match;

    while ((match = sectionRegex.exec(content)) !== null) {
      sections.push({
        title: match[1].trim(),
        prompt: match[2].trim(),
      });
    }

    return this.validateTemplate(
      {
        name: metadata.name,
        description: metadata.description,
        type: metadata.type,
        cost_estimate: parseFloat(metadata.cost_estimate),
        sections: sections,
      },
      filePath
    );
  }

  /**
   * Validate and normalize template structure
   * @private
   */
  static validateTemplate(data, filePath) {
    // Required fields
    if (!data.name) {
      throw new Error(`Template missing 'name' field: ${filePath}`);
    }
    if (!data.sections || !Array.isArray(data.sections) || data.sections.length === 0) {
      throw new Error(`Template missing or empty 'sections' array: ${filePath}`);
    }

    // Validate each section
    for (const section of data.sections) {
      if (!section.title) {
        throw new Error(`Template section missing 'title': ${filePath}`);
      }
      if (!section.prompt) {
        throw new Error(`Template section missing 'prompt': ${filePath}`);
      }
    }

    // Add defaults
    return {
      id: path.basename(filePath, path.extname(filePath)),
      filePath: filePath,
      name: data.name,
      description: data.description || '',
      type: data.type || 'general',
      cost_estimate: data.cost_estimate || 0.01,
      sections: data.sections,
      format: path.extname(filePath),
    };
  }

  /**
   * Estimate token count for a transcript with this template
   * Using rough estimate: 1 token ≈ 4 characters
   * @param {Object} template - Template object
   * @param {string} transcriptText - Meeting transcript
   * @returns {Object} Token estimates and cost
   */
  static estimateTokens(template, transcriptText) {
    // Estimate input tokens (transcript + all prompts)
    const transcriptTokens = Math.ceil(transcriptText.length / 4);
    const promptsText = template.sections.map(s => s.prompt).join(' ');
    const promptTokens = Math.ceil(promptsText.length / 4);
    const inputTokens = transcriptTokens + promptTokens;

    // Estimate output tokens (rough: 200 tokens per section)
    const outputTokens = template.sections.length * 200;

    // Total tokens
    const totalTokens = inputTokens + outputTokens;

    // Cost estimation (using gpt-4o-mini pricing)
    // Input: $0.150 per 1M tokens, Output: $0.600 per 1M tokens
    const inputCost = (inputTokens / 1000000) * 0.15;
    const outputCost = (outputTokens / 1000000) * 0.6;
    const totalCost = inputCost + outputCost;

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      inputCost,
      outputCost,
      totalCost,
    };
  }
}

module.exports = TemplateParser;
