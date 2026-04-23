/**
 * One-off script to trim transcript entries from the meetings database.
 *
 * Usage: node trim-transcript.js
 *
 * Finds the "Yasmin Weston and J.D. Bruce" meeting and removes all
 * transcript entries after timecode 1:03:37 (3817 seconds).
 *
 * Uses sql.js (WASM-based SQLite) since better-sqlite3 is compiled for Electron.
 * IMPORTANT: The app must NOT be running — SQLite WAL mode can conflict.
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(
  process.env.APPDATA,
  'jd-notes-things',
  'meetings.db'
);

// 1:03:37 in seconds
const CUTOFF_TIMESTAMP = 3817;

async function main() {
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  // Step 1: Find the meeting
  const meetings = db.exec(
    "SELECT id, title, date FROM meetings WHERE title LIKE '%Yasmin Weston%' AND date LIKE '2026-04-0%'"
  );

  if (!meetings.length || !meetings[0].values.length) {
    console.log('Meeting not found. Listing recent meetings:');
    const recent = db.exec('SELECT id, title, date FROM meetings ORDER BY date DESC LIMIT 10');
    if (recent.length) {
      recent[0].values.forEach(function(row) {
        console.log('  ' + row[2] + ' - ' + row[1] + ' (' + row[0] + ')');
      });
    }
    db.close();
    process.exit(1);
  }

  var meetingId = meetings[0].values[0][0];
  var meetingTitle = meetings[0].values[0][1];
  var meetingDate = meetings[0].values[0][2];
  console.log('Found meeting: "' + meetingTitle + '" on ' + meetingDate + ' (ID: ' + meetingId + ')');

  // Step 2: Count entries using parameterized queries
  var stmt;

  stmt = db.prepare('SELECT COUNT(*) FROM transcript_entries WHERE meeting_id = ?');
  stmt.bind([meetingId]);
  stmt.step();
  var totalCount = stmt.get()[0];
  stmt.free();

  stmt = db.prepare('SELECT COUNT(*) FROM transcript_entries WHERE meeting_id = ? AND timestamp <= ?');
  stmt.bind([meetingId, CUTOFF_TIMESTAMP]);
  stmt.step();
  var keepCount = stmt.get()[0];
  stmt.free();

  stmt = db.prepare('SELECT COUNT(*) FROM transcript_entries WHERE meeting_id = ? AND timestamp > ?');
  stmt.bind([meetingId, CUTOFF_TIMESTAMP]);
  stmt.step();
  var deleteCount = stmt.get()[0];
  stmt.free();

  console.log('\nTotal transcript entries: ' + totalCount);
  console.log('Entries to KEEP (<= ' + CUTOFF_TIMESTAMP + 's / 1:03:37): ' + keepCount);
  console.log('Entries to DELETE (> ' + CUTOFF_TIMESTAMP + 's): ' + deleteCount);

  // Step 3: Show the last entries we're keeping and first entries we're deleting
  console.log('\n--- Last 3 entries to KEEP ---');
  var lastKeep = db.exec(
    'SELECT entry_order, speaker_display_name, text, timestamp FROM transcript_entries ' +
    'WHERE meeting_id = \'' + meetingId + '\' AND timestamp <= ' + CUTOFF_TIMESTAMP +
    ' ORDER BY entry_order DESC LIMIT 3'
  );
  if (lastKeep.length) {
    lastKeep[0].values.reverse().forEach(function(row) {
      var mins = Math.floor(row[3] / 60);
      var secs = Math.floor(row[3] % 60);
      console.log('  [' + mins + ':' + String(secs).padStart(2, '0') + '] ' + row[1] + ': ' + row[2]);
    });
  }

  console.log('\n--- First 3 entries to DELETE ---');
  var firstDel = db.exec(
    'SELECT entry_order, speaker_display_name, text, timestamp FROM transcript_entries ' +
    'WHERE meeting_id = \'' + meetingId + '\' AND timestamp > ' + CUTOFF_TIMESTAMP +
    ' ORDER BY entry_order ASC LIMIT 3'
  );
  if (firstDel.length) {
    firstDel[0].values.forEach(function(row) {
      var mins = Math.floor(row[3] / 60);
      var secs = Math.floor(row[3] % 60);
      console.log('  [' + mins + ':' + String(secs).padStart(2, '0') + '] ' + row[1] + ': ' + row[2]);
    });
  }

  if (deleteCount === 0) {
    console.log('\nNothing to delete.');
    db.close();
    return;
  }

  // Step 4: Perform the delete
  stmt = db.prepare('DELETE FROM transcript_entries WHERE meeting_id = ? AND timestamp > ?');
  stmt.bind([meetingId, CUTOFF_TIMESTAMP]);
  stmt.step();
  stmt.free();
  var changes = db.getRowsModified();
  console.log('\nDeleted ' + changes + ' transcript entries.');

  // Step 5: Update meeting duration
  stmt = db.prepare('SELECT MAX(end_timestamp) FROM transcript_entries WHERE meeting_id = ?');
  stmt.bind([meetingId]);
  stmt.step();
  var maxTs = stmt.get()[0];
  stmt.free();

  if (maxTs) {
    var newDuration = Math.ceil(maxTs);
    stmt = db.prepare('UPDATE meetings SET duration = ?, updated_at = datetime(\'now\') WHERE id = ?');
    stmt.bind([newDuration, meetingId]);
    stmt.step();
    stmt.free();
    console.log('Updated meeting duration to ' + newDuration + 's (' + Math.floor(newDuration / 60) + 'm ' + (newDuration % 60) + 's)');
  }

  // Step 6: Write back to file
  var data = db.export();
  var buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  console.log('\nDatabase saved to ' + DB_PATH);

  db.close();
  console.log('Done.');
}

main().catch(function(err) {
  console.error('Error:', err);
  process.exit(1);
});
