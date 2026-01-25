/**
 * VaultStructure - Creates and manages folder structure in Obsidian vault
 * Phase 2: Routing System
 * OCRM Integration: Supports dual path structure (legacy and OCRM)
 */

const fs = require('fs');
const path = require('path');

// OCRM path structure constants
const OCRM_PATHS = {
  meetingsClient: 'meetings/clients',
  meetingsIndustry: 'meetings/industry',
  meetingsInternal: 'meetings/internal',
  meetingsUnfiled: 'meetings/_unfiled',
  people: 'crm/people',
  companies: 'crm/companies',
  crmData: '.crm',
  crmRequests: '.crm/requests',
};

// Legacy path structure constants
const LEGACY_PATHS = {
  people: 'People',
  companies: 'Companies',
};

class VaultStructure {
  constructor(vaultBasePath, settingsProvider = null) {
    this.vaultBasePath = vaultBasePath;
    // settingsProvider is a function that returns { crmIntegration: { enabled, pathStructure, ... } }
    this._settingsProvider = settingsProvider;
  }

  /**
   * Set the settings provider function (for lazy initialization)
   * @param {Function} provider - Function that returns app settings
   */
  setSettingsProvider(provider) {
    this._settingsProvider = provider;
  }

  /**
   * Get CRM integration settings
   * @returns {Object} CRM settings or defaults
   */
  getCrmSettings() {
    if (this._settingsProvider) {
      try {
        const settings = this._settingsProvider();
        return settings?.crmIntegration || { enabled: false, pathStructure: 'legacy' };
      } catch (e) {
        console.warn('[VaultStructure] Failed to get CRM settings:', e.message);
      }
    }
    return { enabled: false, pathStructure: 'legacy' };
  }

  /**
   * Check if OCRM path structure is enabled
   * @returns {boolean} True if using OCRM paths
   */
  isOcrmEnabled() {
    const crmSettings = this.getCrmSettings();
    return crmSettings.enabled && crmSettings.pathStructure === 'ocrm';
  }

  /**
   * Get the path for people/contacts based on current mode
   * @returns {string} Relative path for contacts
   */
  getPeoplePath() {
    return this.isOcrmEnabled() ? OCRM_PATHS.people : LEGACY_PATHS.people;
  }

  /**
   * Get the path for companies based on current mode
   * @returns {string} Relative path for companies
   */
  getCompaniesPath() {
    return this.isOcrmEnabled() ? OCRM_PATHS.companies : LEGACY_PATHS.companies;
  }

  /**
   * Get the CRM requests path
   * @returns {string} Relative path for CRM requests
   */
  getCrmRequestsPath() {
    return OCRM_PATHS.crmRequests;
  }

  /**
   * Get the base path for meetings based on route type and OCRM mode
   * @param {string} routeType - 'client', 'industry', 'internal', or 'unfiled'
   * @returns {string|null} Base path prefix or null if legacy mode
   */
  getOcrmMeetingsBasePath(routeType) {
    if (!this.isOcrmEnabled()) return null;

    switch (routeType) {
      case 'client':
        return OCRM_PATHS.meetingsClient;
      case 'industry':
        return OCRM_PATHS.meetingsIndustry;
      case 'internal':
        return OCRM_PATHS.meetingsInternal;
      case 'unfiled':
        return OCRM_PATHS.meetingsUnfiled;
      default:
        return OCRM_PATHS.meetingsUnfiled;
    }
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
   * @throws {Error} If path traversal is detected
   */
  getAbsolutePath(relativePath) {
    // Security: Validate relative path BEFORE joining with vault path
    this.validateRelativePath(relativePath);

    const absolutePath = path.join(this.vaultBasePath, relativePath);

    // Additional validation that resolved path is within vault
    this.validatePathWithinVault(absolutePath);

    return absolutePath;
  }

  /**
   * Validate a relative path for security issues
   * Rejects paths containing directory traversal attempts
   * @param {string} relativePath - Relative path to validate
   * @throws {Error} If path contains suspicious patterns
   */
  validateRelativePath(relativePath) {
    if (!relativePath && relativePath !== '') {
      throw new Error('Path cannot be null or undefined');
    }

    // Reject absolute paths (security)
    if (path.isAbsolute(relativePath)) {
      const error = new Error(`Absolute paths not allowed: ${relativePath}`);
      console.error('[VaultStructure Security]', error.message);
      throw error;
    }

    // Reject Windows UNC paths (\\server\share)
    if (relativePath.startsWith('\\\\')) {
      const error = new Error(`UNC paths not allowed: ${relativePath}`);
      console.error('[VaultStructure Security]', error.message);
      throw error;
    }

    // Reject paths starting with / or \ (should be relative)
    if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      const error = new Error(`Path must be relative, not start with / or \\: ${relativePath}`);
      console.error('[VaultStructure Security]', error.message);
      throw error;
    }

    // Reject paths containing directory traversal (..)
    // Check RAW path BEFORE normalization (normalize() resolves .. segments)
    // This prevents attacks like "clients/../../config/routing.yaml"
    if (relativePath.includes('..')) {
      const error = new Error(`Directory traversal detected in path: ${relativePath}`);
      console.error('[VaultStructure Security]', error.message);
      throw error;
    }
  }

  /**
   * Validate that a path is within the vault directory
   * Prevents path traversal attacks (e.g., ../../../etc/passwd)
   * @param {string} targetPath - Absolute path to validate
   * @throws {Error} If path is outside vault
   */
  validatePathWithinVault(targetPath) {
    // Normalize both paths to resolve any .. or . segments
    const normalizedVault = path.normalize(path.resolve(this.vaultBasePath));
    const normalizedTarget = path.normalize(path.resolve(targetPath));

    // Ensure target path starts with vault path
    // Add path.sep to prevent partial directory name matches
    // e.g., /vault should not match /vault-evil
    const vaultWithSep = normalizedVault + path.sep;

    if (normalizedTarget !== normalizedVault && !normalizedTarget.startsWith(vaultWithSep)) {
      const error = new Error(
        `Path traversal detected: Attempted to access ${normalizedTarget} outside vault ${normalizedVault}`
      );
      console.error('[VaultStructure Security]', error.message);
      throw error;
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param {string} dirPath - Directory path (can be relative to vault or absolute)
   * @returns {boolean} True if directory exists or was created
   */
  ensureDirectory(dirPath) {
    const absolutePath = path.isAbsolute(dirPath) ? dirPath : this.getAbsolutePath(dirPath);

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
      indexPath: path.join(meetingPath, 'index.md'),
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
    const {
      title: _title,
      date: _date,
      participants: _participants,
      platform: _platform,
      meetingType: _meetingType,
    } = indexData; // Validate presence of key fields

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
      day: 'numeric',
    });

    const participantList = participants
      .map(
        p =>
          `  - name: "${p.name || 'Unknown'}"\n    email: "${p.email || ''}"\n    organization: "${p.organization || ''}"`
      )
      .join('\n');

    const attendeeNames = participants.map(p => p.name || p.email).join(', ');

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
   * Supports both legacy and OCRM folder structures
   */
  initializeVault() {
    console.log('[VaultStructure] Initializing vault structure...');

    // Common folders always created
    const commonFolders = ['config', 'config/templates'];

    // Mode-specific folders
    let modeFolders;
    if (this.isOcrmEnabled()) {
      console.log('[VaultStructure] Using OCRM folder structure');
      modeFolders = [
        OCRM_PATHS.meetingsClient,
        OCRM_PATHS.meetingsIndustry,
        OCRM_PATHS.meetingsInternal,
        OCRM_PATHS.meetingsUnfiled,
        OCRM_PATHS.people,
        OCRM_PATHS.companies,
        OCRM_PATHS.crmData,
        OCRM_PATHS.crmRequests,
      ];
    } else {
      console.log('[VaultStructure] Using legacy folder structure');
      modeFolders = [
        'clients',
        'industry',
        'internal/meetings',
        '_unfiled',
        LEGACY_PATHS.people,
        LEGACY_PATHS.companies,
      ];
    }

    const allFolders = [...commonFolders, ...modeFolders];

    for (const folder of allFolders) {
      this.ensureDirectory(folder);
    }

    console.log('[VaultStructure] Vault structure initialized');
  }

  /**
   * Ensure CRM request queue folders exist
   * Call this before writing CRM requests
   */
  ensureCrmRequestFolders() {
    this.ensureDirectory(OCRM_PATHS.crmData);
    this.ensureDirectory(OCRM_PATHS.crmRequests);
    console.log('[VaultStructure] CRM request folders ensured');
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
        .filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name)) // Filter for date-prefixed folders
        .sort()
        .reverse(); // Most recent first
    } catch (error) {
      console.error(`[VaultStructure] Error listing meetings:`, error.message);
      return [];
    }
  }

  // =================================================================
  // CS-3: Contact/Company Page Management
  // =================================================================

  /**
   * Check if a contact page exists
   * Checks both legacy (People/) and OCRM (crm/people/) paths
   * @param {string} contactName - Contact name
   * @returns {boolean} True if contact page exists
   */
  contactPageExists(contactName) {
    const { generateContactFilename } = require('../templates/contactTemplate.js');
    const filename = generateContactFilename(contactName);

    // Check current mode path first
    const currentPath = `${this.getPeoplePath()}/${filename}.md`;
    if (this.fileExists(currentPath)) return true;

    // Also check alternate path for backwards compatibility
    const alternatePath = this.isOcrmEnabled()
      ? `${LEGACY_PATHS.people}/${filename}.md`
      : `${OCRM_PATHS.people}/${filename}.md`;

    return this.fileExists(alternatePath);
  }

  /**
   * Create a contact page in the vault
   * Uses OCRM path (crm/people/) when enabled, otherwise legacy (People/)
   * @param {Object} contact - Contact data from Google Contacts
   * @param {Object} options - Additional options
   * @returns {Object} Result with path and created flag
   */
  createContactPage(contact, options = {}) {
    const {
      generateContactPage,
      generateContactFilename,
    } = require('../templates/contactTemplate.js');

    const filename = generateContactFilename(contact.name);
    const peoplePath = this.getPeoplePath();
    const relativePath = `${peoplePath}/${filename}.md`;

    // Check if page already exists (in either location)
    if (this.contactPageExists(contact.name) && !options.overwrite) {
      console.log(`[VaultStructure] Contact page already exists: ${relativePath}`);
      return {
        success: true,
        path: relativePath,
        created: false,
        message: 'Contact page already exists',
      };
    }

    try {
      // Ensure folder exists
      this.ensureDirectory(peoplePath);

      // Generate page content
      const content = generateContactPage(contact, options);

      // Save the file
      const absolutePath = this.saveFile(relativePath, content);

      console.log(`[VaultStructure] Created contact page: ${relativePath} (mode: ${this.isOcrmEnabled() ? 'OCRM' : 'legacy'})`);

      return {
        success: true,
        path: relativePath,
        absolutePath: absolutePath,
        created: true,
        message: 'Contact page created successfully',
      };
    } catch (error) {
      console.error(`[VaultStructure] Error creating contact page:`, error.message);
      return {
        success: false,
        path: relativePath,
        created: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if a company page exists
   * Checks both legacy (Companies/) and OCRM (crm/companies/) paths
   * @param {string} companyName - Company name
   * @returns {boolean} True if company page exists
   */
  companyPageExists(companyName) {
    const { generateCompanyFilename } = require('../templates/companyTemplate.js');
    const filename = generateCompanyFilename(companyName);

    // Check current mode path first
    const currentPath = `${this.getCompaniesPath()}/${filename}.md`;
    if (this.fileExists(currentPath)) return true;

    // Also check alternate path for backwards compatibility
    const alternatePath = this.isOcrmEnabled()
      ? `${LEGACY_PATHS.companies}/${filename}.md`
      : `${OCRM_PATHS.companies}/${filename}.md`;

    return this.fileExists(alternatePath);
  }

  /**
   * Create a company page in the vault
   * Uses OCRM path (crm/companies/) when enabled, otherwise legacy (Companies/)
   * @param {Object} company - Company data
   * @param {Object} options - Additional options
   * @returns {Object} Result with path and created flag
   */
  createCompanyPage(company, options = {}) {
    const {
      generateCompanyPage,
      generateCompanyFilename,
    } = require('../templates/companyTemplate.js');

    const filename = generateCompanyFilename(company.name);
    const companiesPath = this.getCompaniesPath();
    const relativePath = `${companiesPath}/${filename}.md`;

    // Check if page already exists (in either location)
    if (this.companyPageExists(company.name) && !options.overwrite) {
      console.log(`[VaultStructure] Company page already exists: ${relativePath}`);
      return {
        success: true,
        path: relativePath,
        created: false,
        message: 'Company page already exists',
      };
    }

    try {
      // Ensure folder exists
      this.ensureDirectory(companiesPath);

      // Generate page content
      const content = generateCompanyPage(company, options);

      // Save the file
      const absolutePath = this.saveFile(relativePath, content);

      console.log(`[VaultStructure] Created company page: ${relativePath} (mode: ${this.isOcrmEnabled() ? 'OCRM' : 'legacy'})`);

      return {
        success: true,
        path: relativePath,
        absolutePath: absolutePath,
        created: true,
        message: 'Company page created successfully',
      };
    } catch (error) {
      console.error(`[VaultStructure] Error creating company page:`, error.message);
      return {
        success: false,
        path: relativePath,
        created: false,
        error: error.message,
      };
    }
  }

  /**
   * Get the wiki-link for a contact
   * @param {string} contactName - Contact name
   * @returns {string} Wiki-link syntax
   */
  getContactWikiLink(contactName) {
    return `[[${contactName}]]`;
  }

  /**
   * Get the wiki-link for a company
   * @param {string} companyName - Company name
   * @returns {string} Wiki-link syntax
   */
  getCompanyWikiLink(companyName) {
    return `[[${companyName}]]`;
  }

  // =================================================================
  // RS-2: Stale Link Detection & Refresh
  // =================================================================

  /**
   * Extract meeting_id from YAML frontmatter
   * @param {string} content - File content
   * @returns {string|null} Meeting ID or null if not found
   * @private
   */
  _extractMeetingIdFromFrontmatter(content) {
    // Match YAML frontmatter block
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];

    // Extract meeting_id field
    const meetingIdMatch = frontmatter.match(/^meeting_id:\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (!meetingIdMatch) return null;

    return meetingIdMatch[1].trim();
  }

  /**
   * Recursively scan directory for markdown files
   * @param {string} dirPath - Directory to scan (absolute path)
   * @param {Array} results - Accumulator for results
   * @returns {Array<string>} Array of file paths
   * @private
   */
  _scanDirectoryForMarkdown(dirPath, results = []) {
    try {
      if (!fs.existsSync(dirPath)) return results;

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories and config folder
          if (!entry.name.startsWith('.') && entry.name !== 'config') {
            this._scanDirectoryForMarkdown(fullPath, results);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`[VaultStructure] Error scanning directory ${dirPath}:`, error.message);
    }

    return results;
  }

  /**
   * Find a file by meeting ID in the vault
   * @param {string} meetingId - Meeting ID to find
   * @returns {Object|null} { relativePath, absolutePath } or null if not found
   */
  findFileByMeetingId(meetingId) {
    if (!meetingId || !this.vaultBasePath) return null;

    console.log(`[VaultStructure] Searching for meeting ID: ${meetingId}`);

    const allFiles = this._scanDirectoryForMarkdown(this.vaultBasePath);

    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const foundId = this._extractMeetingIdFromFrontmatter(content);

        if (foundId === meetingId) {
          const relativePath = path.relative(this.vaultBasePath, filePath);
          console.log(`[VaultStructure] Found meeting ${meetingId} at: ${relativePath}`);
          return {
            relativePath: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
            absolutePath: filePath,
          };
        }
      } catch (error) {
        // Skip files that can't be read
        console.warn(`[VaultStructure] Error reading file ${filePath}:`, error.message);
      }
    }

    console.log(`[VaultStructure] Meeting ID not found: ${meetingId}`);
    return null;
  }

  /**
   * Scan entire vault and build map of meeting_id -> file path
   * @returns {Map<string, {relativePath: string, absolutePath: string}>} Map of meeting IDs to paths
   */
  scanAllMeetingNotes() {
    console.log('[VaultStructure] Scanning vault for meeting notes...');

    if (!this.vaultBasePath) {
      console.warn('[VaultStructure] No vault path configured');
      return new Map();
    }

    const meetingMap = new Map();
    const allFiles = this._scanDirectoryForMarkdown(this.vaultBasePath);

    let scanned = 0;
    let found = 0;

    for (const filePath of allFiles) {
      scanned++;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const meetingId = this._extractMeetingIdFromFrontmatter(content);

        if (meetingId) {
          found++;
          const relativePath = path.relative(this.vaultBasePath, filePath);
          meetingMap.set(meetingId, {
            relativePath: relativePath.replace(/\\/g, '/'),
            absolutePath: filePath,
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    console.log(`[VaultStructure] Scan complete: ${found} meeting notes found in ${scanned} files`);
    return meetingMap;
  }

  /**
   * Refresh obsidian links for meetings by scanning vault for moved files
   * @param {Array} meetings - Array of meeting objects with id and obsidianLink fields
   * @returns {Object} { updated: number, stale: Array, refreshed: Array }
   */
  refreshObsidianLinks(meetings) {
    console.log(`[VaultStructure] Refreshing links for ${meetings.length} synced meetings...`);

    // Build map of all meeting notes in vault
    const vaultMap = this.scanAllMeetingNotes();

    const result = {
      updated: 0,
      stale: [], // Meetings whose links were stale (file moved)
      refreshed: [], // Meetings whose links were refreshed
      missing: [], // Meetings not found in vault at all
    };

    for (const meeting of meetings) {
      if (!meeting.id || !meeting.obsidianLink) continue;

      const vaultEntry = vaultMap.get(meeting.id);

      if (!vaultEntry) {
        // Meeting not found in vault - may have been deleted
        result.missing.push({
          id: meeting.id,
          title: meeting.title,
          previousPath: meeting.obsidianLink,
        });
        continue;
      }

      // Compare current stored path with actual vault path
      const currentPath = meeting.obsidianLink.replace(/\\/g, '/');
      const actualPath = vaultEntry.relativePath;

      if (currentPath !== actualPath) {
        // Path changed - file was moved
        result.stale.push({
          id: meeting.id,
          title: meeting.title,
          previousPath: currentPath,
          newPath: actualPath,
        });

        // Update the meeting's obsidianLink
        meeting.obsidianLink = actualPath;
        result.updated++;
        result.refreshed.push({
          id: meeting.id,
          title: meeting.title,
          newPath: actualPath,
        });
      }
    }

    console.log(
      `[VaultStructure] Link refresh complete: ${result.updated} updated, ${result.missing.length} missing`
    );
    return result;
  }
}

module.exports = VaultStructure;
