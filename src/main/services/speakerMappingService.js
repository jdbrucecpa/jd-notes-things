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
      // Store mappings in config directory
      const userDataPath = app.getPath('userData');
      this.dataPath = path.join(userDataPath, 'config', 'speaker-mappings.json');

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
   * Returns ALL unique speakers so user can remap any speaker to a contact
   * Filters out header content like "summary", "introduction", etc.
   * @param {Array} transcript - Transcript utterances
   * @returns {string[]} Array of unique speaker IDs
   */
  extractUniqueSpeakerIds(transcript) {
    if (!Array.isArray(transcript)) return [];

    const speakers = new Set();
    for (const utterance of transcript) {
      const speaker = utterance.speaker || utterance.speakerName;
      if (speaker && !this.isHeaderContent(speaker)) {
        speakers.add(speaker);
      }
    }

    // Return all unique speakers - user should be able to remap any speaker to a contact
    return Array.from(speakers).sort();
  }

  /**
   * Check if a speaker label is actually header/section content
   * @param {string} speaker - Speaker label to check
   * @returns {boolean} True if it's header content, not a real speaker
   */
  isHeaderContent(speaker) {
    if (!speaker) return true;

    const normalized = speaker.toLowerCase().trim();

    // Common header/section names that aren't actual speakers
    const headerPatterns = [
      'summary',
      'introduction',
      'conclusion',
      'action items',
      'action_items',
      'notes',
      'agenda',
      'discussion',
      'overview',
      'key points',
      'key_points',
      'next steps',
      'next_steps',
      'follow up',
      'follow_up',
      'decisions',
      'transcript',
      'meeting notes',
      'meeting_notes',
    ];

    return headerPatterns.includes(normalized);
  }

  /**
   * Detect potential duplicate speakers that might be the same person
   * @param {string[]} speakers - Array of unique speaker names
   * @returns {Object} Object with { autoMerge: [{from, to}], suggestions: [{speakers, reason}] }
   */
  detectDuplicateSpeakers(speakers) {
    const autoMerge = []; // Obvious duplicates to auto-merge
    const suggestions = []; // Potential duplicates to ask user about
    const processed = new Set();

    // Normalize for comparison
    const normalize = name => name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
    const getFirstName = name => name.split(/\s+/)[0].toLowerCase();
    const getLastName = name => {
      const parts = name.split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    };

    for (let i = 0; i < speakers.length; i++) {
      if (processed.has(speakers[i])) continue;

      const speaker1 = speakers[i];
      const norm1 = normalize(speaker1);
      const first1 = getFirstName(speaker1);
      const last1 = getLastName(speaker1);

      for (let j = i + 1; j < speakers.length; j++) {
        if (processed.has(speakers[j])) continue;

        const speaker2 = speakers[j];
        const norm2 = normalize(speaker2);
        const first2 = getFirstName(speaker2);
        const last2 = getLastName(speaker2);

        // Case 1: Exact match after normalization (auto-merge)
        if (norm1 === norm2 && speaker1 !== speaker2) {
          // Keep the longer/more complete name
          const [from, to] = speaker1.length >= speaker2.length
            ? [speaker2, speaker1]
            : [speaker1, speaker2];
          autoMerge.push({ from, to, reason: 'Same name (different case/punctuation)' });
          processed.add(from);
          continue;
        }

        // Case 2: One is a first name only, other has full name (auto-merge)
        if (first1 && first2 && first1 === first2) {
          const parts1 = speaker1.split(/\s+/).length;
          const parts2 = speaker2.split(/\s+/).length;

          if (parts1 === 1 && parts2 > 1) {
            // speaker1 is first name only, speaker2 is full name
            autoMerge.push({ from: speaker1, to: speaker2, reason: 'First name matches full name' });
            processed.add(speaker1);
            continue;
          } else if (parts2 === 1 && parts1 > 1) {
            // speaker2 is first name only, speaker1 is full name
            autoMerge.push({ from: speaker2, to: speaker1, reason: 'First name matches full name' });
            processed.add(speaker2);
            continue;
          } else if (parts1 === 1 && parts2 === 1) {
            // Both are first names only - same first name
            autoMerge.push({ from: speaker2, to: speaker1, reason: 'Same first name' });
            processed.add(speaker2);
            continue;
          }
        }

        // Case 3: Same last name, similar first name (suggestion)
        if (last1 && last2 && last1 === last2 && first1 && first2) {
          // Check if first names are similar (one contains the other or starts with same letter)
          if (first1[0] === first2[0]) {
            suggestions.push({
              speakers: [speaker1, speaker2],
              reason: `Same last name "${last1}", first names start with "${first1[0].toUpperCase()}"`
            });
          }
        }

        // Case 4: Very similar names (Levenshtein distance) - suggestion
        if (norm1.length > 3 && norm2.length > 3) {
          const distance = this.levenshteinDistance(norm1, norm2);
          const maxLen = Math.max(norm1.length, norm2.length);
          const similarity = 1 - (distance / maxLen);

          if (similarity > 0.8 && similarity < 1) {
            suggestions.push({
              speakers: [speaker1, speaker2],
              reason: `Similar names (${Math.round(similarity * 100)}% match)`
            });
          }
        }
      }
    }

    return { autoMerge, suggestions };
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    return dp[m][n];
  }

  /**
   * Get auto-suggestions based on user profile (v1.1)
   * If there's only one speaker in the transcript, suggest mapping to user's name
   * @param {string[]} speakers - Array of unique speaker IDs
   * @param {Object} userProfile - User profile with name, email, etc.
   * @returns {Object} Auto-suggestions { speakerId: { contactName, contactEmail, reason } }
   */
  getAutoSuggestionsFromProfile(speakers, userProfile) {
    const suggestions = {};

    // Must have user profile with name configured
    if (!userProfile?.name) {
      logger.debug(`${LOG_PREFIX} No user profile name configured, skipping auto-suggestions`);
      return suggestions;
    }

    // Only auto-suggest when there's exactly one speaker
    if (speakers.length === 1) {
      const speakerId = speakers[0];
      suggestions[speakerId] = {
        contactName: userProfile.name,
        contactEmail: userProfile.email || null,
        reason: 'single_speaker_is_user',
        confidence: 'high',
        obsidianLink: `[[${userProfile.name}]]`,
      };
      logger.info(`${LOG_PREFIX} Auto-suggesting single speaker "${speakerId}" as user "${userProfile.name}"`);
    }

    // Could add more heuristics here in the future:
    // - Speaker name contains user's first name
    // - Speaker email matches user email
    // - etc.

    return suggestions;
  }

  /**
   * Auto-apply user profile mapping to transcript if single speaker (v1.1)
   * This is called automatically when a transcript is finalized
   * @param {Array} transcript - Transcript utterances
   * @param {Object} userProfile - User profile with name, email, etc.
   * @returns {Object} { applied: boolean, transcript: Array, mapping: Object|null }
   */
  autoApplyUserProfileMapping(transcript, userProfile) {
    if (!Array.isArray(transcript) || transcript.length === 0) {
      return { applied: false, transcript, mapping: null };
    }

    // Get unique speakers
    const speakers = this.extractUniqueSpeakerIds(transcript);

    // Get suggestions (will only suggest if single speaker)
    const suggestions = this.getAutoSuggestionsFromProfile(speakers, userProfile);

    // If no suggestions, return unchanged
    if (Object.keys(suggestions).length === 0) {
      return { applied: false, transcript, mapping: null };
    }

    // Apply the mapping
    const updatedTranscript = this.applyMappingsToTranscript(transcript, suggestions, { useWikiLinks: false });

    logger.info(`${LOG_PREFIX} Auto-applied user profile mapping to single-speaker transcript`);

    return {
      applied: true,
      transcript: updatedTranscript,
      mapping: suggestions,
    };
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
      // Check both speaker and speakerName for mapping matches
      // This handles cases where the transcript has already been partially mapped
      const speakerId = utterance.speaker;
      const speakerNameId = utterance.speakerName;

      // Try to find a mapping - check speaker first, then speakerName
      let mapping = effectiveMappings[speakerId];
      let matchedId = speakerId;

      if (!mapping && speakerNameId && effectiveMappings[speakerNameId]) {
        mapping = effectiveMappings[speakerNameId];
        matchedId = speakerNameId;
      }

      if (mapping) {
        mappedCount++;
        const newName = useWikiLinks ? mapping.obsidianLink : mapping.contactName;
        return {
          ...utterance,
          speaker: speakerId || matchedId, // Keep original for reference
          speakerName: mapping.contactName,
          speakerEmail: mapping.contactEmail || utterance.speakerEmail,
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
