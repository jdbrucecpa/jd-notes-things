/**
 * ConfigLoader - Loads and parses routing configuration from YAML file
 * Phase 2: Routing System
 */

const fs = require('fs');
const yaml = require('js-yaml');

class ConfigLoader {
  constructor(configPath) {
    // Config path must be provided - should be userData/config/routing.yaml
    if (!configPath) {
      throw new Error('ConfigLoader requires a configPath argument');
    }
    this.configPath = configPath;
    this.config = null;
    this.lastLoaded = null;
  }

  /**
   * Load and parse the routing configuration file
   * @returns {Object} Parsed configuration object
   * @throws {Error} If config file is missing or invalid
   */
  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Routing config file not found at: ${this.configPath}`);
      }

      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.load(fileContents);
      this.lastLoaded = new Date();

      // Validate config structure
      this._validateConfig();

      console.log('[ConfigLoader] Routing configuration loaded successfully');
      return this.config;
    } catch (error) {
      console.error('[ConfigLoader] Error loading config:', error.message);
      throw new Error(`Failed to load routing config: ${error.message}`);
    }
  }

  /**
   * Get the current loaded configuration
   * @param {boolean} forceReload - Force reload from disk
   * @returns {Object} Configuration object
   */
  getConfig(forceReload = false) {
    if (!this.config || forceReload) {
      return this.load();
    }
    return this.config;
  }

  /**
   * Validate the structure of the loaded configuration
   * @private
   */
  _validateConfig() {
    if (!this.config) {
      throw new Error('Configuration is null or undefined');
    }

    // Ensure required top-level keys exist
    const requiredKeys = ['clients', 'industry', 'internal', 'settings'];
    for (const key of requiredKeys) {
      if (!(key in this.config)) {
        throw new Error(`Missing required config section: ${key}`);
      }
    }

    // Validate settings
    if (!this.config.settings.unfiled_path) {
      throw new Error('Missing required setting: unfiled_path');
    }

    // Validate client organizations
    for (const [slug, clientConfig] of Object.entries(this.config.clients)) {
      if (!clientConfig.vault_path) {
        throw new Error(`Client "${slug}" missing vault_path`);
      }
      if (!clientConfig.emails) {
        this.config.clients[slug].emails = [];
      }
      if (!clientConfig.contacts) {
        this.config.clients[slug].contacts = [];
      }
    }

    // Validate industry contacts
    for (const [slug, industryConfig] of Object.entries(this.config.industry)) {
      if (!industryConfig.vault_path) {
        throw new Error(`Industry contact "${slug}" missing vault_path`);
      }
      if (!industryConfig.emails) {
        this.config.industry[slug].emails = [];
      }
      if (!industryConfig.contacts) {
        this.config.industry[slug].contacts = [];
      }
    }

    // Validate internal config
    if (!this.config.internal.vault_path) {
      throw new Error('Internal config missing vault_path');
    }

    // Set defaults for optional settings
    this.config.settings.duplicate_multi_org = this.config.settings.duplicate_multi_org || 'all';
    this.config.settings.domain_priority = this.config.settings.domain_priority || 'most_attendees';
    this.config.settings.enable_email_overrides =
      this.config.settings.enable_email_overrides !== false;
    this.config.settings.case_sensitive_emails =
      this.config.settings.case_sensitive_emails || false;

    // Ensure email_overrides exists
    if (!this.config.email_overrides) {
      this.config.email_overrides = {};
    }
  }

  /**
   * Get list of all client slugs
   * @returns {Array<string>} Array of client slugs
   */
  getClientSlugs() {
    const config = this.getConfig();
    return Object.keys(config.clients);
  }

  /**
   * Get list of all industry contact slugs
   * @returns {Array<string>} Array of industry contact slugs
   */
  getIndustrySlugs() {
    const config = this.getConfig();
    return Object.keys(config.industry);
  }

  /**
   * Get configuration for a specific client
   * @param {string} slug - Client slug
   * @returns {Object|null} Client configuration or null if not found
   */
  getClient(slug) {
    const config = this.getConfig();
    return config.clients[slug] || null;
  }

  /**
   * Get configuration for a specific industry contact
   * @param {string} slug - Industry contact slug
   * @returns {Object|null} Industry contact configuration or null if not found
   */
  getIndustryContact(slug) {
    const config = this.getConfig();
    return config.industry[slug] || null;
  }

  /**
   * Get internal team configuration
   * @returns {Object} Internal configuration
   */
  getInternal() {
    const config = this.getConfig();
    return config.internal;
  }

  /**
   * Get routing settings
   * @returns {Object} Settings object
   */
  getSettings() {
    const config = this.getConfig();
    return config.settings;
  }

  /**
   * Get email overrides mapping
   * @returns {Object} Email overrides object
   */
  getEmailOverrides() {
    const config = this.getConfig();
    return config.email_overrides || {};
  }

  /**
   * Reload configuration from disk
   * @returns {Object} New configuration
   */
  reload() {
    console.log('[ConfigLoader] Reloading configuration from disk');
    return this.load();
  }

  /**
   * Watch configuration file for changes and auto-reload
   * @param {Function} onChange - Callback function called when config changes
   */
  watch(onChange) {
    if (this.watcher) {
      console.warn('[ConfigLoader] Already watching config file');
      return;
    }

    this.watcher = fs.watch(this.configPath, eventType => {
      if (eventType === 'change') {
        console.log('[ConfigLoader] Config file changed, reloading...');
        try {
          this.reload();
          if (onChange && typeof onChange === 'function') {
            onChange(this.config);
          }
        } catch (error) {
          console.error('[ConfigLoader] Error reloading config:', error.message);
        }
      }
    });

    console.log('[ConfigLoader] Watching config file for changes');
  }

  /**
   * Stop watching configuration file
   */
  unwatch() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('[ConfigLoader] Stopped watching config file');
    }
  }
}

module.exports = ConfigLoader;
