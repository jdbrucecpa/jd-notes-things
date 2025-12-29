/**
 * GoogleContacts - Integrates with Google People API for contact matching
 * Phase 6: Speaker Recognition & Contact Matching
 *
 * Note: Authentication is handled by GoogleAuth module (shared with GoogleCalendar)
 */

const { google } = require('googleapis');
const { LRUCache } = require('lru-cache');

class GoogleContacts {
  /**
   * @param {GoogleAuth} googleAuth - Shared Google authentication instance
   */
  constructor(googleAuth) {
    if (!googleAuth) {
      throw new Error('[GoogleContacts] GoogleAuth instance is required');
    }

    this.googleAuth = googleAuth;
    this.people = null;

    // Use LRU cache with max 5,000 entries and 24-hour TTL
    this.contactsCache = new LRUCache({
      max: 5000, // Maximum 5,000 contacts in cache
      ttl: 24 * 60 * 60 * 1000, // 24 hour TTL per entry
      updateAgeOnGet: true, // Reset TTL when accessed
      allowStale: false,
    });

    this.contactCount = 0; // actual number of unique contacts
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours (for full cache refresh)
    this.lastFetch = null;
  }

  /**
   * Initialize the People API with authenticated client
   * @returns {boolean} True if initialized successfully
   */
  initialize() {
    if (!this.googleAuth.isAuthenticated()) {
      console.log('[GoogleContacts] Not authenticated - user needs to sign in');
      return false;
    }

    try {
      const auth = this.googleAuth.getClient();
      this.people = google.people({ version: 'v1', auth });
      console.log('[GoogleContacts] Initialized with existing token');
      return true;
    } catch (error) {
      console.error('[GoogleContacts] Initialization error:', error.message);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated
   */
  isAuthenticated() {
    return this.googleAuth.isAuthenticated() && this.people !== null;
  }

  /**
   * Fetch all contacts from Google People API
   * @param {boolean} forceRefresh - Bypass cache and fetch fresh data
   * @returns {Array} Array of contact objects
   */
  async fetchAllContacts(forceRefresh = false) {
    if (!this.isAuthenticated()) {
      // Try to initialize if not already done
      if (!this.initialize()) {
        console.error('[GoogleContacts] Not initialized - cannot fetch contacts');
        return [];
      }
    }

    // Check cache
    if (!forceRefresh && this.lastFetch && Date.now() - this.lastFetch < this.cacheExpiry) {
      console.log('[GoogleContacts] Using cached contacts');
      // Deduplicate by resourceName since same contact may be indexed by multiple emails
      const seen = new Set();
      const uniqueContacts = [];
      for (const contact of this.contactsCache.values()) {
        if (!seen.has(contact.resourceName)) {
          seen.add(contact.resourceName);
          uniqueContacts.push(contact);
        }
      }
      console.log(`[GoogleContacts] Returning ${uniqueContacts.length} unique contacts from cache`);
      return uniqueContacts;
    }

    // Refresh token if needed
    try {
      await this.googleAuth.refreshTokenIfNeeded();
    } catch (error) {
      if (error.code === 'AUTH_REFRESH_FAILED') {
        // Notify user that authentication expired
        this._notifyAuthExpired();
      }
      throw error;
    }

    try {
      console.log('[GoogleContacts] Fetching contacts from Google People API...');
      const allContacts = [];
      let pageToken = null;

      do {
        const response = await this.people.people.connections.list({
          resourceName: 'people/me',
          pageSize: 1000,
          personFields: 'names,emailAddresses,phoneNumbers,organizations,photos',
          pageToken: pageToken,
        });

        const connections = response.data.connections || [];
        allContacts.push(...connections);

        pageToken = response.data.nextPageToken;
        console.log(
          `[GoogleContacts] Fetched ${connections.length} contacts (total: ${allContacts.length})`
        );
      } while (pageToken);

      // Process and cache contacts
      this.contactsCache.clear();
      const processedContacts = [];

      for (const contact of allContacts) {
        const processed = this.processContact(contact);
        if (processed && processed.emails.length > 0) {
          processedContacts.push(processed);

          // Index by email for fast lookup
          for (const email of processed.emails) {
            this.contactsCache.set(email.toLowerCase(), processed);
          }
        }
      }

      this.contactCount = processedContacts.length; // Store actual contact count
      this.lastFetch = Date.now();
      console.log(`[GoogleContacts] Processed ${processedContacts.length} contacts with emails`);
      return processedContacts;
    } catch (error) {
      console.error('[GoogleContacts] Error fetching contacts:', error.message);
      return [];
    }
  }

  /**
   * Process raw contact data into simplified format
   * @param {Object} contact - Raw contact from Google People API
   * @returns {Object} Processed contact
   */
  processContact(contact) {
    try {
      const name = contact.names?.[0]?.displayName || 'Unknown';
      const givenName = contact.names?.[0]?.givenName || '';
      const familyName = contact.names?.[0]?.familyName || '';

      const emails = (contact.emailAddresses || []).map(e => e.value).filter(e => e);

      const phones = (contact.phoneNumbers || []).map(p => p.value).filter(p => p);

      const organization = contact.organizations?.[0]?.name || null;
      const title = contact.organizations?.[0]?.title || null;
      const photoUrl = contact.photos?.[0]?.url || null;

      return {
        resourceName: contact.resourceName,
        name,
        givenName,
        familyName,
        emails,
        phones,
        organization,
        title,
        photoUrl,
      };
    } catch (error) {
      console.error('[GoogleContacts] Error processing contact:', error.message);
      return null;
    }
  }

  /**
   * Find contact by email address
   * @param {string} email - Email address to search
   * @returns {Object|null} Contact info or null if not found
   */
  async findContactByEmail(email) {
    if (!email) return null;

    const normalizedEmail = email.toLowerCase().trim();

    // Check cache first
    if (this.contactsCache.has(normalizedEmail)) {
      return this.contactsCache.get(normalizedEmail);
    }

    // If cache is empty or stale, fetch contacts
    if (this.contactsCache.size === 0 || !this.lastFetch) {
      await this.fetchAllContacts();
      return this.contactsCache.get(normalizedEmail) || null;
    }

    return null;
  }

  /**
   * Find contacts for multiple email addresses
   * @param {Array<string>} emails - Array of email addresses
   * @returns {Map} Map of email -> contact info
   */
  async findContactsByEmails(emails) {
    if (!emails || emails.length === 0) return new Map();

    // Ensure contacts are cached
    if (this.contactsCache.size === 0) {
      await this.fetchAllContacts();
    }

    const results = new Map();
    for (const email of emails) {
      const normalizedEmail = email.toLowerCase().trim();
      const contact = this.contactsCache.get(normalizedEmail);
      if (contact) {
        results.set(email, contact);
      }
    }

    return results;
  }

  /**
   * Find contact by name (searches displayName, givenName, familyName)
   * @param {string} name - Name to search for
   * @param {boolean} exactMatch - If true, requires exact match; if false, uses substring match
   * @returns {Object|null} Best matching contact or null
   */
  async findContactByName(name, exactMatch = false) {
    if (!name) return null;

    // Ensure contacts are cached
    if (this.contactsCache.size === 0) {
      await this.fetchAllContacts();
    }

    const normalizedName = name.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    // Iterate through cached contacts
    for (const contact of this.contactsCache.values()) {
      const contactName = (contact.name || '').toLowerCase();
      const givenName = (contact.givenName || '').toLowerCase();
      const familyName = (contact.familyName || '').toLowerCase();

      if (exactMatch) {
        // Exact match on full name
        if (contactName === normalizedName) {
          return contact;
        }
      } else {
        // Score-based matching
        let score = 0;
        const nameParts = normalizedName.split(' ').filter(p => p.length > 0);
        const sourceHasLastName = nameParts.length > 1;
        const sourceFirstName = nameParts[0];
        const sourceLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

        // Exact full name match is highest
        if (contactName === normalizedName) {
          score = 100;
        }
        // Full name contains search term
        else if (contactName.includes(normalizedName)) {
          score = 80;
        }
        // Search term contains full name (e.g., "J.D. Bruce" contains "JD Bruce")
        else if (normalizedName.includes(contactName)) {
          score = 75;
        }
        // Given name + family name match
        else if (`${givenName} ${familyName}` === normalizedName) {
          score = 90;
        }
        // v1.2.2: Only do first-name matching if source has NO last name
        // This prevents "Tim Peyser" from matching "Tim Rasmussen"
        else if (!sourceHasLastName && givenName === sourceFirstName) {
          score = 50;
        }
        // v1.2.2: If source has both first AND last name, require both to match
        else if (sourceHasLastName && givenName === sourceFirstName && familyName === sourceLastName) {
          score = 85;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = contact;
        }
      }
    }

    // v1.2.2: Raise threshold - require at least score 50 for a match
    if (bestMatch && bestScore >= 50) {
      console.log(
        `[GoogleContacts] Found contact "${bestMatch.name}" for name "${name}" (score: ${bestScore})`
      );
      return bestMatch;
    }

    return null;
  }

  /**
   * Find contacts for multiple names
   * @param {Array<string>} names - Array of names to search
   * @returns {Map<string, Object>} Map of name -> contact info
   */
  async findContactsByNames(names) {
    if (!names || names.length === 0) return new Map();

    // Ensure contacts are cached
    if (this.contactsCache.size === 0) {
      await this.fetchAllContacts();
    }

    const results = new Map();
    for (const name of names) {
      const contact = await this.findContactByName(name, false);
      if (contact) {
        results.set(name, contact);
      }
    }

    console.log(`[GoogleContacts] Matched ${results.size}/${names.length} names to contacts`);
    return results;
  }

  /**
   * Clear cached contacts
   */
  clearCache() {
    this.contactsCache.clear();
    this.contactCount = 0;
    this.lastFetch = null;
    console.log('[GoogleContacts] Cache cleared');
  }

  /**
   * Notify renderer process that Google authentication has expired
   * @private
   */
  _notifyAuthExpired() {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();

      if (windows.length > 0) {
        const mainWindow = windows[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:expired', {
            service: 'Google',
            message:
              'Your Google authentication has expired. Please sign in again to continue using Calendar and Contacts features.',
          });
          console.log('[GoogleContacts] Sent auth:expired notification to renderer');
        }
      }
    } catch (error) {
      console.error('[GoogleContacts] Failed to send auth expiration notification:', error.message);
    }
  }
}

module.exports = GoogleContacts;
