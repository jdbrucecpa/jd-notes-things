const { google } = require('googleapis');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

// Try to import electron app, but handle gracefully if not in Electron context
let app;
try {
  app = require('electron').app;
} catch (e) {
  // Not in Electron context, use fallback
  app = null;
}

/**
 * GoogleCalendar Integration
 *
 * Handles OAuth 2.0 authentication and calendar event fetching for Google Calendar.
 *
 * Features:
 * - OAuth 2.0 authentication flow
 * - Fetch upcoming meetings (next 24 hours)
 * - Extract meeting metadata (title, participants, platform)
 * - Detect meeting platforms (Zoom, Teams, Google Meet)
 * - Token persistence and refresh
 */
class GoogleCalendar {
  constructor() {
    this.oauth2Client = null;
    this.calendar = null;

    // Determine storage path based on context (Electron vs Node.js)
    const storagePath = app
      ? app.getPath('userData')
      : path.join(os.homedir(), '.jd-notes-things');

    this.tokenPath = path.join(storagePath, 'google-calendar-token.json');
    this.credentialsPath = path.join(storagePath, 'google-calendar-credentials.json');

    console.log('[GoogleCalendar] Token path:', this.tokenPath);

    // OAuth scopes - read-only calendar access
    this.scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
  }

  /**
   * Initialize OAuth2 client with credentials
   * @param {Object} credentials - OAuth2 client credentials (client_id, client_secret, redirect_uri)
   */
  async initialize(credentials) {
    if (!credentials || !credentials.client_id || !credentials.client_secret) {
      throw new Error('Invalid credentials: client_id and client_secret are required');
    }

    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri || 'http://localhost:3000/oauth2callback'
    );

    // Try to load existing token
    try {
      const token = await this.loadToken();
      this.oauth2Client.setCredentials(token);
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      console.log('[GoogleCalendar] Initialized with existing token');
      return true;
    } catch (error) {
      console.log('[GoogleCalendar] No valid token found, authentication required');
      return false;
    }
  }

  /**
   * Get OAuth authorization URL
   * @returns {string} Authorization URL for user to grant access
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized. Call initialize() first.');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.scopes,
      prompt: 'consent' // Force consent screen to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code from OAuth callback
   */
  async authenticate(code) {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized. Call initialize() first.');
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      await this.saveToken(tokens);

      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      console.log('[GoogleCalendar] Authentication successful');
      return true;
    } catch (error) {
      console.error('[GoogleCalendar] Authentication error:', error);
      throw new Error(`Failed to authenticate: ${error.message}`);
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated
   */
  isAuthenticated() {
    return this.oauth2Client && this.calendar !== null;
  }

  /**
   * Sign out and clear stored token
   */
  async signOut() {
    try {
      await fs.unlink(this.tokenPath);
      this.oauth2Client = null;
      this.calendar = null;
      console.log('[GoogleCalendar] Signed out successfully');
    } catch (error) {
      console.error('[GoogleCalendar] Error signing out:', error);
    }
  }

  /**
   * Fetch upcoming calendar events
   * @param {number} hoursAhead - How many hours ahead to look (default: 24)
   * @returns {Array} Array of formatted meeting objects
   */
  async getUpcomingMeetings(hoursAhead = 24) {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const now = new Date();
    const timeMax = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50
      });

      const events = response.data.items || [];

      // Filter and format events
      return events
        .filter(event => this._isMeeting(event))
        .map(event => this._formatMeeting(event));
    } catch (error) {
      console.error('[GoogleCalendar] Error fetching events:', error);

      // Handle token refresh
      if (error.code === 401) {
        console.log('[GoogleCalendar] Token expired, attempting refresh...');
        // Token refresh is handled automatically by oauth2Client
        throw new Error('Authentication expired. Please re-authenticate.');
      }

      throw new Error(`Failed to fetch calendar events: ${error.message}`);
    }
  }

  /**
   * Detect if event is a meeting (has participants and/or meeting link)
   * @private
   */
  _isMeeting(event) {
    // Must have a start time
    if (!event.start || !event.start.dateTime) {
      return false;
    }

    // Has attendees (more than just the organizer)
    const hasAttendees = event.attendees && event.attendees.length > 0;

    // Has a meeting link
    const hasMeetingLink = this._detectPlatform(event) !== 'unknown';

    // Accepted or tentative (not declined)
    const isAccepted = !event.attendees || event.attendees.some(
      attendee => attendee.self && attendee.responseStatus !== 'declined'
    );

    return (hasAttendees || hasMeetingLink) && isAccepted;
  }

  /**
   * Format event into standardized meeting object
   * @private
   */
  _formatMeeting(event) {
    const platform = this._detectPlatform(event);
    const meetingLink = this._extractMeetingLink(event, platform);

    return {
      id: event.id,
      title: event.summary || 'Untitled Meeting',
      description: event.description || '',
      startTime: new Date(event.start.dateTime),
      endTime: new Date(event.end.dateTime),
      platform: platform,
      meetingLink: meetingLink,
      participants: this._extractParticipants(event),
      location: event.location || '',
      organizer: event.organizer ? {
        name: event.organizer.displayName || event.organizer.email,
        email: event.organizer.email
      } : null,
      status: event.status || 'confirmed',
      // Metadata for routing
      participantEmails: (event.attendees || []).map(a => a.email).filter(Boolean)
    };
  }

  /**
   * Detect meeting platform from event
   * @private
   */
  _detectPlatform(event) {
    const text = `${event.description || ''} ${event.location || ''} ${event.hangoutLink || ''}`;

    if (event.hangoutLink || text.includes('meet.google.com')) {
      return 'google-meet';
    }
    if (text.match(/zoom\.us|zoomgov\.com/i)) {
      return 'zoom';
    }
    if (text.match(/teams\.microsoft\.com|teams\.live\.com/i)) {
      return 'teams';
    }
    if (text.match(/webex\.com/i)) {
      return 'webex';
    }
    if (text.match(/whereby\.com/i)) {
      return 'whereby';
    }

    return 'unknown';
  }

  /**
   * Extract meeting link from event
   * @private
   */
  _extractMeetingLink(event, platform) {
    if (event.hangoutLink) {
      return event.hangoutLink;
    }

    const text = `${event.description || ''} ${event.location || ''}`;

    // Regex patterns for common meeting platforms
    const patterns = {
      'zoom': /https?:\/\/[\w-]*\.?zoom\.us\/[^\s<]*/i,
      'teams': /https?:\/\/teams\.(microsoft|live)\.com\/[^\s<]*/i,
      'google-meet': /https?:\/\/meet\.google\.com\/[^\s<]*/i,
      'webex': /https?:\/\/[\w-]*\.?webex\.com\/[^\s<]*/i,
      'whereby': /https?:\/\/whereby\.com\/[^\s<]*/i
    };

    if (patterns[platform]) {
      const match = text.match(patterns[platform]);
      if (match) {
        return match[0];
      }
    }

    // Try to find any URL that might be a meeting link
    const urlPattern = /https?:\/\/[^\s<]+/i;
    const match = text.match(urlPattern);
    return match ? match[0] : null;
  }

  /**
   * Extract participant information from event
   * @private
   */
  _extractParticipants(event) {
    if (!event.attendees) {
      return [];
    }

    return event.attendees
      .filter(attendee => attendee.responseStatus !== 'declined')
      .map(attendee => ({
        name: attendee.displayName || attendee.email,
        email: attendee.email,
        responseStatus: attendee.responseStatus || 'needsAction',
        optional: attendee.optional || false,
        organizer: attendee.organizer || false
      }));
  }

  /**
   * Save OAuth token to disk
   * @private
   */
  async saveToken(token) {
    try {
      // Ensure storage directory exists
      const dir = path.dirname(this.tokenPath);
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(this.tokenPath, JSON.stringify(token, null, 2));
      console.log('[GoogleCalendar] Token saved successfully');
    } catch (error) {
      console.error('[GoogleCalendar] Error saving token:', error);
      throw error;
    }
  }

  /**
   * Load OAuth token from disk
   * @private
   */
  async loadToken() {
    try {
      const data = await fs.readFile(this.tokenPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error('No saved token found');
    }
  }

  /**
   * Save OAuth credentials to disk
   * @param {Object} credentials - Client credentials
   */
  async saveCredentials(credentials) {
    try {
      await fs.writeFile(this.credentialsPath, JSON.stringify(credentials, null, 2));
      console.log('[GoogleCalendar] Credentials saved successfully');
    } catch (error) {
      console.error('[GoogleCalendar] Error saving credentials:', error);
      throw error;
    }
  }

  /**
   * Load OAuth credentials from disk
   */
  async loadCredentials() {
    try {
      const data = await fs.readFile(this.credentialsPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error('No saved credentials found');
    }
  }
}

module.exports = GoogleCalendar;
