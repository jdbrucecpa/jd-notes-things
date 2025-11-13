/**
 * XSS Test Payloads - OWASP Top 10
 * Used to validate DOMPurify sanitization in renderer.js
 *
 * Run these payloads through the UI to verify XSS protection
 */

const XSS_TEST_PAYLOADS = {
  // Basic script injection
  basicScript: '<script>alert("XSS")</script>',

  // Image event handler
  imgOnerror: '<img src=x onerror="alert(\'XSS\')">',

  // SVG script
  svgScript: '<svg onload="alert(\'XSS\')">',

  // Iframe injection
  iframe: '<iframe src="javascript:alert(\'XSS\')"></iframe>',

  // Link with javascript protocol
  javascriptLink: '<a href="javascript:alert(\'XSS\')">Click me</a>',

  // Encoded script
  encodedScript: '&#60;script&#62;alert(\'XSS\')&#60;/script&#62;',

  // Event handler in div
  divOnclick: '<div onclick="alert(\'XSS\')">Click me</div>',

  // Object/embed tags
  objectEmbed: '<object data="javascript:alert(\'XSS\')"></object>',

  // Style injection
  styleInjection: '<style>body{background:url("javascript:alert(\'XSS\')")}</style>',

  // Base tag attack
  baseTag: '<base href="javascript:alert(\'XSS\')">',

  // Meta tag injection
  metaRefresh: '<meta http-equiv="refresh" content="0;url=javascript:alert(\'XSS\')">',

  // Form with javascript action
  formAction: '<form action="javascript:alert(\'XSS\')"><input type="submit"></form>',

  // Markdown with HTML
  markdownWithScript: '# Hello\n\n<script>alert("XSS")</script>\n\nNormal text',

  // Unicode encoded
  unicodeScript: '\\u003cscript\\u003ealert("XSS")\\u003c/script\\u003e',

  // NULL byte injection
  nullByte: '<scri\x00pt>alert("XSS")</script>',
};

/**
 * Test Cases - Expected Results
 */
const XSS_TEST_CASES = [
  {
    name: 'Meeting Title with Script Tag',
    location: 'Meeting card title',
    payload: XSS_TEST_PAYLOADS.basicScript,
    expectedResult: 'Script tag should be removed, only text visible',
    attackVector: 'Meeting title field',
  },
  {
    name: 'Summary Content with Image Onerror',
    location: 'Summary card body',
    payload: XSS_TEST_PAYLOADS.imgOnerror,
    expectedResult: 'Image tag should be sanitized, onerror removed',
    attackVector: 'Template summary content',
  },
  {
    name: 'Transcript Speaker Name with Event Handler',
    location: 'Transcript speaker field',
    payload: `<div onclick="alert('XSS')">John Doe</div>`,
    expectedResult: 'Onclick handler removed, only "John Doe" visible',
    attackVector: 'Speaker name from transcript',
  },
  {
    name: 'Transcript Text with JavaScript Link',
    location: 'Transcript text content',
    payload: XSS_TEST_PAYLOADS.javascriptLink,
    expectedResult: 'Link with javascript: protocol should be sanitized',
    attackVector: 'Transcript text field',
  },
  {
    name: 'Participant Name with SVG Script',
    location: 'Participant list',
    payload: XSS_TEST_PAYLOADS.svgScript,
    expectedResult: 'SVG tag should be removed',
    attackVector: 'Participant name field',
  },
  {
    name: 'Auth Notification with Iframe',
    location: 'Authentication notification',
    payload: XSS_TEST_PAYLOADS.iframe,
    expectedResult: 'Iframe should be completely removed',
    attackVector: 'Auth notification message',
  },
];

/**
 * Manual Testing Instructions
 */
const TESTING_INSTRUCTIONS = `
XSS PENETRATION TEST - MANUAL TESTING GUIDE
===========================================

PREREQUISITES:
1. Build and run the app: npm start
2. Open DevTools Console (F12)
3. Monitor for any alert() popups or console errors

TEST PROCEDURE:

Test 1: Meeting Title XSS
--------------------------
1. Create a new manual meeting
2. Set title to: ${XSS_TEST_PAYLOADS.basicScript}
3. Save and view in meeting list
4. EXPECTED: No alert popup, script tag visible as text only
5. VERIFY: Inspect element - no <script> tag in DOM

Test 2: Summary Content XSS
----------------------------
1. Import a transcript or generate a summary
2. Inject payload into summary content via meetings.json:
   {
     "summaries": [{
       "content": "${XSS_TEST_PAYLOADS.imgOnerror}"
     }]
   }
3. Reload app and view summary
4. EXPECTED: No alert popup, image not rendered
5. VERIFY: Inspect element - onerror attribute removed

Test 3: Transcript Speaker XSS
-------------------------------
1. Import a transcript with malicious speaker name
2. Edit meetings.json directly:
   {
     "transcript": [{
       "speaker": "${XSS_TEST_PAYLOADS.divOnclick}",
       "text": "Hello"
     }]
   }
3. View transcript in app
4. EXPECTED: No alert popup when clicking speaker name
5. VERIFY: Inspect element - onclick attribute removed

Test 4: Markdown XSS
--------------------
1. Import a markdown file with embedded script
2. File content: ${XSS_TEST_PAYLOADS.markdownWithScript}
3. View in summary or transcript view
4. EXPECTED: Markdown rendered safely, no script execution
5. VERIFY: Console shows no errors

Test 5: Calendar Meeting XSS
-----------------------------
1. Create a Google Calendar event with XSS payload in title
2. Sync with app (calendar:getUpcomingMeetings)
3. EXPECTED: Meeting title sanitized, no script execution
4. VERIFY: Meeting card displays safe text only

VALIDATION CRITERIA:
- ✅ No alert() popups appear
- ✅ No console errors related to script execution
- ✅ All payloads rendered as plain text or sanitized HTML
- ✅ Inspect element shows no dangerous attributes (onclick, onerror, etc.)
- ✅ No <script>, <iframe>, <object>, <embed> tags in DOM

REPORTING:
- Document any successful XSS attacks
- Take screenshots of payloads being blocked
- Note specific locations where sanitization works/fails
`;

module.exports = {
  XSS_TEST_PAYLOADS,
  XSS_TEST_CASES,
  TESTING_INSTRUCTIONS,
};

// Print instructions when run directly
if (require.main === module) {
  console.log(TESTING_INSTRUCTIONS);
}
