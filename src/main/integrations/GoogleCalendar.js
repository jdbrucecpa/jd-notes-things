const { google } = require('googleapis');

/**
 * GoogleCalendar Integration
 *
 * Handles calendar event fetching for Google Calendar using shared GoogleAuth.
 *
 * Features:
 * - Fetch upcoming meetings (next 24 hours)
 * - Extract meeting metadata (title, participants, platform)
 * - Detect meeting platforms (Zoom, Teams, Google Meet)
 *
 * Note: Authentication is handled by GoogleAuth module (shared with GoogleContacts)
 */
class GoogleCalendar {
  /**
   * @param {GoogleAuth} googleAuth - Shared Google authentication instance
   */
  constructor(googleAuth) {
    if (!googleAuth) {
      throw new Error('[GoogleCalendar] GoogleAuth instance is required');
    }

    this.googleAuth = googleAuth;
    this.calendar = null;
  }

  /**
   * Initialize the Calendar API with authenticated client
   * @returns {boolean} True if initialized successfully
   */
  initialize() {
    if (!this.googleAuth.isAuthenticated()) {
      console.log('[GoogleCalendar] Not authenticated - user needs to sign in');
      return false;
    }

    try {
      const auth = this.googleAuth.getClient();
      this.calendar = google.calendar({ version: 'v3', auth });
      console.log('[GoogleCalendar] Initialized with existing token');
      return true;
    } catch (error) {
      console.error('[GoogleCalendar] Initialization error:', error.message);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated
   */
  isAuthenticated() {
    return this.googleAuth.isAuthenticated() && this.calendar !== null;
  }

  /**
   * Fetch upcoming calendar events
   * @param {number} hoursAhead - How many hours ahead to look (default: 24)
   * @returns {Array} Array of formatted meeting objects
   */
  async getUpcomingMeetings(hoursAhead = 24) {
    if (!this.isAuthenticated()) {
      // Try to initialize if not already done
      if (!this.initialize()) {
        throw new Error('Not authenticated. Call authenticate() first.');
      }
    }

    // Refresh token if needed
    try {
      await this.googleAuth.refreshTokenIfNeeded();
    } catch (error) {
      if (error.code === 'AUTH_REFRESH_FAILED') {
        // Notify user that authentication expired
        this._notifyAuthExpired();
      }
      throw error;
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
   * Notify renderer process that Google authentication has expired
   * @private
   */
  _notifyAuthExpired() {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();

      if (windows.length > 0) {
        const mainWindow = windows[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:expired', {
            service: 'Google',
            message: 'Your Google authentication has expired. Please sign in again to continue using Calendar and Contacts features.'
          });
          console.log('[GoogleCalendar] Sent auth:expired notification to renderer');
        }
      }
    } catch (error) {
      console.error('[GoogleCalendar] Failed to send auth expiration notification:', error.message);
    }
  }
}

module.exports = GoogleCalendar;
