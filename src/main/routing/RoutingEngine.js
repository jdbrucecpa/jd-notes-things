/**
 * RoutingEngine - Determines where meeting notes should be saved based on participants
 * Phase 2: Routing System
 */

const path = require('path');
const ConfigLoader = require('./ConfigLoader');
const EmailMatcher = require('./EmailMatcher');

class RoutingEngine {
  constructor(configPath = null) {
    this.configLoader = new ConfigLoader(configPath);
    this.configLoader.load();
    this.emailMatcher = new EmailMatcher(this.configLoader);
  }

  /**
   * Route a meeting to appropriate vault location(s)
   * @param {Object} meetingData - Meeting information
   * @param {Array<string>} meetingData.participantEmails - Participant email addresses
   * @param {string} meetingData.meetingTitle - Meeting title
   * @param {Date} meetingData.meetingDate - Meeting date
   * @returns {Object} Routing decision with paths and metadata
   */
  route(meetingData) {
    const { participantEmails, meetingTitle, meetingDate } = meetingData;

    // Match participant emails to organizations
    const matchResults = this.emailMatcher.matchMultiple(participantEmails);
    const orgCount = this.emailMatcher.getOrganizationCount(matchResults);

    const config = this.configLoader.getConfig();
    const settings = config.settings;

    // Build routing decision
    const decision = {
      routes: [],
      matchResults,
      orgCount,
      multiOrg: orgCount > 1,
      settings: {
        duplicate_multi_org: settings.duplicate_multi_org
      }
    };

    // Determine routing based on multi-org settings
    if (orgCount === 0 || matchResults.unfiled.length === participantEmails.length) {
      // All unfiled - route to unfiled path
      decision.routes.push(this._buildRoute('unfiled', null, meetingTitle, meetingDate));
    } else if (orgCount === 1) {
      // Single organization - route to that organization
      decision.routes.push(this._routeSingleOrg(matchResults, meetingTitle, meetingDate));
    } else {
      // Multiple organizations
      decision.routes = this._routeMultiOrg(matchResults, meetingTitle, meetingDate, settings);
    }

    console.log(`[RoutingEngine] Meeting routed to ${decision.routes.length} location(s)`);
    return decision;
  }

  /**
   * Route meeting to a single organization
   * @private
   */
  _routeSingleOrg(matchResults, meetingTitle, meetingDate) {
    // Determine which type (client, industry, or internal)
    if (Object.keys(matchResults.clients).length > 0) {
      const slug = Object.keys(matchResults.clients)[0];
      return this._buildRoute('client', slug, meetingTitle, meetingDate);
    } else if (Object.keys(matchResults.industry).length > 0) {
      const slug = Object.keys(matchResults.industry)[0];
      return this._buildRoute('industry', slug, meetingTitle, meetingDate);
    } else if (matchResults.internal.length > 0) {
      return this._buildRoute('internal', null, meetingTitle, meetingDate);
    }

    // Shouldn't reach here, but fallback to unfiled
    return this._buildRoute('unfiled', null, meetingTitle, meetingDate);
  }

  /**
   * Route meeting with multiple organizations
   * @private
   */
  _routeMultiOrg(matchResults, meetingTitle, meetingDate, settings) {
    const routes = [];

    if (settings.duplicate_multi_org === 'all') {
      // Create duplicate notes in all organization folders
      for (const slug of Object.keys(matchResults.clients)) {
        routes.push(this._buildRoute('client', slug, meetingTitle, meetingDate));
      }
      for (const slug of Object.keys(matchResults.industry)) {
        routes.push(this._buildRoute('industry', slug, meetingTitle, meetingDate));
      }
      if (matchResults.internal.length > 0) {
        routes.push(this._buildRoute('internal', null, meetingTitle, meetingDate));
      }
    } else if (settings.duplicate_multi_org === 'primary') {
      // Route to organization with most attendees
      const primary = this.emailMatcher.determinePrimary(matchResults);
      if (primary) {
        routes.push(this._buildRoute(primary.type, primary.slug, meetingTitle, meetingDate));
      } else {
        routes.push(this._buildRoute('unfiled', null, meetingTitle, meetingDate));
      }
    } else if (settings.duplicate_multi_org === 'unfiled') {
      // Route all multi-org meetings to unfiled
      routes.push(this._buildRoute('unfiled', null, meetingTitle, meetingDate));
    }

    return routes;
  }

  /**
   * Build a route object with path and metadata
   * @private
   */
  _buildRoute(type, slug, meetingTitle, meetingDate) {
    const config = this.configLoader.getConfig();
    const date = meetingDate ? new Date(meetingDate) : new Date();
    const dateStr = this._formatDate(date);
    const titleSlug = this._slugify(meetingTitle || 'untitled-meeting');
    const folderName = `${dateStr}-${titleSlug}`;

    let basePath;
    if (type === 'client') {
      const clientConfig = config.clients[slug];
      basePath = clientConfig.vault_path;
    } else if (type === 'industry') {
      const industryConfig = config.industry[slug];
      basePath = industryConfig.vault_path;
    } else if (type === 'internal') {
      basePath = config.internal.vault_path;
    } else {
      // Unfiled - organize by year-month
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      basePath = path.join(config.settings.unfiled_path, yearMonth);
    }

    const fullPath = path.join(basePath, 'meetings', folderName);

    return {
      type,
      slug,
      basePath,
      folderName,
      fullPath,
      dateStr,
      titleSlug
    };
  }

  /**
   * Format date as YYYY-MM-DD
   * @private
   */
  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Convert string to URL-friendly slug
   * @private
   */
  _slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')  // Remove non-word chars (except spaces and hyphens)
      .replace(/[\s_-]+/g, '-')  // Replace spaces, underscores, and multiple hyphens with single hyphen
      .replace(/^-+|-+$/g, '')   // Remove leading/trailing hyphens
      .substring(0, 50);         // Limit length
  }

  /**
   * Test routing with sample participant emails
   * Useful for validating routing configuration
   * @param {Array<string>} emails - Test email addresses
   * @returns {Object} Routing decision
   */
  testRoute(emails) {
    const testMeeting = {
      participantEmails: emails,
      meetingTitle: 'Test Meeting',
      meetingDate: new Date()
    };

    const decision = this.route(testMeeting);

    console.log('[RoutingEngine] Test routing results:');
    console.log(`  Participant Emails: ${emails.join(', ')}`);
    console.log(`  Organizations Matched: ${decision.orgCount}`);
    console.log(`  Routes Generated: ${decision.routes.length}`);
    decision.routes.forEach((route, index) => {
      console.log(`  Route ${index + 1}: ${route.type}${route.slug ? ` (${route.slug})` : ''} -> ${route.fullPath}`);
    });

    return decision;
  }

  /**
   * Get routing decision summary for UI display
   * @param {Object} decision - Routing decision from route()
   * @returns {Object} Simplified summary for display
   */
  getRoutingSummary(decision) {
    const summary = {
      totalRoutes: decision.routes.length,
      isMultiOrg: decision.multiOrg,
      routes: decision.routes.map(route => ({
        type: route.type,
        slug: route.slug,
        path: route.fullPath,
        displayName: this._getDisplayName(route.type, route.slug)
      })),
      participantBreakdown: {
        clients: Object.keys(decision.matchResults.clients),
        industry: Object.keys(decision.matchResults.industry),
        internal: decision.matchResults.internal.length,
        unfiled: decision.matchResults.unfiled.length
      }
    };

    return summary;
  }

  /**
   * Get human-readable display name for route
   * @private
   */
  _getDisplayName(type, slug) {
    if (type === 'client') {
      return slug.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    } else if (type === 'industry') {
      return slug.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    } else if (type === 'internal') {
      return 'Internal Team';
    } else {
      return 'Unfiled';
    }
  }

  /**
   * Reload routing configuration
   */
  reloadConfig() {
    this.configLoader.reload();
    console.log('[RoutingEngine] Configuration reloaded');
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return this.configLoader.getConfig();
  }
}

module.exports = RoutingEngine;
