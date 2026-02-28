/**
 * LLM Service - Unified interface for multiple LLM providers
 * v1.3.2: Supports Anthropic Claude, Google Gemini, and Ollama (local)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');

/**
 * Base LLM Adapter Interface
 * All adapters must implement these methods
 */
class LLMAdapter {
  /**
   * Generate a completion (non-streaming)
   * @param {Object} options - Generation options
   * @param {string} options.systemPrompt - System/instruction prompt
   * @param {string} options.userPrompt - User message
   * @param {number} options.maxTokens - Maximum tokens to generate
   * @param {number} options.temperature - Temperature (0-1)
   * @returns {Promise<{content: string, model: string}>}
   */
  async generateCompletion(_options) {
    throw new Error('generateCompletion must be implemented by subclass');
  }

  /**
   * Generate a completion with streaming
   * @param {Object} options - Generation options
   * @param {string} options.systemPrompt - System/instruction prompt
   * @param {string} options.userPrompt - User message
   * @param {number} options.maxTokens - Maximum tokens to generate
   * @param {number} options.temperature - Temperature (0-1)
   * @param {Function} options.onChunk - Callback for each chunk (cumulative text)
   * @returns {Promise<string>} - Final complete text
   */
  async streamCompletion(_options) {
    throw new Error('streamCompletion must be implemented by subclass');
  }

  /**
   * Get provider name
   */
  getProviderName() {
    throw new Error('getProviderName must be implemented by subclass');
  }
}

/**
 * Model ID mappings - preference string to actual API model ID
 * Format: 'preference-value' => 'api-model-id'
 */
const ANTHROPIC_MODEL_MAP = {
  // Budget tier
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  // Balanced tier
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  // Premium tier
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
};

const GEMINI_MODEL_MAP = {
  // Budget tier
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite-preview-06-17',
  // Balanced tier
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
};

/**
 * Extract model ID from preference string
 * e.g., 'claude-haiku-4-5' => 'claude-haiku-4-5-20251001'
 * e.g., 'gemini-2.5-flash' => 'gemini-2.5-flash-preview-05-20'
 * e.g., 'ollama-llama3' => 'llama3'
 */
function extractModelFromPreference(preference) {
  if (!preference) return null;

  if (preference.startsWith('claude-')) {
    return ANTHROPIC_MODEL_MAP[preference] || preference;
  }

  if (preference.startsWith('gemini-')) {
    return GEMINI_MODEL_MAP[preference] || preference;
  }

  if (preference.startsWith('ollama-')) {
    return preference.replace('ollama-', '');
  }

  return preference;
}

/**
 * Anthropic Claude Adapter
 * Supports Claude models (Haiku, Sonnet)
 */
class AnthropicAdapter extends LLMAdapter {
  constructor(apiKey, model = 'claude-haiku-4-5-20251001') {
    super();
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
    } = options;

    let messages;
    let systemConfig;

    if (cacheableContext) {
      // Use Anthropic's explicit prompt caching
      // Mark the cacheable content (transcript) with cache_control
      systemConfig = [
        {
          type: 'text',
          text: systemPrompt,
        },
        {
          type: 'text',
          text: `Here is the meeting transcript:\n\n${cacheableContext}`,
          cache_control: { type: 'ephemeral' }, // Mark for caching
        },
      ];

      messages = [{ role: 'user', content: userPrompt }];
    } else {
      // Standard message format
      systemConfig = systemPrompt;
      messages = [{ role: 'user', content: userPrompt }];
    }

    const message = await this.client.messages.create({
      model: this.model,
      system: systemConfig,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
    });

    // Log token usage and cache statistics
    if (message.usage) {
      console.log('[Anthropic] Token Usage:', JSON.stringify(message.usage, null, 2));

      // Anthropic uses different field names for cache statistics
      const cacheCreated = message.usage.cache_creation_input_tokens || 0;
      const cacheRead = message.usage.cache_read_input_tokens || 0;
      const normalInput = message.usage.input_tokens || 0;
      const totalInput = cacheCreated + cacheRead + normalInput;

      if (cacheRead > 0) {
        const cacheHitRate = totalInput > 0 ? ((cacheRead / totalInput) * 100).toFixed(1) : 0;
        console.log(
          `[Anthropic] CACHE HIT: ${cacheRead}/${totalInput} tokens from cache (${cacheHitRate}% hit rate)`
        );
      } else if (cacheCreated > 0) {
        console.log(
          `[Anthropic] Cache created: ${cacheCreated} tokens (next calls will hit cache)`
        );
      } else {
        console.log('[Anthropic] No cache activity - standard processing');
      }
    }

    return {
      content: message.content[0].text,
      model: message.model,
    };
  }

  async streamCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
      onChunk,
    } = options;

    let systemConfig;
    let messages;

    if (cacheableContext) {
      // Use Anthropic's explicit prompt caching
      systemConfig = [
        {
          type: 'text',
          text: systemPrompt,
        },
        {
          type: 'text',
          text: `Here is the meeting transcript:\n\n${cacheableContext}`,
          cache_control: { type: 'ephemeral' },
        },
      ];
      messages = [{ role: 'user', content: userPrompt }];
      console.log('[Anthropic Stream] Using prompt caching structure with cache_control');
    } else {
      // Standard message format
      systemConfig = systemPrompt;
      messages = [{ role: 'user', content: userPrompt }];
    }

    const stream = this.client.messages.stream({
      model: this.model,
      system: systemConfig,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
    });

    return new Promise((resolve, reject) => {
      let fullText = '';

      stream.on('text', text => {
        fullText += text;
        if (onChunk) {
          onChunk(fullText);
        }
      });

      stream.on('end', () => {
        resolve(fullText);
      });

      stream.on('error', error => {
        reject(error);
      });
    });
  }

  getProviderName() {
    return 'Anthropic';
  }
}

/**
 * Google Gemini Adapter
 * Supports Gemini 2.5 Flash and Flash Lite models
 */
class GeminiAdapter extends LLMAdapter {
  constructor(apiKey, model = 'gemini-2.5-flash-preview-05-20') {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generateCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
    } = options;

    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    });

    // Build the user prompt with optional cacheable context
    let fullPrompt = userPrompt;
    if (cacheableContext) {
      fullPrompt = `Here is the meeting transcript:\n\n${cacheableContext}\n\n${userPrompt}`;
    }

    const result = await generativeModel.generateContent(fullPrompt);
    const response = result.response;

    // Log token usage
    if (response.usageMetadata) {
      console.log('[Gemini] Token Usage:', JSON.stringify(response.usageMetadata, null, 2));
    }

    return {
      content: response.text(),
      model: this.model,
    };
  }

  async streamCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
      onChunk,
    } = options;

    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    });

    // Build the user prompt with optional cacheable context
    let fullPrompt = userPrompt;
    if (cacheableContext) {
      fullPrompt = `Here is the meeting transcript:\n\n${cacheableContext}\n\n${userPrompt}`;
    }

    const result = await generativeModel.generateContentStream(fullPrompt);

    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        if (onChunk) {
          onChunk(fullText);
        }
      }
    }

    return fullText;
  }

  getProviderName() {
    return 'Gemini';
  }
}

/**
 * Ollama Adapter (Local LLM)
 * Connects to a local Ollama instance via its OpenAI-compatible API.
 * No API key required — runs entirely on your machine.
 */
class OllamaAdapter extends LLMAdapter {
  constructor(model = 'llama3', baseUrl = 'http://localhost:11434') {
    super();
    // Ollama exposes an OpenAI-compatible API, so we reuse the openai client
    this.client = new OpenAI({
      apiKey: 'ollama', // Ollama doesn't need a real key
      baseURL: `${baseUrl}/v1`,
    });
    this.model = model;
  }

  async generateCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
    } = options;

    const messages = [{ role: 'system', content: systemPrompt }];

    if (cacheableContext) {
      messages.push({
        role: 'user',
        content: `Here is the meeting transcript:\n\n${cacheableContext}`,
      });
      messages.push({ role: 'user', content: userPrompt });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
    });

    if (completion.usage) {
      console.log('[Ollama] Token Usage:', JSON.stringify(completion.usage, null, 2));
    }

    return {
      content: completion.choices[0].message.content,
      model: completion.model || this.model,
    };
  }

  async streamCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
      onChunk,
    } = options;

    const messages = [{ role: 'system', content: systemPrompt }];

    if (cacheableContext) {
      messages.push({
        role: 'user',
        content: `Here is the meeting transcript:\n\n${cacheableContext}`,
      });
      messages.push({ role: 'user', content: userPrompt });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    });

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        if (onChunk) {
          onChunk(fullText);
        }
      }
    }

    return fullText;
  }

  getProviderName() {
    return 'Ollama';
  }
}

/**
 * LLM Service Factory
 * Creates the appropriate adapter based on configuration
 */
class LLMService {
  /**
   * Initialize LLM service with provider config
   * @param {Object} config - Provider configuration
   * @param {string} config.provider - 'anthropic' | 'gemini' | 'ollama'
   * @param {Object} config.anthropic - Anthropic config { apiKey, model }
   * @param {Object} config.gemini - Gemini config { apiKey, model }
   * @param {Object} config.ollama - Ollama config { model, baseUrl }
   */
  constructor(config) {
    this.config = config;
    this.adapter = this._createAdapter();
  }

  _createAdapter() {
    switch (this.config.provider) {
      case 'anthropic':
        if (!this.config.anthropic?.apiKey) {
          throw new Error('Anthropic API key is required');
        }
        console.log(
          `[LLM Service] Initializing Anthropic adapter with model: ${this.config.anthropic.model || 'claude-haiku-4-5-20251001'}`
        );
        return new AnthropicAdapter(this.config.anthropic.apiKey, this.config.anthropic.model);

      case 'gemini':
        if (!this.config.gemini?.apiKey) {
          throw new Error('Google API key (Gemini) is required');
        }
        console.log(
          `[LLM Service] Initializing Gemini adapter with model: ${this.config.gemini.model || 'gemini-2.5-flash-preview-05-20'}`
        );
        return new GeminiAdapter(this.config.gemini.apiKey, this.config.gemini.model);

      case 'ollama':
        console.log(
          `[LLM Service] Initializing Ollama adapter with model: ${this.config.ollama?.model || 'llama3'}`
        );
        return new OllamaAdapter(
          this.config.ollama?.model || 'llama3',
          this.config.ollama?.baseUrl || 'http://localhost:11434'
        );

      default:
        throw new Error(
          `Unknown provider: ${this.config.provider}. Must be 'anthropic', 'gemini', or 'ollama'`
        );
    }
  }

  /**
   * Generate completion using configured provider
   */
  async generateCompletion(options) {
    try {
      const result = await this.adapter.generateCompletion(options);
      console.log(
        `[LLM Service] Generated completion using ${this.adapter.getProviderName()} (${result.model})`
      );
      return result;
    } catch (error) {
      console.error(
        `[LLM Service] Error generating completion with ${this.adapter.getProviderName()}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate streaming completion using configured provider
   */
  async streamCompletion(options) {
    try {
      const result = await this.adapter.streamCompletion(options);
      console.log(`[LLM Service] Completed streaming with ${this.adapter.getProviderName()}`);
      return result;
    } catch (error) {
      console.error(`[LLM Service] Error streaming with ${this.adapter.getProviderName()}:`, error);
      throw error;
    }
  }

  /**
   * Get current provider name
   */
  getProviderName() {
    return this.adapter.getProviderName();
  }

  /**
   * Switch to a different provider
   * @param {string} provider - 'anthropic' | 'gemini' | 'ollama'
   * @param {string} [model] - Optional model to use
   */
  switchProvider(provider, model) {
    this.config.provider = provider;

    // Update model config if provided
    if (model) {
      if (provider === 'anthropic' && this.config.anthropic) {
        this.config.anthropic.model = model;
      } else if (provider === 'gemini' && this.config.gemini) {
        this.config.gemini.model = model;
      } else if (provider === 'ollama') {
        if (!this.config.ollama) this.config.ollama = {};
        this.config.ollama.model = model;
      }
    }

    this.adapter = this._createAdapter();
    console.log(
      `[LLM Service] Switched to ${this.adapter.getProviderName()}${model ? ` with model: ${model}` : ''}`
    );
  }

  /**
   * Switch to a specific model using preference string
   * @param {string} preference - Full preference string (e.g., 'claude-haiku-4-5', 'gemini-2.5-flash', 'ollama-llama3')
   */
  switchToPreference(preference) {
    const model = extractModelFromPreference(preference);
    let provider;

    if (preference.startsWith('claude-')) {
      provider = 'anthropic';
    } else if (preference.startsWith('gemini-')) {
      provider = 'gemini';
    } else if (preference.startsWith('ollama-')) {
      provider = 'ollama';
    } else {
      console.warn(
        `[LLM Service] Unknown preference format: ${preference}, defaulting to anthropic`
      );
      provider = 'anthropic';
    }

    this.switchProvider(provider, model);
  }

  /**
   * Get current model name
   */
  getCurrentModel() {
    if (this.config.provider === 'anthropic') {
      return this.config.anthropic?.model || 'claude-haiku-4-5-20251001';
    } else if (this.config.provider === 'gemini') {
      return this.config.gemini?.model || 'gemini-2.5-flash-preview-05-20';
    } else if (this.config.provider === 'ollama') {
      return this.config.ollama?.model || 'llama3';
    }
    return 'unknown';
  }
}

/**
 * Create LLM service from environment variables
 * @deprecated Use createLLMServiceFromCredentials() instead for production
 */
function createLLMServiceFromEnv() {
  // Priority (v1.3.2): Anthropic > Gemini > Ollama
  let provider;
  if (process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
  } else if (process.env.GOOGLE_API_KEY) {
    provider = 'gemini';
  } else {
    // Default to Ollama (local, no key required)
    provider = 'ollama';
  }

  const config = {
    provider,
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-haiku-4-5-20251001',
    },
    gemini: {
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-2.5-flash-preview-05-20',
    },
    ollama: {
      model: process.env.OLLAMA_MODEL || 'llama3',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
  };

  return new LLMService(config);
}

/**
 * Create LLM service from Windows Credential Manager (with .env fallback)
 * @param {Object} keyManagementService - Key management service instance
 */
async function createLLMServiceFromCredentials(keyManagementService) {
  // Try to get API keys from Windows Credential Manager first, fall back to env vars
  const anthropicKey =
    (await keyManagementService.getKey('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
  const geminiKey =
    (await keyManagementService.getKey('GOOGLE_API_KEY')) || process.env.GOOGLE_API_KEY;
  const ollamaBaseUrl =
    (await keyManagementService.getKey('OLLAMA_BASE_URL')) ||
    process.env.OLLAMA_BASE_URL ||
    'http://localhost:11434';
  const ollamaModel =
    (await keyManagementService.getKey('OLLAMA_MODEL')) || process.env.OLLAMA_MODEL || 'llama3';

  // Priority (v1.3.2): Anthropic > Gemini > Ollama (Ollama always available as fallback)
  let provider;
  if (anthropicKey) {
    provider = 'anthropic';
  } else if (geminiKey) {
    provider = 'gemini';
  } else {
    provider = 'ollama';
  }

  const config = {
    provider,
    anthropic: {
      apiKey: anthropicKey,
      model: 'claude-haiku-4-5-20251001',
    },
    gemini: {
      apiKey: geminiKey,
      model: 'gemini-2.5-flash-preview-05-20',
    },
    ollama: {
      model: ollamaModel,
      baseUrl: ollamaBaseUrl,
    },
  };

  return new LLMService(config);
}

/**
 * Create LLM service from a provider preference string
 * @param {string} providerPreference - e.g., 'claude-haiku-4-5', 'gemini-2.5-flash', 'ollama-llama3'
 * @returns {LLMService}
 */
function createLLMServiceFromPreference(providerPreference) {
  const config = {
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-haiku-4-5-20251001',
    },
    gemini: {
      apiKey: process.env.GOOGLE_API_KEY,
      model: 'gemini-2.5-flash-preview-05-20',
    },
    ollama: {
      model: process.env.OLLAMA_MODEL || 'llama3',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
  };

  // Parse provider preference
  if (providerPreference.startsWith('claude')) {
    config.provider = 'anthropic';
    if (!config.anthropic.apiKey) {
      throw new Error('Anthropic API key not found in environment variables');
    }
  } else if (providerPreference.startsWith('gemini')) {
    config.provider = 'gemini';
    if (!config.gemini.apiKey) {
      throw new Error('Google API key (Gemini) not found in environment variables');
    }
  } else if (providerPreference.startsWith('ollama')) {
    config.provider = 'ollama';
  } else {
    // Default to whatever is available
    return createLLMServiceFromEnv();
  }

  return new LLMService(config);
}

module.exports = {
  LLMService,
  AnthropicAdapter,
  GeminiAdapter,
  OllamaAdapter,
  createLLMServiceFromEnv,
  createLLMServiceFromCredentials,
  createLLMServiceFromPreference,
  extractModelFromPreference,
  ANTHROPIC_MODEL_MAP,
  GEMINI_MODEL_MAP,
};
