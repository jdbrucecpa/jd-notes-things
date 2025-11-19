/**
 * Non-interactive Google Calendar Test - Uses auth code directly
 */

require('dotenv').config();
const GoogleCalendar = require('./src/main/integrations/GoogleCalendar');

const AUTH_CODE = '4/0Ab32j92mW68t0JFgwQj4DeuWKFrpKotXHnhBgsMZMgUTi_XGIV4crwT68fOWvUl3QrPQgQ';

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
      redirect_uri:
        process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
    };

    if (!credentials.client_id || !credentials.client_secret) {
      console.error('❌ ERROR: Google Calendar credentials not found in .env file');
      return;
    }

    const alreadyAuthenticated = await calendar.initialize(credentials);

    if (!alreadyAuthenticated) {
      console.log('⚠️  Not authenticated. Authenticating with provided code...\n');
      console.log('Step 2: Authenticating with authorization code...');
      await calendar.authenticate(AUTH_CODE);
      console.log('✅ Authentication successful! Token saved.\n');
    } else {
      console.log('✅ Already authenticated with saved token\n');
    }

    // Step 3: Fetch upcoming meetings
    console.log('Step 3: Fetching upcoming meetings (next 24 hours)...');
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

    // Test routing integration preview (optional)
    if (meetings.length > 0) {
      console.log('\n📊 Routing Preview (using Phase 2 routing system):');
      console.log('─────────────────────────────────────────────────────');

      try {
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
            meetingDate: meeting.startTime,
          });

          console.log(`  Routes: ${routingDecision.routes.length}`);
          routingDecision.routes.forEach(route => {
            console.log(`    → ${route.fullPath}`);
          });
        });

        console.log('\n─────────────────────────────────────────────────────\n');
      } catch (error) {
        console.log('\n⚠️  Routing preview unavailable (config file not found)');
        console.log('   This is expected if config/routing.yaml has not been created yet.\n');
        console.log('─────────────────────────────────────────────────────\n');
      }
    }
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  }
}

// Run the test
testCalendarIntegration();
