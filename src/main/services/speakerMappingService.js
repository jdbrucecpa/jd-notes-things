/**
 * Speaker Mapping Service - SM-2
 * Manages persistent storage of speaker ID → contact mappings
 * for imported transcripts with cryptic speaker IDs (e.g., SPK-72zlg25bsiw)
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../../shared/logger');

const LOG_PREFIX = '[SpeakerMappingService]';

class SpeakerMappingService {
  constructor() {
    this.mappings = new Map();
    this.dataPath = null;
    this.initialized = false;
  }

  /**
   * Initialize the service and load existing mappings
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Store mappings in app data directory
      const userDataPath = app.getPath('userData');
      this.dataPath = path.join(userDataPath, 'speaker-mappings.json');

      await this.loadMappings();
      this.initialized = true;
      logger.info(`${LOG_PREFIX} Initialized with ${this.mappings.size} existing mappings`);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Failed to initialize:`, error);
      this.initialized = true; // Continue without persisted data
    }
  }

  /**
   * Load mappings from disk
   */
  async loadMappings() {
    try {
      if (!fs.existsSync(this.dataPath)) {
        logger.info(`${LOG_PREFIX} No existing mappings file found, starting fresh`);
        return;
      }

      const data = fs.readFileSync(this.dataPath, 'utf8');
      const parsed = JSON.parse(data);

      if (parsed.version !== 1) {
        logger.warn(`${LOG_PREFIX} Unknown version ${parsed.version}, attempting to migrate`);
      }

      // Convert object to Map
      if (parsed.mappings && typeof parsed.mappings === 'object') {
        for (const [speakerId, mapping] of Object.entries(parsed.mappings)) {
          this.mappings.set(speakerId, mapping);
        }
      }

      logger.info(`${LOG_PREFIX} Loaded ${this.mappings.size} mappings from disk`);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Failed to load mappings:`, error);
    }
  }

  /**
   * Save mappings to disk
   */
  async saveMappings() {
    try {
      const data = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        mappings: Object.fromEntries(this.mappings),
      };

      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`${LOG_PREFIX} Saved ${this.mappings.size} mappings to disk`);
    } catch (error) {
      logger.error(`${LOG_PREFIX} Failed to save mappings:`, error);
      throw error;
    }
  }

  /**
   * Add or update a speaker ID → contact mapping
   * @param {string} speakerId - The original speaker ID (e.g., SPK-72zlg25bsiw)
   * @param {Object} contact - Contact information
   * @param {string} contact.name - Contact name
   * @param {string} contact.email - Contact email (optional)
   * @param {Object} sourceContext - Optional context about where mapping was created
   * @returns {Object} The created/updated mapping
   */
  async addMapping(speakerId, contact, sourceContext = null) {
    if (!speakerId || !contact?.name) {
      throw new Error('Speaker ID and contact name are required');
    }

    const existingMapping = this.mappings.get(speakerId);
    const now = new Date().toISOString();

    const mapping = {
      contactName: contact.name,
      contactEmail: contact.email || null,
      obsidianLink: `[[${contact.name}]]`,
      createdAt: existingMapping?.createdAt || now,
      lastUsedAt: now,
      useCount: (existingMapping?.useCount || 0) + 1,
      sourceContext: sourceContext || existingMapping?.sourceContext || null,
    };

    this.mappings.set(speakerId, mapping);
    await this.saveMappings();

    logger.info(`${LOG_PREFIX} Added mapping: ${speakerId} → ${contact.name}`);
    return mapping;
  }

  /**
   * Get mapping for a specific speaker ID
   * @param {string} speakerId - The speaker ID to look up
   * @returns {Object|null} The mapping if found
   */
  getMapping(speakerId) {
    return this.mappings.get(speakerId) || null;
  }

  /**
   * Get all known mappings
   * @returns {Array} Array of {speakerId, ...mapping} objects, sorted by useCount descending
   */
  getAllMappings() {
    const result = [];
    for (const [speakerId, mapping] of this.mappings) {
      result.push({ speakerId, ...mapping });
    }
    return result.sort((a, b) => b.useCount - a.useCount);
  }

  /**
   * Get suggested mappings for a list of speaker IDs
   * Returns known mappings for IDs that have been seen before
   * @param {string[]} speakerIds - Array of speaker IDs to check
   * @returns {Object} Map of speakerId → mapping for known IDs
   */
  getSuggestions(speakerIds) {
    const suggestions = {};
    for (const speakerId of speakerIds) {
      const mapping = this.getMapping(speakerId);
      if (mapping) {
        suggestions[speakerId] = mapping;
      }
    }
    return suggestions;
  }

  /**
   * Delete a mapping
   * @param {string} speakerId - The speaker ID to remove
   * @returns {boolean} True if deleted, false if not found
   */
  async deleteMapping(speakerId) {
    if (!this.mappings.has(speakerId)) {
      return false;
    }

    this.mappings.delete(speakerId);
    await this.saveMappings();

    logger.info(`${LOG_PREFIX} Deleted mapping for: ${speakerId}`);
    return true;
  }

  /**
   * Update the lastUsedAt timestamp for a mapping
   * @param {string} speakerId - The speaker ID
   */
  async touchMapping(speakerId) {
    const mapping = this.mappings.get(speakerId);
    if (mapping) {
      mapping.lastUsedAt = new Date().toISOString();
      mapping.useCount = (mapping.useCount || 0) + 1;
      await this.saveMappings();
    }
  }

  /**
   * Extract unique speaker IDs from a transcript
   * Filters for cryptic IDs (SPK-xxx, Speaker 1, etc.) vs actual names
   * @param {Array} transcript - Transcript utterances
   * @returns {string[]} Array of unique speaker IDs
   */
  extractUniqueSpeakerIds(transcript) {
    if (!Array.isArray(transcript)) return [];

    const speakers = new Set();
    for (const utterance of transcript) {
      const speaker = utterance.speaker || utterance.speakerName;
      if (speaker) {
        speakers.add(speaker);
      }
    }

    // Filter to only include "cryptic" IDs that need mapping
    // Patterns: SPK-xxx, Speaker A/B/1/2, spk_xxx, etc.
    const crypticPatterns = [
      /^SPK[-_][a-z0-9]+$/i, // SPK-72zlg25bsiw
      /^Speaker\s*[A-Z0-9]+$/i, // Speaker A, Speaker 1
      /^spk_\d+$/i, // spk_0, spk_1
      /^SPEAKER_\d+$/i, // SPEAKER_00
      /^S\d+$/i, // S1, S2
    ];

    const uniqueIds = Array.from(speakers).filter(speaker => {
      return crypticPatterns.some(pattern => pattern.test(speaker));
    });

    return uniqueIds.sort();
  }

  /**
   * Check if a speaker label looks like a cryptic ID that needs mapping
   * @param {string} speaker - Speaker label to check
   * @returns {boolean} True if it appears to be a cryptic ID
   */
  isCrypticSpeakerId(speaker) {
    if (!speaker) return false;

    const crypticPatterns = [
      /^SPK[-_][a-z0-9]+$/i,
      /^Speaker\s*[A-Z0-9]+$/i,
      /^spk_\d+$/i,
      /^SPEAKER_\d+$/i,
      /^S\d+$/i,
    ];

    return crypticPatterns.some(pattern => pattern.test(speaker));
  }

  /**
   * Apply mappings to a transcript, replacing speaker IDs with contact names
   * @param {Array} transcript - Transcript utterances
   * @param {Object} mappings - Optional custom mappings to apply (overrides stored mappings)
   * @param {Object} options - Options for replacement
   * @param {boolean} options.useWikiLinks - Use [[Name]] format instead of plain name
   * @returns {Array} Updated transcript with speaker names replaced
   */
  applyMappingsToTranscript(transcript, mappings = null, options = {}) {
    const { useWikiLinks = false } = options;

    if (!Array.isArray(transcript)) return transcript;

    // Merge custom mappings with stored mappings (custom takes precedence)
    const effectiveMappings = {};

    // First, add all stored mappings
    for (const [speakerId, mapping] of this.mappings) {
      effectiveMappings[speakerId] = mapping;
    }

    // Then overlay custom mappings
    if (mappings) {
      Object.assign(effectiveMappings, mappings);
    }

    logger.debug(`${LOG_PREFIX} Effective mappings:`, Object.keys(effectiveMappings));

    let mappedCount = 0;
    const result = transcript.map(utterance => {
      const speakerId = utterance.speaker;
      const mapping = effectiveMappings[speakerId];

      if (mapping) {
        mappedCount++;
        const newName = useWikiLinks ? mapping.obsidianLink : mapping.contactName;
        return {
          ...utterance,
          speaker: speakerId, // Keep original for reference
          speakerName: mapping.contactName,
          speakerEmail: mapping.contactEmail,
          speakerDisplayName: newName,
          speakerMapped: true,
        };
      }

      return utterance;
    });

    logger.info(`${LOG_PREFIX} Applied mappings to ${mappedCount} utterances out of ${transcript.length}`);
    return result;
  }

  /**
   * Get statistics about the mapping database
   */
  getStats() {
    const mappings = this.getAllMappings();
    return {
      totalMappings: mappings.length,
      totalUseCount: mappings.reduce((sum, m) => sum + (m.useCount || 0), 0),
      oldestMapping: mappings.length > 0
        ? new Date(Math.min(...mappings.map(m => new Date(m.createdAt))))
        : null,
      newestMapping: mappings.length > 0
        ? new Date(Math.max(...mappings.map(m => new Date(m.createdAt))))
        : null,
    };
  }

  /**
   * Export mappings for backup/transfer
   * @returns {Object} Exportable data
   */
  exportMappings() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      mappings: Object.fromEntries(this.mappings),
    };
  }

  /**
   * Import mappings from backup/transfer
   * @param {Object} data - Imported data
   * @param {boolean} merge - If true, merge with existing. If false, replace.
   */
  async importMappings(data, merge = true) {
    if (!data?.mappings) {
      throw new Error('Invalid import data: missing mappings');
    }

    if (!merge) {
      this.mappings.clear();
    }

    for (const [speakerId, mapping] of Object.entries(data.mappings)) {
      if (!merge || !this.mappings.has(speakerId)) {
        this.mappings.set(speakerId, mapping);
      }
    }

    await this.saveMappings();
    logger.info(`${LOG_PREFIX} Imported ${Object.keys(data.mappings).length} mappings (merge=${merge})`);
  }
}

// Export singleton instance
const speakerMappingService = new SpeakerMappingService();
module.exports = speakerMappingService;
