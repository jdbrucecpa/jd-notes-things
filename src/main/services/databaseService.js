/**
 * Database Service (v1.3.0)
 * SQLite-backed storage replacing meetings.json + fileOperationManager.
 *
 * Uses better-sqlite3 (synchronous, WAL mode) for:
 *   - Concurrent reads during writes (UI reads while transcription writes)
 *   - SQL queries: filter by date, contact, company, platform
 *   - Schema versioning via PRAGMA user_version
 *
 * Migration: On first v1.3 launch, detects meetings.json and imports all data
 * in a single transaction, then renames it to meetings.json.bak.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const log = require('electron-log');

const CURRENT_SCHEMA_VERSION = 1;

class DatabaseService {
  constructor() {
    this.db = null;
    // NOTE: dbPath is resolved in initialize(), NOT here.
    // The constructor runs at module-import time (before app.setPath('userData') in dev mode),
    // so app.getPath('userData') would return the wrong path in development.
    this.dbPath = null;
  }

  /**
   * Initialize the database, create schema if needed, run migrations.
   */
  initialize() {
    // Resolve dbPath at initialization time (inside app.whenReady), not at import time
    this.dbPath = path.join(app.getPath('userData'), 'meetings.db');
    log.info(`[Database] Opening database at: ${this.dbPath}`);
    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent read/write
    this.db.pragma('journal_mode = WAL');
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    const version = this.db.pragma('user_version', { simple: true });
    log.info(`[Database] Current schema version: ${version}`);

    if (version === 0) {
      this._createSchema();
      this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      log.info(`[Database] Schema created at version ${CURRENT_SCHEMA_VERSION}`);
    } else if (version < CURRENT_SCHEMA_VERSION) {
      this._runMigrations(version);
      this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    }

    this._prepareStatements();
    return this;
  }

  /**
   * Create the initial schema (version 1).
   */
  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'document',
        status TEXT NOT NULL DEFAULT 'upcoming',
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        duration INTEGER,
        platform TEXT,
        meeting_link TEXT,
        content TEXT,
        summary TEXT,
        recording_id TEXT,
        video_file TEXT,
        obsidian_link TEXT,
        vault_path TEXT,
        calendar_event_id TEXT,
        calendar_html_link TEXT,
        calendar_description TEXT,
        transcription_provider TEXT,
        transcript_confidence REAL,
        recording_complete INTEGER DEFAULT 0,
        recording_end_time TEXT,
        upload_token TEXT,
        sdk_upload_id TEXT,
        recall_recording_id TEXT,
        recording_status TEXT,
        subtitle TEXT,
        has_demo INTEGER DEFAULT 0,
        participant_emails TEXT,
        speaker_mapping TEXT,
        summaries TEXT,
        extra_fields TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        participant_id TEXT,
        original_name TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        organization TEXT,
        is_host INTEGER DEFAULT 0,
        platform TEXT,
        join_time TEXT,
        google_contact_resource TEXT,
        extra_fields TEXT,
        UNIQUE(meeting_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS transcript_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        entry_order INTEGER NOT NULL,
        speaker TEXT NOT NULL,
        speaker_name TEXT,
        speaker_email TEXT,
        speaker_display_name TEXT,
        text TEXT NOT NULL,
        timestamp REAL,
        end_timestamp REAL,
        confidence REAL,
        speaker_identified INTEGER DEFAULT 0,
        speaker_mapped INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS speaker_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_label TEXT NOT NULL,
        email TEXT,
        name TEXT,
        confidence TEXT,
        method TEXT,
        email_source TEXT,
        UNIQUE(meeting_id, speaker_label)
      );

      CREATE TABLE IF NOT EXISTS calendar_attendees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        name TEXT,
        email TEXT NOT NULL,
        response_status TEXT,
        is_optional INTEGER DEFAULT 0,
        is_organizer INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(date);
      CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
      CREATE INDEX IF NOT EXISTS idx_meetings_calendar_event ON meetings(calendar_event_id);
      CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);
      CREATE INDEX IF NOT EXISTS idx_participants_meeting ON participants(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_transcript_meeting ON transcript_entries(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_attendees_email ON calendar_attendees(email);
    `);
  }

  /**
   * Run schema migrations from oldVersion to CURRENT_SCHEMA_VERSION.
   */
  _runMigrations(oldVersion) {
    log.info(`[Database] Running migrations from v${oldVersion} to v${CURRENT_SCHEMA_VERSION}`);
    // Future migrations go here:
    // if (oldVersion < 2) { ... }
  }

  /**
   * Prepare frequently-used SQL statements for performance.
   */
  _prepareStatements() {
    this._stmts = {
      getMeeting: this.db.prepare('SELECT * FROM meetings WHERE id = ?'),
      getMeetingsByStatus: this.db.prepare('SELECT * FROM meetings WHERE status = ? ORDER BY date DESC'),
      insertMeeting: this.db.prepare(`
        INSERT INTO meetings (
          id, type, status, title, date, start_time, end_time, duration,
          platform, meeting_link, content, summary, recording_id, video_file,
          obsidian_link, vault_path, calendar_event_id, calendar_html_link,
          calendar_description, transcription_provider, transcript_confidence,
          recording_complete, recording_end_time, upload_token, sdk_upload_id,
          recall_recording_id, recording_status, subtitle, has_demo,
          participant_emails, speaker_mapping, summaries, extra_fields,
          created_at, updated_at
        ) VALUES (
          @id, @type, @status, @title, @date, @start_time, @end_time, @duration,
          @platform, @meeting_link, @content, @summary, @recording_id, @video_file,
          @obsidian_link, @vault_path, @calendar_event_id, @calendar_html_link,
          @calendar_description, @transcription_provider, @transcript_confidence,
          @recording_complete, @recording_end_time, @upload_token, @sdk_upload_id,
          @recall_recording_id, @recording_status, @subtitle, @has_demo,
          @participant_emails, @speaker_mapping, @summaries, @extra_fields,
          @created_at, @updated_at
        )
      `),
      updateMeeting: this.db.prepare(`
        UPDATE meetings SET
          type = @type, status = @status, title = @title, date = @date,
          start_time = @start_time, end_time = @end_time, duration = @duration,
          platform = @platform, meeting_link = @meeting_link, content = @content,
          summary = @summary, recording_id = @recording_id, video_file = @video_file,
          obsidian_link = @obsidian_link, vault_path = @vault_path,
          calendar_event_id = @calendar_event_id, calendar_html_link = @calendar_html_link,
          calendar_description = @calendar_description,
          transcription_provider = @transcription_provider,
          transcript_confidence = @transcript_confidence,
          recording_complete = @recording_complete, recording_end_time = @recording_end_time,
          upload_token = @upload_token, sdk_upload_id = @sdk_upload_id,
          recall_recording_id = @recall_recording_id, recording_status = @recording_status,
          subtitle = @subtitle, has_demo = @has_demo,
          participant_emails = @participant_emails, speaker_mapping = @speaker_mapping,
          summaries = @summaries, extra_fields = @extra_fields,
          updated_at = datetime('now')
        WHERE id = @id
      `),
      deleteMeeting: this.db.prepare('DELETE FROM meetings WHERE id = ?'),
      updateMeetingField: this.db.prepare(
        'UPDATE meetings SET updated_at = datetime(\'now\') WHERE id = ?'
      ),

      // Participants
      insertParticipant: this.db.prepare(`
        INSERT OR REPLACE INTO participants (
          meeting_id, participant_id, original_name, name, email, organization,
          is_host, platform, join_time, google_contact_resource, extra_fields
        ) VALUES (
          @meeting_id, @participant_id, @original_name, @name, @email, @organization,
          @is_host, @platform, @join_time, @google_contact_resource, @extra_fields
        )
      `),
      getParticipants: this.db.prepare('SELECT * FROM participants WHERE meeting_id = ?'),
      deleteParticipants: this.db.prepare('DELETE FROM participants WHERE meeting_id = ?'),

      // Transcript entries
      insertTranscriptEntry: this.db.prepare(`
        INSERT INTO transcript_entries (
          meeting_id, entry_order, speaker, speaker_name, speaker_email,
          speaker_display_name, text, timestamp, end_timestamp, confidence,
          speaker_identified, speaker_mapped
        ) VALUES (
          @meeting_id, @entry_order, @speaker, @speaker_name, @speaker_email,
          @speaker_display_name, @text, @timestamp, @end_timestamp, @confidence,
          @speaker_identified, @speaker_mapped
        )
      `),
      getTranscript: this.db.prepare(
        'SELECT * FROM transcript_entries WHERE meeting_id = ? ORDER BY entry_order'
      ),
      deleteTranscript: this.db.prepare('DELETE FROM transcript_entries WHERE meeting_id = ?'),

      // Speaker mappings
      insertSpeakerMapping: this.db.prepare(`
        INSERT OR REPLACE INTO speaker_mappings (
          meeting_id, speaker_label, email, name, confidence, method, email_source
        ) VALUES (
          @meeting_id, @speaker_label, @email, @name, @confidence, @method, @email_source
        )
      `),
      getSpeakerMappings: this.db.prepare('SELECT * FROM speaker_mappings WHERE meeting_id = ?'),
      deleteSpeakerMappings: this.db.prepare('DELETE FROM speaker_mappings WHERE meeting_id = ?'),

      // Calendar attendees
      insertCalendarAttendee: this.db.prepare(`
        INSERT INTO calendar_attendees (
          meeting_id, name, email, response_status, is_optional, is_organizer
        ) VALUES (
          @meeting_id, @name, @email, @response_status, @is_optional, @is_organizer
        )
      `),
      getCalendarAttendees: this.db.prepare('SELECT * FROM calendar_attendees WHERE meeting_id = ?'),
      deleteCalendarAttendees: this.db.prepare('DELETE FROM calendar_attendees WHERE meeting_id = ?'),
    };
  }

  // ======================================================================
  // Meeting CRUD — public API that replaces fileOperationManager
  // ======================================================================

  /**
   * Get a single meeting by ID, fully hydrated with participants + transcript.
   * @param {string} id
   * @returns {Object|null} Meeting object in the legacy JSON format, or null
   */
  getMeeting(id) {
    const row = this._stmts.getMeeting.get(id);
    if (!row) return null;
    return this._rowToMeeting(row);
  }

  /**
   * Get all meetings, returning in the legacy { upcomingMeetings, pastMeetings } format.
   * This is the primary compatibility bridge for the renderer.
   * @returns {{ upcomingMeetings: Array, pastMeetings: Array }}
   */
  getAllMeetings() {
    const upcoming = this._stmts.getMeetingsByStatus.all('upcoming').map(r => this._rowToMeeting(r));
    const past = this._stmts.getMeetingsByStatus.all('past').map(r => this._rowToMeeting(r));
    // Also include archived in past for backward compat
    const archived = this._stmts.getMeetingsByStatus.all('archived').map(r => this._rowToMeeting(r));
    return {
      upcomingMeetings: upcoming,
      pastMeetings: [...past, ...archived],
    };
  }

  /**
   * Save a meeting (insert or update). Accepts legacy JSON meeting format.
   * Wrapped in a transaction so the meeting row + all child rows (participants,
   * transcript, speaker mappings, attendees) are saved atomically.
   * @param {Object} meeting - Meeting object from renderer
   * @param {string} [status] - Override status ('upcoming' or 'past')
   */
  saveMeeting(meeting, status = null) {
    const doSave = this.db.transaction(() => {
      const params = this._meetingToRow(meeting, status);

      // Use upsert: try insert, fall back to update
      const existing = this._stmts.getMeeting.get(meeting.id);
      if (existing) {
        this._stmts.updateMeeting.run(params);
      } else {
        this._stmts.insertMeeting.run(params);
      }

      // Save participants
      this._saveParticipants(meeting.id, meeting.participants || []);

      // Save transcript
      this._saveTranscript(meeting.id, meeting.transcript || []);

      // Save speaker mappings (from meeting.speakerMapping object)
      this._saveSpeakerMappings(meeting.id, meeting.speakerMapping || {});

      // Save calendar attendees
      this._saveCalendarAttendees(meeting.id, meeting.calendarAttendees || []);
    });
    doSave();
  }

  /**
   * Bulk save all meetings (used by saveMeetingsData IPC handler).
   * Wraps everything in a transaction for atomicity + speed.
   * @param {{ upcomingMeetings: Array, pastMeetings: Array }} data
   */
  saveAllMeetings(data) {
    const transaction = this.db.transaction(() => {
      for (const meeting of (data.upcomingMeetings || [])) {
        this.saveMeeting(meeting, 'upcoming');
      }
      for (const meeting of (data.pastMeetings || [])) {
        this.saveMeeting(meeting, 'past');
      }
    });
    transaction();
  }

  /**
   * Update a single field on a meeting.
   * @param {string} meetingId
   * @param {string} field - Field name (legacy JSON key)
   * @param {*} value
   * @returns {boolean} True if meeting was found and updated
   */
  updateMeetingField(meetingId, field, value) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return false;

    // Set the field on the meeting object and re-save
    meeting[field] = value;
    this.saveMeeting(meeting);
    return true;
  }

  /**
   * Delete a meeting and all related data (cascade).
   * @param {string} meetingId
   * @returns {{ deleted: boolean, recordingId: string|null }}
   */
  deleteMeeting(meetingId) {
    const meeting = this._stmts.getMeeting.get(meetingId);
    if (!meeting) return { deleted: false, recordingId: null };

    const recordingId = meeting.recording_id || null;
    this._stmts.deleteMeeting.run(meetingId);
    return { deleted: true, recordingId };
  }

  /**
   * Find a meeting by calendar event ID.
   * @param {string} calendarEventId
   * @returns {Object|null}
   */
  getMeetingByCalendarEvent(calendarEventId) {
    const row = this.db.prepare('SELECT * FROM meetings WHERE calendar_event_id = ?').get(calendarEventId);
    if (!row) return null;
    return this._rowToMeeting(row);
  }

  /**
   * Query meetings by date range.
   * @param {string} startDate - ISO date string
   * @param {string} endDate - ISO date string
   * @param {Object} [filters] - Optional filters { hasRecording, hasCalendarEvent, status, contactEmail }
   * @returns {Array}
   */
  getMeetingsInRange(startDate, endDate, filters = {}) {
    let sql = 'SELECT * FROM meetings WHERE date BETWEEN ? AND ?';
    const params = [startDate, endDate];

    // Validate filter values to prevent unexpected query behavior
    const VALID_STATUSES = ['upcoming', 'past', 'archived'];
    if (filters.status) {
      if (!VALID_STATUSES.includes(filters.status)) {
        log.warn(`[Database] Invalid status filter: ${filters.status}`);
        return [];
      }
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.hasRecording === true) {
      sql += ' AND recording_id IS NOT NULL';
    } else if (filters.hasRecording === false) {
      sql += ' AND recording_id IS NULL';
    }
    if (filters.hasCalendarEvent === true) {
      sql += ' AND calendar_event_id IS NOT NULL';
    } else if (filters.hasCalendarEvent === false) {
      sql += ' AND calendar_event_id IS NULL';
    }

    sql += ' ORDER BY date DESC';

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._rowToMeeting(r));
  }

  /**
   * Find all meetings involving a specific contact email.
   * @param {string} email
   * @returns {Array}
   */
  getMeetingsForContact(email) {
    const rows = this.db.prepare(`
      SELECT DISTINCT m.* FROM meetings m
      JOIN participants p ON p.meeting_id = m.id
      WHERE p.email = ?
      ORDER BY m.date DESC
    `).all(email);
    return rows.map(r => this._rowToMeeting(r));
  }

  /**
   * Find all meetings involving people from a specific organization.
   * @param {string} organization
   * @returns {Array}
   */
  getMeetingsForOrganization(organization) {
    const rows = this.db.prepare(`
      SELECT DISTINCT m.* FROM meetings m
      JOIN participants p ON p.meeting_id = m.id
      WHERE p.organization = ?
      ORDER BY m.date DESC
    `).all(organization);
    return rows.map(r => this._rowToMeeting(r));
  }

  /**
   * Get meeting count for a contact (for participant panel).
   * @param {string} email
   * @returns {number}
   */
  getMeetingCountForContact(email) {
    const result = this.db.prepare(
      'SELECT COUNT(DISTINCT meeting_id) as count FROM participants WHERE email = ?'
    ).get(email);
    return result ? result.count : 0;
  }

  /**
   * Reports: meetings without recordings in date range.
   */
  getMeetingsWithoutRecordings(startDate, endDate) {
    return this.getMeetingsInRange(startDate, endDate, {
      hasCalendarEvent: true,
      hasRecording: false,
    });
  }

  /**
   * Reports: recordings without calendar events in date range.
   */
  getRecordingsWithoutCalendarEvents(startDate, endDate) {
    return this.getMeetingsInRange(startDate, endDate, {
      hasCalendarEvent: false,
      hasRecording: true,
    });
  }

  // ======================================================================
  // Migration from meetings.json
  // ======================================================================

  /**
   * Migrate data from meetings.json to SQLite.
   * Runs once on first v1.3 launch. Creates meetings.json.bak after success.
   * @param {string} meetingsFilePath - Path to meetings.json
   */
  migrateFromJson(meetingsFilePath) {
    if (!fs.existsSync(meetingsFilePath)) {
      log.info('[Database] No meetings.json found — fresh install');
      return;
    }

    // Check if we already have data (migration already ran)
    const count = this.db.prepare('SELECT COUNT(*) as count FROM meetings').get();
    if (count.count > 0) {
      log.info(`[Database] Database already has ${count.count} meetings — skipping JSON migration`);
      return;
    }

    log.info('[Database] Starting migration from meetings.json...');

    try {
      const raw = fs.readFileSync(meetingsFilePath, 'utf-8');
      const data = JSON.parse(raw);

      const transaction = this.db.transaction(() => {
        let migrated = 0;

        for (const meeting of (data.upcomingMeetings || [])) {
          try {
            this.saveMeeting(meeting, 'upcoming');
            migrated++;
          } catch (error) {
            log.error(`[Database] Failed to migrate upcoming meeting ${meeting.id}:`, error.message);
          }
        }

        for (const meeting of (data.pastMeetings || [])) {
          try {
            this.saveMeeting(meeting, 'past');
            migrated++;
          } catch (error) {
            log.error(`[Database] Failed to migrate past meeting ${meeting.id}:`, error.message);
          }
        }

        log.info(`[Database] Migrated ${migrated} meetings to SQLite`);
      });

      transaction();

      // Rename the old file
      const backupPath = meetingsFilePath + '.bak';
      fs.renameSync(meetingsFilePath, backupPath);
      log.info(`[Database] Renamed meetings.json → meetings.json.bak`);
    } catch (error) {
      log.error('[Database] JSON migration failed:', error.message);
      throw error;
    }
  }

  // ======================================================================
  // Internal: row ↔ meeting object conversion
  // ======================================================================

  /**
   * Convert a SQLite row back to the legacy JSON meeting format.
   * Hydrates participants, transcript, speakerMappings, calendarAttendees.
   */
  _rowToMeeting(row) {
    const meeting = {
      id: row.id,
      type: row.type,
      title: row.title,
      date: row.date,
      platform: row.platform || undefined,
      content: row.content || undefined,
      summary: row.summary || undefined,
      recordingId: row.recording_id || undefined,
      videoFile: row.video_file || undefined,
      obsidianLink: row.obsidian_link || undefined,
      vaultPath: row.vault_path || undefined,
      calendarEventId: row.calendar_event_id || undefined,
      calendarHtmlLink: row.calendar_html_link || undefined,
      calendarDescription: row.calendar_description || undefined,
      transcriptionProvider: row.transcription_provider || undefined,
      transcriptConfidence: row.transcript_confidence != null ? row.transcript_confidence : undefined,
      recordingComplete: row.recording_complete === 1,
      recordingEndTime: row.recording_end_time || undefined,
      uploadToken: row.upload_token || undefined,
      sdkUploadId: row.sdk_upload_id || undefined,
      recallRecordingId: row.recall_recording_id || undefined,
      recordingStatus: row.recording_status || undefined,
      subtitle: row.subtitle || undefined,
      hasDemo: row.has_demo === 1,
      start: row.start_time || undefined,
      end: row.end_time || undefined,
      link: row.meeting_link || undefined,
      participantEmails: row.participant_emails ? JSON.parse(row.participant_emails) : undefined,
      summaries: row.summaries ? JSON.parse(row.summaries) : undefined,
    };

    // Merge any extra fields that didn't map to columns
    if (row.extra_fields) {
      try {
        const extra = JSON.parse(row.extra_fields);
        Object.assign(meeting, extra);
      } catch (err) {
        log.warn(`[Database] Corrupt extra_fields on meeting ${row.id}:`, err.message);
      }
    }

    // Hydrate participants
    const participantRows = this._stmts.getParticipants.all(row.id);
    meeting.participants = participantRows.map(p => {
      const participant = {
        id: p.participant_id || undefined,
        originalName: p.original_name,
        name: p.name,
        email: p.email || undefined,
        organization: p.organization || undefined,
        isHost: p.is_host === 1,
        platform: p.platform || undefined,
        joinTime: p.join_time || undefined,
        googleContactResource: p.google_contact_resource || undefined,
      };
      if (p.extra_fields) {
        try {
          Object.assign(participant, JSON.parse(p.extra_fields));
        } catch (err) {
          log.warn(`[Database] Corrupt extra_fields on participant in meeting ${row.id}:`, err.message);
        }
      }
      return participant;
    });

    // Hydrate transcript
    const transcriptRows = this._stmts.getTranscript.all(row.id);
    if (transcriptRows.length > 0) {
      meeting.transcript = transcriptRows.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp != null ? t.timestamp : undefined,
        endTimestamp: t.end_timestamp != null ? t.end_timestamp : undefined,
        confidence: t.confidence != null ? t.confidence : undefined,
        speakerName: t.speaker_name || undefined,
        speakerEmail: t.speaker_email || undefined,
        speakerDisplayName: t.speaker_display_name || undefined,
        speakerIdentified: t.speaker_identified === 1,
        speakerMapped: t.speaker_mapped === 1,
      }));
    } else {
      meeting.transcript = [];
    }

    // Hydrate speaker mapping (as object keyed by label)
    const mappingRows = this._stmts.getSpeakerMappings.all(row.id);
    if (mappingRows.length > 0) {
      meeting.speakerMapping = {};
      for (const m of mappingRows) {
        meeting.speakerMapping[m.speaker_label] = {
          email: m.email || undefined,
          name: m.name || undefined,
          confidence: m.confidence || undefined,
          method: m.method || undefined,
          emailSource: m.email_source || undefined,
        };
      }
    }

    // Also restore from JSON column as fallback (for complex nested speakerMapping)
    if (!meeting.speakerMapping && row.speaker_mapping) {
      try {
        meeting.speakerMapping = JSON.parse(row.speaker_mapping);
      } catch (err) {
        log.warn(`[Database] Corrupt speaker_mapping JSON on meeting ${row.id}:`, err.message);
      }
    }

    // Hydrate calendar attendees
    const attendeeRows = this._stmts.getCalendarAttendees.all(row.id);
    if (attendeeRows.length > 0) {
      meeting.calendarAttendees = attendeeRows.map(a => ({
        name: a.name || undefined,
        email: a.email,
        responseStatus: a.response_status || undefined,
        isOptional: a.is_optional === 1,
        isOrganizer: a.is_organizer === 1,
      }));
    }

    // Remove undefined keys for cleaner objects
    for (const key of Object.keys(meeting)) {
      if (meeting[key] === undefined) delete meeting[key];
    }

    return meeting;
  }

  /**
   * Convert a legacy JSON meeting object to SQLite row parameters.
   * Unknown fields go into extra_fields JSON column.
   */
  _meetingToRow(meeting, statusOverride = null) {
    // Determine status from the meeting data or override
    let status = statusOverride || meeting.status || 'past';
    // Legacy: if meeting was in upcomingMeetings array, it's 'upcoming'
    if (!statusOverride && !meeting.status) {
      status = 'past'; // Default for legacy data
    }

    // Collect known fields
    const knownFields = new Set([
      'id', 'type', 'status', 'title', 'date', 'start', 'end', 'duration',
      'platform', 'link', 'meetingLink', 'content', 'summary', 'recordingId',
      'videoFile', 'obsidianLink', 'vaultPath', 'calendarEventId',
      'calendarHtmlLink', 'calendarDescription', 'transcriptionProvider',
      'transcriptConfidence', 'recordingComplete', 'recordingEndTime',
      'uploadToken', 'sdkUploadId', 'recallRecordingId', 'recordingStatus',
      'subtitle', 'hasDemo', 'participantEmails', 'speakerMapping',
      'summaries', 'participants', 'transcript', 'calendarAttendees',
      'transcriptProvider', // alias
    ]);

    // Build extra_fields from any unrecognized keys
    const extra = {};
    for (const key of Object.keys(meeting)) {
      if (!knownFields.has(key)) {
        extra[key] = meeting[key];
      }
    }

    return {
      id: meeting.id,
      type: meeting.type || 'document',
      status: status,
      title: meeting.title || 'Untitled Meeting',
      date: meeting.date || new Date().toISOString(),
      start_time: meeting.start || null,
      end_time: meeting.end || null,
      duration: meeting.duration || null,
      platform: meeting.platform || null,
      meeting_link: meeting.link || meeting.meetingLink || null,
      content: meeting.content || null,
      summary: meeting.summary || null,
      recording_id: meeting.recordingId || null,
      video_file: meeting.videoFile || null,
      obsidian_link: meeting.obsidianLink || null,
      vault_path: meeting.vaultPath || null,
      calendar_event_id: meeting.calendarEventId || null,
      calendar_html_link: meeting.calendarHtmlLink || null,
      calendar_description: meeting.calendarDescription || null,
      transcription_provider: meeting.transcriptionProvider || meeting.transcriptProvider || null,
      transcript_confidence: meeting.transcriptConfidence != null ? meeting.transcriptConfidence : null,
      recording_complete: meeting.recordingComplete ? 1 : 0,
      recording_end_time: meeting.recordingEndTime || null,
      upload_token: meeting.uploadToken || null,
      sdk_upload_id: meeting.sdkUploadId || null,
      recall_recording_id: meeting.recallRecordingId || null,
      recording_status: meeting.recordingStatus || null,
      subtitle: meeting.subtitle || null,
      has_demo: meeting.hasDemo ? 1 : 0,
      participant_emails: meeting.participantEmails ? JSON.stringify(meeting.participantEmails) : null,
      speaker_mapping: meeting.speakerMapping ? JSON.stringify(meeting.speakerMapping) : null,
      summaries: meeting.summaries ? JSON.stringify(meeting.summaries) : null,
      extra_fields: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
      created_at: meeting.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Save participants for a meeting (replaces existing).
   */
  _saveParticipants(meetingId, participants) {
    this._stmts.deleteParticipants.run(meetingId);

    for (const p of participants) {
      // Collect known participant fields
      const knownFields = new Set([
        'id', 'name', 'originalName', 'email', 'organization',
        'isHost', 'platform', 'joinTime', 'googleContactResource',
        'participant_id', 'mappedFromSpeakerId',
      ]);
      const extra = {};
      for (const key of Object.keys(p)) {
        if (!knownFields.has(key)) {
          extra[key] = p[key];
        }
      }

      this._stmts.insertParticipant.run({
        meeting_id: meetingId,
        participant_id: p.id || p.participant_id || null,
        original_name: p.originalName || p.name || 'Unknown',
        name: p.name || p.originalName || 'Unknown',
        email: p.email || null,
        organization: p.organization || null,
        is_host: p.isHost ? 1 : 0,
        platform: p.platform || null,
        join_time: p.joinTime || null,
        google_contact_resource: p.googleContactResource || null,
        extra_fields: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
      });
    }
  }

  /**
   * Save transcript entries for a meeting (replaces existing).
   */
  _saveTranscript(meetingId, transcript) {
    this._stmts.deleteTranscript.run(meetingId);

    for (let i = 0; i < transcript.length; i++) {
      const entry = transcript[i];
      this._stmts.insertTranscriptEntry.run({
        meeting_id: meetingId,
        entry_order: i,
        speaker: entry.speaker || 'Unknown',
        speaker_name: entry.speakerName || null,
        speaker_email: entry.speakerEmail || null,
        speaker_display_name: entry.speakerDisplayName || null,
        text: entry.text || '',
        timestamp: entry.timestamp != null ? entry.timestamp : null,
        end_timestamp: entry.endTimestamp || entry.end_timestamp || null,
        confidence: entry.confidence != null ? entry.confidence : null,
        speaker_identified: entry.speakerIdentified ? 1 : 0,
        speaker_mapped: entry.speakerMapped ? 1 : 0,
      });
    }
  }

  /**
   * Save speaker mappings for a meeting (replaces existing).
   * @param {string} meetingId
   * @param {Object} mappings - { "Speaker 1": { email, name, ... }, ... }
   */
  _saveSpeakerMappings(meetingId, mappings) {
    this._stmts.deleteSpeakerMappings.run(meetingId);

    if (!mappings || typeof mappings !== 'object') return;

    for (const [label, info] of Object.entries(mappings)) {
      if (!info || typeof info !== 'object') continue;
      this._stmts.insertSpeakerMapping.run({
        meeting_id: meetingId,
        speaker_label: label,
        email: info.email || null,
        name: info.name || null,
        confidence: info.confidence != null ? String(info.confidence) : null,
        method: info.method || null,
        email_source: info.emailSource || info.email_source || null,
      });
    }
  }

  /**
   * Save calendar attendees for a meeting (replaces existing).
   */
  _saveCalendarAttendees(meetingId, attendees) {
    this._stmts.deleteCalendarAttendees.run(meetingId);

    if (!Array.isArray(attendees)) return;

    for (const a of attendees) {
      if (!a.email) continue;
      this._stmts.insertCalendarAttendee.run({
        meeting_id: meetingId,
        name: a.name || null,
        email: a.email,
        response_status: a.responseStatus || a.response_status || null,
        is_optional: a.isOptional || a.optional ? 1 : 0,
        is_organizer: a.isOrganizer || a.organizer ? 1 : 0,
      });
    }
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      log.info('[Database] Connection closed');
    }
  }
}

// Singleton
const databaseService = new DatabaseService();

module.exports = databaseService;
