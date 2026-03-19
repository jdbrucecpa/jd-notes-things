/**
 * Stream Deck WebSocket Service
 *
 * Provides WebSocket-based integration for Elgato Stream Deck remote control.
 * Extracted from server.js in v2.0 refactoring.
 *
 * Features:
 * - Raw WebSocket upgrade handling (no ws library dependency)
 * - Localhost-only security validation
 * - Start/stop recording and status queries from Stream Deck
 * - Broadcast recording state changes to all connected clients
 */

const crypto = require('crypto');

// WebSocket clients for Stream Deck integration
const streamDeckClients = new Set();
let streamDeckEnabled = false;
const streamDeckCallbacks = {
  onStartRecording: async () => ({ success: false, error: 'Not configured' }),
  onStopRecording: async () => ({ success: false, error: 'Not configured' }),
  getStatus: () => ({ isRecording: false, meetingTitle: null }),
};

// ===================================================================
// WebSocket Frame Helpers
// ===================================================================

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

// ===================================================================
// Client Communication
// ===================================================================

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

// ===================================================================
// Message Handling
// ===================================================================

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

// ===================================================================
// Public API
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

/**
 * Register Stream Deck health endpoint on an Express app
 */
function registerHealthEndpoint(app) {
  app.get('/streamdeck/health', (_req, res) => {
    res.json({
      status: streamDeckEnabled ? 'ok' : 'disabled',
      service: 'jd-notes-things-streamdeck',
      clients: streamDeckClients.size,
    });
  });
}

module.exports = {
  configureStreamDeck,
  setStreamDeckEnabled,
  handleStreamDeckUpgrade,
  broadcastStreamDeckStatus,
  updateStreamDeckRecordingState,
  getStreamDeckStatus,
  registerHealthEndpoint,
};
