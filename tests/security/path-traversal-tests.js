/**
 * Path Traversal Penetration Tests
 * Tests VaultStructure.validatePathWithinVault() implementation
 *
 * Run: node tests/security/path-traversal-tests.js
 */

const path = require('path');
const VaultStructure = require('../../src/main/storage/VaultStructure');

/**
 * Path Traversal Attack Payloads
 */
const PATH_TRAVERSAL_PAYLOADS = {
  // Basic directory traversal
  basicTraversal: '../../../etc/passwd',
  windowsTraversal: '..\\..\\..\\Windows\\System32\\config\\SAM',

  // URL encoded traversal
  urlEncoded: '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  doubleEncoded: '%252e%252e%252f%252e%252e%252fetc%252fpasswd',

  // Unicode traversal
  unicode: '..\\u002f..\\u002f..\\u002fetc\\u002fpasswd',

  // NULL byte injection (bypasses some filters)
  nullByte: '../../../etc/passwd\x00.md',

  // Backslash traversal (Windows)
  backslash: '..\\..\\..\\sensitive-file.txt',

  // Mixed slash traversal
  mixedSlash: '../.\\../.\\.\\sensitive.txt',

  // Absolute path injection
  absolutePath: '/etc/passwd',
  windowsAbsolute: 'C:\\Windows\\System32\\config\\SAM',

  // Dot-dot-slash variations
  dotDotSlash: '....//....//....//etc/passwd',
  dotDotBackslash: '....\\\\....\\\\....\\\\sensitive.txt',

  // UNC path (Windows network share)
  uncPath: '\\\\attacker.com\\share\\malware.exe',

  // Symlink-style attack
  symlinkAttack: 'meetings/../../sensitive-data/api-keys.txt',

  // Vault escape attempts
  vaultEscape1: 'clients/../../../.env',
  vaultEscape2: 'clients/acme/meetings/../../../../package.json',
  vaultEscape3: 'internal/meetings/../../../../../../etc/passwd',
};

/**
 * Test Cases
 */
const TEST_CASES = [
  {
    name: 'Basic Traversal Attack',
    relativePath: 'clients/acme/meetings/../../../sensitive.txt',
    shouldFail: true,
    description: 'Attempts to escape vault using relative paths',
  },
  {
    name: 'Windows Backslash Traversal',
    relativePath: 'clients\\acme\\meetings\\..\\..\\..\\sensitive.txt',
    shouldFail: true,
    description: 'Windows-style directory traversal',
  },
  {
    name: 'Absolute Path Injection',
    relativePath: '/etc/passwd',
    shouldFail: true,
    description: 'Attempts to use absolute path instead of relative',
  },
  {
    name: 'Windows Absolute Path',
    relativePath: 'C:\\Windows\\System32\\config\\SAM',
    shouldFail: true,
    description: 'Windows absolute path injection',
  },
  {
    name: 'UNC Network Path',
    relativePath: '\\\\attacker.com\\share\\malware.exe',
    shouldFail: true,
    description: 'Windows UNC network share path',
  },
  {
    name: 'Mixed Slash Attack',
    relativePath: 'clients/../.\\../.\\.\\sensitive.txt',
    shouldFail: true,
    description: 'Mixed forward/backward slashes to confuse parser',
  },
  {
    name: 'Legitimate Path - Same Directory',
    relativePath: 'clients/acme/meetings/2025-01-15-meeting.md',
    shouldFail: false,
    description: 'Normal file path within vault',
  },
  {
    name: 'Legitimate Path - Subdirectory',
    relativePath: 'clients/acme/meetings/summaries/summary.md',
    shouldFail: false,
    description: 'Deep subdirectory path (legitimate)',
  },
  {
    name: 'Legitimate Path - Root of Vault',
    relativePath: 'README.md',
    shouldFail: false,
    description: 'File at root of vault',
  },
  {
    name: 'Vault Root Access',
    relativePath: '',
    shouldFail: false,
    description: 'Accessing vault root itself',
  },
];

/**
 * Run Tests
 */
function runPathTraversalTests() {
  console.log('='.repeat(70));
  console.log('PATH TRAVERSAL PENETRATION TESTS');
  console.log('='.repeat(70));
  console.log();

  // Create test vault structure
  const testVaultPath = path.join(__dirname, '..', '..', 'test-vault');
  const vaultStructure = new VaultStructure(testVaultPath);

  let passedTests = 0;
  let failedTests = 0;
  const vulnerabilities = [];

  for (const testCase of TEST_CASES) {
    console.log(`\nTest: ${testCase.name}`);
    console.log(`  Description: ${testCase.description}`);
    console.log(`  Path: ${testCase.relativePath}`);
    console.log(`  Should Fail: ${testCase.shouldFail}`);

    try {
      // Test the actual production code path: getAbsolutePath()
      // This validates the relative path THEN joins with vault path
      const absolutePath = vaultStructure.getAbsolutePath(testCase.relativePath);

      if (testCase.shouldFail) {
        // Test FAILED - path traversal attack succeeded!
        console.log(`  ❌ VULNERABILITY: Path traversal attack succeeded!`);
        console.log(`  Resolved to: ${absolutePath}`);
        failedTests++;
        vulnerabilities.push({
          test: testCase.name,
          path: testCase.relativePath,
          severity: 'HIGH',
          description: 'Path traversal attack bypassed validation',
        });
      } else {
        // Test PASSED - legitimate path allowed
        console.log(`  ✅ PASS: Legitimate path allowed`);
        passedTests++;
      }
    } catch (error) {
      if (testCase.shouldFail) {
        // Test PASSED - attack blocked!
        console.log(`  ✅ PASS: Attack blocked`);
        console.log(`  Error: ${error.message}`);
        passedTests++;
      } else {
        // Test FAILED - legitimate path blocked!
        console.log(`  ❌ FAIL: Legitimate path incorrectly blocked`);
        console.log(`  Error: ${error.message}`);
        failedTests++;
        vulnerabilities.push({
          test: testCase.name,
          path: testCase.relativePath,
          severity: 'MEDIUM',
          description: 'Legitimate path incorrectly blocked',
        });
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Tests: ${TEST_CASES.length}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);

  if (vulnerabilities.length > 0) {
    console.log('\n⚠️  VULNERABILITIES DETECTED:');
    vulnerabilities.forEach((vuln, index) => {
      console.log(`\n${index + 1}. ${vuln.test}`);
      console.log(`   Severity: ${vuln.severity}`);
      console.log(`   Path: ${vuln.path}`);
      console.log(`   Description: ${vuln.description}`);
    });
  } else {
    console.log('\n✅ No vulnerabilities detected! Path traversal protection is working.');
  }

  console.log('\n' + '='.repeat(70));
  process.exit(vulnerabilities.length > 0 ? 1 : 0);
}

/**
 * Manual Test Instructions
 */
const MANUAL_TEST_INSTRUCTIONS = `
PATH TRAVERSAL MANUAL TESTING GUIDE
====================================

PREREQUISITES:
1. Know your vault path (from .env: VAULT_PATH)
2. Have file system access to check actual file locations

MANUAL TEST PROCEDURE:

Test 1: Meeting Export with Traversal Path
-------------------------------------------
1. Create a meeting with ID "test-meeting-123"
2. Via IPC, call obsidian:exportMeeting with crafted meeting data:
   {
     "id": "test-meeting-123",
     "routing": {
       "organization": "../../..",
       "slug": "sensitive-folder"
     }
   }
3. Check if files are created outside vault
4. EXPECTED: Export should fail with path traversal error
5. VERIFY: No files created outside vault directory

Test 2: Import File with Absolute Path
---------------------------------------
1. Call import:importFile with absolute path:
   { "filePath": "/etc/passwd" }
2. EXPECTED: Should reject absolute paths
3. VERIFY: Error logged, no file access

Test 3: Template Path Injection
--------------------------------
1. Create malicious template in config/templates:
   Name: "../../sensitive-data.yaml"
2. Scan templates
3. EXPECTED: Template should be rejected or path normalized
4. VERIFY: No access to files outside config/templates

Test 4: Vault Configuration Change
-----------------------------------
1. Change VAULT_PATH to point to system directory
   VAULT_PATH=/etc
2. Restart app
3. Attempt to export meeting
4. EXPECTED: App should validate vault path or reject dangerous paths
5. VERIFY: No system files modified

VALIDATION CRITERIA:
- ✅ All path traversal attempts blocked
- ✅ Error messages logged for security team
- ✅ No files created/accessed outside vault
- ✅ Legitimate paths within vault work normally
- ✅ Path normalization handles edge cases (mixed slashes, etc.)
`;

// Export for programmatic use
module.exports = {
  PATH_TRAVERSAL_PAYLOADS,
  TEST_CASES,
  runPathTraversalTests,
  MANUAL_TEST_INSTRUCTIONS,
};

// Run tests if executed directly
if (require.main === module) {
  runPathTraversalTests();
}
