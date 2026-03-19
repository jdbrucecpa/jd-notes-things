/**
 * Express Server
 *
 * Minimal HTTP server for the application. Hosts the Stream Deck health
 * endpoint and provides the HTTP server instance for WebSocket upgrades.
 *
 * v2.0: Webhook and upload-token endpoints removed (local-first architecture).
 * Stream Deck WebSocket logic extracted to streamDeckService.js.
 */

const express = require('express');
const app = express();

require('dotenv').config();
const { SERVER_PORT, SERVER_HOST } = require('./shared/constants');

// Stream Deck service (extracted from server.js in v2.0)
const streamDeckService = require('./main/services/streamDeckService');

// Register Stream Deck health endpoint on the Express app
streamDeckService.registerHealthEndpoint(app);

// Standalone mode (for testing)
if (require.main === module) {
  // Security: explicitly bind to localhost only
  app.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`Server listening on http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

module.exports = app;

// Re-export Stream Deck functions so existing callers (main.js) still work
// via expressApp.configureStreamDeck(), expressApp.setStreamDeckEnabled(), etc.
module.exports.configureStreamDeck = streamDeckService.configureStreamDeck;
module.exports.setStreamDeckEnabled = streamDeckService.setStreamDeckEnabled;
module.exports.handleStreamDeckUpgrade = streamDeckService.handleStreamDeckUpgrade;
module.exports.broadcastStreamDeckStatus = streamDeckService.broadcastStreamDeckStatus;
module.exports.updateStreamDeckRecordingState = streamDeckService.updateStreamDeckRecordingState;
module.exports.getStreamDeckStatus = streamDeckService.getStreamDeckStatus;
