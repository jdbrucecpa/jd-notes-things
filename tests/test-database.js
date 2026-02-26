/**
 * Headless test for DatabaseService (v1.3 SQLite migration)
 * Runs outside Electron by mocking app.getPath and electron-log.
 *
 * Tests: schema creation, CRUD, JSON migration, query methods.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Create a temp directory for test database
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdnotes-test-'));
const testDbPath = path.join(testDir, 'meetings.db');

console.log(`[Test] Using temp directory: ${testDir}`);

// Mock Electron modules before requiring databaseService
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') {
    return request; // Let the mock handle it
  }
  if (request === 'electron-log') {
    return request;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Install mocks
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: {
      getPath: (name) => {
        if (name === 'userData') return testDir;
        return testDir;
      },
      whenReady: () => Promise.resolve(),
    },
  },
};

require.cache[require.resolve('electron-log')] = {
  id: 'electron-log',
  filename: 'electron-log',
  loaded: true,
  exports: {
    info: (...args) => console.log('[LOG]', ...args),
    warn: (...args) => console.warn('[LOG WARN]', ...args),
    error: (...args) => console.error('[LOG ERROR]', ...args),
    debug: (..._args) => {},
  },
};

// Now require the actual module
const databaseService = require('../src/main/services/databaseService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEq(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message} (expected: ${expected}, got: ${actual})`);
  }
}

// ===================================================================
// Test 1: Schema Creation
// ===================================================================
console.log('\n=== Test 1: Schema Creation ===');

try {
  databaseService.initialize();
  assert(fs.existsSync(testDbPath), 'Database file created');

  // Check tables exist
  const tables = databaseService.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map(r => r.name);

  assert(tables.includes('meetings'), 'meetings table exists');
  assert(tables.includes('participants'), 'participants table exists');
  assert(tables.includes('transcript_entries'), 'transcript_entries table exists');
  assert(tables.includes('speaker_mappings'), 'speaker_mappings table exists');
  assert(tables.includes('calendar_attendees'), 'calendar_attendees table exists');

  // Check indexes
  const indexes = databaseService.db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
    .all()
    .map(r => r.name);

  assert(indexes.includes('idx_meetings_date'), 'idx_meetings_date index exists');
  assert(indexes.includes('idx_meetings_status'), 'idx_meetings_status index exists');
  assert(indexes.includes('idx_meetings_calendar_event'), 'idx_meetings_calendar_event index exists');
  assert(indexes.includes('idx_participants_email'), 'idx_participants_email index exists');
  assert(indexes.includes('idx_participants_meeting'), 'idx_participants_meeting index exists');
  assert(indexes.includes('idx_transcript_meeting'), 'idx_transcript_meeting index exists');
  assert(indexes.includes('idx_calendar_attendees_email'), 'idx_calendar_attendees_email index exists');

  // Check WAL mode
  const journalMode = databaseService.db.pragma('journal_mode', { simple: true });
  assertEq(journalMode, 'wal', 'WAL mode enabled');

  // Check schema version
  const version = databaseService.db.pragma('user_version', { simple: true });
  assertEq(version, 1, 'Schema version is 1');
} catch (err) {
  failed++;
  console.error('  ✗ FAIL: Schema creation threw:', err.message);
}

// ===================================================================
// Test 2: CRUD Operations
// ===================================================================
console.log('\n=== Test 2: CRUD Operations ===');

try {
  // Create a meeting
  const testMeeting = {
    id: 'test-meeting-001',
    type: 'document',
    status: 'past',
    title: 'Test Meeting with Client',
    date: '2026-02-25T10:00:00Z',
    startTime: '2026-02-25T10:00:00Z',
    endTime: '2026-02-25T11:00:00Z',
    duration: 3600,
    platform: 'zoom',
    content: '# Test Meeting\n\nThis is test content.',
    recordingId: 'rec-001',
    calendarEventId: 'cal-event-001',
    calendarHtmlLink: 'https://calendar.google.com/event/001',
    participants: [
      { participantId: 'p1', originalName: 'John Doe', name: 'John Doe', email: 'john@example.com', organization: 'Acme Corp', isHost: true },
      { participantId: 'p2', originalName: 'Jane Smith', name: 'Jane Smith', email: 'jane@example.com', organization: 'WidgetCo', isHost: false },
    ],
    transcript: [
      { speaker: 'Speaker 1', text: 'Hello everyone', timestamp: 0, endTimestamp: 2 },
      { speaker: 'Speaker 2', text: 'Hi there', timestamp: 2, endTimestamp: 4 },
    ],
    speakerMapping: {
      'Speaker 1': { email: 'john@example.com', name: 'John Doe', confidence: 'high' },
    },
  };

  databaseService.saveMeeting(testMeeting);
  assert(true, 'saveMeeting() succeeded');

  // Read back
  const retrieved = databaseService.getMeeting('test-meeting-001');
  assert(retrieved !== null, 'getMeeting() returns meeting');
  assertEq(retrieved.title, 'Test Meeting with Client', 'Title preserved');
  assertEq(retrieved.platform, 'zoom', 'Platform preserved');
  assertEq(retrieved.calendarEventId, 'cal-event-001', 'Calendar event ID preserved');
  assert(Array.isArray(retrieved.participants), 'Participants is array');
  assertEq(retrieved.participants.length, 2, 'Two participants preserved');
  assertEq(retrieved.participants[0].originalName, 'John Doe', 'Original name preserved (IMMUTABLE check)');
  assertEq(retrieved.participants[0].email, 'john@example.com', 'Participant email preserved');
  assert(Array.isArray(retrieved.transcript), 'Transcript is array');
  assertEq(retrieved.transcript.length, 2, 'Two transcript entries preserved');

  // Update a field
  databaseService.updateMeetingField('test-meeting-001', 'title', 'Updated Title');
  const updated = databaseService.getMeeting('test-meeting-001');
  assertEq(updated.title, 'Updated Title', 'updateMeetingField() works');

  // Get all meetings
  const all = databaseService.getAllMeetings();
  assert(all.pastMeetings.length >= 1, 'getAllMeetings() returns past meetings');

  // Delete
  databaseService.deleteMeeting('test-meeting-001');
  const deleted = databaseService.getMeeting('test-meeting-001');
  assertEq(deleted, null, 'deleteMeeting() removes meeting');
} catch (err) {
  failed++;
  console.error('  ✗ FAIL: CRUD operation threw:', err.message);
}

// ===================================================================
// Test 3: Query Methods
// ===================================================================
console.log('\n=== Test 3: Query Methods ===');

try {
  // Insert several meetings for query testing
  const meetings = [
    {
      id: 'q-001', type: 'document', status: 'past', title: 'Q1 Review',
      date: '2026-01-15T10:00:00Z', platform: 'zoom', recordingId: 'rec-q1',
      calendarEventId: 'cal-q1',
      participants: [{ participantId: 'p1', originalName: 'Alice', name: 'Alice', email: 'alice@acme.com', organization: 'Acme' }],
    },
    {
      id: 'q-002', type: 'document', status: 'past', title: 'Q2 Planning',
      date: '2026-02-10T14:00:00Z', platform: 'teams',
      // No recording - orphaned calendar event
      calendarEventId: 'cal-q2',
      participants: [{ participantId: 'p2', originalName: 'Bob', name: 'Bob', email: 'bob@acme.com', organization: 'Acme' }],
    },
    {
      id: 'q-003', type: 'document', status: 'past', title: 'Team Standup',
      date: '2026-02-20T09:00:00Z', platform: 'zoom', recordingId: 'rec-q3',
      // No calendar event - orphaned recording
      participants: [
        { participantId: 'p1', originalName: 'Alice', name: 'Alice', email: 'alice@acme.com', organization: 'Acme' },
        { participantId: 'p3', originalName: 'Charlie', name: 'Charlie', email: 'charlie@widgetco.com', organization: 'WidgetCo' },
      ],
    },
  ];

  for (const m of meetings) {
    databaseService.saveMeeting(m);
  }

  // getMeetingByCalendarEvent
  const calMatch = databaseService.getMeetingByCalendarEvent('cal-q1');
  assert(calMatch !== null, 'getMeetingByCalendarEvent() finds match');
  assertEq(calMatch.id, 'q-001', 'Correct meeting found by calendar event');

  // getMeetingsInRange
  const rangeResults = databaseService.getMeetingsInRange('2026-02-01', '2026-02-28');
  assert(rangeResults.length >= 2, `getMeetingsInRange() returns meetings in Feb (got ${rangeResults.length})`);

  // getMeetingsForContact
  const contactResults = databaseService.getMeetingsForContact('alice@acme.com');
  assert(contactResults.length >= 2, `getMeetingsForContact(alice) returns ${contactResults.length} meetings`);

  // getMeetingCountForContact
  const count = databaseService.getMeetingCountForContact('alice@acme.com');
  assert(count >= 2, `getMeetingCountForContact(alice) = ${count}`);

  // getMeetingsForOrganization
  const orgResults = databaseService.getMeetingsForOrganization('Acme');
  assert(orgResults.length >= 2, `getMeetingsForOrganization(Acme) returns ${orgResults.length} meetings`);

  // Reports: meetings without recordings
  const noRecordings = databaseService.getMeetingsWithoutRecordings('2026-01-01', '2026-12-31');
  assert(noRecordings.length >= 1, `getMeetingsWithoutRecordings() found ${noRecordings.length}`);
  assert(noRecordings.some(m => m.id === 'q-002'), 'q-002 (no recording) found in report');

  // Reports: recordings without calendar events
  const noCalendar = databaseService.getRecordingsWithoutCalendarEvents('2026-01-01', '2026-12-31');
  assert(noCalendar.length >= 1, `getRecordingsWithoutCalendarEvents() found ${noCalendar.length}`);
  assert(noCalendar.some(m => m.id === 'q-003'), 'q-003 (no calendar) found in report');
} catch (err) {
  failed++;
  console.error('  ✗ FAIL: Query method threw:', err.message);
}

// ===================================================================
// Test 4: JSON Migration
// ===================================================================
console.log('\n=== Test 4: JSON Migration ===');

try {
  // Close current db to start fresh
  databaseService.close();
  fs.unlinkSync(testDbPath);

  // Create a mock meetings.json
  const mockMeetingsJson = {
    upcomingMeetings: [
      {
        id: 'upcoming-001', type: 'calendar', title: 'Future Meeting',
        date: '2026-03-01T10:00:00Z', platform: 'zoom',
        participants: [{ participantId: 'p1', originalName: 'Dave', name: 'Dave', email: 'dave@test.com' }],
      },
    ],
    pastMeetings: [
      {
        id: 'past-001', type: 'document', title: 'Past Meeting',
        date: '2026-01-01T10:00:00Z', platform: 'teams', recordingId: 'rec-past1',
        content: '# Past Notes',
        participants: [{ participantId: 'p2', originalName: 'Eve', name: 'Eve', email: 'eve@test.com' }],
        transcript: [{ speaker: 'Speaker 1', text: 'Test', timestamp: 0 }],
      },
    ],
  };

  const meetingsJsonPath = path.join(testDir, 'meetings.json');
  fs.writeFileSync(meetingsJsonPath, JSON.stringify(mockMeetingsJson, null, 2));
  assert(fs.existsSync(meetingsJsonPath), 'Mock meetings.json created');

  // Re-initialize (creates fresh schema)
  databaseService.dbPath = testDbPath;
  databaseService.initialize();

  // Run migration
  databaseService.migrateFromJson(meetingsJsonPath);

  // Verify backup was created
  assert(fs.existsSync(meetingsJsonPath + '.bak'), 'meetings.json.bak created');
  assert(!fs.existsSync(meetingsJsonPath), 'Original meetings.json removed');

  // Verify data was migrated
  const all = databaseService.getAllMeetings();
  assert(all.upcomingMeetings.length >= 1, `Upcoming meetings migrated (${all.upcomingMeetings.length})`);
  assert(all.pastMeetings.length >= 1, `Past meetings migrated (${all.pastMeetings.length})`);

  const pastMeeting = databaseService.getMeeting('past-001');
  assert(pastMeeting !== null, 'past-001 found after migration');
  assertEq(pastMeeting.title, 'Past Meeting', 'Meeting title preserved in migration');
  assertEq(pastMeeting.recordingId, 'rec-past1', 'Recording ID preserved in migration');
  assert(pastMeeting.participants.length >= 1, 'Participants preserved in migration');
  assertEq(pastMeeting.participants[0].originalName, 'Eve', 'Participant originalName preserved');
} catch (err) {
  failed++;
  console.error('  ✗ FAIL: Migration threw:', err.message);
  console.error(err.stack);
}

// ===================================================================
// Cleanup & Summary
// ===================================================================
console.log('\n=== Cleanup ===');
try {
  databaseService.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('  Temp directory cleaned up');
} catch (e) {
  console.log('  Warning: cleanup failed:', e.message);
}

console.log(`\n========================================`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed > 0 ? 1 : 0);
