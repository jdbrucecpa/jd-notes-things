/**
 * TemplateParser - Parse meeting summary templates from various formats
 * Phase 4: Enhanced AI Summaries
 * Phase 10.3: Added plain text template support
 *
 * Supports:
 * - YAML templates (.yaml, .yml)
 * - Markdown templates (.md)
 * - JSON templates (.json)
 * - Plain text templates (.txt)
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

        case '.txt':
          return this.parseTextFile(fileContent, filePath);

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
    // Allow optional blank lines/whitespace between header and comment
    const sectionRegex = /##\s+([^\n]+)[\s\n]*<!--\s*Prompt:\s*([\s\S]*?)-->/g;
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
   * Parse plain text file (Phase 10.3)
   * Treats the entire file as a single prompt section
   * @private
   */
  static parseTextFile(content, filePath) {
    const filename = path.basename(filePath, '.txt');

    // Simple text template - entire content is the prompt
    return this.validateTemplate(
      {
        name: filename.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: `Plain text template: ${filename}`,
        type: 'general',
        cost_estimate: 0.5,
        sections: [
          {
            title: 'Content',
            prompt: content.trim(),
          },
        ],
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
   * Pricing per million tokens
   * Last updated: February 2026
   * Sources: https://docs.anthropic.com/en/docs/about-claude/pricing
   *          https://ai.google.dev/pricing
   *
   * NOTE: Prices may change. Verify current pricing before major deployments.
   *
   * Models are organized into pricing tiers:
   * - Budget: Gemini 2.5 Flash Lite
   * - Balanced: Gemini 2.5 Flash, Claude Haiku 4.5
   * - Premium: Claude Sonnet 4.5
   * - Ultra-Premium: Claude Sonnet 4
   * - Local: Ollama (free, runs on your hardware)
   */
  static MODEL_PRICING = {
    // ═══════════════════════════════════════════════════════════════════
    // BUDGET TIER - Best for high-volume, cost-sensitive tasks
    // ═══════════════════════════════════════════════════════════════════
    'gemini-2.5-flash-lite': {
      input: 0.075, // $0.075 per 1M tokens
      output: 0.3, // $0.30 per 1M tokens
      tier: 'budget',
      updated: '2026-02-28',
    },

    // ═══════════════════════════════════════════════════════════════════
    // BALANCED TIER - Good balance of quality and cost
    // ═══════════════════════════════════════════════════════════════════
    'gemini-2.5-flash': {
      input: 0.15, // $0.15 per 1M tokens
      output: 0.6, // $0.60 per 1M tokens
      tier: 'balanced',
      updated: '2026-02-28',
    },
    'claude-haiku-4-5': {
      input: 0.8, // $0.80 per 1M tokens
      output: 4.0, // $4.00 per 1M tokens
      tier: 'balanced',
      updated: '2026-02-28',
    },

    // ═══════════════════════════════════════════════════════════════════
    // PREMIUM TIER - Higher quality for important summaries
    // ═══════════════════════════════════════════════════════════════════
    'claude-sonnet-4-5': {
      input: 3.0, // $3.00 per 1M tokens
      output: 15.0, // $15.00 per 1M tokens
      tier: 'premium',
      updated: '2026-02-28',
    },

    // ═══════════════════════════════════════════════════════════════════
    // ULTRA-PREMIUM TIER - Best quality for critical content
    // ═══════════════════════════════════════════════════════════════════
    'claude-sonnet-4': {
      input: 3.0, // $3.00 per 1M tokens
      output: 15.0, // $15.00 per 1M tokens
      tier: 'ultra-premium',
      updated: '2026-02-28',
    },

    // ═══════════════════════════════════════════════════════════════════
    // LOCAL TIER - Free, runs on your hardware via Ollama
    // ═══════════════════════════════════════════════════════════════════
    'ollama-local': {
      input: 0,
      output: 0,
      tier: 'local',
      updated: '2026-02-28',
    },
  };

  /**
   * Estimate token count for a transcript with this template
   * Using rough estimate: 1 token ≈ 4 characters
   * @param {Object} template - Template object
   * @param {string} transcriptText - Meeting transcript
   * @param {string} provider - Model provider (e.g., 'azure-gpt-5-mini', 'openai-gpt-4o-mini', 'claude-haiku-4-5')
   * @returns {Object} Token estimates and cost
   */
  static estimateTokens(template, transcriptText, provider = 'gemini-2.5-flash') {
    // Estimate input tokens (transcript + all prompts)
    const transcriptTokens = Math.ceil(transcriptText.length / 4);
    const promptsText = template.sections.map(s => s.prompt).join(' ');
    const promptTokens = Math.ceil(promptsText.length / 4);
    const inputTokens = transcriptTokens + promptTokens;

    // Estimate output tokens (rough: 200 tokens per section)
    const outputTokens = template.sections.length * 200;

    // Total tokens
    const totalTokens = inputTokens + outputTokens;

    // Get pricing for the selected provider (fallback to gemini-2.5-flash)
    const pricing = this.MODEL_PRICING[provider] || this.MODEL_PRICING['gemini-2.5-flash'];

    // Cost estimation using provider-specific pricing
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      inputCost,
      outputCost,
      totalCost,
      provider, // Include provider in response for transparency
    };
  }
}

module.exports = TemplateParser;
