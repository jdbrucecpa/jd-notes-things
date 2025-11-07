/**
 * Recording Manager for audio capture using Recall.ai Desktop SDK
 * Handles starting, stopping, and managing recording sessions
 *
 * Implementation based on muesli-public example pattern:
 * https://github.com/recallai/muesli-public/blob/main/src/main.js
 */

import { RecordingSession, RecordingStatus } from '../../shared/types';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { systemPreferences } from 'electron';
import RecallAiSdk from '@recallai/desktop-sdk';
import { RecallAIClient, SDKUpload } from './RecallAIClient';

export class RecordingManager {
  private currentSession: RecordingSession | null = null;
  private outputDirectory: string;
  private recallApiKey: string | null;
  private recallApiUrl: string;
  private isInitialized: boolean = false;
  private windowId: string | null = null;  // Changed from recordingId to match muesli
  private currentUpload: SDKUpload | null = null;
  private recallClient: RecallAIClient | null = null;

  constructor(config: {
    outputDirectory?: string;
    recallApiKey?: string;
    recallApiUrl?: string;
    assemblyAiApiKey?: string;
  } = {}) {
    this.outputDirectory = config.outputDirectory || path.join(os.tmpdir(), 'jd-notes-things', 'recordings');
    this.recallApiKey = config.recallApiKey || null;
    this.recallApiUrl = config.recallApiUrl || 'https://us-west-2.recall.ai';

    // Initialize Recall.ai API client if API key is provided
    if (this.recallApiKey) {
      this.recallClient = new RecallAIClient({
        apiKey: this.recallApiKey,
        apiUrl: this.recallApiUrl,
        assemblyAiApiKey: config.assemblyAiApiKey,
      });
    }

    // Ensure output directory exists
    this.ensureDirectoryExists(this.outputDirectory);
  }

  /**
   * Initialize Recall.ai SDK
   * Based on muesli pattern (lines 354-372)
   */
  private async initializeSDK(): Promise<void> {
    if (this.isInitialized) return;

    console.log('[RecordingManager] Initializing Recall.ai Desktop SDK...');
    console.log('[RecordingManager] Requesting permissions: system-audio, microphone');

    try {
      // Check microphone access status on Windows
      console.log('[RecordingManager] Checking Windows microphone access...');
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log('[RecordingManager] Windows microphone status:', micStatus);

      if (micStatus === 'denied') {
        throw new Error('Microphone access denied. Please enable in Windows Settings → Privacy & Security → Microphone');
      }

      // Type assertion needed - SDK accepts config.recording_path but types don't show it
      const initResult = await (RecallAiSdk.init as any)({
        api_url: this.recallApiUrl,  // muesli uses api_url
        config: {
          recording_path: this.outputDirectory  // muesli pattern: specify recording path
        },
        acquirePermissionsOnStartup: ['system-audio', 'microphone'],
        restartOnError: true,
      });

      console.log('[RecordingManager] SDK init result:', initResult);

      // Explicitly request microphone permission from SDK (after Electron permission granted)
      console.log('[RecordingManager] Requesting SDK microphone permission...');
      try {
        await RecallAiSdk.requestPermission('microphone');
        console.log('[RecordingManager] SDK microphone permission granted');
      } catch (micError) {
        console.error('[RecordingManager] Failed to get SDK microphone permission:', micError);
      }

      // Also request system audio permission
      console.log('[RecordingManager] Requesting SDK system audio permission...');
      try {
        await RecallAiSdk.requestPermission('system-audio');
        console.log('[RecordingManager] SDK system audio permission granted');
      } catch (audioError) {
        console.error('[RecordingManager] Failed to get SDK system audio permission:', audioError);
      }

      // Set up event listeners
      RecallAiSdk.addEventListener('recording-started', (event) => {
        console.log('[RecordingManager] Recording started event:', event);
      });

      RecallAiSdk.addEventListener('recording-ended', (event) => {
        console.log('[RecordingManager] Recording ended event:', event);
      });

      RecallAiSdk.addEventListener('media-capture-status', (event: any) => {
        console.log('[RecordingManager] Media capture status:', event);
        if (event.type === 'audio') {
          console.log('[RecordingManager] Audio capture is:', event.capturing ? 'ACTIVE' : 'INACTIVE');
        }
      });

      RecallAiSdk.addEventListener('permission-status', (event: any) => {
        console.log('[RecordingManager] Permission status:', event);
      });

      RecallAiSdk.addEventListener('error', (event) => {
        console.error('[RecordingManager] SDK error:', event);
      });

      this.isInitialized = true;
      console.log('[RecordingManager] SDK initialized successfully');
      console.log('[RecordingManager] Recording path:', this.outputDirectory);
    } catch (error: any) {
      console.error('[RecordingManager] Failed to initialize SDK:', error);
      throw new Error(`Failed to initialize Recall.ai SDK: ${error.message}`);
    }
  }

  /**
   * Start a new recording session
   * Based on muesli pattern (lines 815-895)
   */
  async startRecording(): Promise<RecordingSession> {
    if (this.currentSession) {
      throw new Error('Recording already in progress');
    }

    if (!this.recallClient) {
      throw new Error('Recall.ai client not initialized. API key required.');
    }

    console.log('[RecordingManager] Starting new recording session...');

    // Initialize SDK if needed
    await this.initializeSDK();

    // Create new session
    const session: RecordingSession = {
      id: Date.now().toString(),
      startTime: new Date(),
      status: 'recording',
    };

    this.currentSession = session;

    try {
      // Step 1: Create SDK upload to get upload token (muesli line 843)
      console.log('[RecordingManager] Creating SDK upload...');
      this.currentUpload = await this.recallClient.createSDKUpload();
      console.log('[RecordingManager] Upload created:', this.currentUpload.id);

      // Step 2: Prepare desktop audio recording - get windowId (muesli line 839)
      console.log('[RecordingManager] Preparing desktop audio recording...');
      const windowId = await RecallAiSdk.prepareDesktopAudioRecording();
      this.windowId = windowId;
      console.log('[RecordingManager] Prepared with window ID:', windowId);

      // Step 3: Start recording with both windowId and uploadToken (muesli lines 878-881)
      console.log('[RecordingManager] Starting recording...');
      console.log('[RecordingManager] - Window ID:', windowId);
      console.log('[RecordingManager] - Upload Token:', this.currentUpload.upload_token.substring(0, 8) + '...');

      await RecallAiSdk.startRecording({
        windowId: windowId,
        uploadToken: this.currentUpload.upload_token,
      });

      console.log('[RecordingManager] Recording started successfully');
    } catch (error: any) {
      // Clean up on error
      this.currentSession = null;
      this.currentUpload = null;
      this.windowId = null;
      console.error('[RecordingManager] Failed to start recording:', error);
      throw new Error(`Failed to start recording: ${error.message}`);
    }

    return session;
  }

  /**
   * Stop the current recording session
   * Based on muesli pattern (lines 898-924 and 441-499)
   */
  async stopRecording(): Promise<RecordingSession> {
    if (!this.currentSession) {
      throw new Error('No active recording session');
    }

    if (!this.windowId) {
      throw new Error('No recording window ID available');
    }

    console.log('[RecordingManager] Stopping recording session:', this.currentSession.id);

    try {
      // Step 1: Stop the SDK recording (muesli line 912)
      console.log('[RecordingManager] Stopping recording for window:', this.windowId);
      await RecallAiSdk.stopRecording({ windowId: this.windowId });

      // Step 2: Wait a moment for the recording-ended event (muesli line 454)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 3: Trigger the upload (muesli lines 468-482)
      console.log('[RecordingManager] Triggering upload...');

      if (this.currentUpload?.upload_token) {
        console.log('[RecordingManager] Uploading with token:', this.currentUpload.upload_token.substring(0, 8) + '...');
        // Type assertion needed - SDK accepts uploadToken even though types don't show it
        await (RecallAiSdk.uploadRecording as any)({
          windowId: this.windowId,
          uploadToken: this.currentUpload.upload_token,
        });
      } else {
        console.log('[RecordingManager] Uploading without token (fallback)');
        await RecallAiSdk.uploadRecording({ windowId: this.windowId });
      }

      // Update session status
      this.currentSession.endTime = new Date();
      this.currentSession.status = 'processing';

      console.log('[RecordingManager] Recording stopped and upload triggered');

      const session = this.currentSession;

      // Don't reset state yet - we need it for transcript retrieval

      return session;
    } catch (error: any) {
      console.error('[RecordingManager] Error stopping recording:', error);
      throw new Error(`Failed to stop recording: ${error.message}`);
    }
  }

  /**
   * Get transcript from Recall.ai (using Recall's native transcriber)
   * Call this after stopping recording
   */
  async getTranscript(): Promise<any> {
    if (!this.currentUpload) {
      throw new Error('No upload information available');
    }

    if (!this.recallClient) {
      throw new Error('Recall.ai client not initialized');
    }

    try {
      console.log('[RecordingManager] Waiting for upload to complete...');

      // Step 1: Wait for upload to complete
      const completedUpload = await this.recallClient.waitForUploadComplete(this.currentUpload.id);

      if (!completedUpload.recording_id) {
        throw new Error('No recording ID in completed upload');
      }

      console.log('[RecordingManager] Upload complete. Recording ID:', completedUpload.recording_id);

      // Step 1.5: Check recording details to verify audio was captured
      console.log('[RecordingManager] Checking recording details...');
      const recordingDetails = await this.recallClient.getRecording(completedUpload.recording_id);
      console.log('[RecordingManager] Recording duration:', recordingDetails.duration, 'seconds');

      if (!recordingDetails.duration || recordingDetails.duration === 0) {
        console.warn('[RecordingManager] WARNING: Recording has no duration - no audio was captured!');
        console.warn('[RecordingManager] Check microphone permissions and ensure microphone is not muted.');
      }

      // Step 2: Wait for real-time transcript to be ready (should already be processing)
      // With AssemblyAI v3 streaming, transcript is generated in real-time during recording
      console.log('[RecordingManager] Waiting for transcript from AssemblyAI...');
      const transcriptMeta = await this.recallClient.waitForTranscript(completedUpload.recording_id);

      console.log('[RecordingManager] Transcript ready! Downloading content...');

      // Step 4: Download the actual transcript data
      if (!transcriptMeta.data?.download_url) {
        throw new Error('No download URL in transcript metadata');
      }

      const transcriptData = await this.recallClient.downloadTranscriptData(transcriptMeta.data.download_url);

      console.log('[RecordingManager] Transcript content downloaded!');
      console.log('[RecordingManager] Words:', transcriptData.words?.length || 0);
      console.log('[RecordingManager] Utterances:', transcriptData.utterances?.length || 0);

      // Now we can reset the recording state
      this.currentSession = null;
      this.currentUpload = null;
      this.windowId = null;

      return transcriptData;
    } catch (error) {
      // Clean up state on error
      console.error('[RecordingManager] Error getting transcript:', error);
      this.currentSession = null;
      this.currentUpload = null;
      this.windowId = null;
      throw error;
    }
  }

  /**
   * Pause the current recording
   * Note: Desktop audio recording may not support pause/resume
   */
  async pauseRecording(): Promise<RecordingSession> {
    if (!this.currentSession) {
      throw new Error('No active recording session');
    }

    if (this.currentSession.status !== 'recording') {
      throw new Error(`Cannot pause recording in state: ${this.currentSession.status}`);
    }

    console.log('[RecordingManager] Pausing not supported for desktop audio recording');
    console.log('[RecordingManager] Pause/resume requires meeting-based recording (Phase 3)');

    // For now, just update status locally
    // Full pause/resume will be implemented with meeting detection
    this.currentSession.status = 'paused';

    return this.currentSession;
  }

  /**
   * Resume a paused recording
   * Note: Desktop audio recording may not support pause/resume
   */
  async resumeRecording(): Promise<RecordingSession> {
    if (!this.currentSession) {
      throw new Error('No active recording session');
    }

    if (this.currentSession.status !== 'paused') {
      throw new Error(`Cannot resume recording in state: ${this.currentSession.status}`);
    }

    console.log('[RecordingManager] Resuming not supported for desktop audio recording');
    console.log('[RecordingManager] Pause/resume requires meeting-based recording (Phase 3)');

    // For now, just update status locally
    this.currentSession.status = 'recording';

    return this.currentSession;
  }

  /**
   * Get the current recording session
   */
  getCurrentSession(): RecordingSession | null {
    return this.currentSession;
  }

  /**
   * Check if a recording is in progress
   */
  isRecording(): boolean {
    return this.currentSession !== null && this.currentSession.status === 'recording';
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[RecordingManager] Created directory: ${dirPath}`);
    }
  }

  /**
   * Set output directory for audio files
   */
  setOutputDirectory(directory: string): void {
    this.outputDirectory = directory;
    this.ensureDirectoryExists(directory);
  }

  /**
   * Get current output directory
   */
  getOutputDirectory(): string {
    return this.outputDirectory;
  }
}
