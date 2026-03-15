/**
 * Client Service (v1.4)
 *
 * Manages company/client configuration for meeting routing.
 * Companies are identified by Google Contacts organization names.
 * Each company can have a vault folder path and a category (Client/Other).
 *
 * Data flow: Google Contacts org → clients table → routing decisions
 */

const crypto = require('crypto');
const log = require('electron-log');
const databaseService = require('./databaseService');

class ClientService {
  constructor() {
    this.googleContacts = null;
  }

  /**
   * Set the Google Contacts instance for company discovery.
   * @param {Object} googleContacts
   */
  setGoogleContacts(googleContacts) {
    this.googleContacts = googleContacts;
  }

  /**
   * Check if any companies have been configured with vault paths.
   * @returns {boolean}
   */
  hasClients() {
    const clients = databaseService.getAllClients();
    return clients.some(c => c.vault_path);
  }

  // ======================================================================
  // CRUD Operations
  // ======================================================================

  getAllClients() {
    return databaseService.getAllClients();
  }

  getClient(id) {
    return databaseService.getClient(id);
  }

  createClient(clientData) {
    const client = {
      id: clientData.id || this._generateSlug(clientData.name),
      name: clientData.name,
      vaultPath: clientData.vaultPath || null,
      category: clientData.category || 'Other',
      status: clientData.status || 'active',
      notes: clientData.notes || null,
    };

    databaseService.saveClient(client);
    log.info(`[ClientService] Created company: ${client.name} (${client.id})`);
    return client;
  }

  updateClient(id, updates) {
    const existing = databaseService.getClient(id);
    if (!existing) throw new Error(`Company not found: ${id}`);

    const updated = { ...existing, ...updates, id };
    databaseService.saveClient(updated);
    log.info(`[ClientService] Updated company: ${id}`);
    return updated;
  }

  deleteClient(id) {
    const result = databaseService.deleteClient(id);
    if (result) {
      log.info(`[ClientService] Deleted company: ${id}`);
    }
    return result;
  }

  // ======================================================================
  // Contact Management
  // ======================================================================

  getClientContacts(clientId) {
    return databaseService.getClientContacts(clientId);
  }

  // ======================================================================
  // Email Matching (used as routing fallback)
  // ======================================================================

  /**
   * Match an email to a company via client_contacts table.
   * @param {string} email
   * @returns {Object|null} Company with matchType property
   */
  matchEmailToClient(email) {
    if (!email) return null;
    return databaseService.matchEmailToClient(email);
  }

  // ======================================================================
  // Company Browsing (for UI)
  // ======================================================================

  /**
   * Get all companies from Google Contacts, enriched with DB data.
   * Falls back to DB-only when Google Contacts is not authenticated.
   * @returns {Promise<Array>} Array of company objects
   */
  async getCompaniesFromContacts() {
    const dbClients = databaseService.getAllClients();
    const dbByName = new Map(dbClients.map(c => [c.name.toLowerCase(), c]));

    // If Google Contacts not available, return DB-only companies
    if (!this.googleContacts || !this.googleContacts.isAuthenticated()) {
      return dbClients.map(c => ({
        name: c.name,
        id: c.id,
        vaultPath: c.vault_path,
        category: c.category || 'Other',
        contactCount: 0,
        inDatabase: true,
      }));
    }

    const contacts = await this.googleContacts.fetchAllContacts(false);
    const companies = new Map();

    for (const contact of contacts) {
      if (!contact.organization) continue;
      const orgName = contact.organization;

      if (!companies.has(orgName)) {
        const dbRecord = dbByName.get(orgName.toLowerCase());
        companies.set(orgName, {
          name: orgName,
          id: dbRecord?.id || null,
          vaultPath: dbRecord?.vault_path || null,
          category: dbRecord?.category || null,
          contactCount: 0,
          inDatabase: !!dbRecord,
        });
      }
      companies.get(orgName).contactCount++;
    }

    // Include DB companies not found in Google Contacts
    for (const client of dbClients) {
      if (!companies.has(client.name)) {
        companies.set(client.name, {
          name: client.name,
          id: client.id,
          vaultPath: client.vault_path,
          category: client.category || 'Other',
          contactCount: 0,
          inDatabase: true,
        });
      }
    }

    return Array.from(companies.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  // ======================================================================
  // Contact Sync (per-company)
  // ======================================================================

  /**
   * Sync a single company's contacts from Google Contacts into client_contacts.
   * @param {string} companyName - Company/organization name
   * @returns {Promise<{added: number}>}
   */
  async syncCompanyContacts(companyName) {
    if (!this.googleContacts || !this.googleContacts.isAuthenticated()) {
      throw new Error('Google Contacts not authenticated');
    }

    const client = databaseService.getAllClients()
      .find(c => c.name.toLowerCase() === companyName.toLowerCase());
    if (!client) throw new Error(`Company not found in database: ${companyName}`);

    const contacts = await this.googleContacts.fetchAllContacts(false);
    const existing = databaseService.getClientContacts(client.id);
    const existingEmails = new Set(existing.map(c => c.email.toLowerCase()));

    let added = 0;
    for (const contact of contacts) {
      if (!contact.organization || contact.organization.toLowerCase() !== companyName.toLowerCase()) continue;
      const email = contact.emails?.[0];
      if (email && !existingEmails.has(email.toLowerCase())) {
        databaseService.addClientContact(client.id, {
          email,
          name: contact.name,
          googleContactResource: contact.resourceName,
        });
        added++;
      }
    }

    log.info(`[ClientService] Synced ${added} contacts for ${companyName}`);
    return { added };
  }

  // ======================================================================
  // Private Helpers
  // ======================================================================

  _generateSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || `client-${crypto.randomUUID().substring(0, 8)}`;
  }
}

// Singleton
const clientService = new ClientService();
module.exports = clientService;
