/**
 * Client Service (v1.4)
 *
 * Manages client/organization data sourced from Google Contacts.
 * Replaces routing.yaml as the primary client configuration mechanism.
 *
 * Data flow: Google Contacts (company field) → clients table → routing decisions
 */

const crypto = require('crypto');
const log = require('electron-log');
const databaseService = require('./databaseService');

class ClientService {
  constructor() {
    this.googleContacts = null;
  }

  /**
   * Set the Google Contacts instance for contact discovery.
   * @param {Object} googleContacts
   */
  setGoogleContacts(googleContacts) {
    this.googleContacts = googleContacts;
  }

  /**
   * Check if the client system has any clients configured.
   * @returns {boolean}
   */
  hasClients() {
    const clients = databaseService.getAllClients();
    return clients.length > 0;
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
      type: clientData.type || 'client',
      vaultPath: clientData.vaultPath || null,
      domains: clientData.domains || [],
      status: clientData.status || 'active',
      googleSource: clientData.googleSource || 'manual',
      notes: clientData.notes || null,
    };

    databaseService.saveClient(client);
    log.info(`[ClientService] Created client: ${client.name} (${client.id})`);
    return client;
  }

  updateClient(id, updates) {
    const existing = databaseService.getClient(id);
    if (!existing) throw new Error(`Client not found: ${id}`);

    const updated = { ...existing, ...updates, id };
    databaseService.saveClient(updated);
    log.info(`[ClientService] Updated client: ${id}`);
    return updated;
  }

  deleteClient(id) {
    const result = databaseService.deleteClient(id);
    if (result) {
      log.info(`[ClientService] Deleted client: ${id}`);
    }
    return result;
  }

  // ======================================================================
  // Contact Management
  // ======================================================================

  getClientContacts(clientId) {
    return databaseService.getClientContacts(clientId);
  }

  addContactToClient(clientId, email, name, googleResource) {
    databaseService.addClientContact(clientId, {
      email,
      name: name || null,
      googleContactResource: googleResource || null,
      isPrimary: false,
    });
  }

  removeContactFromClient(clientId, email) {
    return databaseService.removeClientContact(clientId, email);
  }

  // ======================================================================
  // Email Matching (replacement for EmailMatcher)
  // ======================================================================

  /**
   * Match an email to a client via exact contact match or domain match.
   * @param {string} email
   * @returns {Object|null} Client with matchType property
   */
  matchEmailToClient(email) {
    if (!email) return null;
    return databaseService.matchEmailToClient(email);
  }

  // ======================================================================
  // Discovery from Google Contacts
  // ======================================================================

  /**
   * Scan Google Contacts and group by organization field.
   * Returns companies with contact counts and auto-detected domains.
   * @returns {Promise<Array>} Array of discovered companies
   */
  async discoverClientsFromContacts() {
    if (!this.googleContacts || !this.googleContacts.isAuthenticated()) {
      throw new Error('Google Contacts not authenticated');
    }

    const contacts = await this.googleContacts.fetchAllContacts(true);
    const companies = new Map();

    for (const contact of contacts) {
      if (!contact.organization) continue;

      const orgName = contact.organization;
      if (!companies.has(orgName)) {
        companies.set(orgName, {
          name: orgName,
          contacts: [],
          domains: new Set(),
          contactCount: 0,
        });
      }

      const company = companies.get(orgName);
      company.contactCount++;
      company.contacts.push({
        name: contact.name,
        email: contact.emails?.[0] || null,
        resourceName: contact.resourceName,
      });

      // Extract domains from emails
      if (contact.emails) {
        for (const email of contact.emails) {
          const domain = email.split('@')[1];
          if (domain && !this._isGenericDomain(domain)) {
            company.domains.add(domain);
          }
        }
      }
    }

    // Convert to array and check which are already set up
    const existingClients = databaseService.getAllClients();
    const existingNames = new Set(existingClients.map(c => c.name.toLowerCase()));

    return Array.from(companies.values()).map(company => ({
      name: company.name,
      contactCount: company.contactCount,
      contacts: company.contacts.slice(0, 10), // Limit preview
      domains: Array.from(company.domains),
      alreadySetUp: existingNames.has(company.name.toLowerCase()),
      suggestedId: this._generateSlug(company.name),
    })).sort((a, b) => b.contactCount - a.contactCount);
  }

  // ======================================================================
  // Health Check
  // ======================================================================

  /**
   * Run health check on client setup.
   * @returns {Object} Health report
   */
  checkClientSetup() {
    const clients = databaseService.getAllClients();
    const issues = [];

    for (const client of clients) {
      if (!client.vault_path) {
        issues.push({
          clientId: client.id,
          clientName: client.name,
          issue: 'missing_vault_path',
          message: `${client.name} has no vault path configured`,
        });
      }

      if (!client.domains || client.domains.length === 0) {
        const contacts = databaseService.getClientContacts(client.id);
        if (contacts.length === 0) {
          issues.push({
            clientId: client.id,
            clientName: client.name,
            issue: 'no_matching_criteria',
            message: `${client.name} has no domains or contacts for matching`,
          });
        }
      }
    }

    return {
      totalClients: clients.length,
      activeClients: clients.filter(c => c.status === 'active').length,
      issues,
      healthy: issues.length === 0,
    };
  }

  // ======================================================================
  // Sync with Google Contacts
  // ======================================================================

  /**
   * Re-scan Google Contacts and update existing clients with new contacts.
   * @returns {Promise<Object>} Sync results
   */
  async syncWithGoogleContacts() {
    if (!this.googleContacts || !this.googleContacts.isAuthenticated()) {
      throw new Error('Google Contacts not authenticated');
    }

    const contacts = await this.googleContacts.fetchAllContacts(true);
    const clients = databaseService.getAllClients();
    const clientsByName = new Map(clients.map(c => [c.name.toLowerCase(), c]));

    let newContacts = 0;
    let newCompanies = 0;

    for (const contact of contacts) {
      if (!contact.organization) continue;
      const client = clientsByName.get(contact.organization.toLowerCase());
      if (!client) {
        newCompanies++;
        continue;
      }

      // Add contact if not already linked
      const email = contact.emails?.[0];
      if (email) {
        const existing = databaseService.getClientContacts(client.id);
        if (!existing.some(c => c.email.toLowerCase() === email.toLowerCase())) {
          databaseService.addClientContact(client.id, {
            email,
            name: contact.name,
            googleContactResource: contact.resourceName,
          });
          newContacts++;
        }
      }
    }

    log.info(`[ClientService] Sync complete: ${newContacts} new contacts, ${newCompanies} new companies found`);
    return { newContacts, newCompanies };
  }

  // ======================================================================
  // Migration from routing.yaml
  // ======================================================================

  /**
   * One-time import of routing.yaml data into the clients DB.
   * @param {Object} routingConfig - Parsed routing.yaml config
   * @returns {{ imported: number, skipped: number }}
   */
  migrateFromRoutingYaml(routingConfig) {
    let imported = 0;
    let skipped = 0;

    const processOrg = (type, orgs) => {
      if (!orgs) return;
      for (const [slug, config] of Object.entries(orgs)) {
        // Skip if already exists
        if (databaseService.getClient(slug)) {
          skipped++;
          continue;
        }

        const client = {
          id: slug,
          name: config.name || slug,
          type: type,
          vaultPath: config.vault_path || config.vaultPath || null,
          domains: [],
          status: 'active',
          googleSource: 'routing_yaml',
          notes: `Migrated from routing.yaml`,
        };

        // Extract domains from email patterns
        if (config.emails) {
          const domainSet = new Set();
          for (const email of config.emails) {
            const domain = email.split('@')[1];
            if (domain) domainSet.add(domain);
          }
          client.domains = Array.from(domainSet);
        }

        databaseService.saveClient(client);

        // Add contacts
        if (config.contacts) {
          for (const contactEmail of config.contacts) {
            databaseService.addClientContact(slug, { email: contactEmail });
          }
        }
        if (config.emails) {
          for (const email of config.emails) {
            databaseService.addClientContact(slug, { email });
          }
        }

        imported++;
      }
    };

    processOrg('client', routingConfig.clients);
    processOrg('industry', routingConfig.industry);

    log.info(`[ClientService] Migration complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
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

  _isGenericDomain(domain) {
    const generic = new Set([
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
      'live.com', 'msn.com', 'ymail.com', 'zoho.com',
    ]);
    return generic.has(domain.toLowerCase());
  }
}

// Singleton
const clientService = new ClientService();
module.exports = clientService;
