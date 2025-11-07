/**
 * Google Calendar Integration Test Script
 *
 * Tests the Google Calendar OAuth flow and calendar event fetching.
 *
 * Usage:
 *   node test-calendar.js
 */

require('dotenv').config();
const GoogleCalendar = require('./src/main/integrations/GoogleCalendar');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to prompt user for input
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function testCalendarIntegration() {
  console.log('\n==============================================');
  console.log('Google Calendar Integration Test');
  console.log('==============================================\n');

  const calendar = new GoogleCalendar();

  try {
    // Step 1: Initialize with credentials from .env
    console.log('Step 1: Initializing Google Calendar...');
    const credentials = {
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
    };

    if (!credentials.client_id || !credentials.client_secret) {
      console.error('❌ ERROR: Google Calendar credentials not found in .env file');
      console.error('   Please add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET');
      rl.close();
      return;
    }

    const alreadyAuthenticated = await calendar.initialize(credentials);

    if (alreadyAuthenticated) {
      console.log('✅ Already authenticated with saved token\n');
    } else {
      console.log('⚠️  Not authenticated. Starting OAuth flow...\n');

      // Step 2: Get authorization URL
      console.log('Step 2: Getting OAuth authorization URL...');
      const authUrl = calendar.getAuthUrl();
      console.log('\n📋 Please visit this URL to authorize the application:');
      console.log('─────────────────────────────────────────────────────');
      console.log(authUrl);
      console.log('─────────────────────────────────────────────────────\n');

      // Step 3: Wait for authorization code
      const code = await prompt('Enter the authorization code from the browser: ');

      if (!code || code.trim() === '') {
        console.error('❌ No authorization code provided. Exiting.');
        rl.close();
        return;
      }

      console.log('\nStep 3: Authenticating with authorization code...');
      await calendar.authenticate(code.trim());
      console.log('✅ Authentication successful! Token saved.\n');
    }

    // Step 4: Fetch upcoming meetings
    console.log('Step 4: Fetching upcoming meetings (next 24 hours)...');
    const meetings = await calendar.getUpcomingMeetings(24);

    console.log(`\n✅ Found ${meetings.length} upcoming meetings:\n`);
    console.log('==============================================\n');

    if (meetings.length === 0) {
      console.log('No upcoming meetings found in the next 24 hours.');
    } else {
      meetings.forEach((meeting, index) => {
        console.log(`Meeting ${index + 1}: ${meeting.title}`);
        console.log(`  Time: ${meeting.startTime.toLocaleString()}`);
        console.log(`  Platform: ${meeting.platform}`);
        console.log(`  Participants: ${meeting.participants.length}`);

        if (meeting.meetingLink) {
          console.log(`  Link: ${meeting.meetingLink}`);
        }

        if (meeting.participants.length > 0) {
          console.log('  Attendees:');
          meeting.participants.slice(0, 5).forEach(p => {
            console.log(`    - ${p.name} (${p.email}) [${p.responseStatus}]`);
          });
          if (meeting.participants.length > 5) {
            console.log(`    ... and ${meeting.participants.length - 5} more`);
          }
        }

        console.log('');
      });
    }

    console.log('==============================================');
    console.log('✅ Calendar integration test completed successfully!');
    console.log('==============================================\n');

    // Test routing integration preview
    if (meetings.length > 0) {
      console.log('\n📊 Routing Preview (using Phase 2 routing system):');
      console.log('─────────────────────────────────────────────────────');

      const RoutingEngine = require('./src/main/routing/RoutingEngine');
      const ConfigLoader = require('./src/main/routing/ConfigLoader');

      const configLoader = new ConfigLoader();
      configLoader.load();
      const routingEngine = new RoutingEngine(configLoader);

      meetings.slice(0, 3).forEach((meeting, index) => {
        console.log(`\nMeeting ${index + 1}: ${meeting.title}`);
        const routingDecision = routingEngine.route({
          participantEmails: meeting.participantEmails,
          meetingTitle: meeting.title,
          meetingDate: meeting.startTime
        });

        console.log(`  Routes: ${routingDecision.routes.length}`);
        routingDecision.routes.forEach(route => {
          console.log(`    → ${route.fullPath}`);
        });
      });

      console.log('\n─────────────────────────────────────────────────────\n');
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  } finally {
    rl.close();
  }
}

// Run the test
testCalendarIntegration();
