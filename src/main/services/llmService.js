/**
 * LLM Service - Unified interface for multiple LLM providers
 * v1.3.2: Supports Anthropic Claude, Google Gemini, and Ollama (local)
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');
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
  // Premium tier
  'claude-sonnet-5-5': 'claude-sonnet-5-5',
  'claude-opus-5-5': 'claude-opus-5-5',
  // Legacy preference strings (older settings/meetings) → current model
  'claude-opus-5': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
};

const GEMINI_MODEL_MAP = {
  // Budget tier (current Flash-Lite — no newer Flash-Lite as of 2026-09)
  'gemini-3.5-flash-lite': 'gemini-3.5-flash-lite',
  // Balanced tier
  'gemini-3.8-flash': 'gemini-3.8-flash',
  // Legacy preference strings (older settings/meetings) → nearest current model
  'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-3.5-flash': 'gemini-3.8-flash',
  'gemini-3.7-flash': 'gemini-3.8-flash',
};

/**
 * Claude models using the modern request surface (Opus 4.7+, Sonnet 5+, Fable 5):
 * sampling params (temperature/top_p/top_k) and budget_tokens are REJECTED with a 400.
 * Older models (Haiku 4.5, Sonnet 4.6, Opus 4.6 and earlier) still accept temperature.
 */
const CLAUDE_MODERN_PARAM_MODELS = [
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-mythos-5',
];

/**
 * Models run at their API defaults: no `thinking` or `effort` fields, i.e.
 * adaptive thinking at the model's default effort (Sonnet 5.5: high, Opus 5.5:
 * medium). All reject `thinking: { type: 'disabled' }` with a 400. Chosen from a
 * 2026-09-28 side-by-side on a real meeting: defaults beat lower thinking on
 * accuracy (verbatim quotes, multi-step facts) at a small cost increase.
 * Checked BEFORE the disable list — prefix matching means 'claude-opus-5' /
 * 'claude-sonnet-5' there would also match 'claude-opus-5-5' / 'claude-sonnet-5-5'.
 */
const CLAUDE_DEFAULT_THINKING_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-fable-5',
  'claude-mythos-5',
];

/**
 * Modern models that accept `thinking: { type: 'disabled' }` to run without thinking.
 */
const CLAUDE_THINKING_DISABLE_MODELS = ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5'];

/**
 * Extra max_tokens for default-thinking models, since thinking tokens count
 * against max_tokens. Billed only if used. Keep LLM_SECTION_MAX_TOKENS (15000)
 * + this under ~21,333 — above that the SDK refuses non-streaming requests.
 */
const CLAUDE_THINKING_HEADROOM_TOKENS = 4000;

function claudeUsesModernParams(modelId) {
  return CLAUDE_MODERN_PARAM_MODELS.some(m => modelId && modelId.startsWith(m));
}

function claudeUsesDefaultThinking(modelId) {
  return CLAUDE_DEFAULT_THINKING_MODELS.some(m => modelId && modelId.startsWith(m));
}

function claudeSupportsThinkingDisabled(modelId) {
  return CLAUDE_THINKING_DISABLE_MODELS.some(m => modelId && modelId.startsWith(m));
}

/**
 * Apply model-appropriate sampling/thinking params to a Messages API request.
 * Current models run at their default thinking with extra max_tokens headroom;
 * older modern-surface models run with thinking disabled.
 */
function applyClaudeModelParams(params, temperature) {
  if (!claudeUsesModernParams(params.model)) {
    params.temperature = temperature;
  } else if (claudeUsesDefaultThinking(params.model)) {
    params.max_tokens += CLAUDE_THINKING_HEADROOM_TOKENS;
  } else if (claudeSupportsThinkingDisabled(params.model)) {
    params.thinking = { type: 'disabled' };
  }
  return params;
}

/**
 * Extract model ID from preference string
 * e.g., 'claude-haiku-4-5' => 'claude-haiku-4-5-20251001'
 * e.g., 'gemini-3.8-flash' => 'gemini-3.8-flash'
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

    const requestParams = {
      model: this.model,
      system: systemConfig,
      messages: messages,
      max_tokens: maxTokens,
    };
    applyClaudeModelParams(requestParams, temperature);

    const message = await this.client.messages.create(requestParams);

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

    // Find the text block explicitly — content[0] is a (possibly empty) thinking
    // block on always-thinking models like Opus 5.5.
    const textBlock = message.content.find(b => b.type === 'text');
    return {
      content: textBlock ? textBlock.text : '',
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

    const streamParams = {
      model: this.model,
      system: systemConfig,
      messages: messages,
      max_tokens: maxTokens,
    };
    applyClaudeModelParams(streamParams, temperature);

    const stream = this.client.messages.stream(streamParams);

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
 * Uses the @google/genai SDK (the old @google/generative-ai hit EOL 2025-11-30).
 * Supports Gemini 3.5 Flash Lite and 3.8 Flash models.
 */
class GeminiAdapter extends LLMAdapter {
  constructor(apiKey, model = 'gemini-3.5-flash-lite') {
    super();
    this.genAI = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  _buildRequest({ systemPrompt, userPrompt, cacheableContext, maxTokens, temperature }) {
    // Build the user prompt with optional cacheable context
    let fullPrompt = userPrompt;
    if (cacheableContext) {
      fullPrompt = `Here is the meeting transcript:\n\n${cacheableContext}\n\n${userPrompt}`;
    }
    return {
      model: this.model,
      contents: fullPrompt,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: maxTokens,
        temperature,
      },
    };
  }

  async generateCompletion(options) {
    const {
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens = 1000,
      temperature = 0.7,
    } = options;

    const response = await this.genAI.models.generateContent(
      this._buildRequest({ systemPrompt, userPrompt, cacheableContext, maxTokens, temperature })
    );

    // Log token usage
    if (response.usageMetadata) {
      console.log('[Gemini] Token Usage:', JSON.stringify(response.usageMetadata, null, 2));
    }

    return {
      content: response.text, // property in @google/genai (was a method in the old SDK)
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

    const stream = await this.genAI.models.generateContentStream(
      this._buildRequest({ systemPrompt, userPrompt, cacheableContext, maxTokens, temperature })
    );

    let fullText = '';
    for await (const chunk of stream) {
      const chunkText = chunk.text;
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
 * Local LLM Adapter
 * Connects to a local LLM server (Ollama, LM Studio, etc.) via an OpenAI-compatible API.
 * No API key required — runs entirely on your machine.
 */
class LocalLLMAdapter extends LLMAdapter {
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
      console.log('[Local LLM] Token Usage:', JSON.stringify(completion.usage, null, 2));
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
    return 'Local LLM';
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
    // Per-call-chain provider override (see runWithPreference). Lets overlapping
    // summaries for different meetings each use their own model without
    // mutating the shared default.
    this._scope = new AsyncLocalStorage();
  }

  _createAdapter() {
    return this._createAdapterFor(this.config.provider);
  }

  /**
   * @param {string} provider - 'anthropic' | 'gemini' | 'ollama'
   * @param {string} [model] - Defaults to the configured model for that provider
   */
  _createAdapterFor(provider, model) {
    switch (provider) {
      case 'anthropic': {
        if (!this.config.anthropic?.apiKey) {
          throw new Error('Anthropic API key is required');
        }
        const anthropicModel = model || this.config.anthropic.model;
        console.log(
          `[LLM Service] Initializing Anthropic adapter with model: ${anthropicModel || 'claude-haiku-4-5-20251001'}`
        );
        return new AnthropicAdapter(this.config.anthropic.apiKey, anthropicModel);
      }

      case 'gemini': {
        if (!this.config.gemini?.apiKey) {
          throw new Error('Google API key (Gemini) is required');
        }
        const geminiModel = model || this.config.gemini.model;
        console.log(
          `[LLM Service] Initializing Gemini adapter with model: ${geminiModel || 'gemini-3.5-flash-lite'}`
        );
        return new GeminiAdapter(this.config.gemini.apiKey, geminiModel);
      }

      case 'ollama': {
        const ollamaModel = model || this.config.ollama?.model || 'llama3';
        console.log(`[LLM Service] Initializing Local LLM adapter with model: ${ollamaModel}`);
        return new LocalLLMAdapter(
          ollamaModel,
          this.config.ollama?.baseUrl || 'http://localhost:11434'
        );
      }

      default:
        throw new Error(
          `Unknown provider: ${provider}. Must be 'anthropic', 'gemini', or 'ollama'`
        );
    }
  }

  /** The adapter for the current call chain: a runWithPreference scope, else the default. */
  _activeAdapter() {
    return this._scope.getStore()?.adapter || this.adapter;
  }

  /**
   * Run fn with a provider/model override that applies only to LLM calls made
   * within fn's async call chain. Concurrent scopes don't affect each other or
   * the default provider.
   * @param {string} preference - e.g. 'claude-sonnet-5-5', 'gemini-3.5-flash-lite', 'ollama-llama3'
   * @param {Function} fn
   * @param {{explicit?: boolean, yieldToExplicit?: boolean}} [opts]
   *   explicit: a model the user picked for this run.
   *   yieldToExplicit: skip this override when an enclosing explicit scope exists
   *   (preference defaults must not replace a user-picked model).
   */
  runWithPreference(preference, fn, { explicit = false, yieldToExplicit = false } = {}) {
    const outer = this._scope.getStore();
    if (yieldToExplicit && outer?.explicit) {
      return fn();
    }
    const { provider, model } = this._resolvePreference(preference);
    const adapter = this._createAdapterFor(provider, model);
    return this._scope.run({ provider, model, adapter, explicit }, fn);
  }

  /**
   * Generate completion using configured provider
   */
  async generateCompletion(options) {
    const adapter = this._activeAdapter();
    try {
      const result = await adapter.generateCompletion(options);
      console.log(
        `[LLM Service] Generated completion using ${adapter.getProviderName()} (${result.model})`
      );
      return result;
    } catch (error) {
      console.error(
        `[LLM Service] Error generating completion with ${adapter.getProviderName()}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate streaming completion using configured provider
   */
  async streamCompletion(options) {
    const adapter = this._activeAdapter();
    try {
      const result = await adapter.streamCompletion(options);
      console.log(`[LLM Service] Completed streaming with ${adapter.getProviderName()}`);
      return result;
    } catch (error) {
      console.error(`[LLM Service] Error streaming with ${adapter.getProviderName()}:`, error);
      throw error;
    }
  }

  /**
   * Get current provider name
   */
  getProviderName() {
    return this._activeAdapter().getProviderName();
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
   * @param {string} preference - Full preference string (e.g., 'claude-haiku-4-5', 'gemini-3.5-flash-lite', 'ollama-llama3')
   */
  switchToPreference(preference) {
    const { provider, model } = this._resolvePreference(preference);
    this.switchProvider(provider, model);
  }

  /**
   * @param {string} preference - e.g. 'claude-haiku-4-5', 'gemini-3.5-flash-lite', 'ollama-llama3'
   * @returns {{provider: string, model: string}}
   */
  _resolvePreference(preference) {
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

    return { provider, model };
  }

  /**
   * Get current model name (of the active runWithPreference scope, if any)
   */
  getCurrentModel() {
    const scoped = this._scope.getStore();
    if (scoped) return scoped.model;
    if (this.config.provider === 'anthropic') {
      return this.config.anthropic?.model || 'claude-haiku-4-5-20251001';
    } else if (this.config.provider === 'gemini') {
      return this.config.gemini?.model || 'gemini-3.5-flash-lite';
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
      model: 'gemini-3.5-flash-lite',
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
      model: 'gemini-3.5-flash-lite',
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
 * @param {string} providerPreference - e.g., 'claude-haiku-4-5', 'gemini-3.5-flash-lite', 'ollama-llama3'
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
      model: 'gemini-3.5-flash-lite',
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

/**
 * Fetch available models from a local LLM server.
 * Tries the Ollama /api/tags endpoint first, then falls back to the
 * OpenAI-compatible /v1/models endpoint (used by LM Studio and others).
 * @param {string} [baseUrl='http://localhost:11434'] - LLM server base URL
 * @returns {Promise<Array<{name: string, size: number, modifiedAt: string|null}>>}
 */
async function fetchLocalModels(baseUrl = 'http://localhost:11434') {
  const base = baseUrl.replace(/\/+$/, '');

  // Try Ollama /api/tags first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${base}/api/tags`, { signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = await response.json();
      return (data.models || []).map(m => ({
        name: m.name,
        size: m.size || 0,
        modifiedAt: m.modified_at || null,
      }));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Ollama endpoint not available — try OpenAI-compatible /v1/models
  }

  // Fall back to OpenAI-compatible /v1/models
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${base}/v1/models`, { signal: controller.signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = await response.json();
      return (data.data || []).map(m => ({
        name: m.id,
        size: 0,
        modifiedAt: null,
      }));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // OpenAI-compatible endpoint not available either
  }

  return [];
}

module.exports = {
  LLMService,
  AnthropicAdapter,
  GeminiAdapter,
  OllamaAdapter: LocalLLMAdapter, // backward compat alias
  LocalLLMAdapter,
  createLLMServiceFromEnv,
  createLLMServiceFromCredentials,
  createLLMServiceFromPreference,
  extractModelFromPreference,
  fetchLocalModels,
  ANTHROPIC_MODEL_MAP,
  GEMINI_MODEL_MAP,
  applyClaudeModelParams,
};
