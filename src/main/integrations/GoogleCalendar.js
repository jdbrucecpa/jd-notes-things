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
    console.log(`[GoogleCalendar] getUpcomingMeetings called (hoursAhead: ${hoursAhead})`);
    console.log(`[GoogleCalendar] this.calendar exists: ${!!this.calendar}`);
    console.log(`[GoogleCalendar] googleAuth.isAuthenticated: ${this.googleAuth.isAuthenticated()}`);

    if (!this.isAuthenticated()) {
      console.log('[GoogleCalendar] Not authenticated, trying to initialize...');
      // Try to initialize if not already done
      if (!this.initialize()) {
        console.log('[GoogleCalendar] Initialize failed!');
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
    console.log(`[GoogleCalendar] Fetching events from ${now.toISOString()} to ${timeMax.toISOString()}`);

    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      const events = response.data.items || [];
      console.log(`[GoogleCalendar] API returned ${events.length} raw events`);

      // Log each event and why it's filtered
      events.forEach((event, i) => {
        const hasDateTime = event.start && event.start.dateTime;
        const hasAttendees = event.attendees && event.attendees.length > 0;
        const platform = this._detectPlatform(event);
        const _hasMeetingLink = platform !== 'unknown';
        console.log(`[GoogleCalendar] Event ${i}: "${event.summary}" - dateTime:${hasDateTime}, attendees:${hasAttendees}, platform:${platform}`);
      });

      // Filter and format events
      const filtered = events.filter(event => this._isMeeting(event));
      console.log(`[GoogleCalendar] After filtering: ${filtered.length} meetings`);
      return filtered.map(event => this._formatMeeting(event));
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
   * Detect if event is a meeting (any timed event, not all-day)
   * @private
   */
  _isMeeting(event) {
    // Must have a specific start time (not an all-day event)
    if (!event.start || !event.start.dateTime) {
      return false;
    }

    // v1.2.2: Show all timed calendar events, not just ones with attendees/links
    // Only filter out events the user has explicitly declined
    if (event.attendees) {
      const selfAttendee = event.attendees.find(a => a.self);
      if (selfAttendee && selfAttendee.responseStatus === 'declined') {
        return false;
      }
    }

    return true;
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
      organizer: event.organizer
        ? {
            name: event.organizer.displayName || event.organizer.email,
            email: event.organizer.email,
          }
        : null,
      status: event.status || 'confirmed',
      // Metadata for routing
      participantEmails: (event.attendees || []).map(a => a.email).filter(Boolean),
    };
  }

  /**
   * Detect meeting platform from event
   * @private
   */
  _detectPlatform(event) {
    // Check conferenceData first (used when adding video conferencing via Google Calendar dropdown)
    if (event.conferenceData) {
      const confSolution = event.conferenceData.conferenceSolution?.name?.toLowerCase() || '';
      const confType = event.conferenceData.conferenceSolution?.key?.type?.toLowerCase() || '';

      // Check conference solution name and type
      if (confSolution.includes('zoom') || confType.includes('zoom')) {
        return 'zoom';
      }
      if (confSolution.includes('teams') || confType.includes('teams')) {
        return 'teams';
      }
      if (confSolution.includes('webex') || confType.includes('webex')) {
        return 'webex';
      }
      if (confSolution.includes('whereby') || confType.includes('whereby')) {
        return 'whereby';
      }

      // Check entry point URIs for platform detection
      const entryPoints = event.conferenceData.entryPoints || [];
      for (const entry of entryPoints) {
        const uri = entry.uri || '';
        if (uri.match(/zoom\.us|zoomgov\.com/i)) {
          return 'zoom';
        }
        if (uri.match(/teams\.microsoft\.com|teams\.live\.com/i)) {
          return 'teams';
        }
        if (uri.match(/webex\.com/i)) {
          return 'webex';
        }
        if (uri.match(/whereby\.com/i)) {
          return 'whereby';
        }
      }
    }

    // Fall back to checking description, location, and hangoutLink
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

    // Check conferenceData entry points (used when adding video conferencing via dropdown)
    if (event.conferenceData?.entryPoints) {
      // Prefer video entry point, fall back to others
      const videoEntry = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video');
      if (videoEntry?.uri) {
        return videoEntry.uri;
      }
      // Fall back to any entry point with a URI
      const anyEntry = event.conferenceData.entryPoints.find(e => e.uri);
      if (anyEntry?.uri) {
        return anyEntry.uri;
      }
    }

    const text = `${event.description || ''} ${event.location || ''}`;

    // Regex patterns for common meeting platforms
    const patterns = {
      zoom: /https?:\/\/[\w-]*\.?zoom\.us\/[^\s<]*/i,
      teams: /https?:\/\/teams\.(microsoft|live)\.com\/[^\s<]*/i,
      'google-meet': /https?:\/\/meet\.google\.com\/[^\s<]*/i,
      webex: /https?:\/\/[\w-]*\.?webex\.com\/[^\s<]*/i,
      whereby: /https?:\/\/whereby\.com\/[^\s<]*/i,
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
        organizer: attendee.organizer || false,
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
            message:
              'Your Google authentication has expired. Please sign in again to continue using Calendar and Contacts features.',
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
