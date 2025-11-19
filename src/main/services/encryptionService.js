/**
 * Encryption Service (Phase 10.2)
 * Handles file encryption/decryption using Electron's safeStorage API (Windows DPAPI)
 * Provides transparent encryption at rest for meeting transcripts and summaries
 */

const { safeStorage } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const log = require('electron-log');

class EncryptionService {
  constructor() {
    this.isAvailable = false;
    this.encryptionEnabled = false; // User preference, loaded from settings
    this.encryptedSuffix = '.encrypted';
  }

  /**
   * Initialize the encryption service
   * Must be called after app 'ready' event
   * @returns {boolean} Whether encryption is available on this system
   */
  initialize() {
    try {
      this.isAvailable = safeStorage.isEncryptionAvailable();
      log.info(`[Encryption] Service initialized. Available: ${this.isAvailable}`);

      if (!this.isAvailable) {
        log.warn('[Encryption] Encryption not available on this system');
      }

      return this.isAvailable;
    } catch (error) {
      log.error('[Encryption] Failed to initialize:', error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Set encryption enabled/disabled (user preference)
   * @param {boolean} enabled - Whether to enable encryption for new files
   */
  setEncryptionEnabled(enabled) {
    if (!this.isAvailable && enabled) {
      throw new Error('Encryption is not available on this system');
    }

    this.encryptionEnabled = enabled;
    log.info(`[Encryption] Encryption ${enabled ? 'enabled' : 'disabled'} by user`);
  }

  /**
   * Check if encryption is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.encryptionEnabled && this.isAvailable;
  }

  /**
   * Encrypt a buffer using safeStorage
   * @param {Buffer|string} data - Data to encrypt
   * @returns {Buffer} Encrypted data
   */
  encryptBuffer(data) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const encrypted = safeStorage.encryptString(buffer.toString('utf8'));
      log.debug(`[Encryption] Encrypted ${buffer.length} bytes`);
      return encrypted;
    } catch (error) {
      log.error('[Encryption] Failed to encrypt data:', error);
      throw error;
    }
  }

  /**
   * Decrypt a buffer using safeStorage
   * @param {Buffer} encryptedData - Encrypted data
   * @returns {Buffer} Decrypted data
   */
  decryptBuffer(encryptedData) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    try {
      const decrypted = safeStorage.decryptString(encryptedData);
      log.debug(`[Encryption] Decrypted data`);
      return Buffer.from(decrypted, 'utf8');
    } catch (error) {
      log.error('[Encryption] Failed to decrypt data:', error);
      throw error;
    }
  }

  /**
   * Encrypt a file
   * @param {string} filePath - Path to file to encrypt
   * @param {boolean} addSuffix - Whether to add .encrypted suffix (default: true)
   * @returns {Promise<string>} Path to encrypted file
   */
  async encryptFile(filePath, addSuffix = true) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    try {
      // Check if file exists
      await fs.access(filePath);

      // Read file contents
      const contents = await fs.readFile(filePath);

      // Encrypt contents
      const encrypted = this.encryptBuffer(contents);

      // Determine output path
      const outputPath = addSuffix ? `${filePath}${this.encryptedSuffix}` : filePath;

      // Write encrypted file
      await fs.writeFile(outputPath, encrypted);

      // If we added suffix, delete original unencrypted file
      if (addSuffix && outputPath !== filePath) {
        await fs.unlink(filePath);
      }

      log.info(`[Encryption] Encrypted file: ${filePath} -> ${outputPath}`);
      return outputPath;
    } catch (error) {
      log.error(`[Encryption] Failed to encrypt file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Decrypt a file
   * @param {string} filePath - Path to encrypted file
   * @param {boolean} removeSuffix - Whether to remove .encrypted suffix (default: true)
   * @returns {Promise<string>} Path to decrypted file
   */
  async decryptFile(filePath, removeSuffix = true) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    try {
      // Check if file exists
      await fs.access(filePath);

      // Read encrypted contents
      const encryptedContents = await fs.readFile(filePath);

      // Decrypt contents
      const decrypted = this.decryptBuffer(encryptedContents);

      // Determine output path
      let outputPath = filePath;
      if (removeSuffix && filePath.endsWith(this.encryptedSuffix)) {
        outputPath = filePath.slice(0, -this.encryptedSuffix.length);
      }

      // Write decrypted file
      await fs.writeFile(outputPath, decrypted);

      // If we removed suffix, delete encrypted file
      if (removeSuffix && outputPath !== filePath) {
        await fs.unlink(filePath);
      }

      log.info(`[Encryption] Decrypted file: ${filePath} -> ${outputPath}`);
      return outputPath;
    } catch (error) {
      log.error(`[Encryption] Failed to decrypt file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if a file is encrypted
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>}
   */
  async isFileEncrypted(filePath) {
    try {
      // First check: does it have the encrypted suffix?
      if (filePath.endsWith(this.encryptedSuffix)) {
        return true;
      }

      // Second check: try to read and decrypt (if it fails, it's not encrypted)
      // Note: This is a heuristic, not foolproof
      const contents = await fs.readFile(filePath);

      // If file is very small or looks like plain text, it's probably not encrypted
      if (contents.length < 10) {
        return false;
      }

      // Encrypted files from safeStorage are binary, not UTF-8 text
      // Try to detect if it's binary vs text
      const textSample = contents.slice(0, 100).toString('utf8');
      const hasNullBytes = textSample.includes('\0');
      // eslint-disable-next-line no-control-regex
      const hasControlChars = /[\x00-\x08\x0E-\x1F]/.test(textSample); // Intentionally checking for control characters

      return hasNullBytes || hasControlChars;
    } catch (error) {
      log.error(`[Encryption] Failed to check if file is encrypted ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Read a file with automatic decryption if needed
   * @param {string} filePath - Path to file (can be encrypted or not)
   * @returns {Promise<{content: string, wasEncrypted: boolean}>}
   */
  async readFile(filePath) {
    try {
      const isEncrypted = await this.isFileEncrypted(filePath);

      if (isEncrypted && this.isAvailable) {
        const encryptedContents = await fs.readFile(filePath);
        const decrypted = this.decryptBuffer(encryptedContents);
        log.debug(`[Encryption] Read and decrypted file: ${filePath}`);
        return {
          content: decrypted.toString('utf8'),
          wasEncrypted: true,
        };
      } else {
        const contents = await fs.readFile(filePath, 'utf8');
        log.debug(`[Encryption] Read unencrypted file: ${filePath}`);
        return {
          content: contents,
          wasEncrypted: false,
        };
      }
    } catch (error) {
      log.error(`[Encryption] Failed to read file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Write a file with automatic encryption if enabled
   * @param {string} filePath - Path to file
   * @param {string|Buffer} content - Content to write
   * @param {boolean} forceEncrypt - Force encryption regardless of global setting
   * @returns {Promise<{path: string, encrypted: boolean}>}
   */
  async writeFile(filePath, content, forceEncrypt = false) {
    try {
      const shouldEncrypt = forceEncrypt || this.isEnabled();

      if (shouldEncrypt) {
        const encrypted = this.encryptBuffer(content);
        const encryptedPath = filePath.endsWith(this.encryptedSuffix)
          ? filePath
          : `${filePath}${this.encryptedSuffix}`;

        await fs.writeFile(encryptedPath, encrypted);
        log.debug(`[Encryption] Wrote encrypted file: ${encryptedPath}`);

        return {
          path: encryptedPath,
          encrypted: true,
        };
      } else {
        await fs.writeFile(filePath, content);
        log.debug(`[Encryption] Wrote unencrypted file: ${filePath}`);

        return {
          path: filePath,
          encrypted: false,
        };
      }
    } catch (error) {
      log.error(`[Encryption] Failed to write file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Batch encrypt all files in a directory
   * @param {string} dirPath - Directory path
   * @param {Array<string>} extensions - File extensions to encrypt (e.g., ['.md', '.txt'])
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<{total: number, encrypted: number, failed: Array}>}
   */
  async encryptDirectory(dirPath, extensions = ['.md'], progressCallback = null) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    const results = {
      total: 0,
      encrypted: 0,
      failed: [],
    };

    try {
      // Recursively find all files with specified extensions
      const files = await this._findFiles(dirPath, extensions);
      results.total = files.length;

      log.info(`[Encryption] Starting batch encryption of ${files.length} files in ${dirPath}`);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
          // Skip already encrypted files
          if (await this.isFileEncrypted(file)) {
            log.debug(`[Encryption] Skipping already encrypted file: ${file}`);
            continue;
          }

          await this.encryptFile(file, true);
          results.encrypted++;

          if (progressCallback) {
            progressCallback({
              current: i + 1,
              total: files.length,
              file: path.basename(file),
            });
          }
        } catch (error) {
          log.error(`[Encryption] Failed to encrypt ${file}:`, error);
          results.failed.push({ file, error: error.message });
        }
      }

      log.info(
        `[Encryption] Batch encryption complete: ${results.encrypted}/${results.total} files encrypted, ${results.failed.length} failed`
      );

      return results;
    } catch (error) {
      log.error(`[Encryption] Batch encryption failed:`, error);
      throw error;
    }
  }

  /**
   * Batch decrypt all files in a directory
   * @param {string} dirPath - Directory path
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<{total: number, decrypted: number, failed: Array}>}
   */
  async decryptDirectory(dirPath, progressCallback = null) {
    if (!this.isAvailable) {
      throw new Error('Encryption not available');
    }

    const results = {
      total: 0,
      decrypted: 0,
      failed: [],
    };

    try {
      // Find all .encrypted files
      const files = await this._findFiles(dirPath, [this.encryptedSuffix]);
      results.total = files.length;

      log.info(`[Encryption] Starting batch decryption of ${files.length} files in ${dirPath}`);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        try {
          await this.decryptFile(file, true);
          results.decrypted++;

          if (progressCallback) {
            progressCallback({
              current: i + 1,
              total: files.length,
              file: path.basename(file),
            });
          }
        } catch (error) {
          log.error(`[Encryption] Failed to decrypt ${file}:`, error);
          results.failed.push({ file, error: error.message });
        }
      }

      log.info(
        `[Encryption] Batch decryption complete: ${results.decrypted}/${results.total} files decrypted, ${results.failed.length} failed`
      );

      return results;
    } catch (error) {
      log.error(`[Encryption] Batch decryption failed:`, error);
      throw error;
    }
  }

  /**
   * Recursively find files with specified extensions
   * @private
   */
  async _findFiles(dirPath, extensions) {
    const files = [];

    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          // Check if file has any of the specified extensions
          const hasExtension = extensions.some((ext) => fullPath.endsWith(ext));
          if (hasExtension) {
            files.push(fullPath);
          }
        }
      }
    }

    await walk(dirPath);
    return files;
  }

  /**
   * Get encryption statistics for a directory
   * @param {string} dirPath - Directory path
   * @returns {Promise<{total: number, encrypted: number, unencrypted: number}>}
   */
  async getEncryptionStats(dirPath) {
    try {
      const allFiles = await this._findFiles(dirPath, ['.md', this.encryptedSuffix]);

      let encrypted = 0;
      let unencrypted = 0;

      for (const file of allFiles) {
        if (await this.isFileEncrypted(file)) {
          encrypted++;
        } else {
          unencrypted++;
        }
      }

      return {
        total: allFiles.length,
        encrypted,
        unencrypted,
      };
    } catch (error) {
      log.error(`[Encryption] Failed to get encryption stats for ${dirPath}:`, error);
      throw error;
    }
  }
}

// Singleton instance
const encryptionService = new EncryptionService();

module.exports = encryptionService;
