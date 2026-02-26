/**
 * Gmail Integration (v1.3.0)
 *
 * Read-only Gmail API client for fetching email thread snippets.
 * Uses shared GoogleAuth (no separate auth flow).
 *
 * Features:
 * - Search threads by contact email
 * - Fetch thread metadata (subject, snippet, date, participants)
 * - Generate direct Gmail web links
 *
 * Data is fetched on-demand and NOT cached locally.
 * Requires scope: gmail.readonly
 */

const { google } = require('googleapis');

class Gmail {
  /**
   * @param {GoogleAuth} googleAuth - Shared Google authentication instance
   */
  constructor(googleAuth) {
    if (!googleAuth) {
      throw new Error('[Gmail] GoogleAuth instance is required');
    }
    this.googleAuth = googleAuth;
    this.gmail = null;
  }

  /**
   * Initialize the Gmail API client.
   * @returns {boolean}
   */
  initialize() {
    if (!this.googleAuth.isAuthenticated()) {
      console.log('[Gmail] Not authenticated');
      return false;
    }

    try {
      const auth = this.googleAuth.getClient();
      this.gmail = google.gmail({ version: 'v1', auth });
      console.log('[Gmail] Initialized');
      return true;
    } catch (error) {
      console.error('[Gmail] Initialization error:', error.message);
      return false;
    }
  }

  /**
   * Check if Gmail is ready.
   * @returns {boolean}
   */
  isAuthenticated() {
    return this.googleAuth.isAuthenticated() && this.gmail !== null;
  }

  /**
   * Search for email threads involving a specific contact.
   * @param {string} email - Contact email address
   * @param {number} [maxResults=10] - Maximum threads to return
   * @returns {Promise<Array>} Array of thread snippet objects
   */
  async getThreadsByContact(email, maxResults = 10) {
    if (!this.isAuthenticated()) {
      if (!this.initialize()) {
        throw new Error('Gmail not authenticated');
      }
    }

    await this.googleAuth.refreshTokenIfNeeded();

    const query = `from:${email} OR to:${email}`;
    console.log(`[Gmail] Searching threads: "${query}" (max: ${maxResults})`);

    const listResponse = await this.gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const threads = listResponse.data.threads || [];
    if (threads.length === 0) {
      return [];
    }

    // Fetch metadata for each thread
    const results = await Promise.all(
      threads.map(t => this._getThreadSnippet(t.id))
    );

    return results.filter(Boolean);
  }

  /**
   * Fetch snippet metadata for a single thread.
   * @param {string} threadId
   * @returns {Promise<Object|null>}
   */
  async _getThreadSnippet(threadId) {
    try {
      const response = await this.gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      });

      const thread = response.data;
      const messages = thread.messages || [];
      if (messages.length === 0) return null;

      // Get the latest message for date/subject
      const latestMessage = messages[messages.length - 1];
      const headers = latestMessage.payload?.headers || [];

      const getHeader = (name) => {
        const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : null;
      };

      // Collect all participants from all messages
      const participantSet = new Set();
      for (const msg of messages) {
        const msgHeaders = msg.payload?.headers || [];
        for (const h of msgHeaders) {
          if (h.name.toLowerCase() === 'from' || h.name.toLowerCase() === 'to') {
            // Extract email from "Name <email>" format
            const emailMatch = h.value.match(/<([^>]+)>/);
            if (emailMatch) {
              participantSet.add(emailMatch[1].toLowerCase());
            } else if (h.value.includes('@')) {
              participantSet.add(h.value.trim().toLowerCase());
            }
          }
        }
      }

      return {
        threadId: threadId,
        subject: getHeader('Subject') || '(no subject)',
        snippet: thread.snippet || '',
        lastMessageDate: latestMessage.internalDate
          ? new Date(parseInt(latestMessage.internalDate))
          : null,
        messageCount: messages.length,
        gmailLink: this.getGmailLink(threadId),
        participants: Array.from(participantSet),
      };
    } catch (error) {
      console.error(`[Gmail] Failed to get thread ${threadId}:`, error.message);
      return null;
    }
  }

  /**
   * Generate a direct link to a Gmail thread in the web UI.
   * @param {string} threadId
   * @returns {string}
   */
  getGmailLink(threadId) {
    return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
  }
}

module.exports = Gmail;
