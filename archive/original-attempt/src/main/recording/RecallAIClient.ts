/**
 * Recall.ai API Client
 * Handles REST API calls to Recall.ai for SDK uploads and downloads
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export interface RecallAIConfig {
  apiKey: string;
  apiUrl: string;
  assemblyAiApiKey?: string;
}

export interface SDKUpload {
  id: string;
  upload_token: string;
  status?: {
    code: string;
    sub_code?: string | null;
    updated_at?: string;
  };
  recording_id?: string;
  mp4_url?: string;
  mp3_url?: string;
  created_at?: string;
  metadata?: any;
}

export interface RecallTranscript {
  id: string;
  status: {
    code: 'processing' | 'done' | 'error';
    sub_code?: string | null;
    updated_at?: string;
  };
  data?: {
    download_url: string;
    provider_data_download_url?: string;
  };
  provider?: any;
  metadata?: any;
  created_at?: string;
}

export interface TranscriptData {
  words?: Array<{
    text: string;
    start_timestamp: { relative: number; absolute: string };
    end_timestamp: { relative: number; absolute: string };
    confidence?: number;
  }>;
  utterances?: Array<{
    text: string;
    speaker: string;
    start_timestamp: { relative: number; absolute: string };
    end_timestamp: { relative: number; absolute: string };
    confidence?: number;
  }>;
}

export class RecallAIClient {
  private client: AxiosInstance;
  private assemblyAiApiKey: string | null;

  constructor(config: RecallAIConfig) {
    this.client = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Authorization': `Token ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    this.assemblyAiApiKey = config.assemblyAiApiKey || null;
  }

  /**
   * Create an SDK upload to get an upload token
   * This is required before using the Desktop SDK to record
   *
   * Based on muesli pattern - uses streaming transcription provider
   * and desktop-sdk-callback for real-time events
   */
  async createSDKUpload(): Promise<SDKUpload> {
    console.log('[RecallAI] Creating SDK upload with AssemblyAI v3 streaming...');

    // Use exact working configuration from muesli
    const recordingConfig: any = {
      transcript: {
        provider: {
          assembly_ai_v3_streaming: {
            word_boost: [],
            speaker_labels: true
          }
        }
      },
      realtime_endpoints: [
        {
          type: 'desktop-sdk-callback',
          events: [
            'participant_events.join',
            'video_separate_png.data',
            'transcript.data',
            'transcript.provider_data'
          ]
        }
      ]
    };

    try {
      // Note: muesli uses sdk_upload (underscore) not sdk-upload (hyphen)
      const response = await this.client.post('/api/v1/sdk_upload/', {
        recording_config: recordingConfig,
      });

      const upload: SDKUpload = response.data;
      console.log('[RecallAI] SDK upload created:', upload.id);
      console.log('[RecallAI] Using AssemblyAI v3 streaming with real-time transcription');

      return upload;
    } catch (error: any) {
      console.error('[RecallAI] Failed to create SDK upload:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create transcript for a completed recording using Recall's native transcriber
   * Call this after the recording has been uploaded to Recall.ai
   */
  async createTranscript(recordingId: string): Promise<void> {
    console.log('[RecallAI] Creating transcript with Recall native transcriber for recording:', recordingId);

    try {
      // Use Recall's native transcription service (no external API key needed)
      await this.client.post(`/api/v1/recording/${recordingId}/create_transcript/`, {
        provider: {
          recallai_async: {
            speaker_labels: true, // Enable speaker diarization
          },
        },
      });

      console.log('[RecallAI] Transcript creation initiated with Recall native transcriber');
    } catch (error: any) {
      console.error('[RecallAI] Error creating transcript:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get SDK upload status
   */
  async getSDKUpload(uploadId: string): Promise<SDKUpload> {
    const response = await this.client.get(`/api/v1/sdk-upload/${uploadId}/`);
    return response.data;
  }

  /**
   * Wait for SDK upload to complete
   * Polls the API until upload is complete or fails
   */
  async waitForUploadComplete(uploadId: string, timeout: number = 180000): Promise<SDKUpload> {
    console.log('[RecallAI] Waiting for upload to complete:', uploadId);

    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < timeout) {
      const upload = await this.getSDKUpload(uploadId);

      console.log('[RecallAI] Upload status:', upload);
      console.log('[RecallAI] Checking upload status code:', upload.status?.code);

      // Check nested status.code field (Recall.ai API response format)
      if (upload.status?.code === 'complete' || upload.status?.code === 'done') {
        console.log('[RecallAI] Upload complete!');
        return upload;
      }

      if (upload.status?.code === 'failed' || upload.status?.code === 'error') {
        throw new Error(`SDK upload failed: ${uploadId} - ${upload.status.sub_code || 'Unknown error'}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`SDK upload timed out after ${timeout}ms: ${uploadId}`);
  }

  /**
   * Get transcript for a recording
   * Transcript is embedded in the recording's media_shortcuts field
   */
  async getTranscript(recordingId: string): Promise<RecallTranscript | null> {
    console.log('[RecallAI] Fetching transcript for recording:', recordingId);

    try {
      const response = await this.client.get(`/api/v1/recording/${recordingId}/`);
      const recording = response.data;

      // Transcript is in media_shortcuts.transcript
      const transcript = recording.media_shortcuts?.transcript;

      if (!transcript) {
        console.log('[RecallAI] Transcript not yet available in recording');
        return null;
      }

      console.log('[RecallAI] Transcript found:', transcript.id);
      return transcript;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log('[RecallAI] Recording not found');
        return null;
      }
      throw error;
    }
  }

  /**
   * Wait for transcript to be ready
   * Polls the API until transcript is complete or fails
   */
  async waitForTranscript(recordingId: string, timeout: number = 180000): Promise<RecallTranscript> {
    console.log('[RecallAI] Waiting for transcript to be ready:', recordingId);

    const startTime = Date.now();
    const pollInterval = 5000; // Poll every 5 seconds

    while (Date.now() - startTime < timeout) {
      const transcript = await this.getTranscript(recordingId);

      if (transcript) {
        console.log('[RecallAI] Transcript status:', transcript.status.code);

        if (transcript.status.code === 'done') {
          console.log('[RecallAI] Transcript ready!');
          return transcript;
        }

        if (transcript.status.code === 'error') {
          throw new Error(`Transcript processing failed for recording: ${recordingId}`);
        }
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Transcript timed out after ${timeout}ms: ${recordingId}`);
  }

  /**
   * Download transcript data from the download URL
   * Returns the actual transcript content (words, utterances, etc.)
   */
  async downloadTranscriptData(downloadUrl: string): Promise<TranscriptData> {
    console.log('[RecallAI] Downloading transcript data...');

    try {
      const response = await axios.get(downloadUrl);
      console.log('[RecallAI] Transcript data downloaded successfully');
      return response.data;
    } catch (error: any) {
      console.error('[RecallAI] Error downloading transcript data:', error.message);
      throw error;
    }
  }

  /**
   * Get recording details including audio file URLs
   */
  async getRecording(recordingId: string): Promise<any> {
    console.log('[RecallAI] Fetching recording details:', recordingId);
    const response = await this.client.get(`/api/v1/recording/${recordingId}/`);
    return response.data;
  }
}
