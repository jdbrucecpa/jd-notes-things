const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');

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
  constructor(tokenPath = null, keyManagementService = null) {
    this.tokenPath = tokenPath || path.join(app.getPath('userData'), 'google-token.json');
    this.keyManagementService = keyManagementService;
    this.oauth2Client = null;
    this.initialized = false;
    this.pendingState = null; // CSRF protection: stores expected state parameter

    // Combined scopes for Calendar, Contacts, and User Profile
    // Phase 6: Added userinfo.email for reliable user identification
    this.scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/userinfo.email', // Required for current user identification
    ];
  }

  /**
   * Initialize the OAuth2 client with credentials from Windows Credential Manager or .env
   * Attempts to load existing token if available
   *
   * @returns {Promise<boolean>} True if token exists and is valid, false otherwise
   */
  async initialize() {
    if (this.initialized) {
      return this.isAuthenticated();
    }

    // Try to get credentials from keyManagementService first, then fall back to .env
    let clientId, clientSecret;

    if (this.keyManagementService) {
      try {
        clientId = await this.keyManagementService.getKey('GOOGLE_CALENDAR_CLIENT_ID');
        clientSecret = await this.keyManagementService.getKey('GOOGLE_CALENDAR_CLIENT_SECRET');
      } catch (error) {
        console.warn('[GoogleAuth] Failed to read from Windows Credential Manager:', error.message);
      }
    }

    // Fall back to process.env if not found in Credential Manager
    clientId = clientId || process.env.GOOGLE_CALENDAR_CLIENT_ID;
    clientSecret = clientSecret || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const redirectUri = 'http://localhost:3000/oauth2callback';

    if (!clientId || !clientSecret) {
      console.error(
        '[GoogleAuth] Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET',
        'Please configure in Settings or add to Windows Credential Manager'
      );
      return false;
    }

    console.log(
      '[GoogleAuth] Loaded credentials from:',
      this.keyManagementService ? 'Windows Credential Manager' : '.env file'
    );
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

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
   * Save token to disk with secure file permissions
   *
   * @param {Object} token - OAuth2 token object
   */
  async saveToken(token) {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.tokenPath);
      await fs.mkdir(dir, { recursive: true });

      // Write token file
      await fs.writeFile(this.tokenPath, JSON.stringify(token, null, 2));

      // Set restrictive file permissions
      if (process.platform !== 'win32') {
        // Unix/Linux/Mac: Set to 0o600 (owner read/write only)
        await fs.chmod(this.tokenPath, 0o600);
        console.log('[GoogleAuth] Token saved with 0o600 permissions');
      } else {
        // Windows: Use icacls to restrict access to current user only
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);

          const username = process.env.USERNAME || process.env.USER;
          if (!username) {
            // Delete token file if we can't secure it
            await fs.unlink(this.tokenPath).catch(() => {});
            throw new Error(
              '[GoogleAuth Security] Cannot determine current username - unable to secure token file'
            );
          }

          // Remove inheritance and grant full control to current user only
          const { stdout: _stdout, stderr } = await execAsync(
            `icacls "${this.tokenPath}" /inheritance:r /grant:r "${username}:F"`
          );

          // Verify the command succeeded
          if (stderr && stderr.toLowerCase().includes('error')) {
            throw new Error(`icacls failed: ${stderr}`);
          }

          // Verify permissions were actually set by reading them back
          const { stdout: verifyOutput } = await execAsync(`icacls "${this.tokenPath}"`);
          if (!verifyOutput.includes(username)) {
            throw new Error('Failed to verify token file permissions were set correctly');
          }

          console.log('[GoogleAuth Security] Token saved with restricted permissions (Windows)');
        } catch (err) {
          // Delete the insecurely-created token file
          await fs.unlink(this.tokenPath).catch(() => {});
          console.error(
            '[GoogleAuth Security] Failed to secure token file, deleted for safety:',
            err.message
          );
          throw new Error(`Failed to secure token file: ${err.message}`);
        }
      }

      console.log('[GoogleAuth] Token saved to:', this.tokenPath);
    } catch (error) {
      console.error('[GoogleAuth] Error saving token:', error.message);
      throw error;
    }
  }

  /**
   * Generate OAuth2 authorization URL with CSRF protection
   *
   * @returns {string} Authorization URL for user to visit
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('[GoogleAuth] OAuth2 client not initialized. Call initialize() first.');
    }

    // Generate random state parameter for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    this.pendingState = state;
    console.log('[GoogleAuth Security] Generated OAuth state parameter for CSRF protection');

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.scopes,
      prompt: 'consent', // Force consent screen to ensure refresh token
      state: state, // CSRF protection
    });
  }

  /**
   * Validate OAuth state parameter for CSRF protection
   *
   * @param {string} receivedState - State parameter from OAuth callback
   * @throws {Error} If state validation fails
   */
  validateState(receivedState) {
    if (!this.pendingState) {
      throw new Error('[GoogleAuth Security] No pending OAuth state found. Possible CSRF attack.');
    }

    if (receivedState !== this.pendingState) {
      this.pendingState = null; // Clear invalid state
      throw new Error('[GoogleAuth Security] OAuth state mismatch. Possible CSRF attack.');
    }

    console.log('[GoogleAuth Security] OAuth state validated successfully');
    this.pendingState = null; // Clear used state
  }

  /**
   * Exchange authorization code for access token (with CSRF protection)
   *
   * @param {string} code - Authorization code from OAuth callback
   * @param {string} state - State parameter from OAuth callback (for CSRF validation)
   * @returns {Promise<Object>} Token object
   * @throws {Error} If state validation fails
   */
  async getTokenFromCode(code, state = null) {
    if (!this.oauth2Client) {
      throw new Error('[GoogleAuth] OAuth2 client not initialized. Call initialize() first.');
    }

    // SECURITY: State parameter is REQUIRED for CSRF protection
    // Do not allow authentication without state validation
    if (!state) {
      throw new Error('[GoogleAuth Security] CSRF protection failed: State parameter is required.');
    }

    // Validate state parameter matches expected value
    this.validateState(state);

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
    return !!(credentials && (credentials.access_token || credentials.refresh_token));
  }

  /**
   * Validate that stored tokens actually work by making a test API call.
   * This catches stale tokens from previous installations.
   *
   * @returns {Promise<boolean>} True if tokens are valid, false otherwise
   */
  async validateTokens() {
    if (!this.oauth2Client || !this.isAuthenticated()) {
      return false;
    }

    try {
      // Try to refresh the token - this validates the refresh_token works
      await this.refreshTokenIfNeeded();

      // Make a lightweight API call to validate the access token
      // Using tokeninfo endpoint which doesn't count against quota
      const credentials = this.oauth2Client.credentials;
      if (credentials.access_token) {
        const response = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${credentials.access_token}`
        );

        if (!response.ok) {
          console.log('[GoogleAuth] Token validation failed - token rejected by Google');
          return false;
        }

        const tokenInfo = await response.json();
        console.log(
          '[GoogleAuth] Token validated successfully, expires in:',
          tokenInfo.expires_in,
          'seconds'
        );
        return true;
      }

      return false;
    } catch (error) {
      console.log('[GoogleAuth] Token validation failed:', error.message);
      return false;
    }
  }

  /**
   * Initialize and validate authentication state.
   * Clears invalid tokens to ensure accurate "connected" status.
   *
   * @returns {Promise<boolean>} True if authenticated with valid tokens
   */
  async initializeAndValidate() {
    const initialized = await this.initialize();

    if (!initialized) {
      return false;
    }

    // If we loaded a token, validate it actually works
    if (this.isAuthenticated()) {
      console.log('[GoogleAuth] Validating stored tokens...');
      const isValid = await this.validateTokens();

      if (!isValid) {
        console.log('[GoogleAuth] Stored tokens are invalid - clearing auth state');
        await this.clearInvalidTokens();
        return false;
      }

      console.log('[GoogleAuth] Authentication validated successfully');
      return true;
    }

    return false;
  }

  /**
   * Clear invalid tokens without revoking (tokens may already be invalid)
   */
  async clearInvalidTokens() {
    // Delete local token file
    try {
      await fs.unlink(this.tokenPath);
      console.log('[GoogleAuth] Deleted invalid token file');
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
   * Includes recovery mechanism for refresh failures
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
        console.log('[GoogleAuth] Access token refreshed successfully');
      } catch (error) {
        console.error('[GoogleAuth] Error refreshing token:', error.message);

        // Token refresh failed - clear broken credentials and notify user
        this.oauth2Client.setCredentials({});
        this.initialized = false;

        // Delete token file
        try {
          await fs.unlink(this.tokenPath);
          console.log('[GoogleAuth] Deleted invalid token file');
        } catch {
          // File may not exist, ignore
        }

        // Throw error with clear message for re-authentication
        const authError = new Error('Google authentication expired - please sign in again');
        authError.code = 'AUTH_REFRESH_FAILED';
        throw authError;
      }
    }
  }

  /**
   * Get the authenticated user's profile information (Phase 6)
   * Uses Google People API 'people/me' endpoint
   *
   * Required scope: userinfo.email (for email) or contacts.readonly (for name)
   * API Reference: https://developers.google.com/people/api/rest/v1/people/get
   *
   * @returns {Promise<{email: string, name: string}|null>} User info or null if not available
   */
  async getAuthenticatedUserInfo() {
    if (!this.isAuthenticated()) return null;

    try {
      await this.refreshTokenIfNeeded();
      const people = google.people({ version: 'v1', auth: this.oauth2Client });

      const response = await people.people.get({
        resourceName: 'people/me',
        personFields: 'names,emailAddresses',
      });

      const result = {
        email: response.data.emailAddresses?.[0]?.value || null,
        name: response.data.names?.[0]?.displayName || null,
      };

      console.log(`[GoogleAuth] User info: ${result.name} <${result.email}>`);
      return result;
    } catch (error) {
      console.error('[GoogleAuth] Failed to get user info:', error.message);
      return null;
    }
  }
}

module.exports = GoogleAuth;
