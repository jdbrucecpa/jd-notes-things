const express = require('express');
const axios = require('axios');
const { Webhook } = require('svix');
const app = express();

require('dotenv').config();

// Key management service reference (will be set by main.js)
let keyManagementService = null;

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

if (require.main === module) {
  app.listen(13373, () => {
    console.log(`Server listening on http://localhost:13373`);
  });
}

module.exports = app;
module.exports.setKeyManagementService = setKeyManagementService;
