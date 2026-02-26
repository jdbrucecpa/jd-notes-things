/**
 * SafeStorage Key Manager (v1.3.0)
 * Replaces keytar with Electron's built-in safeStorage for DPAPI encryption.
 * Stores encrypted API keys in {userData}/secure-keys.json.
 *
 * safeStorage.encryptString() uses the OS credential store:
 *   - Windows: DPAPI (same as keytar)
 *   - macOS: Keychain
 *   - Linux: libsecret / kwallet
 *
 * Must only be used after app.whenReady() — safeStorage is unavailable before that.
 */

const { safeStorage } = require('electron');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

class SafeStorageKeyManager {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'secure-keys.json');
    this._cache = null; // In-memory cache of { keyName: base64EncryptedValue }
  }

  /**
   * Check if safeStorage encryption is available on this system.
   * @returns {boolean}
   */
  isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Load the encrypted keys file from disk into cache.
   * @returns {Object} Map of keyName → base64-encoded encrypted value
   */
  _loadStore() {
    if (this._cache) return this._cache;

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this._cache = JSON.parse(raw);
      } else {
        this._cache = {};
      }
    } catch (error) {
      log.error('[SafeStorage] Failed to read secure-keys.json:', error.message);
      this._cache = {};
    }

    return this._cache;
  }

  /**
   * Persist the in-memory store to disk.
   */
  _saveStore() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this._cache, null, 2), 'utf-8');
    } catch (error) {
      log.error('[SafeStorage] Failed to write secure-keys.json:', error.message);
      throw error;
    }
  }

  /**
   * Store an API key, encrypting it with safeStorage.
   * @param {string} keyName
   * @param {string} value - plaintext value
   */
  setKey(keyName, value) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available');
    }

    const encrypted = safeStorage.encryptString(value);
    const base64 = encrypted.toString('base64');

    const store = this._loadStore();
    store[keyName] = base64;
    this._saveStore();

    log.info(`[SafeStorage] Stored key: ${keyName}`);
  }

  /**
   * Retrieve and decrypt an API key.
   * @param {string} keyName
   * @returns {string|null} Decrypted plaintext value, or null if not found
   */
  getKey(keyName) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available');
    }

    const store = this._loadStore();
    const base64 = store[keyName];
    if (!base64) return null;

    try {
      const buffer = Buffer.from(base64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      log.error(`[SafeStorage] Failed to decrypt key ${keyName}:`, error.message);
      return null;
    }
  }

  /**
   * Delete a key from the store.
   * @param {string} keyName
   * @returns {boolean} True if the key existed and was deleted
   */
  deleteKey(keyName) {
    const store = this._loadStore();
    if (!(keyName in store)) return false;

    delete store[keyName];
    this._saveStore();

    log.info(`[SafeStorage] Deleted key: ${keyName}`);
    return true;
  }

  /**
   * Check if a key exists in the store (without decrypting).
   * @param {string} keyName
   * @returns {boolean}
   */
  hasKey(keyName) {
    const store = this._loadStore();
    return keyName in store;
  }

  /**
   * List all key names currently stored.
   * @returns {string[]}
   */
  listStoredKeys() {
    const store = this._loadStore();
    return Object.keys(store);
  }

  /**
   * Clear the in-memory cache (forces re-read from disk on next access).
   */
  invalidateCache() {
    this._cache = null;
  }

  /**
   * Delete all stored keys.
   * @returns {number} Number of keys deleted
   */
  clearAll() {
    const store = this._loadStore();
    const count = Object.keys(store).length;
    this._cache = {};
    this._saveStore();
    log.warn(`[SafeStorage] Cleared ${count} stored keys`);
    return count;
  }
}

module.exports = SafeStorageKeyManager;
