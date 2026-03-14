const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Create a test database file
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
const dbPath = path.join(testDir, 'test.db');

// Step 1: Create and initialize a database with WAL mode
console.log('Step 1: Creating test database with WAL mode...');
const dbWrite = new Database(dbPath);
dbWrite.pragma('journal_mode = WAL');
const journalMode = dbWrite.pragma('journal_mode', { simple: true });
console.log('Initial journal_mode:', journalMode);
dbWrite.close();

// Step 2: Open the same database in read-only mode
console.log('\nStep 2: Opening same database in read-only mode...');
const dbReadOnly = new Database(dbPath, { readonly: true });
console.log('Opened read-only successfully');

// Step 3: Try to set pragma on read-only connection
console.log('\nStep 3: Attempting to set journal_mode on read-only connection...');
try {
  const result = dbReadOnly.pragma('journal_mode = WAL');
  console.log('PRAGMA execution succeeded (no error thrown)');
  console.log('Result:', result);
} catch (error) {
  console.log('PRAGMA execution threw error:');
  console.log('  Error type:', error.constructor.name);
  console.log('  Message:', error.message);
  console.log('  Code:', error.code);
}

dbReadOnly.close();

// Cleanup
fs.rmSync(testDir, { recursive: true });
console.log('\nTest complete, cleanup done.');
