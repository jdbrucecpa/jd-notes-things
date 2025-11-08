# LLM Service

Unified interface for multiple LLM providers in JD Notes Things.

## Supported Providers

- **OpenAI** - GPT models via OpenAI API
- **Azure OpenAI** - GPT models via Azure deployment
- **Anthropic** - Claude models (Haiku, Sonnet, Opus)

## Quick Start

### Automatic Initialization

The service automatically detects available providers based on environment variables:

```javascript
const { createLLMServiceFromEnv } = require('./services/llmService');

// Auto-detects provider with priority: Azure > Anthropic > OpenAI
const llmService = createLLMServiceFromEnv();
console.log(llmService.getProviderName()); // "Azure OpenAI"
```

### Manual Configuration

```javascript
const { LLMService } = require('./services/llmService');

const llmService = new LLMService({
  provider: 'azure', // 'openai' | 'azure' | 'anthropic'

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini'
  },

  azure: {
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: '2025-01-01-preview'
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001'
  }
});
```

## Usage

### Non-Streaming Completion

```javascript
const result = await llmService.generateCompletion({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarize this meeting transcript...',
  maxTokens: 1000,
  temperature: 0.7
});

console.log(result.content); // Generated text
console.log(result.model);   // Model that was used
```

### Streaming Completion

```javascript
const fullText = await llmService.streamCompletion({
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarize this meeting transcript...',
  maxTokens: 1000,
  temperature: 0.7,
  onChunk: (cumulativeText) => {
    // Called for each chunk with accumulated text
    console.log('Progress:', cumulativeText);
  }
});

console.log('Final:', fullText);
```

### Switching Providers at Runtime

```javascript
// Switch to different provider
llmService.switchProvider('anthropic');
console.log(llmService.getProviderName()); // "Anthropic"

// Now all subsequent calls use Anthropic
const result = await llmService.generateCompletion({...});
```

## Environment Variables

### OpenAI

```env
OPENAI_API_KEY=sk-...
```

### Azure OpenAI

```env
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_API_VERSION=2025-01-01-preview
```

### Anthropic

```env
ANTHROPIC_API_KEY=sk-ant-...
```

## IPC Handlers

The app exposes IPC handlers for switching providers from the renderer process:

```javascript
// Get current provider
const result = await window.electron.ipcRenderer.invoke('llm:getProvider');
console.log(result.provider); // "Azure OpenAI"

// Switch provider
const result = await window.electron.ipcRenderer.invoke('llm:switchProvider', 'anthropic');
console.log(result.provider); // "Anthropic"
```

## Provider Selection Priority

When using `createLLMServiceFromEnv()`, providers are selected in this order:

1. **Azure OpenAI** - If `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and `AZURE_OPENAI_DEPLOYMENT` are set
2. **Anthropic** - If `ANTHROPIC_API_KEY` is set
3. **OpenAI** - If `OPENAI_API_KEY` is set

## Performance Comparison

Based on testing with 4 templates, 6 sections each (24 parallel API calls):

| Provider | Model | Time | Cost/1K tokens | Notes |
|----------|-------|------|---------------|-------|
| OpenAI | gpt-4o-mini | 22s | $0.00015 | Sequential: ~60s |
| Anthropic | claude-haiku-4-5 | 5s | $0.00025 | ~4.3x faster than OpenAI |
| Azure OpenAI | gpt-5-mini | TBD | ~$0.00010 | Cheapest option |

## Architecture

The service uses the **Adapter pattern** with a unified interface:

```
LLMService (Factory)
    ├── OpenAIAdapter
    ├── AzureOpenAIAdapter
    └── AnthropicAdapter
         └── LLMAdapter (Base Interface)
```

Each adapter implements:
- `generateCompletion(options)` - Non-streaming
- `streamCompletion(options)` - Streaming with callbacks
- `getProviderName()` - Provider identification

This allows switching providers without changing calling code.

## Error Handling

All methods throw errors that should be caught by the caller:

```javascript
try {
  const result = await llmService.generateCompletion({...});
} catch (error) {
  console.error('LLM error:', error);
  // Handle error (API rate limit, network issue, etc.)
}
```

Common error types:
- API authentication errors (invalid API key)
- Rate limit errors (too many requests)
- Network errors (connection timeout)
- Content policy errors (rejected by safety filters)
