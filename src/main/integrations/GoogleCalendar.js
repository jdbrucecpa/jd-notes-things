const { google } = require('googleapis');
const log = require('electron-log');

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
      log.info('[GoogleCalendar] Not authenticated - user needs to sign in');
      return false;
    }

    try {
      const auth = this.googleAuth.getClient();
      this.calendar = google.calendar({ version: 'v3', auth });
      log.info('[GoogleCalendar] Initialized with existing token');
      return true;
    } catch (error) {
      log.error('[GoogleCalendar] Initialization error:', error.message);
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
    log.debug(`[GoogleCalendar] getUpcomingMeetings called (hoursAhead: ${hoursAhead})`);

    if (!this.isAuthenticated()) {
      log.info('[GoogleCalendar] Not authenticated, trying to initialize...');
      // Try to initialize if not already done
      if (!this.initialize()) {
        log.warn('[GoogleCalendar] Initialize failed!');
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
    log.debug(`[GoogleCalendar] Fetching events from ${now.toISOString()} to ${timeMax.toISOString()}`);

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

      // Filter and format events
      const filtered = events.filter(event => this._isMeeting(event));
      log.debug(`[GoogleCalendar] ${events.length} raw events, ${filtered.length} after filtering`);
      return filtered.map(event => this._formatMeeting(event));
    } catch (error) {
      log.error('[GoogleCalendar] Error fetching events:', error.message);

      // Handle token refresh
      if (error.code === 401) {
        log.info('[GoogleCalendar] Token expired, attempting refresh...');
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

    // v1.3.0: Extract jdNotes extended properties if present
    const jdNotesProps = {};
    const privateProps = event.extendedProperties?.private || {};
    for (const [key, value] of Object.entries(privateProps)) {
      if (key.startsWith('jdNotes')) {
        jdNotesProps[key] = value;
      }
    }

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
      htmlLink: event.htmlLink || null,               // v1.3.0: Direct link to Google Calendar event
      jdNotesProperties: jdNotesProps,                 // v1.3.0: Our custom extended properties
      hasRecording: !!jdNotesProps.jdNotesRecordingId, // v1.3.0: Quick check for existing recording
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

  // ======================================================================
  // v1.3.0: Extended Properties + Event Updates
  // ======================================================================

  /**
   * v1.3.0: Write jdNotes extended properties to a calendar event.
   * Used to mark events as having recordings, Obsidian links, etc.
   * @param {string} eventId - Google Calendar event ID
   * @param {Object} properties - Key-value pairs to set (e.g., { jdNotesRecordingId: 'meeting-123' })
   * @returns {Promise<Object>} Updated event
   */
  async updateEventProperties(eventId, properties) {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }
    await this.googleAuth.refreshTokenIfNeeded();

    // Merge with existing private properties
    const event = await this.calendar.events.get({
      calendarId: 'primary',
      eventId: eventId,
    });

    const existingPrivate = event.data.extendedProperties?.private || {};
    const updatedPrivate = { ...existingPrivate, ...properties };

    const response = await this.calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: {
        extendedProperties: {
          private: updatedPrivate,
        },
      },
    });

    log.info(`[GoogleCalendar] Updated extendedProperties for event ${eventId}:`, Object.keys(properties));
    return response.data;
  }

  /**
   * v1.3.0: Get calendar events in a date range (for reports).
   * @param {string|Date} startDate
   * @param {string|Date} endDate
   * @returns {Promise<Array>} Formatted meeting objects
   */
  async getEventsInRange(startDate, endDate) {
    if (!this.isAuthenticated()) {
      if (!this.initialize()) {
        throw new Error('Not authenticated');
      }
    }
    await this.googleAuth.refreshTokenIfNeeded();

    const timeMin = new Date(startDate).toISOString();
    const timeMax = new Date(endDate).toISOString();

    const allEvents = [];
    let pageToken = null;

    do {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        pageToken: pageToken || undefined,
      });

      const events = response.data.items || [];
      allEvents.push(...events.filter(e => this._isMeeting(e)));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    log.info(`[GoogleCalendar] getEventsInRange: ${allEvents.length} events from ${timeMin} to ${timeMax}`);
    return allEvents.map(e => this._formatMeeting(e));
  }

  /**
   * v1.3.0: Search for a calendar event by its jdNotesRecordingId.
   * @param {string} recordingId
   * @returns {Promise<Object|null>} Event or null
   */
  async findEventByRecordingId(recordingId) {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }
    await this.googleAuth.refreshTokenIfNeeded();

    try {
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        privateExtendedProperty: `jdNotesRecordingId=${recordingId}`,
        maxResults: 1,
      });

      const events = response.data.items || [];
      if (events.length > 0) {
        return this._formatMeeting(events[0]);
      }
      return null;
    } catch (error) {
      log.error(`[GoogleCalendar] Error searching for recording ${recordingId}:`, error.message);
      return null;
    }
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
          log.info('[GoogleCalendar] Sent auth:expired notification to renderer');
        }
      }
    } catch (error) {
      log.error('[GoogleCalendar] Failed to send auth expiration notification:', error.message);
    }
  }
}

module.exports = GoogleCalendar;
