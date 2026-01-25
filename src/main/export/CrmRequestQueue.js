/**
 * CrmRequestQueue - Manages the .crm/requests/ queue for obsidian-crm integration
 * OCRM Integration: Creates JSON request files for the obsidian-crm plugin to process
 */

const fs = require('fs');
const path = require('path');

/**
 * Request types supported by the CRM queue
 */
const REQUEST_TYPES = {
  MEETING: 'meeting',
  CREATE_CONTACT: 'create-contact',
  CREATE_COMPANY: 'create-company',
  UPDATE_CONTACT: 'update-contact',
  UPDATE_COMPANY: 'update-company',
};

class CrmRequestQueue {
  /**
   * Create a CRM request queue manager
   * @param {string} vaultPath - Base path to the Obsidian vault
   */
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this.requestsFolder = path.join(vaultPath, '.crm', 'requests');
    this.processedFolder = path.join(this.requestsFolder, 'processed');
  }

  /**
   * Ensure the queue folders exist
   * @returns {boolean} True if folders exist or were created
   */
  ensureFolders() {
    try {
      if (!fs.existsSync(this.requestsFolder)) {
        fs.mkdirSync(this.requestsFolder, { recursive: true });
        console.log(`[CrmRequestQueue] Created requests folder: ${this.requestsFolder}`);
      }
      if (!fs.existsSync(this.processedFolder)) {
        fs.mkdirSync(this.processedFolder, { recursive: true });
        console.log(`[CrmRequestQueue] Created processed folder: ${this.processedFolder}`);
      }
      return true;
    } catch (error) {
      console.error('[CrmRequestQueue] Failed to create folders:', error.message);
      return false;
    }
  }

  /**
   * Generate a unique request ID
   * @param {string} type - Request type (e.g., 'meeting', 'create-contact')
   * @param {string} identifier - Human-readable identifier
   * @returns {string} Unique request ID
   */
  generateRequestId(type, identifier = '') {
    const timestamp = Date.now();
    const sanitizedId = identifier
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
    return `${type}-${sanitizedId}-${timestamp}`;
  }

  /**
   * Write a request to the queue
   * @param {string} type - Request type from REQUEST_TYPES
   * @param {string} id - Unique request ID
   * @param {Object} data - Request data
   * @param {Object} options - Additional options
   * @returns {Object} Result with success flag and file path
   */
  async writeRequest(type, id, data, options = {}) {
    try {
      this.ensureFolders();

      const request = {
        type,
        id,
        timestamp: new Date().toISOString(),
        source: 'jdnt',
        version: '1.0',
        ...options,
        data,
      };

      const filename = `${id}.json`;
      const filePath = path.join(this.requestsFolder, filename);

      fs.writeFileSync(filePath, JSON.stringify(request, null, 2), 'utf8');
      console.log(`[CrmRequestQueue] Wrote request: ${filename}`);

      return {
        success: true,
        id,
        filePath,
        request,
      };
    } catch (error) {
      console.error(`[CrmRequestQueue] Failed to write request ${id}:`, error.message);
      return {
        success: false,
        id,
        error: error.message,
      };
    }
  }

  /**
   * Write a meeting request to the queue
   * @param {Object} meeting - Meeting data
   * @param {Object} route - Routing information
   * @param {Array} attendees - Structured attendee array
   * @returns {Object} Result
   */
  async writeMeetingRequest(meeting, route, attendees = []) {
    const id = this.generateRequestId('meeting', meeting.title || meeting.id);

    const data = {
      meeting_id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      platform: meeting.platform,
      route_type: route?.type,
      route_slug: route?.slug,
      vault_path: route?.fullPath,
      attendees: attendees.map(a => ({
        name: a.name,
        email: a.email || null,
        google_contact_id: a.google_contact_id || null,
      })),
    };

    return this.writeRequest(REQUEST_TYPES.MEETING, id, data, {
      source_meeting_id: meeting.id,
    });
  }

  /**
   * Write a contact creation request to the queue
   * @param {Object} contact - Contact data
   * @param {string} sourceMeetingId - ID of the meeting that triggered this
   * @returns {Object} Result
   */
  async writeContactRequest(contact, sourceMeetingId = null) {
    const id = this.generateRequestId('contact', contact.name || contact.email);

    const data = {
      name: contact.name,
      email: contact.email || null,
      organization: contact.organization || null,
      title: contact.title || null,
      google_resource_name: contact.googleContactId || contact.google_contact_id || null,
    };

    const options = {};
    if (sourceMeetingId) {
      options.source_meeting_id = sourceMeetingId;
    }

    return this.writeRequest(REQUEST_TYPES.CREATE_CONTACT, id, data, options);
  }

  /**
   * Write a company creation request to the queue
   * @param {Object} company - Company data
   * @param {string} sourceMeetingId - ID of the meeting that triggered this
   * @returns {Object} Result
   */
  async writeCompanyRequest(company, sourceMeetingId = null) {
    const id = this.generateRequestId('company', company.name);

    const data = {
      name: company.name,
      slug: company.slug || company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      domain: company.domain || null,
      routing_folder: company.routingFolder || null,
    };

    const options = {};
    if (sourceMeetingId) {
      options.source_meeting_id = sourceMeetingId;
    }

    return this.writeRequest(REQUEST_TYPES.CREATE_COMPANY, id, data, options);
  }

  /**
   * Check for acknowledgment of a request
   * @param {string} requestId - Request ID to check
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<Object>} Result with acknowledged flag
   */
  async checkAcknowledgment(requestId, timeoutMs = 5000) {
    const ackFilePath = path.join(this.processedFolder, `${requestId}.ack`);
    const startTime = Date.now();

    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        // Check if ack file exists
        if (fs.existsSync(ackFilePath)) {
          clearInterval(checkInterval);
          try {
            const ackContent = fs.readFileSync(ackFilePath, 'utf8');
            const ackData = JSON.parse(ackContent);
            console.log(`[CrmRequestQueue] Received acknowledgment for: ${requestId}`);
            resolve({
              acknowledged: true,
              data: ackData,
            });
          } catch (e) {
            resolve({
              acknowledged: true,
              data: null,
            });
          }
          return;
        }

        // Check for timeout
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          console.log(`[CrmRequestQueue] Acknowledgment timeout for: ${requestId}`);
          resolve({
            acknowledged: false,
            timedOut: true,
          });
        }
      }, 100); // Check every 100ms
    });
  }

  /**
   * Clean up old processed requests
   * @param {number} maxAgeMs - Maximum age of files to keep (default: 7 days)
   * @returns {number} Number of files cleaned up
   */
  cleanupProcessedRequests(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    try {
      if (!fs.existsSync(this.processedFolder)) return 0;

      const files = fs.readdirSync(this.processedFolder);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.processedFolder, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[CrmRequestQueue] Cleaned up ${cleaned} old processed requests`);
      }

      return cleaned;
    } catch (error) {
      console.error('[CrmRequestQueue] Cleanup failed:', error.message);
      return 0;
    }
  }

  /**
   * Get pending request count
   * @returns {number} Number of pending requests
   */
  getPendingCount() {
    try {
      if (!fs.existsSync(this.requestsFolder)) return 0;

      const files = fs.readdirSync(this.requestsFolder);
      return files.filter(f => f.endsWith('.json')).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * List pending requests
   * @returns {Array} Array of pending request objects
   */
  listPendingRequests() {
    try {
      if (!fs.existsSync(this.requestsFolder)) return [];

      const files = fs.readdirSync(this.requestsFolder);
      const requests = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(this.requestsFolder, file);
          const content = fs.readFileSync(filePath, 'utf8');
          requests.push(JSON.parse(content));
        } catch (e) {
          // Skip invalid files
        }
      }

      return requests;
    } catch (error) {
      console.error('[CrmRequestQueue] Failed to list requests:', error.message);
      return [];
    }
  }
}

module.exports = {
  CrmRequestQueue,
  REQUEST_TYPES,
};
