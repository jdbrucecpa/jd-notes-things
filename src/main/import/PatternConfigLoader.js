/**
 * Pattern Configuration Loader
 *
 * Loads and validates transcript parsing patterns from YAML configuration file.
 * Implements singleton pattern with caching and hot-reload capability.
 *
 * Phase 10.8.1 - Pattern Configuration System
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { z } = require('zod');

// Zod schema for pattern validation
const CaptureGroupsSchema = z.object({
  speaker: z.number().int().positive().optional(),
  text: z.number().int().positive().optional(),
  timestamp: z.number().int().positive().optional(),
  role: z.number().int().positive().optional(),
});

const PatternSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['inline', 'header', 'timestamp']),
  regex: z.string().min(1),
  captureGroups: CaptureGroupsSchema,
  enabled: z.boolean(),
  priority: z.number().int().positive(),
  examples: z.array(z.string()).optional(),
});

const SettingsSchema = z.object({
  skipEmptyLines: z.boolean().optional(),
  stripQuotes: z.boolean().optional(),
  combineConsecutiveSpeaker: z.boolean().optional(),
  defaultSpeaker: z.string().optional(),
  headerStopPatterns: z
    .object({
      emptyLine: z.boolean().optional(),
      nextSpeakerHeader: z.boolean().optional(),
      nextInlineSpeaker: z.boolean().optional(),
      nextTimestamp: z.boolean().optional(),
    })
    .optional(),
});

const ConfigSchema = z.object({
  patterns: z.array(PatternSchema),
  settings: SettingsSchema.optional(),
});

class PatternConfigLoader {
  constructor() {
    this.configPath = null;
    this.cachedConfig = null;
    this.lastLoadTime = null;
  }

  /**
   * Get the configuration file path
   * Checks both development (./config) and production (user data) locations
   */
  getConfigPath() {
    if (this.configPath) {
      return this.configPath;
    }

    // Try user data path first (where UI saves patterns)
    const { app } = require('electron');
    const userPath = path.join(app.getPath('userData'), 'config', 'transcript-patterns.yaml');

    // Development fallback path
    const devPath = path.join(process.cwd(), 'config', 'transcript-patterns.yaml');

    // Check if user config exists, otherwise use default
    if (fsSync.existsSync(userPath)) {
      console.log('[PatternConfigLoader] Using user config:', userPath);
      this.configPath = userPath;
    } else {
      console.log('[PatternConfigLoader] Using default config:', devPath);
      this.configPath = devPath;
    }

    return this.configPath;
  }

  /**
   * Load pattern configuration from YAML file
   * @param {boolean} forceReload - Force reload even if cached
   * @returns {Promise<Object>} Validated configuration object
   */
  async loadConfig(forceReload = false) {
    // Return cached config if available and not forcing reload
    if (this.cachedConfig && !forceReload) {
      return this.cachedConfig;
    }

    const configPath = this.getConfigPath();

    try {
      // Read YAML file
      const fileContent = await fs.readFile(configPath, 'utf-8');

      // Parse YAML
      const rawConfig = yaml.load(fileContent);

      // Debug: Log the raw config structure (disabled in production)
      // console.log('[PatternConfigLoader] Raw config loaded, patterns count:', rawConfig?.patterns?.length);

      // Validate with Zod schema
      const validatedConfig = ConfigSchema.parse(rawConfig);

      // Sort patterns by priority (lower number = higher priority)
      validatedConfig.patterns.sort((a, b) => a.priority - b.priority);

      // Compile regex patterns
      validatedConfig.patterns = validatedConfig.patterns.map(pattern => ({
        ...pattern,
        compiledRegex: new RegExp(pattern.regex),
      }));

      // Cache the configuration
      this.cachedConfig = validatedConfig;
      this.lastLoadTime = Date.now();

      console.log(
        `[PatternConfigLoader] Loaded ${validatedConfig.patterns.length} patterns from ${configPath}`
      );

      return validatedConfig;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`[PatternConfigLoader] Configuration file not found: ${configPath}`);
        console.error('[PatternConfigLoader] Using fallback default patterns');
        return this.getDefaultConfig();
      }

      if (error instanceof z.ZodError) {
        console.error('[PatternConfigLoader] Configuration validation failed');
        const firstError = error.issues && error.issues[0];
        if (firstError) {
          console.error(`  Path: ${firstError.path.join('.')}`);
          console.error(`  Message: ${firstError.message}`);
        }
        const errorMessage = firstError
          ? `${firstError.path.join('.')}: ${firstError.message}`
          : 'Unknown validation error';
        throw new Error(`Invalid pattern configuration: ${errorMessage}`);
      }

      console.error('[PatternConfigLoader] Error loading configuration:', error);
      throw error;
    }
  }

  /**
   * Get enabled patterns sorted by priority
   * @returns {Promise<Array>} Array of enabled patterns
   */
  async getEnabledPatterns() {
    const config = await this.loadConfig();
    return config.patterns.filter(pattern => pattern.enabled);
  }

  /**
   * Get patterns by type
   * @param {string} type - Pattern type ('inline', 'header', 'timestamp')
   * @returns {Promise<Array>} Array of patterns matching the type
   */
  async getPatternsByType(type) {
    const config = await this.loadConfig();
    return config.patterns.filter(pattern => pattern.enabled && pattern.type === type);
  }

  /**
   * Get configuration settings
   * @returns {Promise<Object>} Settings object
   */
  async getSettings() {
    const config = await this.loadConfig();
    return (
      config.settings || {
        skipEmptyLines: true,
        stripQuotes: true,
        combineConsecutiveSpeaker: false,
        defaultSpeaker: 'Unknown',
        headerStopPatterns: {
          emptyLine: true,
          nextSpeakerHeader: true,
          nextInlineSpeaker: true,
          nextTimestamp: true,
        },
      }
    );
  }

  /**
   * Reload configuration from disk
   * Useful for hot-reloading when config file changes
   */
  async reload() {
    console.log('[PatternConfigLoader] Reloading configuration...');
    return this.loadConfig(true);
  }

  /**
   * Get fallback default configuration
   * Used when config file is missing or invalid
   */
  getDefaultConfig() {
    console.log('[PatternConfigLoader] Using default fallback patterns');

    return {
      patterns: [
        {
          id: 'header-basic',
          name: 'Speaker Header (Basic)',
          description: 'Speaker name on own line',
          type: 'header',
          regex: '^([A-Za-z\\s]+):$',
          compiledRegex: /^([A-Za-z\s]+):$/,
          captureGroups: { speaker: 1 },
          enabled: true,
          priority: 1,
        },
        {
          id: 'inline-basic',
          name: 'Inline Speaker with Text (Basic)',
          description: 'Speaker: text on same line',
          type: 'inline',
          regex: '^([A-Za-z\\s]+):\\s+(.+)',
          compiledRegex: /^([A-Za-z\s]+):\s+(.+)/,
          captureGroups: { speaker: 1, text: 2 },
          enabled: true,
          priority: 2,
        },
        {
          id: 'timestamp-bracketed',
          name: 'Bracketed Timestamp',
          description: 'Timestamp in brackets',
          type: 'timestamp',
          regex: '^\\[(\\d{1,2}:?\\d{2}:?\\d{2})\\]\\s*(.+)',
          compiledRegex: /^\[(\d{1,2}:?\d{2}:?\d{2})\]\s*(.+)/,
          captureGroups: { timestamp: 1, text: 2 },
          enabled: true,
          priority: 3,
        },
      ],
      settings: {
        skipEmptyLines: true,
        stripQuotes: true,
        combineConsecutiveSpeaker: false,
        defaultSpeaker: 'Unknown',
        headerStopPatterns: {
          emptyLine: true,
          nextSpeakerHeader: true,
          nextInlineSpeaker: true,
          nextTimestamp: true,
        },
      },
    };
  }

  /**
   * Validate a pattern configuration object
   * Useful for testing custom patterns before saving
   * @param {Object} pattern - Pattern object to validate
   * @returns {Object} Validation result with success and errors
   */
  validatePattern(pattern) {
    try {
      PatternSchema.parse(pattern);

      // Try to compile the regex
      new RegExp(pattern.regex);

      return { success: true, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, errors: error.errors };
      }

      if (error instanceof SyntaxError) {
        return { success: false, errors: [{ message: 'Invalid regex syntax' }] };
      }

      return { success: false, errors: [{ message: error.message }] };
    }
  }
}

// Export singleton instance
module.exports = new PatternConfigLoader();
