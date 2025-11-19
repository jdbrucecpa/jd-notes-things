/**
 * EmailMatcher - Matches email addresses to organizations based on routing configuration
 * Phase 2: Routing System
 */

class EmailMatcher {
  constructor(configLoader) {
    this.configLoader = configLoader;
  }

  /**
   * Extract domain from email address
   * @param {string} email - Email address
   * @returns {string} Domain portion of email
   */
  extractDomain(email) {
    if (!email || typeof email !== 'string') {
      return '';
    }
    const parts = email.toLowerCase().split('@');
    return parts.length === 2 ? parts[1] : '';
  }

  /**
   * Normalize email address for matching
   * @param {string} email - Email address
   * @param {boolean} caseSensitive - Whether matching should be case sensitive
   * @returns {string} Normalized email
   */
  normalizeEmail(email, caseSensitive = false) {
    if (!email || typeof email !== 'string') {
      return '';
    }
    return caseSensitive ? email.trim() : email.trim().toLowerCase();
  }

  /**
   * Check if email matches via email override
   * @param {string} email - Email address to check
   * @returns {string|null} Organization slug if matched, null otherwise
   */
  matchEmailOverride(email) {
    const config = this.configLoader.getConfig();
    const settings = config.settings;

    if (!settings.enable_email_overrides) {
      return null;
    }

    const normalizedEmail = this.normalizeEmail(email, settings.case_sensitive_emails);
    const overrides = config.email_overrides || {};

    // Normalize all override keys
    for (const [overrideEmail, orgSlug] of Object.entries(overrides)) {
      const normalizedOverride = this.normalizeEmail(overrideEmail, settings.case_sensitive_emails);
      if (normalizedEmail === normalizedOverride) {
        return { type: 'override', slug: orgSlug };
      }
    }

    return null;
  }

  /**
   * Check if email matches a specific contact in configuration
   * @param {string} email - Email address to check
   * @returns {Object|null} Match result with type and slug, or null
   */
  matchExactContact(email) {
    const config = this.configLoader.getConfig();
    const settings = config.settings;
    const normalizedEmail = this.normalizeEmail(email, settings.case_sensitive_emails);

    // Check clients
    for (const [slug, clientConfig] of Object.entries(config.clients)) {
      const contacts = clientConfig.contacts || [];
      for (const contact of contacts) {
        if (this.normalizeEmail(contact, settings.case_sensitive_emails) === normalizedEmail) {
          return { type: 'client', slug };
        }
      }
    }

    // Check industry
    for (const [slug, industryConfig] of Object.entries(config.industry)) {
      const contacts = industryConfig.contacts || [];
      for (const contact of contacts) {
        if (this.normalizeEmail(contact, settings.case_sensitive_emails) === normalizedEmail) {
          return { type: 'industry', slug };
        }
      }
    }

    return null;
  }

  /**
   * Check if email domain matches an organization
   * @param {string} email - Email address to check
   * @returns {Object|null} Match result with type and slug, or null
   */
  matchDomain(email) {
    const config = this.configLoader.getConfig();
    const domain = this.extractDomain(email);

    if (!domain) {
      return null;
    }

    // Check clients
    for (const [slug, clientConfig] of Object.entries(config.clients)) {
      const domains = clientConfig.emails || [];
      for (const configDomain of domains) {
        if (domain === configDomain.toLowerCase()) {
          return { type: 'client', slug };
        }
      }
    }

    // Check industry
    for (const [slug, industryConfig] of Object.entries(config.industry)) {
      const domains = industryConfig.emails || [];
      for (const configDomain of domains) {
        if (domain === configDomain.toLowerCase()) {
          return { type: 'industry', slug };
        }
      }
    }

    return null;
  }

  /**
   * Check if email is from internal team
   * @param {string} email - Email address to check
   * @returns {boolean} True if internal team member
   */
  matchInternal(email) {
    const config = this.configLoader.getConfig();
    const domain = this.extractDomain(email);

    if (!domain) {
      return false;
    }

    const teamEmails = config.internal.team_emails || [];
    for (const teamDomain of teamEmails) {
      if (domain === teamDomain.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match email using full priority logic
   * Priority: override → exact contact → domain → internal
   * @param {string} email - Email address to match
   * @returns {Object|null} Match result with type and slug, or null if unfiled
   */
  match(email) {
    if (!email || typeof email !== 'string') {
      return null;
    }

    // 1. Email overrides (highest priority)
    const overrideMatch = this.matchEmailOverride(email);
    if (overrideMatch) {
      return overrideMatch;
    }

    // 2. Exact contact email match
    const contactMatch = this.matchExactContact(email);
    if (contactMatch) {
      return contactMatch;
    }

    // 3. Domain match
    const domainMatch = this.matchDomain(email);
    if (domainMatch) {
      return domainMatch;
    }

    // 4. Internal team check
    if (this.matchInternal(email)) {
      return { type: 'internal', slug: null };
    }

    // No match found - will route to unfiled
    return null;
  }

  /**
   * Match multiple participant emails
   * @param {Array<string>} emails - Array of participant email addresses
   * @returns {Object} Match results grouped by organization
   */
  matchMultiple(emails) {
    if (!Array.isArray(emails)) {
      emails = [emails];
    }

    const results = {
      clients: {}, // { slug: [emails] }
      industry: {}, // { slug: [emails] }
      internal: [], // [emails]
      unfiled: [], // [emails]
    };

    for (const email of emails) {
      const match = this.match(email);

      if (!match) {
        // Unfiled
        results.unfiled.push(email);
      } else if (match.type === 'client') {
        if (!results.clients[match.slug]) {
          results.clients[match.slug] = [];
        }
        results.clients[match.slug].push(email);
      } else if (match.type === 'industry') {
        if (!results.industry[match.slug]) {
          results.industry[match.slug] = [];
        }
        results.industry[match.slug].push(email);
      } else if (match.type === 'internal') {
        results.internal.push(email);
      } else if (match.type === 'override') {
        // Override can point to client or industry
        // Determine which by checking if slug exists in clients or industry
        const config = this.configLoader.getConfig();
        if (config.clients[match.slug]) {
          if (!results.clients[match.slug]) {
            results.clients[match.slug] = [];
          }
          results.clients[match.slug].push(email);
        } else if (config.industry[match.slug]) {
          if (!results.industry[match.slug]) {
            results.industry[match.slug] = [];
          }
          results.industry[match.slug].push(email);
        }
      }
    }

    return results;
  }

  /**
   * Determine primary organization for a meeting based on participant count
   * @param {Object} matchResults - Results from matchMultiple()
   * @returns {Object|null} Primary organization with type and slug
   */
  determinePrimary(matchResults) {
    const config = this.configLoader.getConfig();
    const _settings = config.settings; // Reserved for future routing preferences

    let maxCount = 0;
    let primary = null;

    // Count clients
    for (const [slug, emails] of Object.entries(matchResults.clients)) {
      if (emails.length > maxCount) {
        maxCount = emails.length;
        primary = { type: 'client', slug };
      }
    }

    // Count industry
    for (const [slug, emails] of Object.entries(matchResults.industry)) {
      if (emails.length > maxCount) {
        maxCount = emails.length;
        primary = { type: 'industry', slug };
      }
    }

    // If most attendees are internal, it's an internal meeting
    if (matchResults.internal.length > maxCount) {
      return { type: 'internal', slug: null };
    }

    return primary;
  }

  /**
   * Get count of organizations represented in meeting
   * @param {Object} matchResults - Results from matchMultiple()
   * @returns {number} Number of different organizations
   */
  getOrganizationCount(matchResults) {
    let count = 0;

    count += Object.keys(matchResults.clients).length;
    count += Object.keys(matchResults.industry).length;

    if (matchResults.internal.length > 0) {
      count += 1;
    }

    return count;
  }
}

module.exports = EmailMatcher;
