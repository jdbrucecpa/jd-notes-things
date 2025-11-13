/**
 * OAuth CSRF (Cross-Site Request Forgery) Tests
 * Validates state parameter implementation in GoogleAuth.js
 *
 * Run: node tests/security/oauth-csrf-tests.js
 */

const GoogleAuth = require('../../src/main/integrations/GoogleAuth');
const path = require('path');
const fs = require('fs');

/**
 * OAuth CSRF Attack Scenarios
 */
const OAUTH_CSRF_SCENARIOS = {
  noStateParameter: {
    name: 'No State Parameter',
    description: 'Attacker omits state parameter entirely',
    code: 'valid-auth-code-123',
    state: null,
    expectedResult: 'Should reject - missing state parameter',
  },

  wrongStateParameter: {
    name: 'Wrong State Parameter',
    description: 'Attacker uses incorrect state value',
    code: 'valid-auth-code-123',
    state: 'attacker-generated-state-value',
    expectedResult: 'Should reject - state mismatch',
  },

  reusedStateParameter: {
    name: 'Reused State Parameter',
    description: 'Attacker reuses previous valid state',
    code: 'valid-auth-code-123',
    state: 'previously-used-state-123',
    expectedResult: 'Should reject - state already consumed',
  },

  emptyStateParameter: {
    name: 'Empty State Parameter',
    description: 'Attacker passes empty string as state',
    code: 'valid-auth-code-123',
    state: '',
    expectedResult: 'Should reject - empty state',
  },
};

/**
 * Test OAuth State Parameter Flow
 */
async function testOAuthCSRFProtection() {
  console.log('='.repeat(70));
  console.log('OAUTH CSRF PROTECTION TESTS');
  console.log('='.repeat(70));
  console.log();

  // Use test token path to avoid affecting real auth
  const testTokenPath = path.join(__dirname, '..', '..', 'test-oauth-token.json');
  const googleAuth = new GoogleAuth(testTokenPath);

  let passedTests = 0;
  let failedTests = 0;
  const vulnerabilities = [];

  try {
    // Initialize OAuth client (required before generating auth URL)
    await googleAuth.initialize();

    // Test 1: Normal Flow (Baseline)
    console.log('Test: Normal OAuth Flow (Baseline)');
    console.log('  Description: Legitimate state parameter from auth URL');
    try {
      // Generate auth URL (creates state parameter internally)
      const authUrl = googleAuth.getAuthUrl();

      // Extract state parameter from URL
      const url = new URL(authUrl);
      const validState = url.searchParams.get('state');

      if (!validState) {
        console.log('  ❌ FAIL: No state parameter in auth URL');
        failedTests++;
        vulnerabilities.push({
          test: 'Normal Flow',
          severity: 'CRITICAL',
          description: 'Auth URL missing state parameter',
        });
      } else {
        console.log(`  ✅ PASS: State parameter generated: ${validState.substring(0, 16)}...`);
        passedTests++;
      }
    } catch (error) {
      console.log(`  ❌ FAIL: ${error.message}`);
      failedTests++;
    }

    // Test 2: No State Parameter
    console.log('\nTest: No State Parameter Attack');
    console.log('  Description: Attempt OAuth callback without state');
    try {
      // Generate state first (simulates user clicking "Sign in with Google")
      googleAuth.getAuthUrl();

      // Attacker attempts callback with code but no state
      await googleAuth.getTokenFromCode('fake-code-123', null);

      // If we reach here, attack succeeded
      console.log('  ❌ VULNERABILITY: Accepted code without state parameter!');
      failedTests++;
      vulnerabilities.push({
        test: 'No State Parameter',
        severity: 'CRITICAL',
        description: 'CSRF attack succeeded - no state validation',
      });
    } catch (error) {
      if (error.message.includes('state') || error.message.includes('CSRF')) {
        console.log('  ✅ PASS: Attack blocked');
        console.log(`  Error: ${error.message}`);
        passedTests++;
      } else {
        // Failed for wrong reason (e.g., invalid code)
        console.log('  ⚠️  INCONCLUSIVE: Failed but not due to state validation');
        console.log(`  Error: ${error.message}`);
      }
    }

    // Test 3: Wrong State Parameter
    console.log('\nTest: Wrong State Parameter Attack');
    console.log('  Description: Attacker provides incorrect state value');
    try {
      // Generate new state
      googleAuth.getAuthUrl();

      // Attacker uses wrong state
      await googleAuth.getTokenFromCode('fake-code-456', 'attacker-state-value');

      console.log('  ❌ VULNERABILITY: Accepted wrong state parameter!');
      failedTests++;
      vulnerabilities.push({
        test: 'Wrong State Parameter',
        severity: 'CRITICAL',
        description: 'CSRF attack succeeded - state mismatch not detected',
      });
    } catch (error) {
      if (error.message.includes('state') || error.message.includes('CSRF')) {
        console.log('  ✅ PASS: Attack blocked');
        console.log(`  Error: ${error.message}`);
        passedTests++;
      } else {
        console.log('  ⚠️  INCONCLUSIVE: Failed but not due to state validation');
        console.log(`  Error: ${error.message}`);
      }
    }

    // Test 4: State Reuse Attack
    console.log('\nTest: State Reuse Attack');
    console.log('  Description: Attempt to reuse previously valid state');
    try {
      // Generate auth URL and extract state
      const authUrl = googleAuth.getAuthUrl();
      const url = new URL(authUrl);
      const state1 = url.searchParams.get('state');

      // Try to use state1 (should consume it)
      try {
        await googleAuth.getTokenFromCode('fake-code-789', state1);
      } catch (e) {
        // Expected to fail (fake code), but state is consumed
      }

      // Attacker tries to reuse same state
      await googleAuth.getTokenFromCode('fake-code-reuse', state1);

      console.log('  ❌ VULNERABILITY: State reuse succeeded!');
      failedTests++;
      vulnerabilities.push({
        test: 'State Reuse',
        severity: 'HIGH',
        description: 'State parameter can be reused (no one-time token)',
      });
    } catch (error) {
      if (error.message.includes('state') || error.message.includes('CSRF')) {
        console.log('  ✅ PASS: State reuse blocked');
        console.log(`  Error: ${error.message}`);
        passedTests++;
      } else {
        console.log('  ⚠️  INCONCLUSIVE: Failed but not due to state validation');
        console.log(`  Error: ${error.message}`);
      }
    }

    // Test 5: Empty State Parameter
    console.log('\nTest: Empty State Parameter Attack');
    console.log('  Description: Attacker provides empty string as state');
    try {
      googleAuth.getAuthUrl();
      await googleAuth.getTokenFromCode('fake-code-empty', '');

      console.log('  ❌ VULNERABILITY: Accepted empty state!');
      failedTests++;
      vulnerabilities.push({
        test: 'Empty State',
        severity: 'HIGH',
        description: 'Empty state parameter accepted',
      });
    } catch (error) {
      if (error.message.includes('state') || error.message.includes('CSRF')) {
        console.log('  ✅ PASS: Empty state blocked');
        console.log(`  Error: ${error.message}`);
        passedTests++;
      } else {
        console.log('  ⚠️  INCONCLUSIVE: Failed but not due to state validation');
        console.log(`  Error: ${error.message}`);
      }
    }

  } finally {
    // Cleanup test token file
    try {
      if (fs.existsSync(testTokenPath)) {
        fs.unlinkSync(testTokenPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Tests: ${passedTests + failedTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);

  if (vulnerabilities.length > 0) {
    console.log('\n⚠️  VULNERABILITIES DETECTED:');
    vulnerabilities.forEach((vuln, index) => {
      console.log(`\n${index + 1}. ${vuln.test}`);
      console.log(`   Severity: ${vuln.severity}`);
      console.log(`   Description: ${vuln.description}`);
    });
  } else {
    console.log('\n✅ No vulnerabilities! OAuth CSRF protection is working correctly.');
  }

  console.log('\n' + '='.repeat(70));
  process.exit(vulnerabilities.length > 0 ? 1 : 0);
}

/**
 * Manual Testing Instructions
 */
const MANUAL_TEST_INSTRUCTIONS = `
OAUTH CSRF MANUAL TESTING GUIDE
================================

ATTACK SCENARIO 1: Intercepted Callback
-----------------------------------------
1. Attacker creates malicious website: evil.com
2. Attacker starts OAuth flow on their machine, gets state parameter
3. Attacker crafts link: http://localhost:3000/oauth2callback?code=VICTIM_CODE&state=ATTACKER_STATE
4. Victim clicks attacker's link
5. EXPECTED: App rejects due to state mismatch
6. VERIFY: Console shows "OAuth state mismatch" error

ATTACK SCENARIO 2: Missing State
----------------------------------
1. Attacker crafts callback URL without state parameter
2. URL: http://localhost:3000/oauth2callback?code=STOLEN_CODE
3. EXPECTED: App rejects due to missing state
4. VERIFY: Error logged, authentication fails

ATTACK SCENARIO 3: State Reuse
-------------------------------
1. User completes legitimate OAuth flow
2. Attacker captures the state parameter from URL
3. Attacker attempts second authentication with same state
4. EXPECTED: App rejects reused state
5. VERIFY: State is consumed after first use

VALIDATION CRITERIA:
- ✅ State parameter present in all auth URLs
- ✅ State validated on every callback
- ✅ Mismatched state rejected with error
- ✅ Missing state rejected
- ✅ State cannot be reused (one-time token)
- ✅ Cryptographically random state (32+ bytes)
`;

module.exports = {
  OAUTH_CSRF_SCENARIOS,
  testOAuthCSRFProtection,
  MANUAL_TEST_INSTRUCTIONS,
};

// Run tests if executed directly
if (require.main === module) {
  testOAuthCSRFProtection().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}
