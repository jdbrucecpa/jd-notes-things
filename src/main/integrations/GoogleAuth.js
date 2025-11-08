const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

/**
 * Shared Google OAuth2 authentication for Calendar and Contacts APIs
 *
 * This module provides a single OAuth flow requesting both scopes:
 * - calendar.readonly (for Google Calendar integration)
 * - contacts.readonly (for Google Contacts / People API integration)
 *
 * Benefits:
 * - Single authentication flow for user
 * - Shared token file (google-token.json)
 * - Consistent OAuth2 client for all Google services
 */
class GoogleAuth {
  constructor(tokenPath = null) {
    this.tokenPath = tokenPath || path.join(app.getPath('userData'), 'google-token.json');
    this.oauth2Client = null;
    this.initialized = false;

    // Combined scopes for both Calendar and Contacts
    this.scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/contacts.readonly'
    ];
  }

  /**
   * Initialize the OAuth2 client with credentials from environment variables
   * Attempts to load existing token if available
   *
   * @returns {Promise<boolean>} True if token exists and is valid, false otherwise
   */
  async initialize() {
    if (this.initialized) {
      return this.isAuthenticated();
    }

    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const redirectUri = 'http://localhost:3000/oauth2callback';

    if (!clientId || !clientSecret) {
      console.error('[GoogleAuth] Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET in .env');
      return false;
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    this.initialized = true;

    // Try to load existing token
    const tokenLoaded = await this.loadToken();
    if (tokenLoaded) {
      console.log('[GoogleAuth] Initialized with existing token');
      return true;
    } else {
      console.log('[GoogleAuth] No token found - user needs to authenticate');
      return false;
    }
  }

  /**
   * Load token from disk if it exists
   *
   * @returns {Promise<boolean>} True if token loaded successfully, false otherwise
   */
  async loadToken() {
    try {
      const tokenData = await fs.readFile(this.tokenPath, 'utf-8');
      const token = JSON.parse(tokenData);
      this.oauth2Client.setCredentials(token);
      console.log('[GoogleAuth] Token loaded from:', this.tokenPath);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[GoogleAuth] Error loading token:', error.message);
      }
      return false;
    }
  }

  /**
   * Save token to disk
   *
   * @param {Object} token - OAuth2 token object
   */
  async saveToken(token) {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.tokenPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(this.tokenPath, JSON.stringify(token, null, 2));
      console.log('[GoogleAuth] Token saved to:', this.tokenPath);
    } catch (error) {
      console.error('[GoogleAuth] Error saving token:', error.message);
      throw error;
    }
  }

  /**
   * Generate OAuth2 authorization URL
   *
   * @returns {string} Authorization URL for user to visit
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('[GoogleAuth] OAuth2 client not initialized. Call initialize() first.');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.scopes,
      prompt: 'consent' // Force consent screen to ensure refresh token
    });
  }

  /**
   * Exchange authorization code for access token
   *
   * @param {string} code - Authorization code from OAuth callback
   * @returns {Promise<Object>} Token object
   */
  async getTokenFromCode(code) {
    if (!this.oauth2Client) {
      throw new Error('[GoogleAuth] OAuth2 client not initialized. Call initialize() first.');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(tokens);
    console.log('[GoogleAuth] Authentication successful');
    return tokens;
  }

  /**
   * Check if user is authenticated (has valid token)
   *
   * @returns {boolean} True if authenticated, false otherwise
   */
  isAuthenticated() {
    if (!this.oauth2Client) {
      return false;
    }

    const credentials = this.oauth2Client.credentials;
    return credentials && (credentials.access_token || credentials.refresh_token);
  }

  /**
   * Get the authenticated OAuth2 client for use with Google APIs
   *
   * @returns {OAuth2Client} Authenticated OAuth2 client
   * @throws {Error} If not authenticated
   */
  getClient() {
    if (!this.isAuthenticated()) {
      throw new Error('[GoogleAuth] Not authenticated. Please authenticate first.');
    }
    return this.oauth2Client;
  }

  /**
   * Revoke authentication (delete token)
   *
   * @returns {Promise<void>}
   */
  async revokeAuthentication() {
    try {
      // Revoke token with Google
      if (this.oauth2Client && this.isAuthenticated()) {
        await this.oauth2Client.revokeCredentials();
      }
    } catch (error) {
      console.error('[GoogleAuth] Error revoking credentials:', error.message);
    }

    // Delete local token file
    try {
      await fs.unlink(this.tokenPath);
      console.log('[GoogleAuth] Token deleted');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[GoogleAuth] Error deleting token:', error.message);
      }
    }

    // Reset OAuth2 client credentials
    if (this.oauth2Client) {
      this.oauth2Client.setCredentials({});
    }
  }

  /**
   * Refresh access token if expired
   *
   * @returns {Promise<void>}
   */
  async refreshTokenIfNeeded() {
    if (!this.oauth2Client || !this.isAuthenticated()) {
      return;
    }

    const credentials = this.oauth2Client.credentials;
    const now = Date.now();

    // Check if token is expired or will expire in the next 5 minutes
    if (credentials.expiry_date && credentials.expiry_date - now < 5 * 60 * 1000) {
      try {
        console.log('[GoogleAuth] Refreshing access token...');
        const { credentials: newCredentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(newCredentials);
        await this.saveToken(newCredentials);
        console.log('[GoogleAuth] Access token refreshed');
      } catch (error) {
        console.error('[GoogleAuth] Error refreshing token:', error.message);
        throw error;
      }
    }
  }
}

module.exports = GoogleAuth;
