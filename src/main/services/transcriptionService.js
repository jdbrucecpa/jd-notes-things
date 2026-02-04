const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Unified Transcription Service
 * Supports multiple providers: Recall.ai, AssemblyAI, Deepgram
 *
 * Universal-3-Pro Features (AssemblyAI):
 * - Higher accuracy transcription with speech_models: ['universal-3-pro', 'universal-2']
 * - Keyterms prompting via `keyterms_prompt` (up to 1,000 domain-specific terms)
 * - Speaker identification with names via speech_understanding
 * - Verbatim mode for disfluencies (preserves "um", "uh", etc.)
 *
 * API LIMITATION: AssemblyAI only allows ONE of: prompt OR keyterms_prompt (not both)
 * We use keyterms_prompt for better vocabulary accuracy (company names, technical terms)
 *
 * PENDING FEATURES:
 * - Verbatim mode: Backend supports `options.verbatim = true` but no UI toggle exists yet.
 *   To enable programmatically, pass { verbatim: true } in transcription options.
 */
class TranscriptionService {
  constructor() {
    this.providers = {
      recallai: this.transcribeWithRecallAI.bind(this),
      assemblyai: this.transcribeWithAssemblyAI.bind(this),
      deepgram: this.transcribeWithDeepgram.bind(this),
    };
    this.keyManagementService = null;
    this.backgroundTaskManager = null;
  }

  /**
   * Set the background task manager for progress tracking (Phase 7)
   * @param {object} manager - Background task manager instance
   */
  setBackgroundTaskManager(manager) {
    this.backgroundTaskManager = manager;
  }

  /**
   * Update task progress if manager is available
   * @param {string|null} taskId - Task ID (may be null)
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} statusMessage - Status message to display
   */
  updateTaskProgress(taskId, progress, statusMessage) {
    if (this.backgroundTaskManager && taskId) {
      this.backgroundTaskManager.updateTask(taskId, progress, statusMessage);
    }
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
   * AssemblyAI Transcription with Universal-3 Pro support
   * https://www.assemblyai.com/docs
   * @param {string} audioFilePath - Path to audio file
   * @param {object} options - Transcription options
   * @param {Array} options.custom_spelling - Custom spelling corrections [{from: [], to: ""}] (legacy)
   * @param {Array} options.keyterms_prompt - Keyterms for Universal-3 Pro (up to 1,000 terms)
   * @param {Array} options.speakerNames - Known speaker names for identification (max 10, 35 chars each)
   * @param {boolean} options.verbatim - Preserve filler words (um, uh, etc.) - No UI yet
   * @param {string} options.meetingId - Meeting ID for background task tracking
   */
  async transcribeWithAssemblyAI(audioFilePath, options = {}) {
    const ASSEMBLYAI_API_KEY = await this.getApiKey('ASSEMBLYAI_API_KEY');

    if (!ASSEMBLYAI_API_KEY) {
      throw new Error('ASSEMBLYAI_API_KEY not configured. Set it in Settings > Security');
    }

    let taskId = null;

    // Create background task if manager available (Phase 7)
    if (this.backgroundTaskManager) {
      taskId = this.backgroundTaskManager.addTask({
        type: 'transcription',
        description: `Transcribing: ${path.basename(audioFilePath)}`,
        meetingId: options.meetingId,
        metadata: { audioPath: audioFilePath, provider: 'assemblyai' },
      });
    }

    try {
      // Step 1: Upload
      this.updateTaskProgress(taskId, 10, 'Uploading audio to AssemblyAI...');
      console.log('[AssemblyAI] Step 1: Uploading audio file...');
      const uploadUrl = await this.uploadToAssemblyAI(audioFilePath, ASSEMBLYAI_API_KEY);
      console.log('[AssemblyAI] Upload complete');

      // Step 2: Request transcription
      this.updateTaskProgress(taskId, 20, 'Starting transcription...');
      console.log('[AssemblyAI] Step 2: Requesting transcription with Universal-3 Pro...');
      const transcriptId = await this.requestAssemblyAITranscription(
        uploadUrl,
        ASSEMBLYAI_API_KEY,
        options
      );
      console.log(`[AssemblyAI] Transcription started, ID: ${transcriptId}`);

      // Step 3: Poll for completion (30% to 90% during polling)
      this.updateTaskProgress(taskId, 30, 'Waiting for AssemblyAI...');
      console.log('[AssemblyAI] Step 3: Waiting for transcription to complete...');
      const transcript = await this.pollAssemblyAITranscript(
        transcriptId,
        ASSEMBLYAI_API_KEY,
        taskId
      );

      // Complete
      this.updateTaskProgress(taskId, 95, 'Processing transcript...');
      if (this.backgroundTaskManager && taskId) {
        this.backgroundTaskManager.completeTask(taskId, { transcriptId });
      }

      console.log('[AssemblyAI] ✓ Transcription complete');
      return this.formatAssemblyAITranscript(transcript);
    } catch (error) {
      if (this.backgroundTaskManager && taskId) {
        this.backgroundTaskManager.failTask(taskId, error.message);
      }
      throw error;
    }
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
    // Build request with Universal-3 Pro features
    // NOTE: To use both prompt AND keyterms_prompt, must include fallback model and language_detection
    const requestBody = {
      audio_url: uploadUrl,
      speaker_labels: true, // Enable speaker diarization
      speech_models: ['universal-3-pro', 'universal-2'], // Primary + fallback (required for dual prompting)
      language_detection: true, // Recommended for Universal-3-Pro
    };

    // Keyterms prompting (up to 1,000 terms for Universal-3-Pro, max 6 words per phrase)
    // NOTE: AssemblyAI API only allows ONE of: prompt OR keyterms_prompt (not both)
    // We prioritize keyterms_prompt for better vocabulary/terminology accuracy
    if (options.keyterms_prompt && options.keyterms_prompt.length > 0) {
      requestBody.keyterms_prompt = options.keyterms_prompt;
      console.log(`[AssemblyAI] Using ${options.keyterms_prompt.length} keyterms for Universal-3-Pro`);
    } else if (options.custom_spelling && options.custom_spelling.length > 0) {
      // Legacy fallback: convert custom_spelling to keyterms
      const legacyKeyterms = options.custom_spelling.map(item => item.to).filter(Boolean);
      if (legacyKeyterms.length > 0) {
        requestBody.keyterms_prompt = legacyKeyterms.slice(0, 1000);
        console.log(
          `[AssemblyAI] Converted ${legacyKeyterms.length} custom_spelling entries to keyterms`
        );
      }
    }

    // NOTE: prompt parameter abandoned in v1.2.5 - API only allows keyterms_prompt OR prompt
    // We use keyterms_prompt for better vocabulary accuracy (company names, technical terms)

    // Phase 4: Speaker identification with names
    if (options.speakerNames && options.speakerNames.length > 0) {
      // API constraints: max 10 names, each max 35 characters
      const validNames = options.speakerNames
        .filter(name => name && typeof name === 'string')
        .map(name => (name.length > 35 ? name.substring(0, 35) : name))
        .slice(0, 10);

      if (validNames.length > 0) {
        requestBody.speech_understanding = {
          request: {
            speaker_identification: {
              speaker_type: 'name',
              known_values: validNames,
            },
          },
        };
        console.log(`[AssemblyAI] Speaker identification enabled with ${validNames.length} names`);
      }
    }

    // Phase 5: Verbatim mode (preserve filler words)
    if (options.verbatim === true) {
      requestBody.disfluencies = true;
      console.log('[AssemblyAI] Verbatim mode enabled (preserving filler words)');
    }

    console.log('[AssemblyAI] Request body:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post('https://api.assemblyai.com/v2/transcript', requestBody, {
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
    });

    return response.data.id;
  }

  async pollAssemblyAITranscript(transcriptId, apiKey, taskId = null) {
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

      // Update progress (30% to 90% linearly during polling) - Phase 7
      const progress = Math.floor(30 + (attempts / maxAttempts) * 60);
      const elapsedSeconds = attempts * 5;
      this.updateTaskProgress(taskId, progress, `Transcribing... (${elapsedSeconds}s)`);

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
