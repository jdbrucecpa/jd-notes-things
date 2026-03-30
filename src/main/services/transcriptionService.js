const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Unified Transcription Service
 * Supports multiple providers: AssemblyAI, Deepgram, Local (JD Audio Service)
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
      assemblyai: this.transcribeWithAssemblyAI.bind(this),
      deepgram: this.transcribeWithDeepgram.bind(this),
      local: this.transcribeWithLocal.bind(this),
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
   * @param {string} provider - 'assemblyai', 'deepgram', or 'local'
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
   * Local Transcription via JD Audio Service
   * Calls a locally-running Python FastAPI server for offline transcription + speaker diarization
   * @param {string} audioFilePath - Path to audio file
   * @param {object} options - Transcription options
   * @param {string} [options.aiServiceUrl='http://localhost:8374'] - Base URL of the JD Audio Service
   * @param {Array} [options.speakerNames] - Known speaker names for diarization hints
   * @param {number} [options.minSpeakers] - Minimum number of speakers expected
   * @param {number} [options.maxSpeakers] - Maximum number of speakers expected
   * @param {Array} [options.vocabulary] - Domain-specific vocabulary terms
   * @param {string} [options.meetingId] - Meeting ID for background task tracking
   */
  async transcribeWithLocal(audioFilePath, options = {}) {
    const aiServiceUrl = options.aiServiceUrl || 'http://localhost:8374';

    let taskId = null;

    // Create background task if manager available
    if (this.backgroundTaskManager) {
      taskId = this.backgroundTaskManager.addTask({
        type: 'transcription',
        description: `Transcribing: ${path.basename(audioFilePath)}`,
        meetingId: options.meetingId,
        metadata: { audioPath: audioFilePath, provider: 'local' },
      });
    }

    try {
      // Health check — confirm service is running
      this.updateTaskProgress(taskId, 5, 'Checking JD Audio Service...');
      console.log('[Local] Checking JD Audio Service health...');
      let healthOk = false;
      try {
        const healthRes = await fetch(`${aiServiceUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        healthOk = healthRes.ok;
      } catch {
        healthOk = false;
      }
      if (!healthOk) {
        throw new Error(
          'JD Audio Service is not running. Start it from the system tray, or switch to cloud transcription in Settings.'
        );
      }
      console.log('[Local] JD Audio Service is healthy');

      // Estimate timeout from file size (rough: 1 MB ≈ 1 min of audio at 128 kbps)
      const stats = fs.statSync(audioFilePath);
      const estimatedDurationSec = (stats.size / (128 * 1024 / 8)) * 1; // bytes → seconds
      const timeoutMs = (estimatedDurationSec * 0.5 + 60) * 1000;
      console.log(
        `[Local] File size: ${(stats.size / 1024).toFixed(2)} KB, estimated duration: ${estimatedDurationSec.toFixed(0)}s, timeout: ${(timeoutMs / 1000).toFixed(0)}s`
      );

      // POST /process
      this.updateTaskProgress(taskId, 10, 'Sending audio to JD Audio Service...');
      console.log('[Local] POSTing to /process...');
      const response = await fetch(`${aiServiceUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioPath: audioFilePath,
          options: {
            speakerNames: options.speakerNames,
            minSpeakers: options.minSpeakers,
            maxSpeakers: options.maxSpeakers,
            vocabulary: options.vocabulary,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`JD Audio Service returned ${response.status}: ${errText}`);
      }

      this.updateTaskProgress(taskId, 80, 'Processing transcript...');
      const data = await response.json();

      // Normalize to standard shape
      // Service returns timestamps in seconds; convert to milliseconds
      const entries = (data.entries || []).map(entry => ({
        speaker: entry.speaker,
        speakerId: entry.speakerId ?? entry.speaker_id ?? entry.speaker,
        text: entry.text,
        timestamp: typeof entry.timestamp === 'number' ? Math.round(entry.timestamp * 1000) : entry.timestamp,
        words: entry.words || [],
      }));

      const result = {
        text: data.text || entries.map(e => e.text).join(' '),
        entries,
        segments: data.segments || null,
        provider: 'local',
        confidence: data.confidence ?? 0.9,
        audio_duration: data.audio_duration || null,
      };

      this.updateTaskProgress(taskId, 95, 'Finalizing...');
      if (this.backgroundTaskManager && taskId) {
        this.backgroundTaskManager.completeTask(taskId, {});
      }

      console.log('[Local] Transcription complete');
      return result;
    } catch (error) {
      if (this.backgroundTaskManager && taskId) {
        this.backgroundTaskManager.failTask(taskId, error.message);
      }
      throw error;
    }
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
    const audioStream = fs.createReadStream(audioFilePath);

    const response = await axios.post('https://api.assemblyai.com/v2/upload', audioStream, {
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
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
    let hasIdentifiedSpeakers = false;

    if (assemblyData.utterances) {
      assemblyData.utterances.forEach(utterance => {
        // Detect whether speaker_identification returned real names vs generic diarization labels.
        // Generic labels are single letters ("A", "B") or single digits ("0", "1").
        // Real names (e.g. "JD Bruce") should be used directly.
        const rawSpeaker = String(utterance.speaker);
        const isGenericLabel = /^[A-Z]$|^\d+$/.test(rawSpeaker);

        const entry = {
          speaker: isGenericLabel ? `Speaker ${rawSpeaker}` : rawSpeaker,
          speakerId: utterance.speaker,
          text: utterance.text,
          timestamp: utterance.start,
          words: utterance.words || [],
        };

        if (!isGenericLabel) {
          entry.speakerIdentified = true;
          hasIdentifiedSpeakers = true;
        }

        entries.push(entry);
      });
    }

    if (hasIdentifiedSpeakers) {
      console.log('[AssemblyAI] speech_understanding speaker identification was used - real names found in transcript');
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

    const audioStream = fs.createReadStream(audioFilePath);

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

    const response = await axios.post(url, audioStream, {
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/mpeg',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
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
