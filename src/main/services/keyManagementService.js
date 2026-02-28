/**
 * Key Management Service (v1.3.0)
 * Securely stores and retrieves API keys using Electron safeStorage (DPAPI on Windows).
 * Migrated from keytar (archived Dec 2022) to Electron's built-in safeStorage.
 *
 * On first v1.3 launch, attempts to migrate existing keys from keytar → safeStorage.
 * If keytar is unavailable (native build failure, already removed), migration is skipped.
 */

const log = require('electron-log');
const SafeStorageKeyManager = require('./safeStorageKeyManager');

// Supported API key types
const API_KEY_TYPES = {
  RECALLAI_API_KEY: 'Recall.ai API Key',
  RECALLAI_API_URL: 'Recall.ai API URL',
  RECALL_WEBHOOK_SECRET: 'Recall.ai Webhook Secret',
  ASSEMBLYAI_API_KEY: 'AssemblyAI API Key',
  DEEPGRAM_API_KEY: 'Deepgram API Key',
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  GOOGLE_API_KEY: 'Google API Key (Gemini)',
  GOOGLE_CALENDAR_CLIENT_ID: 'Google Calendar Client ID',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'Google Calendar Client Secret',
  OLLAMA_BASE_URL: 'Ollama Server URL',
  OLLAMA_MODEL: 'Ollama Default Model',
  TUNNEL_SUBDOMAIN: 'Localtunnel Subdomain (not recommended)',
};

// Try to load keytar for one-time migration (optional — may not be installed)
let keytar = null;
try {
  keytar = require('keytar');
} catch {
  // keytar not available — fresh install or already removed
}

const KEYTAR_SERVICE_NAME = 'JD Notes Things';

class KeyManagementService {
  constructor() {
    this.keyTypes = API_KEY_TYPES;
    this.backend = new SafeStorageKeyManager();
    this._migrationDone = false;
  }

  /**
   * One-time migration from keytar → safeStorage.
   * Must be called after app.whenReady() since safeStorage requires it.
   * Safe to call multiple times — runs only once.
   */
  async migrateFromKeytar() {
    if (this._migrationDone) return;
    this._migrationDone = true;

    if (!keytar) {
      log.info('[KeyManagement] keytar not available — skipping migration');
      return;
    }

    if (!this.backend.isAvailable()) {
      log.warn('[KeyManagement] safeStorage not available — skipping migration');
      return;
    }

    // Check if we already have keys in safeStorage (migration already ran)
    const existingKeys = this.backend.listStoredKeys();
    if (existingKeys.length > 0) {
      log.info(`[KeyManagement] safeStorage already has ${existingKeys.length} keys — skipping keytar migration`);
      return;
    }

    log.info('[KeyManagement] Starting one-time migration from keytar → safeStorage');

    let migrated = 0;
    let failed = 0;

    try {
      const credentials = await keytar.findCredentials(KEYTAR_SERVICE_NAME);

      for (const { account, password } of credentials) {
        try {
          this.backend.setKey(account, password);
          migrated++;
          log.info(`[KeyManagement] Migrated key: ${account}`);
        } catch (error) {
          failed++;
          log.error(`[KeyManagement] Failed to migrate key ${account}:`, error.message);
        }
      }

      log.info(`[KeyManagement] Migration complete: ${migrated} migrated, ${failed} failed out of ${credentials.length} total`);
    } catch (error) {
      log.error('[KeyManagement] keytar read failed during migration:', error.message);
    }
  }

  /**
   * Store an API key securely via safeStorage
   * @param {string} keyName - Key identifier (e.g., 'RECALLAI_API_KEY')
   * @param {string} value - Key value to store
   * @returns {Promise<boolean>} Success status
   */
  async setKey(keyName, value) {
    try {
      if (!keyName || !value) {
        throw new Error('Key name and value are required');
      }

      this.backend.setKey(keyName, value);
      log.info(`[KeyManagement] Stored key: ${keyName}`);
      return true;
    } catch (error) {
      log.error(`[KeyManagement] Failed to store key ${keyName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve an API key from safeStorage
   * @param {string} keyName - Key identifier
   * @returns {Promise<string|null>} Key value or null if not found
   */
  async getKey(keyName) {
    try {
      const value = this.backend.getKey(keyName);
      if (value) {
        log.debug(`[KeyManagement] Retrieved key: ${keyName}`);
      } else {
        log.debug(`[KeyManagement] Key not found: ${keyName}`);
      }
      return value;
    } catch (error) {
      log.error(`[KeyManagement] Failed to retrieve key ${keyName}:`, error);
      return null;
    }
  }

  /**
   * Delete an API key from safeStorage
   * @param {string} keyName - Key identifier
   * @returns {Promise<boolean>} Success status
   */
  async deleteKey(keyName) {
    try {
      const deleted = this.backend.deleteKey(keyName);
      if (deleted) {
        log.info(`[KeyManagement] Deleted key: ${keyName}`);
      } else {
        log.warn(`[KeyManagement] Key not found for deletion: ${keyName}`);
      }
      return deleted;
    } catch (error) {
      log.error(`[KeyManagement] Failed to delete key ${keyName}:`, error);
      throw error;
    }
  }

  /**
   * List all stored API keys (returns key names only, not values)
   * @returns {Promise<Array<{key: string, name: string, hasValue: boolean}>>}
   */
  async listKeys() {
    try {
      const storedKeyNames = this.backend.listStoredKeys();

      const keyList = Object.keys(this.keyTypes).map(keyName => ({
        key: keyName,
        name: this.keyTypes[keyName],
        hasValue: storedKeyNames.includes(keyName),
      }));

      log.debug(`[KeyManagement] Listed ${keyList.length} keys, ${storedKeyNames.length} stored`);
      return keyList;
    } catch (error) {
      log.error('[KeyManagement] Failed to list keys:', error);
      throw error;
    }
  }

  /**
   * Check if a key exists in credential storage
   * @param {string} keyName - Key identifier
   * @returns {Promise<boolean>}
   */
  async hasKey(keyName) {
    try {
      return this.backend.hasKey(keyName);
    } catch (error) {
      log.error(`[KeyManagement] Failed to check key ${keyName}:`, error);
      return false;
    }
  }

  /**
   * Migrate API keys from .env file to safeStorage
   * @param {Object} envVars - Environment variables from .env file
   * @returns {Promise<{migrated: Array, failed: Array, skipped: Array}>}
   */
  async migrateFromEnv(envVars) {
    const results = {
      migrated: [],
      failed: [],
      skipped: [],
    };

    log.info('[KeyManagement] Starting migration from .env to safeStorage');

    for (const keyName of Object.keys(this.keyTypes)) {
      try {
        const envValue = envVars[keyName];

        if (!envValue) {
          results.skipped.push(keyName);
          continue;
        }

        const existingValue = await this.getKey(keyName);
        if (existingValue) {
          log.info(`[KeyManagement] Key ${keyName} already exists in safeStorage, skipping`);
          results.skipped.push(keyName);
          continue;
        }

        await this.setKey(keyName, envValue);
        results.migrated.push(keyName);
      } catch (error) {
        log.error(`[KeyManagement] Failed to migrate key ${keyName}:`, error);
        results.failed.push({ key: keyName, error: error.message });
      }
    }

    log.info(
      `[KeyManagement] Migration complete: ${results.migrated.length} migrated, ${results.failed.length} failed, ${results.skipped.length} skipped`
    );

    return results;
  }

  /**
   * Get obfuscated version of a key for display (shows first 4 and last 4 chars)
   * @param {string} keyValue - Full key value
   * @returns {string} Obfuscated key
   */
  obfuscateKey(keyValue) {
    if (!keyValue || keyValue.length < 12) {
      return '••••••••';
    }

    const firstFour = keyValue.substring(0, 4);
    const lastFour = keyValue.substring(keyValue.length - 4);
    const middleLength = Math.max(8, keyValue.length - 8);
    const dots = '•'.repeat(middleLength);

    return `${firstFour}${dots}${lastFour}`;
  }

  /**
   * Validate that a key is properly formatted (basic validation)
   * @param {string} keyName - Key identifier
   * @param {string} value - Key value to validate
   * @returns {Object} {valid: boolean, message: string}
   */
  validateKey(keyName, value) {
    if (!value || value.trim().length === 0) {
      return { valid: false, message: 'Key value cannot be empty' };
    }

    switch (keyName) {
      case 'RECALLAI_API_KEY':
      case 'ASSEMBLYAI_API_KEY':
      case 'DEEPGRAM_API_KEY':
        if (value.length < 20) {
          return { valid: false, message: 'API key appears too short' };
        }
        break;

      case 'ANTHROPIC_API_KEY':
        if (!value.startsWith('sk-ant-')) {
          return { valid: false, message: 'Anthropic API keys should start with "sk-ant-"' };
        }
        break;

      case 'RECALL_WEBHOOK_SECRET':
      case 'RECALLAI_WEBHOOK_SECRET':
        if (!value.startsWith('whsec_')) {
          return { valid: false, message: 'Recall.ai webhook secrets should start with "whsec_"' };
        }
        break;

      case 'GOOGLE_CALENDAR_CLIENT_ID':
        if (!value.includes('.apps.googleusercontent.com')) {
          return {
            valid: false,
            message: 'Google Client ID should end with .apps.googleusercontent.com',
          };
        }
        break;

      case 'GOOGLE_CALENDAR_CLIENT_SECRET':
        if (!value.startsWith('GOCSPX-')) {
          return { valid: false, message: 'Google Client Secret should start with "GOCSPX-"' };
        }
        break;

      case 'OLLAMA_BASE_URL':
        if (!value.startsWith('http://') && !value.startsWith('https://')) {
          return { valid: false, message: 'Ollama URL should be a valid HTTP/HTTPS URL' };
        }
        break;
    }

    return { valid: true, message: 'Key format looks valid' };
  }

  /**
   * Clear all stored credentials (use with caution!)
   * @returns {Promise<number>} Number of keys deleted
   */
  async clearAllKeys() {
    try {
      const count = this.backend.clearAll();
      log.warn(`[KeyManagement] Cleared ${count} stored credentials`);
      return count;
    } catch (error) {
      log.error('[KeyManagement] Failed to clear credentials:', error);
      throw error;
    }
  }
}

// Singleton instance
const keyManagementService = new KeyManagementService();

module.exports = keyManagementService;
