/**
 * VaultStructure - Creates and manages folder structure in Obsidian vault
 * Phase 2: Routing System
 */

const fs = require('fs');
const path = require('path');

class VaultStructure {
  constructor(vaultBasePath) {
    this.vaultBasePath = vaultBasePath;
  }

  /**
   * Set the vault base path (e.g., when user changes settings)
   * @param {string} newPath - New vault base path
   */
  setVaultPath(newPath) {
    this.vaultBasePath = newPath;
    console.log(`[VaultStructure] Vault path set to: ${newPath}`);
  }

  /**
   * Get absolute path within vault
   * @param {string} relativePath - Path relative to vault root
   * @returns {string} Absolute path
   */
  getAbsolutePath(relativePath) {
    return path.join(this.vaultBasePath, relativePath);
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param {string} dirPath - Directory path (can be relative to vault or absolute)
   * @returns {boolean} True if directory exists or was created
   */
  ensureDirectory(dirPath) {
    const absolutePath = path.isAbsolute(dirPath)
      ? dirPath
      : this.getAbsolutePath(dirPath);

    try {
      if (!fs.existsSync(absolutePath)) {
        fs.mkdirSync(absolutePath, { recursive: true });
        console.log(`[VaultStructure] Created directory: ${absolutePath}`);
      }
      return true;
    } catch (error) {
      console.error(`[VaultStructure] Error creating directory ${absolutePath}:`, error.message);
      return false;
    }
  }

  /**
   * Create folder structure for a meeting based on route
   * @param {Object} route - Route object from RoutingEngine
   * @returns {Object} Created paths
   */
  createMeetingFolders(route) {
    const meetingPath = this.getAbsolutePath(route.fullPath);

    // Ensure meeting folder exists
    if (!this.ensureDirectory(meetingPath)) {
      throw new Error(`Failed to create meeting folder: ${meetingPath}`);
    }

    const paths = {
      meetingFolder: meetingPath,
      transcriptPath: path.join(meetingPath, 'full-notes.md'),
      audioPath: path.join(meetingPath, 'recording.wav'),
      indexPath: path.join(meetingPath, 'index.md')
    };

    console.log(`[VaultStructure] Created meeting folders at: ${meetingPath}`);
    return paths;
  }

  /**
   * Save transcript to meeting folder
   * @param {string} meetingPath - Path to meeting folder
   * @param {string} transcript - Transcript content
   * @param {string} filename - Optional filename (default: full-notes.md)
   * @returns {string} Path to saved file
   */
  saveTranscript(meetingPath, transcript, filename = 'full-notes.md') {
    const transcriptPath = path.join(meetingPath, filename);

    try {
      fs.writeFileSync(transcriptPath, transcript, 'utf8');
      console.log(`[VaultStructure] Saved transcript to: ${transcriptPath}`);
      return transcriptPath;
    } catch (error) {
      console.error(`[VaultStructure] Error saving transcript:`, error.message);
      throw error;
    }
  }

  /**
   * Save audio file to meeting folder
   * @param {string} meetingPath - Path to meeting folder
   * @param {Buffer|string} audioData - Audio data (Buffer or path to source file)
   * @param {string} filename - Optional filename (default: recording.wav)
   * @returns {string} Path to saved file
   */
  saveAudio(meetingPath, audioData, filename = 'recording.wav') {
    const audioPath = path.join(meetingPath, filename);

    try {
      if (typeof audioData === 'string') {
        // If audioData is a path, copy the file
        fs.copyFileSync(audioData, audioPath);
      } else {
        // If audioData is a Buffer, write it directly
        fs.writeFileSync(audioPath, audioData);
      }
      console.log(`[VaultStructure] Saved audio to: ${audioPath}`);
      return audioPath;
    } catch (error) {
      console.error(`[VaultStructure] Error saving audio:`, error.message);
      throw error;
    }
  }

  /**
   * Save meeting index file
   * @param {string} meetingPath - Path to meeting folder
   * @param {Object} indexData - Index metadata
   * @returns {string} Path to saved index
   */
  saveIndex(meetingPath, indexData) {
    const { title, date, participants, platform, meetingType } = indexData;

    const indexContent = this._generateIndexMarkdown(indexData);
    const indexPath = path.join(meetingPath, 'index.md');

    try {
      fs.writeFileSync(indexPath, indexContent, 'utf8');
      console.log(`[VaultStructure] Saved index to: ${indexPath}`);
      return indexPath;
    } catch (error) {
      console.error(`[VaultStructure] Error saving index:`, error.message);
      throw error;
    }
  }

  /**
   * Generate markdown content for meeting index
   * @private
   */
  _generateIndexMarkdown(indexData) {
    const { title, date, participants, platform, meetingType, duration } = indexData;

    const dateStr = new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const participantList = participants
      .map(p => `  - name: "${p.name || 'Unknown'}"\n    email: "${p.email || ''}"\n    organization: "${p.organization || ''}"`)
      .join('\n');

    const attendeeNames = participants
      .map(p => p.name || p.email)
      .join(', ');

    return `---
title: "${title}"
date: ${date}
tags: [meeting${meetingType ? `, ${meetingType}` : ''}]
type: meeting-index
participants:
${participantList}
meeting_platform: "${platform || 'unknown'}"
---

# Meeting Index: ${title}

**Date:** ${dateStr} | **Attendees:** ${attendeeNames}

## Quick Navigation

| Topic | Found In |
|-------|----------|
| (Topics will be added in Phase 5) | |

## Files in This Meeting

### [[full-notes]]
Comprehensive meeting notes covering all discussion topics.

**Topics:** (to be added)

## Meeting Details

**Platform:** ${platform || 'Unknown'}
**Duration:** ${duration || 'N/A'}
**Recording:** ${fs.existsSync(path.join(path.dirname(indexData.meetingPath || ''), 'recording.wav')) ? 'Available' : 'Not available'}

---

*This index will be enhanced in Phase 5 with AI-generated topic navigation.*
`;
  }

  /**
   * Check if vault path exists and is accessible
   * @returns {boolean} True if vault is accessible
   */
  checkVaultAccess() {
    try {
      if (!this.vaultBasePath) {
        console.warn('[VaultStructure] No vault path configured');
        return false;
      }

      if (!fs.existsSync(this.vaultBasePath)) {
        console.warn(`[VaultStructure] Vault path does not exist: ${this.vaultBasePath}`);
        return false;
      }

      // Test write access by creating a temp file
      const testPath = path.join(this.vaultBasePath, '.jd-notes-test');
      fs.writeFileSync(testPath, 'test');
      fs.unlinkSync(testPath);

      return true;
    } catch (error) {
      console.error('[VaultStructure] Vault access check failed:', error.message);
      return false;
    }
  }

  /**
   * Initialize vault with default folder structure
   * Creates the base folders if they don't exist
   */
  initializeVault() {
    console.log('[VaultStructure] Initializing vault structure...');

    const defaultFolders = [
      'clients',
      'industry',
      'internal/meetings',
      '_unfiled',
      'config',
      'config/templates'
    ];

    for (const folder of defaultFolders) {
      this.ensureDirectory(folder);
    }

    console.log('[VaultStructure] Vault structure initialized');
  }

  /**
   * Save a generic file to vault
   * @param {string} relativePath - Path relative to vault root
   * @param {string|Buffer} content - File content
   * @returns {string} Absolute path to saved file
   */
  saveFile(relativePath, content) {
    const absolutePath = this.getAbsolutePath(relativePath);
    const dirPath = path.dirname(absolutePath);

    // Ensure directory exists
    this.ensureDirectory(dirPath);

    try {
      fs.writeFileSync(absolutePath, content);
      console.log(`[VaultStructure] Saved file to: ${absolutePath}`);
      return absolutePath;
    } catch (error) {
      console.error(`[VaultStructure] Error saving file:`, error.message);
      throw error;
    }
  }

  /**
   * Read a file from vault
   * @param {string} relativePath - Path relative to vault root
   * @returns {string|null} File content or null if not found
   */
  readFile(relativePath) {
    const absolutePath = this.getAbsolutePath(relativePath);

    try {
      if (!fs.existsSync(absolutePath)) {
        return null;
      }
      return fs.readFileSync(absolutePath, 'utf8');
    } catch (error) {
      console.error(`[VaultStructure] Error reading file:`, error.message);
      return null;
    }
  }

  /**
   * Check if a file exists in vault
   * @param {string} relativePath - Path relative to vault root
   * @returns {boolean} True if file exists
   */
  fileExists(relativePath) {
    const absolutePath = this.getAbsolutePath(relativePath);
    return fs.existsSync(absolutePath);
  }

  /**
   * Get list of meeting folders in a directory
   * @param {string} relativePath - Path relative to vault root
   * @returns {Array<string>} Array of meeting folder names
   */
  listMeetings(relativePath) {
    const absolutePath = this.getAbsolutePath(relativePath);

    try {
      if (!fs.existsSync(absolutePath)) {
        return [];
      }

      const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name))  // Filter for date-prefixed folders
        .sort()
        .reverse();  // Most recent first
    } catch (error) {
      console.error(`[VaultStructure] Error listing meetings:`, error.message);
      return [];
    }
  }
}

module.exports = VaultStructure;
