/**
 * Quick Pattern Validation Script
 * Run this anytime to verify pattern system is working
 * Usage: node quick-test-patterns.js
 */

const TranscriptParser = require('./src/main/import/TranscriptParser');
const patternConfigLoader = require('./src/main/import/PatternConfigLoader');
const fs = require('fs');

const TESTS = [
  {
    name: 'Basic Inline Format',
    file: './test-transcripts/basic-inline.txt',
    expectedSpeakers: ['John Smith', 'Mary Johnson'],
    expectedEntries: 4,
  },
  {
    name: 'Header Format',
    file: './test-transcripts/header-format.txt',
    expectedSpeakers: ['John Smith', 'Mary Johnson'],
    expectedEntries: 4,
  },
  {
    name: 'Special Characters (NEW in 10.8.1)',
    file: './test-transcripts/special-characters.txt',
    expectedSpeakers: ['Dr. Smith', "O'Brien", 'Speaker 1', 'Mary-Anne Johnson', 'Prof. Williams Jr.'],
    expectedEntries: 5,
  },
  {
    name: 'Timestamps',
    file: './test-transcripts/with-timestamps.txt',
    expectedEntries: 5,
    hasTimestamps: true,
  },
  {
    name: 'Mixed Format',
    file: './test-transcripts/mixed-format.txt',
    expectedSpeakers: ['Dr. Smith', "O'Brien", 'Speaker 1', 'Mary-Anne', 'Prof. Williams Jr.'],
  },
];

async function runQuickTest() {
  console.log('🧪 Phase 10.8.1 Quick Validation\n');
  console.log('═'.repeat(60));

  let passed = 0;
  let failed = 0;

  // Check if config loads
  try {
    const config = await patternConfigLoader.loadConfig();
    console.log(`✅ Config loaded: ${config.patterns.length} patterns`);
  } catch (error) {
    console.log(`❌ Config load failed: ${error.message}`);
    process.exit(1);
  }

  console.log('═'.repeat(60) + '\n');

  const parser = new TranscriptParser();

  for (const test of TESTS) {
    process.stdout.write(`Testing: ${test.name}... `);

    // Check if file exists
    if (!fs.existsSync(test.file)) {
      console.log(`❌ SKIP (file not found)`);
      continue;
    }

    try {
      const result = await parser.parseFile(test.file);

      let testPassed = true;
      const issues = [];

      // Check entry count
      if (test.expectedEntries && result.entries.length !== test.expectedEntries) {
        testPassed = false;
        issues.push(`entries: expected ${test.expectedEntries}, got ${result.entries.length}`);
      }

      // Check speakers
      if (test.expectedSpeakers) {
        const speakers = parser.getSpeakers(result);
        const missingSpeakers = test.expectedSpeakers.filter(s => !speakers.includes(s));
        if (missingSpeakers.length > 0) {
          testPassed = false;
          issues.push(`missing speakers: ${missingSpeakers.join(', ')}`);
        }
      }

      // Check timestamps
      if (test.hasTimestamps) {
        if (!result.hasTimestamps) {
          testPassed = false;
          issues.push('timestamps not detected');
        }
      }

      if (testPassed) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log(`❌ FAIL`);
        issues.forEach(issue => console.log(`  - ${issue}`));
        failed++;
      }
    } catch (error) {
      console.log(`❌ ERROR: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n✅ All tests passed! Phase 10.8.1 is working correctly.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Check the output above.');
    process.exit(1);
  }
}

runQuickTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
