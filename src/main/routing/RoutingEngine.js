/**
 * RoutingEngine - Determines where meeting notes should be saved based on participants
 *
 * v1.4: Routes via participant organization fields matched against the clients DB table.
 * Falls back to client_contacts email matching. No longer reads routing.yaml.
 */

const path = require('path');
const databaseService = require('../services/databaseService');

class RoutingEngine {
  constructor(settingsProvider = null) {
    this._settingsProvider = settingsProvider;
    this._clientService = null;
  }

  /**
   * Set the settings provider function (for lazy initialization)
   * @param {Function} provider - Function that returns app settings
   */
  setSettingsProvider(provider) {
    this._settingsProvider = provider;
  }

  /**
   * Set the client service for email-based routing fallback.
   * @param {Object} clientService
   */
  setClientService(clientService) {
    this._clientService = clientService;
  }

  /**
   * Route a meeting to appropriate vault location(s).
   *
   * @param {Object} meetingData
   * @param {Array<string>} meetingData.participantEmails - Participant email addresses
   * @param {string} meetingData.meetingTitle - Meeting title
   * @param {Date} meetingData.meetingDate - Meeting date
   * @param {Array<Object>} [meetingData.participants] - Full participant objects with organization field
   * @returns {Object} Routing decision with routes array
   */
  route(meetingData) {
    const { participantEmails = [], meetingTitle, meetingDate, participants = [] } = meetingData;

    const date = meetingDate ? new Date(meetingDate) : new Date();
    const dateStr = this._formatDate(date);
    const titleSlug = this._slugify(meetingTitle || 'untitled-meeting');
    const folderName = `${dateStr}-${titleSlug}`;

    const routes = [];
    const matchedCompanies = new Set();
    const routedClientIds = [];

    // Primary: match via participant organization field → clients DB
    for (const participant of participants) {
      const org = participant.organization;
      if (!org || matchedCompanies.has(org.toLowerCase())) continue;

      const company = databaseService.matchOrganizationToCompany(org);
      if (company && company.vault_path) {
        matchedCompanies.add(org.toLowerCase());
        routedClientIds.push(company.id);
        routes.push(this._buildRouteFromCompany(company, folderName, dateStr, titleSlug));
      }
    }

    // Fallback: match via client_contacts table (email-based)
    if (routes.length === 0 && this._clientService) {
      for (const email of participantEmails) {
        const match = this._clientService.matchEmailToClient(email);
        if (match && match.vault_path && !matchedCompanies.has(match.name.toLowerCase())) {
          matchedCompanies.add(match.name.toLowerCase());
          routedClientIds.push(match.id);
          routes.push(this._buildRouteFromCompany(match, folderName, dateStr, titleSlug));
        }
      }
    }

    // No match → unfiled
    if (routes.length === 0) {
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      routes.push({
        type: 'unfiled',
        slug: null,
        basePath: path.join('_unfiled', yearMonth, 'meetings'),
        fullPath: path.join('_unfiled', yearMonth, 'meetings', folderName),
        folderName,
        dateStr,
        titleSlug,
      });
    }

    console.log(`[RoutingEngine] Meeting routed to ${routes.length} location(s)`);

    return {
      routes,
      routedClientIds: routedClientIds.length > 0 ? routedClientIds : undefined,
      orgCount: matchedCompanies.size,
      multiOrg: matchedCompanies.size > 1,
      // Legacy compat fields
      matchResults: { clients: {}, industry: {}, internal: [], unfiled: [] },
      settings: { duplicate_multi_org: 'all' },
    };
  }

  /**
   * Build a route from a company DB record.
   * @private
   */
  _buildRouteFromCompany(company, folderName, dateStr, titleSlug) {
    // vault_path is an absolute folder path — write directly there
    const basePath = company.vault_path;

    return {
      type: 'client',
      slug: company.id,
      basePath,
      fullPath: path.join(basePath, folderName),
      isAbsolutePath: true,
      folderName,
      dateStr,
      titleSlug,
      organizationName: company.name,
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
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  /**
   * Get routing decision summary for UI display
   * @param {Object} decision - Routing decision from route()
   * @returns {Object} Simplified summary for display
   */
  getRoutingSummary(decision) {
    return {
      totalRoutes: decision.routes.length,
      isMultiOrg: decision.multiOrg,
      routes: decision.routes.map(route => ({
        type: route.type,
        slug: route.slug,
        path: route.fullPath,
        displayName: route.organizationName || route.slug || 'Unfiled',
      })),
    };
  }

  /**
   * Get all configured destinations for UI pickers.
   * @returns {Object} destinations grouped by type
   */
  /**
   * Stub: getConfig() no longer reads yaml. Returns minimal compat structure.
   * Will be removed once all callers are updated.
   */
  getConfig() {
    return { clients: {}, industry: {}, internal: { vault_path: 'internal' }, settings: { unfiled_path: '_unfiled', duplicate_multi_org: 'all' } };
  }

  /**
   * Stub: reloadConfig() is a no-op since we no longer use yaml.
   */
  reloadConfig() {
    // No-op: routing is now DB-driven
  }

  /**
   * Test routing with sample emails (for routing preview IPC handler).
   */
  testRoute(emails) {
    return this.route({
      participantEmails: emails,
      participants: [],
      meetingTitle: 'Test Meeting',
      meetingDate: new Date(),
    });
  }

  getDestinations() {
    const clients = databaseService.getAllClients().filter(c => c.vault_path && c.status === 'active');
    return {
      destinations: clients.map(c => ({
        type: c.category === 'Client' ? 'client' : 'other',
        id: c.id,
        name: c.name,
        vaultPath: c.vault_path,
      })),
    };
  }
}

module.exports = RoutingEngine;
