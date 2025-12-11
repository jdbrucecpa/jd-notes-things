const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { Webhook } = require('svix');
const app = express();

require('dotenv').config();
const { SERVER_PORT, SERVER_HOST } = require('./shared/constants');

// Key management service reference (will be set by main.js)
let keyManagementService = null;

// ===================================================================
// v1.2: Stream Deck WebSocket Support
// ===================================================================
// WebSocket clients for Stream Deck integration
const streamDeckClients = new Set();
let streamDeckEnabled = false;
const streamDeckCallbacks = {
  onStartRecording: async () => ({ success: false, error: 'Not configured' }),
  onStopRecording: async () => ({ success: false, error: 'Not configured' }),
  getStatus: () => ({ isRecording: false, meetingTitle: null }),
};

/**
 * Set the key management service for retrieving API keys from Windows Credential Manager
 * @param {object} kms - Key management service instance
 */
function setKeyManagementService(kms) {
  keyManagementService = kms;
}

/**
 * Get API key from Windows Credential Manager with fallback to environment variable
 * @param {string} keyName - Key name (e.g., 'RECALLAI_API_KEY')
 * @returns {Promise<string|null>} API key or null
 */
async function getApiKey(keyName) {
  // Try Windows Credential Manager first
  if (keyManagementService) {
    const key = await keyManagementService.getKey(keyName);
    if (key) {
      return key;
    }
  }
  // Fall back to environment variable (for dev mode)
  return process.env[keyName] || null;
}

/**
 * Get all Recall.ai configuration values
 * @returns {Promise<{apiUrl: string, apiKey: string|null, webhookSecret: string|null}>}
 */
async function getRecallConfig() {
  return {
    apiUrl:
      (await getApiKey('RECALLAI_API_URL')) ||
      process.env.RECALLAI_API_URL ||
      'https://api.recall.ai',
    apiKey: await getApiKey('RECALLAI_API_KEY'),
    webhookSecret: await getApiKey('RECALL_WEBHOOK_SECRET'),
  };
}

app.get('/start-recording', async (req, res) => {
  const { apiUrl, apiKey } = await getRecallConfig();
  console.log(`Creating upload token with API key: ${apiKey?.substring(0, 8)}...`);

  if (!apiKey) {
    console.error('RECALLAI_API_KEY is missing! Set it in Settings > Security');
    return res.json({ status: 'error', message: 'RECALLAI_API_KEY is missing' });
  }

  const url = `${apiUrl}/api/v1/sdk_upload/`;

  // NOTE: Webhook URL MUST be configured in Recall.ai dashboard
  // There is no API to set it per-request for SDK uploads
  // You must manually update it in your dashboard when the tunnel URL changes
  console.log('[Upload Token] Creating upload token (webhook must be configured in dashboard)');
  if (global.webhookUrl) {
    console.log('[Upload Token] Current tunnel webhook URL:', global.webhookUrl);
    console.log(
      '[Upload Token] ⚠️  Update this URL in your Recall.ai dashboard at: https://us-west-2.recall.ai/webhooks'
    );
  }

  try {
    const requestBody = {
      recording_config: {
        // Audio-only recording - must EXPLICITLY set video to null to disable it
        // Per docs: video_mixed_mp4 is enabled by DEFAULT if not set to null
        video_mixed_mp4: null, // ← THIS IS REQUIRED to disable video
        audio_mixed_mp3: {},

        // No real-time transcription - we use Recall.ai async API after recording
        // This provides better quality and proper speaker diarization
        realtime_endpoints: [
          {
            type: 'desktop_sdk_callback',
            events: [
              'participant_events.join', // Only track participant info
            ],
          },
        ],
      },
    };

    console.log('[Upload Token] Request body:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(url, requestBody, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 9000,
    });

    console.log('[Upload Token] Response:', JSON.stringify(response.data, null, 2));
    res.json({ status: 'success', upload_token: response.data.upload_token });
  } catch (e) {
    console.error('Error creating upload token:', e.response?.data || e.message);
    res.json({ status: 'error', message: e.message });
  }
});

// Webhook endpoint to receive Recall.ai notifications
// IMPORTANT: Use raw body parser for Svix signature verification
app.post('/webhook/recall', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('[Webhook] Received webhook from Recall.ai');
  console.log('[Webhook] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[Webhook] Body length:', req.body?.length || 0);

  const { webhookSecret } = await getRecallConfig();

  if (!webhookSecret) {
    console.error('[Webhook] RECALL_WEBHOOK_SECRET not configured in Settings > Security');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Verify webhook signature using Svix
  const payload = req.body;
  const headers = req.headers;

  // Check for required Svix headers
  const requiredHeaders = ['svix-id', 'svix-timestamp', 'svix-signature'];
  const missingHeaders = requiredHeaders.filter(h => !headers[h]);

  if (missingHeaders.length > 0) {
    console.error('[Webhook] Missing Svix headers:', missingHeaders);
    console.error('[Webhook] This might not be a Svix-signed webhook from Recall.ai');
    // Return 200 to acknowledge receipt but log the issue
    return res.status(200).json({ warning: 'Missing signature headers' });
  }

  const wh = new Webhook(webhookSecret);
  let event;

  try {
    event = wh.verify(payload, headers);
    console.log('[Webhook] ✓ Signature verified');
  } catch (err) {
    console.error('[Webhook] ✗ Signature verification failed:', err.message);
    console.error('[Webhook] Secret (first 10 chars):', webhookSecret?.substring(0, 10));
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Parse the verified event
  const eventType = event.event;
  const eventData = event.data;

  console.log(`[Webhook] Event: ${eventType}`);
  console.log(`[Webhook] Data:`, JSON.stringify(eventData, null, 2).substring(0, 500));

  try {
    // Call webhook handlers directly (server.js runs in main process)
    if (global.webhookHandlers) {
      switch (eventType) {
        case 'sdk_upload.complete':
          await global.webhookHandlers.handleUploadComplete({
            recordingId: eventData.recording.id,
            sdkUploadId: eventData.sdk_upload.id,
            metadata: eventData.recording.metadata,
          });
          console.log('[Webhook] ✓ Upload complete handler executed');
          break;

        case 'transcript.done':
          await global.webhookHandlers.handleTranscriptDone({
            transcriptId: eventData.transcript.id,
            recordingId: eventData.recording.id,
            metadata: eventData.transcript.metadata,
          });
          console.log('[Webhook] → Sent transcript-done event to main process');
          break;

        case 'transcript.failed':
          global.mainWindow.webContents.send('webhook-transcript-failed', {
            transcriptId: eventData.transcript.id,
            recordingId: eventData.recording.id,
            error: eventData.data,
          });
          console.log('[Webhook] → Sent transcript-failed event to main process');
          break;

        case 'sdk_upload.failed':
          global.mainWindow.webContents.send('webhook-upload-failed', {
            recordingId: eventData.recording.id,
            sdkUploadId: eventData.sdk_upload.id,
            error: eventData.data,
          });
          console.log('[Webhook] → Sent upload-failed event to main process');
          break;

        default:
          console.log(`[Webhook] Unhandled event type: ${eventType}`);
      }
    } else {
      console.warn('[Webhook] Main window not available - cannot send IPC message');
    }

    // Return 204 No Content for success (Svix expects this)
    res.status(204).send();
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// ===================================================================
// v1.2: Stream Deck WebSocket Functions
// ===================================================================

/**
 * Configure Stream Deck callbacks (called from main.js)
 */
function configureStreamDeck(callbacks) {
  if (callbacks.onStartRecording) streamDeckCallbacks.onStartRecording = callbacks.onStartRecording;
  if (callbacks.onStopRecording) streamDeckCallbacks.onStopRecording = callbacks.onStopRecording;
  if (callbacks.getStatus) streamDeckCallbacks.getStatus = callbacks.getStatus;
}

/**
 * Enable/disable Stream Deck WebSocket support
 */
function setStreamDeckEnabled(enabled) {
  streamDeckEnabled = enabled;
  console.log(`[StreamDeck] WebSocket support ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Handle WebSocket upgrade for Stream Deck connections
 * Called from main.js when server receives upgrade request
 */
function handleStreamDeckUpgrade(request, socket, _head) {
  if (!streamDeckEnabled) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }

  // Only handle /streamdeck path
  if (!request.url.startsWith('/streamdeck')) {
    return false; // Not a Stream Deck request
  }

  // Security: Validate origin - only allow localhost connections
  const origin = request.headers.origin;
  if (origin && !origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
    console.warn('[StreamDeck] Rejected connection from non-localhost origin:', origin);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return true;
  }

  // Verify WebSocket handshake
  const key = request.headers['sec-websocket-key'];
  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return true;
  }

  // Generate accept key
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  // Send upgrade response
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
  );

  // Create client object
  const client = {
    socket,
    id: crypto.randomUUID(),
  };

  streamDeckClients.add(client);
  console.log(`[StreamDeck] Client connected: ${client.id} (total: ${streamDeckClients.size})`);

  // Send initial status
  sendToStreamDeckClient(client, {
    event: 'connected',
    data: streamDeckCallbacks.getStatus(),
  });

  // Handle incoming data
  socket.on('data', buffer => {
    try {
      const message = decodeWebSocketFrame(buffer);
      if (message) {
        handleStreamDeckMessage(client, message);
      }
    } catch (error) {
      console.error('[StreamDeck] Error decoding message:', error);
    }
  });

  // Handle disconnect
  socket.on('close', () => {
    streamDeckClients.delete(client);
    console.log(
      `[StreamDeck] Client disconnected: ${client.id} (total: ${streamDeckClients.size})`
    );
  });

  socket.on('error', error => {
    console.error(`[StreamDeck] Socket error for ${client.id}:`, error.message);
    streamDeckClients.delete(client);
  });

  return true; // Handled
}

/**
 * Decode WebSocket frame
 */
function decodeWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const secondByte = buffer[1];

  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;

  let offset = 2;

  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    return null; // Large payloads not supported
  }

  let maskingKey = null;
  if (masked) {
    maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.slice(offset, offset + payloadLength);

  if (masked && maskingKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] = payload[i] ^ maskingKey[i % 4];
    }
  }

  if (opcode === 0x01) {
    try {
      return JSON.parse(payload.toString('utf8'));
    } catch {
      return payload.toString('utf8');
    }
  }

  return null;
}

/**
 * Encode WebSocket frame
 */
function encodeWebSocketFrame(data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    return null;
  }

  return Buffer.concat([header, payload]);
}

/**
 * Send message to a Stream Deck client
 */
function sendToStreamDeckClient(client, message) {
  try {
    const frame = encodeWebSocketFrame(message);
    if (frame && client.socket && !client.socket.destroyed) {
      client.socket.write(frame);
    }
  } catch (error) {
    console.error('[StreamDeck] Error sending to client:', error);
  }
}

/**
 * Broadcast to all Stream Deck clients
 */
function broadcastToStreamDeck(message) {
  for (const client of streamDeckClients) {
    sendToStreamDeckClient(client, message);
  }
}

/**
 * Handle incoming Stream Deck message
 */
async function handleStreamDeckMessage(client, message) {
  console.log('[StreamDeck] Received:', message);

  if (typeof message !== 'object' || !message.action) return;

  switch (message.action) {
    case 'startRecording':
      try {
        const result = await streamDeckCallbacks.onStartRecording();
        sendToStreamDeckClient(client, { event: 'recordingStarted', data: result });
        broadcastStreamDeckStatus();
      } catch (error) {
        sendToStreamDeckClient(client, { event: 'error', data: { message: error.message } });
      }
      break;

    case 'stopRecording':
      try {
        const result = await streamDeckCallbacks.onStopRecording();
        sendToStreamDeckClient(client, { event: 'recordingStopped', data: result });
        broadcastStreamDeckStatus();
      } catch (error) {
        sendToStreamDeckClient(client, { event: 'error', data: { message: error.message } });
      }
      break;

    case 'getStatus':
      sendToStreamDeckClient(client, {
        event: 'statusUpdate',
        data: streamDeckCallbacks.getStatus(),
      });
      break;
  }
}

/**
 * Broadcast current status to all Stream Deck clients
 */
function broadcastStreamDeckStatus() {
  broadcastToStreamDeck({
    event: 'statusUpdate',
    data: streamDeckCallbacks.getStatus(),
  });
}

/**
 * Update recording state and notify Stream Deck clients
 */
function updateStreamDeckRecordingState(isRecording, meetingTitle = null) {
  broadcastToStreamDeck({
    event: isRecording ? 'recordingStarted' : 'recordingStopped',
    data: { isRecording, meetingTitle, timestamp: Date.now() },
  });
}

/**
 * Get Stream Deck connection status
 */
function getStreamDeckStatus() {
  return {
    enabled: streamDeckEnabled,
    connectedClients: streamDeckClients.size,
  };
}

// Health endpoint for Stream Deck
app.get('/streamdeck/health', (req, res) => {
  res.json({
    status: streamDeckEnabled ? 'ok' : 'disabled',
    service: 'jd-notes-things-streamdeck',
    clients: streamDeckClients.size,
  });
});

if (require.main === module) {
  // Security: explicitly bind to localhost only
  app.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`Server listening on http://${SERVER_HOST}:${SERVER_PORT}`);
  });
}

module.exports = app;
module.exports.setKeyManagementService = setKeyManagementService;
// v1.2: Stream Deck exports
module.exports.configureStreamDeck = configureStreamDeck;
module.exports.setStreamDeckEnabled = setStreamDeckEnabled;
module.exports.handleStreamDeckUpgrade = handleStreamDeckUpgrade;
module.exports.broadcastStreamDeckStatus = broadcastStreamDeckStatus;
module.exports.updateStreamDeckRecordingState = updateStreamDeckRecordingState;
module.exports.getStreamDeckStatus = getStreamDeckStatus;
