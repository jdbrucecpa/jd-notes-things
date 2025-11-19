/**
 * Test script for Phase 2 Routing System
 * This script tests the routing engine by creating actual files in the vault
 */

require('dotenv').config();
const path = require('path');
const RoutingEngine = require('./src/main/routing/RoutingEngine');
const VaultStructure = require('./src/main/storage/VaultStructure');

// Get vault path from environment
const vaultPath = process.env.VAULT_PATH || './vault';
const absoluteVaultPath = path.isAbsolute(vaultPath) ? vaultPath : path.join(__dirname, vaultPath);

console.log('='.repeat(80));
console.log('JD NOTES THINGS - ROUTING SYSTEM TEST');
console.log('='.repeat(80));
console.log(`Vault Path: ${absoluteVaultPath}`);
console.log('');

// Initialize routing engine and vault structure
const router = new RoutingEngine();
const vault = new VaultStructure(absoluteVaultPath);

// Initialize vault structure
console.log('[1] Initializing vault structure...');
vault.initializeVault();
console.log('');

// Test scenarios
const testMeetings = [
  {
    name: 'Client Meeting - Alman Partners',
    data: {
      participantEmails: ['john@almanpartners.com', 'you@jdknowsthings.com'],
      meetingTitle: 'Quarterly Review',
      meetingDate: new Date('2025-11-06'),
    },
    expectedRoute: 'clients/alman-partners/meetings',
  },
  {
    name: 'Multi-Org Meeting',
    data: {
      participantEmails: [
        'john@almanpartners.com',
        'jane@capitalpartners.com',
        'you@jdknowsthings.com',
      ],
      meetingTitle: 'Multi Party Discussion',
      meetingDate: new Date('2025-11-06'),
    },
    expectedRoute: 'multiple locations (depends on settings)',
  },
  {
    name: 'Internal Team Meeting',
    data: {
      participantEmails: ['you@jdknowsthings.com', 'team@jdknowsthings.com'],
      meetingTitle: 'Team Standup',
      meetingDate: new Date('2025-11-06'),
    },
    expectedRoute: 'internal/meetings',
  },
  {
    name: 'Unfiled Meeting',
    data: {
      participantEmails: ['unknown@randomemail.com', 'stranger@somewhere.com'],
      meetingTitle: 'Mystery Meeting',
      meetingDate: new Date('2025-11-06'),
    },
    expectedRoute: '_unfiled',
  },
  {
    name: 'Industry Contact Meeting',
    data: {
      participantEmails: ['contact@herbers.com', 'you@jdknowsthings.com'],
      meetingTitle: 'Industry Discussion',
      meetingDate: new Date('2025-11-06'),
    },
    expectedRoute: 'industry/herbers/meetings',
  },
];

// Run tests
console.log('[2] Testing routing scenarios...');
console.log('');

const results = [];

testMeetings.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log('-'.repeat(80));
  console.log(`Participants: ${test.data.participantEmails.join(', ')}`);

  // Route the meeting
  const decision = router.route(test.data);
  const summary = router.getRoutingSummary(decision);

  console.log(`Expected: ${test.expectedRoute}`);
  console.log(`Actual Routes: ${decision.routes.length}`);

  decision.routes.forEach((route, routeIndex) => {
    console.log(`  Route ${routeIndex + 1}: ${route.fullPath}`);

    try {
      // Create the meeting folders
      const paths = vault.createMeetingFolders(route);

      // Create sample transcript
      const transcript = `# ${test.data.meetingTitle}

**Date:** ${test.data.meetingDate.toLocaleDateString()}
**Participants:** ${test.data.participantEmails.join(', ')}

## Transcript

This is a sample transcript for testing the routing system.

**Speaker 1 (0:00:05):**
Hello everyone, thanks for joining today's meeting.

**Speaker 2 (0:00:12):**
Happy to be here. Let's get started.

---

*Transcript generated for routing system test*
`;

      vault.saveTranscript(paths.meetingFolder, transcript);

      // Create sample index
      const indexData = {
        title: test.data.meetingTitle,
        date: test.data.meetingDate,
        participants: test.data.participantEmails.map(email => ({
          email,
          name: email.split('@')[0],
          organization: email.split('@')[1],
        })),
        platform: 'test',
        meetingType: test.name.toLowerCase().replace(/\s+/g, '-'),
        duration: '15 minutes',
        meetingPath: paths.meetingFolder,
      };

      vault.saveIndex(paths.meetingFolder, indexData);

      console.log(`  ✓ Created files at: ${paths.meetingFolder}`);
      results.push({ test: test.name, route: route.fullPath, success: true });
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      results.push({
        test: test.name,
        route: route.fullPath,
        success: false,
        error: error.message,
      });
    }
  });

  console.log('');
});

// Summary
console.log('='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));

const successful = results.filter(r => r.success).length;
const failed = results.filter(r => !r.success).length;

console.log(`Total Tests: ${testMeetings.length}`);
console.log(`Routes Created: ${results.length}`);
console.log(`Successful: ${successful}`);
console.log(`Failed: ${failed}`);
console.log('');

if (successful > 0) {
  console.log('Successfully Created:');
  results
    .filter(r => r.success)
    .forEach(r => {
      console.log(`  ✓ ${r.test} -> ${r.route}`);
    });
  console.log('');
}

if (failed > 0) {
  console.log('Failed:');
  results
    .filter(r => !r.success)
    .forEach(r => {
      console.log(`  ✗ ${r.test} -> ${r.error}`);
    });
  console.log('');
}

console.log('='.repeat(80));
console.log(`Check your vault at: ${absoluteVaultPath}`);
console.log('='.repeat(80));
console.log('');
console.log('You can now:');
console.log('1. Open the vault folder and verify the structure');
console.log('2. Open the folders in Obsidian to see the notes');
console.log('3. Edit config/routing.yaml to test different routing rules');
console.log('4. Run this script again to test routing changes');
console.log('');
