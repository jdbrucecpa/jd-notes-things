/**
 * AssemblyAI transcription provider
 * Cloud-based transcription with excellent speaker diarization
 */

import { AssemblyAI } from 'assemblyai';
import * as fs from 'fs';
import { ITranscriptionProvider, TranscriptionProviderConfig } from './ITranscriptionProvider';
import { Transcript, TranscriptSegment, Participant } from '../../shared/types';

export class AssemblyAIProvider implements ITranscriptionProvider {
  readonly name = 'AssemblyAI';
  private client: AssemblyAI | null = null;
  private config: TranscriptionProviderConfig;

  constructor(config: TranscriptionProviderConfig) {
    this.config = config;
    if (config.apiKey) {
      this.client = new AssemblyAI({ apiKey: config.apiKey });
    }
  }

  async transcribe(audioFilePath: string): Promise<Transcript> {
    if (!this.client) {
      throw new Error('AssemblyAI client not initialized. API key required.');
    }

    console.log(`[AssemblyAI] Starting transcription for: ${audioFilePath}`);

    // Verify file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    try {
      // Upload and transcribe with speaker diarization
      const transcript = await this.client.transcripts.transcribe({
        audio: audioFilePath,
        speaker_labels: true,
      });

      if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
      }

      console.log(`[AssemblyAI] Transcription completed. Found ${transcript.words?.length || 0} words`);

      // Convert AssemblyAI format to our Transcript format
      return this.convertToTranscript(transcript, audioFilePath);
    } catch (error) {
      console.error('[AssemblyAI] Transcription error:', error);
      throw error;
    }
  }

  supportsRealtime(): boolean {
    return false; // AssemblyAI real-time is available but not implemented yet
  }

  getCostPerHour(): number {
    return 0.27; // $0.27/hour as of 2025
  }

  requiresApiKey(): boolean {
    return true;
  }

  async isAvailable(): Promise<boolean> {
    return this.client !== null && !!this.config.apiKey;
  }

  /**
   * Convert AssemblyAI transcript format to our internal format
   */
  private convertToTranscript(aaiTranscript: any, audioFilePath: string): Transcript {
    const segments: TranscriptSegment[] = [];
    const speakerMap = new Map<string, Participant>();

    // Group utterances by speaker
    if (aaiTranscript.utterances) {
      for (const utterance of aaiTranscript.utterances) {
        const speakerLabel = utterance.speaker || 'Unknown';

        // Create participant if not exists
        if (!speakerMap.has(speakerLabel)) {
          speakerMap.set(speakerLabel, {
            name: `Speaker ${speakerLabel}`,
          });
        }

        // Add segment
        segments.push({
          speaker: `Speaker ${speakerLabel}`,
          text: utterance.text,
          timestamp: new Date(utterance.start), // Start time in milliseconds
          confidence: utterance.confidence,
        });
      }
    }

    // Calculate duration from transcript
    const duration = aaiTranscript.audio_duration || 0;

    // Extract session ID from file path (or generate one)
    const sessionId = this.extractSessionId(audioFilePath);

    return {
      sessionId,
      segments,
      metadata: {
        duration,
        participants: Array.from(speakerMap.values()),
        platform: 'manual', // Will be updated when we have platform detection
      },
    };
  }

  /**
   * Extract session ID from audio file path
   */
  private extractSessionId(audioFilePath: string): string {
    // Extract filename without extension
    const filename = audioFilePath.split(/[\\/]/).pop() || '';
    const sessionId = filename.replace(/\.[^.]+$/, '');
    return sessionId || Date.now().toString();
  }
}
