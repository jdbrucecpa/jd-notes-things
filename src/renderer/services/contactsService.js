/**
 * ContactsService - Shared service for Google Contacts integration
 * Phase 10.5: Meeting Metadata Management
 *
 * Provides a clean interface for searching and working with Google Contacts
 * from the renderer process.
 */

class ContactsService {
  constructor() {
    this.cache = new Map();
    this.lastFetch = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Search for contacts by name or email
   * @param {string} query - Search query (name or email)
   * @param {object} options - Search options
   * @param {boolean} options.useCache - Use cached results (default: true)
   * @param {number} options.debounceMs - Debounce delay in ms (default: 300)
   * @returns {Promise<Array>} Array of matching contacts
   */
  async search(query, options = {}) {
    const { useCache = true, debounceMs = 300 } = options;

    if (!query || query.trim().length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();

    // Check cache
    if (useCache && this.cache.has(normalizedQuery)) {
      const cached = this.cache.get(normalizedQuery);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log('[ContactsService] Returning cached results for:', normalizedQuery);
        return cached.contacts;
      }
    }

    // Debounce if requested
    if (debounceMs > 0) {
      await this._debounce(debounceMs);
    }

    try {
      const result = await window.electronAPI.contactsSearchContacts(query);

      if (result.success) {
        // Cache the results
        this.cache.set(normalizedQuery, {
          contacts: result.contacts,
          timestamp: Date.now(),
        });

        return result.contacts;
      } else {
        console.error('[ContactsService] Search failed:', result.error);
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ContactsService] Search error:', error);
      throw error;
    }
  }

  /**
   * Fetch/refresh contacts from Google
   * @param {boolean} forceRefresh - Force refresh from Google API
   * @returns {Promise<object>} Contact count and last fetch info
   */
  async fetchContacts(forceRefresh = false) {
    try {
      const result = await window.electronAPI.contactsFetchContacts(forceRefresh);

      if (result.success) {
        this.lastFetch = result.lastFetch;
        // Clear search cache when contacts are refreshed
        if (forceRefresh) {
          this.cache.clear();
        }
        return {
          count: result.contactCount,
          lastFetch: result.lastFetch,
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[ContactsService] Fetch error:', error);
      throw error;
    }
  }

  /**
   * Format a contact for display
   * @param {object} contact - Contact object
   * @returns {object} Formatted contact with displayName and primaryEmail
   */
  formatContact(contact) {
    return {
      name: contact.name || 'Unknown',
      email: contact.emails && contact.emails.length > 0 ? contact.emails[0] : null,
      allEmails: contact.emails || [],
      photoUrl: contact.photoUrl || null,
      displayName: contact.name || (contact.emails && contact.emails[0]) || 'Unknown',
      initials: this._getInitials(contact.name),
    };
  }

  /**
   * Get initials from a name
   * @param {string} name - Person's name
   * @returns {string} Initials (e.g., "JD")
   * @private
   */
  _getInitials(name) {
    if (!name) return '?';

    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  /**
   * Debounce helper
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise}
   * @private
   */
  _debounce(ms) {
    if (this._debounceTimeout) {
      clearTimeout(this._debounceTimeout);
    }

    return new Promise(resolve => {
      this._debounceTimeout = setTimeout(() => {
        this._debounceTimeout = null;
        resolve();
      }, ms);
    });
  }

  /**
   * Clear the search cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[ContactsService] Cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      lastFetch: this.lastFetch,
    };
  }
}

// Export singleton instance
export const contactsService = new ContactsService();
export default contactsService;
