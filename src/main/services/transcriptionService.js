const axios = require('axios');
const _FormData = require('form-data'); // Reserved for future multipart uploads
const fs = require('fs');
const _path = require('path'); // Reserved for future path utilities

/**
 * Unified Transcription Service
 * Supports multiple providers: Recall.ai, AssemblyAI, Deepgram
 */
class TranscriptionService {
  constructor() {
    this.providers = {
      recallai: this.transcribeWithRecallAI.bind(this),
      assemblyai: this.transcribeWithAssemblyAI.bind(this),
      deepgram: this.transcribeWithDeepgram.bind(this),
    };
    this.keyManagementService = null;
  }

  /**
   * Set the key management service for retrieving API keys from Windows Credential Manager
   * @param {object} keyManagementService - Key management service instance
   */
  setKeyManagementService(keyManagementService) {
    this.keyManagementService = keyManagementService;
  }

  /**
   * Get API key from Windows Credential Manager with fallback to environment variable
   * @param {string} keyName - Key name (e.g., 'ASSEMBLYAI_API_KEY')
   * @returns {Promise<string|null>} API key or null
   */
  async getApiKey(keyName) {
    // Try Windows Credential Manager first
    if (this.keyManagementService) {
      const key = await this.keyManagementService.getKey(keyName);
      if (key) {
        console.log(`[Transcription] Retrieved ${keyName} from Windows Credential Manager`);
        return key;
      }
    }
    // Fall back to environment variable (for dev mode)
    if (process.env[keyName]) {
      console.log(`[Transcription] Retrieved ${keyName} from environment variable`);
      return process.env[keyName];
    }
    return null;
  }

  /**
   * Main entry point - routes to the correct provider
   * @param {string} provider - 'recallai', 'assemblyai', or 'deepgram'
   * @param {string} audioFilePath - Path to the MP3 file
   * @param {object} options - Provider-specific options
   * @returns {Promise<object>} Transcript with speaker diarization
   */
  async transcribe(provider, audioFilePath, options = {}) {
    console.log(`[Transcription] Using provider: ${provider}`);
    console.log(`[Transcription] Audio file: ${audioFilePath}`);

    if (!this.providers[provider]) {
      throw new Error(`Unknown transcription provider: ${provider}`);
    }

    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    const stats = fs.statSync(audioFilePath);
    console.log(`[Transcription] File size: ${(stats.size / 1024).toFixed(2)} KB`);

    return await this.providers[provider](audioFilePath, options);
  }

  /**
   * Recall.ai (existing implementation - kept for when SDK is fixed)
   * Note: Currently broken - SDK uploadRecording() doesn't work
   */
  async transcribeWithRecallAI(audioFilePath, _options = {}) {
    throw new Error('Recall.ai SDK upload is currently broken. Please use AssemblyAI or Deepgram.');
  }

  /**
   * AssemblyAI Transcription
   * https://www.assemblyai.com/docs
   * @param {string} audioFilePath - Path to audio file
   * @param {object} options - Transcription options
   * @param {Array} options.custom_spelling - Custom spelling corrections [{from: [], to: ""}]
   */
  async transcribeWithAssemblyAI(audioFilePath, options = {}) {
    const ASSEMBLYAI_API_KEY = await this.getApiKey('ASSEMBLYAI_API_KEY');

    if (!ASSEMBLYAI_API_KEY) {
      throw new Error('ASSEMBLYAI_API_KEY not configured. Set it in Settings > Security');
    }

    console.log('[AssemblyAI] Step 1: Uploading audio file...');

    // Step 1: Upload the audio file
    const uploadUrl = await this.uploadToAssemblyAI(audioFilePath, ASSEMBLYAI_API_KEY);
    console.log('[AssemblyAI] Upload complete');

    // Step 2: Request transcription with speaker diarization
    console.log('[AssemblyAI] Step 2: Requesting transcription...');
    const transcriptId = await this.requestAssemblyAITranscription(
      uploadUrl,
      ASSEMBLYAI_API_KEY,
      options
    );
    console.log(`[AssemblyAI] Transcription started, ID: ${transcriptId}`);

    // Step 3: Poll for completion
    console.log('[AssemblyAI] Step 3: Waiting for transcription to complete...');
    const transcript = await this.pollAssemblyAITranscript(transcriptId, ASSEMBLYAI_API_KEY);

    console.log('[AssemblyAI] ✓ Transcription complete');
    return this.formatAssemblyAITranscript(transcript);
  }

  async uploadToAssemblyAI(audioFilePath, apiKey) {
    const audioData = fs.readFileSync(audioFilePath);

    const response = await axios.post('https://api.assemblyai.com/v2/upload', audioData, {
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
    });

    return response.data.upload_url;
  }

  async requestAssemblyAITranscription(uploadUrl, apiKey, options = {}) {
    const requestBody = {
      audio_url: uploadUrl,
      speaker_labels: true, // Enable speaker diarization
    };

    // Add custom spelling if vocabulary is provided (VC-3.2)
    if (options.custom_spelling && options.custom_spelling.length > 0) {
      requestBody.custom_spelling = options.custom_spelling;
      console.log(
        `[AssemblyAI] Using ${options.custom_spelling.length} custom spelling corrections`
      );
    }

    const response = await axios.post('https://api.assemblyai.com/v2/transcript', requestBody, {
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
    });

    return response.data.id;
  }

  async pollAssemblyAITranscript(transcriptId, apiKey) {
    const maxAttempts = 120; // 10 minutes max (5 second intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await axios.get(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      });

      const status = response.data.status;
      console.log(`[AssemblyAI] Status: ${status}`);

      if (status === 'completed') {
        return response.data;
      } else if (status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${response.data.error}`);
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('AssemblyAI transcription timed out');
  }

  formatAssemblyAITranscript(assemblyData) {
    // Convert AssemblyAI format to our standard format
    const entries = [];

    if (assemblyData.utterances) {
      assemblyData.utterances.forEach(utterance => {
        entries.push({
          speaker: `Speaker ${utterance.speaker}`,
          speakerId: utterance.speaker,
          text: utterance.text,
          timestamp: utterance.start,
          words: utterance.words || [],
        });
      });
    }

    return {
      text: assemblyData.text,
      entries: entries,
      provider: 'assemblyai',
      confidence: assemblyData.confidence,
      audio_duration: assemblyData.audio_duration || null, // Duration in seconds
    };
  }

  /**
   * Deepgram Transcription
   * https://developers.deepgram.com/docs
   * @param {string} audioFilePath - Path to audio file
   * @param {object} options - Transcription options
   * @param {Array} options.keywords - Keyword boosts ["word:intensifier", ...]
   */
  async transcribeWithDeepgram(audioFilePath, options = {}) {
    const DEEPGRAM_API_KEY = await this.getApiKey('DEEPGRAM_API_KEY');

    if (!DEEPGRAM_API_KEY) {
      throw new Error('DEEPGRAM_API_KEY not configured. Set it in Settings > Security');
    }

    console.log('[Deepgram] Uploading and transcribing...');

    const audioData = fs.readFileSync(audioFilePath);

    // Build URL with base parameters
    let url = 'https://api.deepgram.com/v1/listen?diarize=true&punctuate=true&utterances=true';

    // Add keywords if vocabulary is provided (VC-3.3)
    if (options.keywords && options.keywords.length > 0) {
      // Deepgram accepts multiple keywords params: &keywords=word1:3&keywords=word2:5
      const keywordsParams = options.keywords
        .map(kw => `keywords=${encodeURIComponent(kw)}`)
        .join('&');
      url += '&' + keywordsParams;
      console.log(`[Deepgram] Using ${options.keywords.length} keyword boosts`);
    }

    const response = await axios.post(url, audioData, {
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/mpeg',
      },
    });

    console.log('[Deepgram] ✓ Transcription complete');
    return this.formatDeepgramTranscript(response.data);
  }

  formatDeepgramTranscript(deepgramData) {
    // Convert Deepgram format to our standard format
    const entries = [];

    if (deepgramData.results?.utterances) {
      deepgramData.results.utterances.forEach(utterance => {
        entries.push({
          speaker: `Speaker ${utterance.speaker}`,
          speakerId: utterance.speaker,
          text: utterance.transcript,
          // Deepgram returns timestamps in seconds, convert to milliseconds for consistency with AssemblyAI
          timestamp: Math.round(utterance.start * 1000),
          words: utterance.words || [],
        });
      });
    }

    return {
      text: deepgramData.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
      entries: entries,
      provider: 'deepgram',
      confidence: deepgramData.results?.channels?.[0]?.alternatives?.[0]?.confidence,
      audio_duration: deepgramData.metadata?.duration || null, // Duration in seconds
    };
  }
}

module.exports = new TranscriptionService();
