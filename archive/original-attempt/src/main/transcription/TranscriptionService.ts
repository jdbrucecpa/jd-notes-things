/**
 * Transcription Service Factory
 * Creates and manages transcription providers
 */

import { ITranscriptionProvider, TranscriptionProviderConfig } from './ITranscriptionProvider';
import { AssemblyAIProvider } from './AssemblyAIProvider';
import { TranscriptionProvider, Transcript } from '../../shared/types';

export class TranscriptionService {
  private provider: ITranscriptionProvider;

  constructor(
    providerType: TranscriptionProvider,
    config: TranscriptionProviderConfig
  ) {
    this.provider = this.createProvider(providerType, config);
  }

  /**
   * Factory method to create the appropriate provider
   */
  private createProvider(
    providerType: TranscriptionProvider,
    config: TranscriptionProviderConfig
  ): ITranscriptionProvider {
    switch (providerType) {
      case 'assemblyai':
        return new AssemblyAIProvider(config);

      case 'parakeet':
        // TODO: Implement ParakeetProvider in Phase 1.5
        throw new Error('Parakeet provider not yet implemented. Use "assemblyai" for now.');

      case 'auto':
        // Auto mode: try local first, fallback to cloud
        // For now, just use AssemblyAI
        console.log('[TranscriptionService] Auto mode: defaulting to AssemblyAI');
        return new AssemblyAIProvider(config);

      default:
        throw new Error(`Unknown transcription provider: ${providerType}`);
    }
  }

  /**
   * Transcribe an audio file
   */
  async transcribe(audioFilePath: string): Promise<Transcript> {
    console.log(`[TranscriptionService] Transcribing with ${this.provider.name}...`);

    // Check if provider is available
    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      throw new Error(
        `${this.provider.name} is not available. ` +
        `${this.provider.requiresApiKey() ? 'API key may be missing.' : 'Provider not configured.'}`
      );
    }

    // Perform transcription
    const startTime = Date.now();
    const transcript = await this.provider.transcribe(audioFilePath);
    const duration = (Date.now() - startTime) / 1000;

    console.log(
      `[TranscriptionService] Transcription completed in ${duration.toFixed(2)}s. ` +
      `Found ${transcript.segments.length} segments.`
    );

    return transcript;
  }

  /**
   * Get information about the current provider
   */
  getProviderInfo() {
    return {
      name: this.provider.name,
      supportsRealtime: this.provider.supportsRealtime(),
      costPerHour: this.provider.getCostPerHour(),
      requiresApiKey: this.provider.requiresApiKey(),
    };
  }

  /**
   * Check if the current provider is available
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }
}

/**
 * Create a transcription service from environment variables
 */
export function createTranscriptionServiceFromEnv(): TranscriptionService {
  const providerType = (process.env.TRANSCRIPTION_PROVIDER || 'assemblyai') as TranscriptionProvider;
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  return new TranscriptionService(providerType, {
    apiKey,
  });
}
