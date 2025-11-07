/**
 * Interface for transcription service providers
 * Allows pluggable backends (AssemblyAI, Parakeet, etc.)
 */

import { Transcript } from '../../shared/types';

export interface ITranscriptionProvider {
  /**
   * Provider name for logging/debugging
   */
  readonly name: string;

  /**
   * Transcribe an audio file
   * @param audioFilePath - Path to the audio file to transcribe
   * @returns Promise resolving to the transcript with speaker diarization
   */
  transcribe(audioFilePath: string): Promise<Transcript>;

  /**
   * Check if this provider supports real-time streaming transcription
   */
  supportsRealtime(): boolean;

  /**
   * Get the cost per hour of audio for this provider
   * @returns Cost in USD, or 0 for local/free providers
   */
  getCostPerHour(): number;

  /**
   * Check if this provider requires an API key
   */
  requiresApiKey(): boolean;

  /**
   * Check if this provider is available (e.g., API key configured, local model installed)
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Configuration for transcription providers
 */
export interface TranscriptionProviderConfig {
  apiKey?: string;
  apiUrl?: string;
  // Provider-specific options
  options?: Record<string, any>;
}
