/**
 * GoogleContacts - Integrates with Google People API for contact matching
 * Phase 6: Speaker Recognition & Contact Matching
 *
 * Note: Authentication is handled by GoogleAuth module (shared with GoogleCalendar)
 */

const { google } = require('googleapis');

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
    this.contactsCache = new Map(); // email -> contact info
    this.contactCount = 0; // actual number of unique contacts
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
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
    if (!forceRefresh && this.lastFetch && (Date.now() - this.lastFetch < this.cacheExpiry)) {
      console.log('[GoogleContacts] Using cached contacts');
      return Array.from(this.contactsCache.values());
    }

    // Refresh token if needed
    await this.googleAuth.refreshTokenIfNeeded();

    try {
      console.log('[GoogleContacts] Fetching contacts from Google People API...');
      const allContacts = [];
      let pageToken = null;

      do {
        const response = await this.people.people.connections.list({
          resourceName: 'people/me',
          pageSize: 1000,
          personFields: 'names,emailAddresses,phoneNumbers,organizations,photos',
          pageToken: pageToken
        });

        const connections = response.data.connections || [];
        allContacts.push(...connections);

        pageToken = response.data.nextPageToken;
        console.log(`[GoogleContacts] Fetched ${connections.length} contacts (total: ${allContacts.length})`);
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

      const emails = (contact.emailAddresses || [])
        .map(e => e.value)
        .filter(e => e);

      const phones = (contact.phoneNumbers || [])
        .map(p => p.value)
        .filter(p => p);

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
        photoUrl
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
   * Clear cached contacts
   */
  clearCache() {
    this.contactsCache.clear();
    this.contactCount = 0;
    this.lastFetch = null;
    console.log('[GoogleContacts] Cache cleared');
  }
}

module.exports = GoogleContacts;
