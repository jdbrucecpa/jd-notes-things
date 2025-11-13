/**
 * LLM Service - Unified interface for multiple LLM providers
 * Supports: OpenAI, Anthropic Claude, Azure OpenAI
 */

const { OpenAI } = require('openai');
const { AzureOpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

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
  async generateCompletion(options) {
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
  async streamCompletion(options) {
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
 * OpenAI Adapter
 * Supports gpt-4o-mini and other OpenAI models
 */
class OpenAIAdapter extends LLMAdapter {
  constructor(apiKey, model = 'gpt-4o-mini') {
    super();
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000, temperature = 0.7 } = options;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens
    });

    return {
      content: completion.choices[0].message.content,
      model: completion.model
    };
  }

  async streamCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000, temperature = 0.7, onChunk } = options;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true
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
    return 'OpenAI';
  }
}

/**
 * Azure OpenAI Adapter
 * Supports GPT models deployed on Azure
 */
class AzureOpenAIAdapter extends LLMAdapter {
  constructor(config) {
    super();
    this.client = new AzureOpenAI({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      apiVersion: config.apiVersion || '2025-01-01-preview',
      deployment: config.deployment
    });
    this.deployment = config.deployment;
  }

  async generateCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000 } = options;
    // Note: gpt-5-mini is a reasoning model and does NOT support temperature, top_p,
    // presence_penalty, frequency_penalty, logprobs, or max_tokens parameters

    console.log('[Azure] generateCompletion called with:');
    console.log('[Azure] - systemPrompt length:', systemPrompt?.length || 0);
    console.log('[Azure] - userPrompt length:', userPrompt?.length || 0);
    console.log('[Azure] - maxTokens:', maxTokens);
    console.log('[Azure] - deployment:', this.deployment);

    const completion = await this.client.chat.completions.create({
      model: this.deployment,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: maxTokens  // Reasoning models use max_completion_tokens
    });

    console.log('[Azure] Raw completion object type:', typeof completion);
    console.log('[Azure] Raw completion keys:', completion ? Object.keys(completion) : 'null');
    console.log('[Azure] Full completion (first 500 chars):', JSON.stringify(completion).substring(0, 500));

    console.log('[Azure] Completion structure:', JSON.stringify({
      hasChoices: !!completion.choices,
      choicesLength: completion.choices?.length,
      firstChoice: completion.choices?.[0] ? {
        hasMessage: !!completion.choices[0].message,
        messageKeys: completion.choices[0].message ? Object.keys(completion.choices[0].message) : [],
        contentType: typeof completion.choices[0].message?.content,
        contentLength: completion.choices[0].message?.content?.length || 0,
        contentPreview: completion.choices[0].message?.content?.substring(0, 100)
      } : null
    }, null, 2));

    const resultContent = completion.choices[0].message.content;
    const resultModel = completion.model || this.deployment;
    const finishReason = completion.choices[0].finish_reason;

    console.log('[Azure] Extracted content type:', typeof resultContent);
    console.log('[Azure] Extracted content length:', resultContent?.length || 0);
    console.log('[Azure] Finish reason:', finishReason);
    console.log('[Azure] Is content falsy?', !resultContent);

    // Warn if we hit token limit with empty/truncated content
    if (finishReason === 'length') {
      if (!resultContent || resultContent.length === 0) {
        console.error('[Azure] ERROR: Hit token limit during reasoning phase - no content generated!');
        console.error('[Azure] This usually means max_completion_tokens is too low for the reasoning model.');
        console.error('[Azure] Consider increasing maxTokens parameter.');
        throw new Error('Reasoning model exhausted token budget before generating content. Increase maxTokens.');
      } else {
        console.warn('[Azure] WARNING: Response truncated due to token limit (finish_reason: length)');
      }
    }

    return {
      content: resultContent,
      model: resultModel
    };
  }

  async streamCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000, onChunk } = options;
    // Note: gpt-5-mini is a reasoning model and does NOT support temperature

    const stream = await this.client.chat.completions.create({
      model: this.deployment,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: maxTokens,  // Reasoning models use max_completion_tokens
      stream: true
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
    return 'Azure OpenAI';
  }
}

/**
 * Anthropic Claude Adapter
 * Supports Claude models (Haiku, Sonnet, Opus)
 */
class AnthropicAdapter extends LLMAdapter {
  constructor(apiKey, model = 'claude-haiku-4-5-20251001') {
    super();
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000, temperature = 0.7 } = options;

    const message = await this.client.messages.create({
      model: this.model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    });

    return {
      content: message.content[0].text,
      model: message.model
    };
  }

  async streamCompletion(options) {
    const { systemPrompt, userPrompt, maxTokens = 1000, temperature = 0.7, onChunk } = options;

    const stream = this.client.messages.stream({
      model: this.model,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    });

    return new Promise((resolve, reject) => {
      let fullText = '';

      stream.on('text', (text) => {
        fullText += text;
        if (onChunk) {
          onChunk(fullText);
        }
      });

      stream.on('end', () => {
        resolve(fullText);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  getProviderName() {
    return 'Anthropic';
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
   * @param {string} config.provider - 'openai' | 'azure' | 'anthropic'
   * @param {Object} config.openai - OpenAI config { apiKey, model }
   * @param {Object} config.azure - Azure config { apiKey, endpoint, deployment, apiVersion }
   * @param {Object} config.anthropic - Anthropic config { apiKey, model }
   */
  constructor(config) {
    this.config = config;
    this.adapter = this._createAdapter();
  }

  _createAdapter() {
    switch (this.config.provider) {
      case 'openai':
        if (!this.config.openai?.apiKey) {
          throw new Error('OpenAI API key is required');
        }
        console.log(`[LLM Service] Initializing OpenAI adapter with model: ${this.config.openai.model || 'gpt-4o-mini'}`);
        return new OpenAIAdapter(this.config.openai.apiKey, this.config.openai.model);

      case 'azure':
        if (!this.config.azure?.apiKey || !this.config.azure?.endpoint || !this.config.azure?.deployment) {
          throw new Error('Azure OpenAI requires apiKey, endpoint, and deployment');
        }
        console.log(`[LLM Service] Initializing Azure OpenAI adapter with deployment: ${this.config.azure.deployment}`);
        return new AzureOpenAIAdapter(this.config.azure);

      case 'anthropic':
        if (!this.config.anthropic?.apiKey) {
          throw new Error('Anthropic API key is required');
        }
        console.log(`[LLM Service] Initializing Anthropic adapter with model: ${this.config.anthropic.model || 'claude-haiku-4-5-20251001'}`);
        return new AnthropicAdapter(this.config.anthropic.apiKey, this.config.anthropic.model);

      default:
        throw new Error(`Unknown provider: ${this.config.provider}. Must be 'openai', 'azure', or 'anthropic'`);
    }
  }

  /**
   * Generate completion using configured provider
   */
  async generateCompletion(options) {
    try {
      const result = await this.adapter.generateCompletion(options);
      console.log(`[LLM Service] Generated completion using ${this.adapter.getProviderName()} (${result.model})`);
      return result;
    } catch (error) {
      console.error(`[LLM Service] Error generating completion with ${this.adapter.getProviderName()}:`, error);
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
   * @param {string} provider - 'openai' | 'azure' | 'anthropic'
   */
  switchProvider(provider) {
    this.config.provider = provider;
    this.adapter = this._createAdapter();
    console.log(`[LLM Service] Switched to ${this.adapter.getProviderName()}`);
  }
}

/**
 * Create LLM service from environment variables
 */
function createLLMServiceFromEnv() {
  // Determine which provider to use based on env vars
  // Priority: Azure > Anthropic > OpenAI
  let provider;
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT) {
    provider = 'azure';
  } else if (process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
  } else if (process.env.OPENAI_API_KEY) {
    provider = 'openai';
  } else {
    throw new Error('No LLM API keys found in environment variables');
  }

  const config = {
    provider,
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini' // Can be overridden
    },
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview'
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-haiku-4-5-20251001' // Fast and cost-effective
    }
  };

  return new LLMService(config);
}

module.exports = {
  LLMService,
  OpenAIAdapter,
  AzureOpenAIAdapter,
  AnthropicAdapter,
  createLLMServiceFromEnv
};
