/**
 * Vocabulary Service - VC-1
 * Manages custom vocabulary for improved transcription accuracy.
 * Supports global and client-specific vocabulary lists with
 * provider-specific formatting for AssemblyAI and Deepgram.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const LOG_PREFIX = '[VocabularyService]';

class VocabularyService {
  constructor() {
    // Config path: userData/config/vocabulary.yaml (both dev and prod)
    // Default files are copied there on app initialization
    const { app } = require('electron');
    this.configPath = path.join(app.getPath('userData'), 'config', 'vocabulary.yaml');
    this.config = null;
    this.lastLoaded = null;
  }

  /**
   * Set custom config path (useful for testing or alternate configs)
   * @param {string} configPath - Path to vocabulary.yaml file
   */
  setConfigPath(configPath) {
    this.configPath = configPath;
    this.config = null; // Force reload on next access
  }

  /**
   * Load vocabulary configuration from disk
   * @returns {Object} Parsed vocabulary configuration
   */
  load() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.log(
          `${LOG_PREFIX} No vocabulary file found at ${this.configPath}, using empty config`
        );
        this.config = this._getEmptyConfig();
        return this.config;
      }

      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.load(fileContents) || this._getEmptyConfig();
      this.lastLoaded = new Date();

      // Ensure required structure exists
      this._normalizeConfig();

      const globalSpellings = this.config.global?.spelling_corrections?.length || 0;
      const globalKeywords = this.config.global?.keyword_boosts?.length || 0;
      const clientCount = Object.keys(this.config.clients || {}).length;

      console.log(
        `${LOG_PREFIX} Loaded vocabulary: ${globalSpellings} global spelling corrections, ${globalKeywords} global keyword boosts, ${clientCount} client configs`
      );
      return this.config;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error loading vocabulary:`, error.message);
      this.config = this._getEmptyConfig();
      return this.config;
    }
  }

  /**
   * Get empty configuration structure
   * @private
   */
  _getEmptyConfig() {
    return {
      global: {
        spelling_corrections: [],
        keyword_boosts: [],
      },
      clients: {},
    };
  }

  /**
   * Normalize config structure, ensuring all required fields exist
   * @private
   */
  _normalizeConfig() {
    if (!this.config.global) {
      this.config.global = {};
    }
    if (!Array.isArray(this.config.global.spelling_corrections)) {
      this.config.global.spelling_corrections = [];
    }
    if (!Array.isArray(this.config.global.keyword_boosts)) {
      this.config.global.keyword_boosts = [];
    }
    if (!this.config.clients || typeof this.config.clients !== 'object') {
      this.config.clients = {};
    }

    // Normalize each client config
    for (const [slug, clientConfig] of Object.entries(this.config.clients)) {
      if (!clientConfig) {
        this.config.clients[slug] = {
          spelling_corrections: [],
          keyword_boosts: [],
        };
        continue;
      }
      if (!Array.isArray(clientConfig.spelling_corrections)) {
        this.config.clients[slug].spelling_corrections = [];
      }
      if (!Array.isArray(clientConfig.keyword_boosts)) {
        this.config.clients[slug].keyword_boosts = [];
      }
    }
  }

  /**
   * Get current configuration, loading if necessary
   * @param {boolean} forceReload - Force reload from disk
   * @returns {Object} Vocabulary configuration
   */
  getConfig(forceReload = false) {
    if (!this.config || forceReload) {
      return this.load();
    }
    return this.config;
  }

  /**
   * Get global vocabulary
   * @returns {Object} Global vocabulary with spelling_corrections and keyword_boosts
   */
  getGlobalVocabulary() {
    const config = this.getConfig();
    return config.global;
  }

  /**
   * Get vocabulary for a specific client
   * @param {string} clientSlug - Client identifier (matches routing.yaml)
   * @returns {Object|null} Client vocabulary or null if not found
   */
  getClientVocabulary(clientSlug) {
    const config = this.getConfig();
    return config.clients[clientSlug] || null;
  }

  /**
   * Get list of all client slugs with vocabulary defined
   * @returns {string[]} Array of client slugs
   */
  getClientSlugs() {
    const config = this.getConfig();
    return Object.keys(config.clients);
  }

  /**
   * Merge global and client-specific vocabulary
   * Client vocabulary takes precedence for conflicts
   * @param {string|null} clientSlug - Client slug, or null for global only
   * @returns {Object} Merged vocabulary
   */
  getMergedVocabulary(clientSlug = null) {
    const config = this.getConfig();
    const global = config.global;

    if (!clientSlug) {
      return {
        spelling_corrections: [...(global.spelling_corrections || [])],
        keyword_boosts: [...(global.keyword_boosts || [])],
      };
    }

    const client = config.clients[clientSlug];
    if (!client) {
      return {
        spelling_corrections: [...(global.spelling_corrections || [])],
        keyword_boosts: [...(global.keyword_boosts || [])],
      };
    }

    // Merge spelling corrections (client additions go at the end, processed last = higher priority)
    const spellingCorrections = [
      ...(global.spelling_corrections || []),
      ...(client.spelling_corrections || []),
    ];

    // Merge keyword boosts, with client overriding global for same word
    const keywordMap = new Map();

    // Add global keywords first
    for (const kb of global.keyword_boosts || []) {
      if (kb.word) {
        keywordMap.set(kb.word.toLowerCase(), kb);
      }
    }

    // Client keywords override global
    for (const kb of client.keyword_boosts || []) {
      if (kb.word) {
        keywordMap.set(kb.word.toLowerCase(), kb);
      }
    }

    const keywordBoosts = Array.from(keywordMap.values());

    console.log(
      `${LOG_PREFIX} Merged vocabulary for "${clientSlug}": ${spellingCorrections.length} spelling corrections, ${keywordBoosts.length} keyword boosts`
    );

    return {
      spelling_corrections: spellingCorrections,
      keyword_boosts: keywordBoosts,
    };
  }

  /**
   * Format vocabulary for AssemblyAI custom_spelling parameter
   * @param {Object} vocabulary - Merged vocabulary object
   * @returns {Array} Array of {from: [], to: ""} objects for AssemblyAI
   */
  formatForAssemblyAI(vocabulary) {
    const customSpelling = [];

    // Add explicit spelling corrections
    if (vocabulary.spelling_corrections) {
      for (const sc of vocabulary.spelling_corrections) {
        if (sc.from && sc.to) {
          customSpelling.push({
            from: Array.isArray(sc.from) ? sc.from : [sc.from],
            to: sc.to,
          });
        }
      }
    }

    // Convert keyword boosts to spelling corrections (ensures proper casing)
    // AssemblyAI doesn't have probability boosting, so we ensure the word
    // is spelled correctly by mapping lowercase to proper casing
    if (vocabulary.keyword_boosts) {
      for (const kb of vocabulary.keyword_boosts) {
        if (kb.word) {
          const lowerWord = kb.word.toLowerCase();
          // Only add if the word has non-trivial casing
          if (lowerWord !== kb.word) {
            customSpelling.push({
              from: [lowerWord],
              to: kb.word,
            });
          }
        }
      }
    }

    console.log(`${LOG_PREFIX} Formatted ${customSpelling.length} entries for AssemblyAI`);
    return customSpelling;
  }

  /**
   * Format vocabulary for Universal-3 Pro model (keyterms_prompt)
   *
   * API Constraints (AssemblyAI):
   * - Max 1,000 keyterms for Universal-3-Pro (200 for Universal-2)
   * - Max 6 words per phrase
   * - Avoid single common English words
   *
   * @param {Object} vocabulary - Merged vocabulary object
   * @param {number} maxTerms - Maximum terms (1000 for U3P, 200 for U2)
   * @returns {string[]} Array of keyterms
   */
  formatForUniversal(vocabulary, maxTerms = 1000) {
    const keyterms = new Set();

    // Extract "to" values from spelling corrections
    if (vocabulary.spelling_corrections) {
      vocabulary.spelling_corrections.forEach(item => {
        if (item.to) {
          const wordCount = item.to.trim().split(/\s+/).length;
          if (wordCount <= 6 && wordCount >= 1) {
            keyterms.add(item.to);
          } else {
            console.log(
              `${LOG_PREFIX} Skipping "${item.to}" - exceeds 6 word limit (${wordCount} words)`
            );
          }
        }
      });
    }

    // Add keyword boosts directly
    if (vocabulary.keyword_boosts) {
      vocabulary.keyword_boosts.forEach(item => {
        if (item.word) {
          const wordCount = item.word.trim().split(/\s+/).length;
          if (wordCount <= 6 && wordCount >= 1) {
            keyterms.add(item.word);
          } else {
            console.log(`${LOG_PREFIX} Skipping "${item.word}" - exceeds 6 word limit`);
          }
        }
      });
    }

    // Add any direct terms list
    if (vocabulary.terms) {
      vocabulary.terms.forEach(term => {
        const wordCount = term.trim().split(/\s+/).length;
        if (wordCount <= 6 && wordCount >= 1) {
          keyterms.add(term);
        }
      });
    }

    const result = [...keyterms].slice(0, maxTerms);
    console.log(
      `${LOG_PREFIX} Formatted ${result.length} keyterms for Universal model (max: ${maxTerms})`
    );
    return result;
  }

  /**
   * Format vocabulary for Deepgram keywords parameter
   * @param {Object} vocabulary - Merged vocabulary object
   * @returns {Array} Array of "word:intensifier" strings for Deepgram
   */
  formatForDeepgram(vocabulary) {
    const keywords = [];

    // Add keyword boosts
    if (vocabulary.keyword_boosts) {
      for (const kb of vocabulary.keyword_boosts) {
        if (kb.word) {
          const intensifier = kb.intensifier || 3; // Default boost
          keywords.push(`${kb.word}:${intensifier}`);
        }
      }
    }

    // For spelling corrections, boost the correct spelling
    if (vocabulary.spelling_corrections) {
      for (const sc of vocabulary.spelling_corrections) {
        if (sc.to) {
          // Add the correct term with a moderate boost
          keywords.push(`${sc.to}:3`);
        }
      }
    }

    // Deepgram has a 200 keyword limit
    if (keywords.length > 200) {
      console.warn(`${LOG_PREFIX} Vocabulary exceeds Deepgram's 200 keyword limit, truncating`);
      keywords.length = 200;
    }

    console.log(`${LOG_PREFIX} Formatted ${keywords.length} keywords for Deepgram`);
    return keywords;
  }

  /**
   * Get provider-formatted vocabulary ready for transcription
   * @param {string} provider - 'assemblyai', 'assemblyai-universal', or 'deepgram'
   * @param {string|null} clientSlug - Client slug for client-specific vocabulary
   * @returns {Object} Provider-specific vocabulary format
   */
  getVocabularyForProvider(provider, clientSlug = null) {
    const merged = this.getMergedVocabulary(clientSlug);

    switch (provider.toLowerCase()) {
      case 'assemblyai':
      case 'assemblyai-universal':
        // Use Universal-3 Pro keyterms format by default
        return {
          keyterms_prompt: this.formatForUniversal(merged),
          // Keep legacy format for backwards compatibility
          custom_spelling: this.formatForAssemblyAI(merged),
        };

      case 'deepgram':
        return {
          keywords: this.formatForDeepgram(merged),
        };

      default:
        console.warn(`${LOG_PREFIX} Unknown provider "${provider}", returning raw vocabulary`);
        return merged;
    }
  }

  /**
   * Save vocabulary configuration to disk
   * @param {Object} config - Configuration to save
   */
  save(config = null) {
    const configToSave = config || this.config;

    if (!configToSave) {
      throw new Error('No vocabulary configuration to save');
    }

    try {
      const yamlContent = yaml.dump(configToSave, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      fs.writeFileSync(this.configPath, yamlContent, 'utf8');
      this.config = configToSave;
      this.lastLoaded = new Date();

      console.log(`${LOG_PREFIX} Saved vocabulary configuration to ${this.configPath}`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error saving vocabulary:`, error.message);
      throw error;
    }
  }

  /**
   * Add a global spelling correction
   * @param {string[]} from - Array of incorrect spellings
   * @param {string} to - Correct spelling
   */
  addGlobalSpellingCorrection(from, to) {
    const config = this.getConfig();

    config.global.spelling_corrections.push({
      from: Array.isArray(from) ? from : [from],
      to: to,
    });

    this.save(config);
    console.log(`${LOG_PREFIX} Added global spelling correction: ${from.join(', ')} → ${to}`);
  }

  /**
   * Add a global keyword boost
   * @param {string} word - Word to boost
   * @param {number} intensifier - Boost intensity (1-10)
   */
  addGlobalKeywordBoost(word, intensifier = 5) {
    const config = this.getConfig();

    config.global.keyword_boosts.push({
      word: word,
      intensifier: Math.min(10, Math.max(1, intensifier)),
    });

    this.save(config);
    console.log(`${LOG_PREFIX} Added global keyword boost: ${word}:${intensifier}`);
  }

  /**
   * Add a client-specific spelling correction
   * @param {string} clientSlug - Client identifier
   * @param {string[]} from - Array of incorrect spellings
   * @param {string} to - Correct spelling
   */
  addClientSpellingCorrection(clientSlug, from, to) {
    const config = this.getConfig();

    if (!config.clients[clientSlug]) {
      config.clients[clientSlug] = {
        spelling_corrections: [],
        keyword_boosts: [],
      };
    }

    config.clients[clientSlug].spelling_corrections.push({
      from: Array.isArray(from) ? from : [from],
      to: to,
    });

    this.save(config);
    console.log(
      `${LOG_PREFIX} Added spelling correction for "${clientSlug}": ${from.join(', ')} → ${to}`
    );
  }

  /**
   * Add a client-specific keyword boost
   * @param {string} clientSlug - Client identifier
   * @param {string} word - Word to boost
   * @param {number} intensifier - Boost intensity (1-10)
   */
  addClientKeywordBoost(clientSlug, word, intensifier = 5) {
    const config = this.getConfig();

    if (!config.clients[clientSlug]) {
      config.clients[clientSlug] = {
        spelling_corrections: [],
        keyword_boosts: [],
      };
    }

    config.clients[clientSlug].keyword_boosts.push({
      word: word,
      intensifier: Math.min(10, Math.max(1, intensifier)),
    });

    this.save(config);
    console.log(`${LOG_PREFIX} Added keyword boost for "${clientSlug}": ${word}:${intensifier}`);
  }

  /**
   * Remove a global spelling correction by target word
   * @param {string} to - The "to" word to remove
   * @returns {boolean} True if removed
   */
  removeGlobalSpellingCorrection(to) {
    const config = this.getConfig();
    const before = config.global.spelling_corrections.length;

    config.global.spelling_corrections = config.global.spelling_corrections.filter(
      sc => sc.to !== to
    );

    if (config.global.spelling_corrections.length < before) {
      this.save(config);
      console.log(`${LOG_PREFIX} Removed global spelling correction for "${to}"`);
      return true;
    }
    return false;
  }

  /**
   * Remove a global keyword boost
   * @param {string} word - The word to remove
   * @returns {boolean} True if removed
   */
  removeGlobalKeywordBoost(word) {
    const config = this.getConfig();
    const before = config.global.keyword_boosts.length;

    config.global.keyword_boosts = config.global.keyword_boosts.filter(kb => kb.word !== word);

    if (config.global.keyword_boosts.length < before) {
      this.save(config);
      console.log(`${LOG_PREFIX} Removed global keyword boost for "${word}"`);
      return true;
    }
    return false;
  }

  /**
   * Reload configuration from disk
   * @returns {Object} Reloaded configuration
   */
  reload() {
    console.log(`${LOG_PREFIX} Reloading vocabulary from disk`);
    return this.load();
  }

  /**
   * Export vocabulary for backup
   * @returns {Object} Exportable vocabulary data
   */
  exportVocabulary() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      vocabulary: this.getConfig(),
    };
  }

  /**
   * Import vocabulary from backup
   * @param {Object} data - Imported data
   * @param {boolean} merge - If true, merge with existing. If false, replace.
   */
  importVocabulary(data, merge = true) {
    if (!data?.vocabulary) {
      throw new Error('Invalid import data: missing vocabulary');
    }

    if (!merge) {
      this.config = data.vocabulary;
      this._normalizeConfig();
      this.save();
      console.log(`${LOG_PREFIX} Imported vocabulary (replaced existing)`);
      return;
    }

    // Merge import with existing
    const config = this.getConfig();
    const imported = data.vocabulary;

    // Merge global spelling corrections
    if (imported.global?.spelling_corrections) {
      const existingTos = new Set(config.global.spelling_corrections.map(sc => sc.to));
      for (const sc of imported.global.spelling_corrections) {
        if (!existingTos.has(sc.to)) {
          config.global.spelling_corrections.push(sc);
        }
      }
    }

    // Merge global keyword boosts
    if (imported.global?.keyword_boosts) {
      const existingWords = new Set(config.global.keyword_boosts.map(kb => kb.word?.toLowerCase()));
      for (const kb of imported.global.keyword_boosts) {
        if (!existingWords.has(kb.word?.toLowerCase())) {
          config.global.keyword_boosts.push(kb);
        }
      }
    }

    // Merge client vocabularies
    if (imported.clients) {
      for (const [slug, clientVocab] of Object.entries(imported.clients)) {
        if (!config.clients[slug]) {
          config.clients[slug] = clientVocab;
        } else {
          // Merge spelling corrections
          if (clientVocab.spelling_corrections) {
            const existingTos = new Set(config.clients[slug].spelling_corrections.map(sc => sc.to));
            for (const sc of clientVocab.spelling_corrections) {
              if (!existingTos.has(sc.to)) {
                config.clients[slug].spelling_corrections.push(sc);
              }
            }
          }

          // Merge keyword boosts
          if (clientVocab.keyword_boosts) {
            const existingWords = new Set(
              config.clients[slug].keyword_boosts.map(kb => kb.word?.toLowerCase())
            );
            for (const kb of clientVocab.keyword_boosts) {
              if (!existingWords.has(kb.word?.toLowerCase())) {
                config.clients[slug].keyword_boosts.push(kb);
              }
            }
          }
        }
      }
    }

    this.save(config);
    console.log(`${LOG_PREFIX} Imported vocabulary (merged with existing)`);
  }

  /**
   * Get statistics about vocabulary
   * @returns {Object} Vocabulary statistics
   */
  getStats() {
    const config = this.getConfig();

    const clientStats = {};
    for (const [slug, clientConfig] of Object.entries(config.clients)) {
      clientStats[slug] = {
        spellingCorrections: clientConfig.spelling_corrections?.length || 0,
        keywordBoosts: clientConfig.keyword_boosts?.length || 0,
      };
    }

    return {
      global: {
        spellingCorrections: config.global.spelling_corrections?.length || 0,
        keywordBoosts: config.global.keyword_boosts?.length || 0,
      },
      clientCount: Object.keys(config.clients).length,
      clients: clientStats,
      lastLoaded: this.lastLoaded,
    };
  }
}

// Export singleton instance
const vocabularyService = new VocabularyService();
module.exports = vocabularyService;
