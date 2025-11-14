/**
 * Key Management Service (Phase 10.2)
 * Securely stores and retrieves API keys using Windows Credential Manager via keytar
 * Replaces plain-text .env storage with encrypted credential storage
 */

const keytar = require('keytar');
const log = require('electron-log');

// Service name for Windows Credential Manager
const SERVICE_NAME = 'JD Notes Things';

// Supported API key types
const API_KEY_TYPES = {
  RECALLAI_API_KEY: 'Recall.ai API Key',
  RECALL_WEBHOOK_SECRET: 'Recall.ai Webhook Secret',
  ASSEMBLYAI_API_KEY: 'AssemblyAI API Key',
  DEEPGRAM_API_KEY: 'Deepgram API Key',
  OPENAI_API_KEY: 'OpenAI API Key',
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  GOOGLE_API_KEY: 'Google API Key (Gemini)',
  GOOGLE_CALENDAR_CLIENT_ID: 'Google Calendar Client ID',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'Google Calendar Client Secret',
  AZURE_OPENAI_API_KEY: 'Azure OpenAI API Key',
  AZURE_OPENAI_ENDPOINT: 'Azure OpenAI Endpoint',
  AZURE_OPENAI_DEPLOYMENT: 'Azure OpenAI Deployment',
  NGROK_AUTHTOKEN: 'ngrok Auth Token',
  NGROK_DOMAIN: 'ngrok Domain',
};

class KeyManagementService {
  constructor() {
    this.serviceName = SERVICE_NAME;
    this.keyTypes = API_KEY_TYPES;
  }

  /**
   * Store an API key securely in Windows Credential Manager
   * @param {string} keyName - Key identifier (e.g., 'RECALLAI_API_KEY')
   * @param {string} value - Key value to store
   * @returns {Promise<boolean>} Success status
   */
  async setKey(keyName, value) {
    try {
      if (!keyName || !value) {
        throw new Error('Key name and value are required');
      }

      await keytar.setPassword(this.serviceName, keyName, value);
      log.info(`[KeyManagement] Stored key: ${keyName}`);
      return true;
    } catch (error) {
      log.error(`[KeyManagement] Failed to store key ${keyName}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve an API key from Windows Credential Manager
   * @param {string} keyName - Key identifier
   * @returns {Promise<string|null>} Key value or null if not found
   */
  async getKey(keyName) {
    try {
      const value = await keytar.getPassword(this.serviceName, keyName);
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
   * Delete an API key from Windows Credential Manager
   * @param {string} keyName - Key identifier
   * @returns {Promise<boolean>} Success status
   */
  async deleteKey(keyName) {
    try {
      const deleted = await keytar.deletePassword(this.serviceName, keyName);
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
      const credentials = await keytar.findCredentials(this.serviceName);
      const storedKeyNames = credentials.map((c) => c.account);

      // Return all possible keys with their storage status
      const keyList = Object.keys(this.keyTypes).map((keyName) => ({
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
      const value = await keytar.getPassword(this.serviceName, keyName);
      return value !== null;
    } catch (error) {
      log.error(`[KeyManagement] Failed to check key ${keyName}:`, error);
      return false;
    }
  }

  /**
   * Migrate API keys from .env file to Windows Credential Manager
   * @param {Object} envVars - Environment variables from .env file
   * @returns {Promise<{migrated: Array, failed: Array, skipped: Array}>}
   */
  async migrateFromEnv(envVars) {
    const results = {
      migrated: [],
      failed: [],
      skipped: [],
    };

    log.info('[KeyManagement] Starting migration from .env to Credential Manager');

    for (const keyName of Object.keys(this.keyTypes)) {
      try {
        const envValue = envVars[keyName];

        // Skip if no value in .env
        if (!envValue) {
          results.skipped.push(keyName);
          continue;
        }

        // Check if already exists in credential manager
        const existingValue = await this.getKey(keyName);
        if (existingValue) {
          log.info(`[KeyManagement] Key ${keyName} already exists in Credential Manager, skipping`);
          results.skipped.push(keyName);
          continue;
        }

        // Store in credential manager
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

    // Basic format validation based on key type
    switch (keyName) {
      case 'RECALLAI_API_KEY':
      case 'ASSEMBLYAI_API_KEY':
      case 'DEEPGRAM_API_KEY':
        if (value.length < 20) {
          return { valid: false, message: 'API key appears too short' };
        }
        break;

      case 'OPENAI_API_KEY':
        if (!value.startsWith('sk-')) {
          return { valid: false, message: 'OpenAI API keys should start with "sk-"' };
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
          return { valid: false, message: 'Google Client ID should end with .apps.googleusercontent.com' };
        }
        break;

      case 'GOOGLE_CALENDAR_CLIENT_SECRET':
        if (!value.startsWith('GOCSPX-')) {
          return { valid: false, message: 'Google Client Secret should start with "GOCSPX-"' };
        }
        break;

      case 'AZURE_OPENAI_ENDPOINT':
        if (!value.startsWith('https://')) {
          return { valid: false, message: 'Azure endpoint should be a valid HTTPS URL' };
        }
        break;

      case 'NGROK_DOMAIN':
        if (!value.includes('ngrok')) {
          return { valid: false, message: 'ngrok domain should contain "ngrok"' };
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
      const credentials = await keytar.findCredentials(this.serviceName);
      let deleted = 0;

      for (const credential of credentials) {
        await keytar.deletePassword(this.serviceName, credential.account);
        deleted++;
      }

      log.warn(`[KeyManagement] Cleared ${deleted} stored credentials`);
      return deleted;
    } catch (error) {
      log.error('[KeyManagement] Failed to clear credentials:', error);
      throw error;
    }
  }
}

// Singleton instance
const keyManagementService = new KeyManagementService();

module.exports = keyManagementService;
