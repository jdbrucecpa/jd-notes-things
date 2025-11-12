const express = require('express');
const axios = require('axios');
const { Webhook } = require('svix');
const app = express();

require('dotenv').config();

// API configuration for Recall.ai
const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;
const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET;

app.get('/start-recording', async (req, res) => {
    console.log(`Creating upload token with API key: ${RECALLAI_API_KEY?.substring(0, 8)}...`);

    if (!RECALLAI_API_KEY) {
        console.error("RECALLAI_API_KEY is missing! Set it in .env file");
        return res.json({ status: 'error', message: 'RECALLAI_API_KEY is missing' });
    }

    const url = `${RECALLAI_API_URL}/api/v1/sdk_upload/`;

    // Note: Webhook URL is configured in Recall.ai dashboard, not in the request
    console.log('[Upload Token] Creating upload token (webhook configured in dashboard)');

    try {
        const requestBody = {
            recording_config: {
                // Audio-only recording - omit video_mixed_mp4 entirely (don't set to null)
                audio_mixed_mp3: {},

                // No real-time transcription - we use Recall.ai async API after recording
                // This provides better quality and proper speaker diarization
                realtime_endpoints: [
                    {
                        type: "desktop_sdk_callback",
                        events: [
                            "participant_events.join"  // Only track participant info
                        ]
                    }
                ]
            }
        };

        console.log('[Upload Token] Request body:', JSON.stringify(requestBody, null, 2));

        const response = await axios.post(url, requestBody, {
            headers: { 'Authorization': `Token ${RECALLAI_API_KEY}` },
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
app.post('/webhook/recall', express.raw({type: 'application/json'}), async (req, res) => {
    console.log('[Webhook] Received webhook from Recall.ai');
    console.log('[Webhook] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[Webhook] Body length:', req.body?.length || 0);

    if (!RECALL_WEBHOOK_SECRET) {
        console.error('[Webhook] RECALL_WEBHOOK_SECRET not configured in .env');
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

    const wh = new Webhook(RECALL_WEBHOOK_SECRET);
    let event;

    try {
        event = wh.verify(payload, headers);
        console.log('[Webhook] ✓ Signature verified');
    } catch (err) {
        console.error('[Webhook] ✗ Signature verification failed:', err.message);
        console.error('[Webhook] Secret (first 10 chars):', RECALL_WEBHOOK_SECRET?.substring(0, 10));
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
                        metadata: eventData.recording.metadata
                    });
                    console.log('[Webhook] ✓ Upload complete handler executed');
                    break;

                case 'transcript.done':
                    await global.webhookHandlers.handleTranscriptDone({
                        transcriptId: eventData.transcript.id,
                        recordingId: eventData.recording.id,
                        metadata: eventData.transcript.metadata
                    });
                    console.log('[Webhook] → Sent transcript-done event to main process');
                    break;

                case 'transcript.failed':
                    global.mainWindow.webContents.send('webhook-transcript-failed', {
                        transcriptId: eventData.transcript.id,
                        recordingId: eventData.recording.id,
                        error: eventData.data
                    });
                    console.log('[Webhook] → Sent transcript-failed event to main process');
                    break;

                case 'sdk_upload.failed':
                    global.mainWindow.webContents.send('webhook-upload-failed', {
                        recordingId: eventData.recording.id,
                        sdkUploadId: eventData.sdk_upload.id,
                        error: eventData.data
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
