/**
 * Claude models run through Claude Code (subscription) when it's logged in,
 * with the Anthropic API as fallback. The CLI runner and availability probe
 * are fakes here; no real process or API call is made.
 */
const {
  LLMService,
  AnthropicAdapter,
  ClaudeSubscriptionAdapter,
  createLLMServiceFromCredentials,
} = require('../../src/main/services/llmService');
const { ClaudeCliAvailability } = require('../../src/main/services/claudeCli');

function makeAvailability({ usable = true, reason = 'logged in' } = {}) {
  return new ClaudeCliAvailability({
    resolveExecutable: () => '/usr/bin/claude',
    probe: async () => ({ usable, reason, authMethod: usable ? 'claude.ai' : null }),
  });
}

function makeService({ apiKey = 'test-key', availability = makeAvailability(), runCli } = {}) {
  return new LLMService({
    provider: 'anthropic',
    anthropic: { apiKey, model: 'claude-haiku-5-5' },
    gemini: { apiKey: 'test-key', model: 'gemini-3.5-flash-lite' },
    ollama: { model: 'llama3', baseUrl: 'http://localhost:11434' },
    claudeCli: { enabled: true, availability, runCli },
  });
}

const request = {
  systemPrompt: 'Rules',
  userPrompt: 'Summarize.',
  cacheableContext: 'Alice: hi',
  maxTokens: 15000,
};

let apiSpy;
let apiStreamSpy;
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  apiSpy = vi
    .spyOn(AnthropicAdapter.prototype, 'generateCompletion')
    .mockImplementation(async function () {
      return { content: 'from api', model: this.model };
    });
  apiStreamSpy = vi
    .spyOn(AnthropicAdapter.prototype, 'streamCompletion')
    .mockImplementation(async ({ onChunk }) => {
      onChunk('from api');
      return 'from api';
    });
});
afterEach(() => vi.restoreAllMocks());

describe('ClaudeSubscriptionAdapter via LLMService', () => {
  it('uses the subscription when Claude Code is logged in', async () => {
    const runCli = vi.fn(async ({ model }) => ({ content: 'from cli', model, usage: null }));
    const llm = makeService({ runCli });

    const result = await llm.runWithPreference('claude-sonnet-5-5', () =>
      llm.generateCompletion(request)
    );

    expect(result).toEqual({
      content: 'from cli',
      model: 'claude-sonnet-5-5',
      provider: 'claude-cli',
    });
    expect(runCli).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/usr/bin/claude',
        model: 'claude-sonnet-5-5',
        systemPrompt: 'Rules',
        userPrompt: 'Summarize.',
        cacheableContext: 'Alice: hi',
      })
    );
    expect(apiSpy).not.toHaveBeenCalled();
    expect(llm.getProviderName()).toBe('Claude Code (subscription)');
  });

  it('falls back to the API when a CLI call fails, then skips the CLI while paused', async () => {
    const runCli = vi.fn(async () => {
      throw new Error('Claude subscription limit reached');
    });
    const llm = makeService({ runCli });

    const first = await llm.generateCompletion(request);
    const second = await llm.generateCompletion(request);

    expect(first.content).toBe('from api');
    expect(second.content).toBe('from api');
    // The second section goes straight to the API instead of waiting on the CLI.
    expect(runCli).toHaveBeenCalledTimes(1);
    expect(apiSpy).toHaveBeenCalledTimes(2);
    expect(apiSpy.mock.calls[0][0]).toBe(request);
    expect(llm.getProviderName()).toBe('Anthropic');

    const status = await llm.getClaudeCliStatus();
    expect(status).toMatchObject({ usable: false, lastError: 'Claude subscription limit reached' });
    expect(status.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('uses the API when Claude Code is not logged in', async () => {
    const runCli = vi.fn();
    const llm = makeService({ runCli, availability: makeAvailability({ usable: false }) });

    expect((await llm.generateCompletion(request)).content).toBe('from api');
    expect(runCli).not.toHaveBeenCalled();
  });

  it('streams through the CLI, passing onChunk through', async () => {
    const runCli = vi.fn(async ({ onText }) => {
      onText('partial');
      onText('partial done');
      return { content: 'partial done', model: 'claude-haiku-5-5' };
    });
    const llm = makeService({ runCli });
    const chunks = [];

    const text = await llm.streamCompletion({ ...request, onChunk: c => chunks.push(c) });

    expect(text).toBe('partial done');
    expect(chunks).toEqual(['partial', 'partial done']);
    expect(apiStreamSpy).not.toHaveBeenCalled();
  });

  it('falls back to API streaming when the CLI stream fails', async () => {
    const runCli = vi.fn(async () => {
      throw new Error('timed out');
    });
    const llm = makeService({ runCli });
    const chunks = [];

    expect(await llm.streamCompletion({ ...request, onChunk: c => chunks.push(c) })).toBe(
      'from api'
    );
    expect(chunks).toEqual(['from api']);
  });

  describe('without an API key', () => {
    it('runs on the subscription alone', async () => {
      const runCli = vi.fn(async () => ({ content: 'from cli', model: 'claude-haiku-5-5' }));
      const llm = makeService({ apiKey: null, runCli });
      expect((await llm.generateCompletion(request)).content).toBe('from cli');
    });

    it('surfaces the CLI error instead of a missing-key error', async () => {
      const runCli = vi.fn(async () => {
        throw new Error('HTTP 529 overloaded');
      });
      const llm = makeService({ apiKey: null, runCli });
      await expect(llm.generateCompletion(request)).rejects.toThrow('HTTP 529 overloaded');
    });

    it('explains how to fix it when Claude Code is unavailable', async () => {
      const llm = makeService({
        apiKey: null,
        availability: makeAvailability({ usable: false, reason: 'Claude Code is not logged in' }),
      });
      await expect(llm.generateCompletion(request)).rejects.toThrow(
        /No Anthropic API key.*not logged in.*log in/
      );
    });
  });

  it('turning the setting off sends Claude calls straight to the API', async () => {
    const runCli = vi.fn();
    const llm = makeService({ runCli });
    llm.setClaudeCliEnabled(false);

    expect((await llm.generateCompletion(request)).content).toBe('from api');
    expect(runCli).not.toHaveBeenCalled();
    expect(await llm.getClaudeCliStatus()).toMatchObject({
      enabled: false,
      apiKeyConfigured: true,
    });
  });

  it('keeps the plain API adapter when no claudeCli config is given', () => {
    const llm = new LLMService({
      provider: 'anthropic',
      anthropic: { apiKey: 'test-key', model: 'claude-haiku-5-5' },
    });
    expect(llm.adapter).toBeInstanceOf(AnthropicAdapter);
    expect(llm.adapter).not.toBeInstanceOf(ClaudeSubscriptionAdapter);
  });
});

describe('createLLMServiceFromCredentials', () => {
  const keys = (values = {}) => ({ getKey: async name => values[name] || null });

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to Claude when Claude Code is logged in, even with no API key', async () => {
    const llm = await createLLMServiceFromCredentials(keys({ GOOGLE_API_KEY: 'g' }), {
      claudeCliAvailability: makeAvailability(),
    });
    expect(llm.config.provider).toBe('anthropic');
    expect(llm.adapter).toBeInstanceOf(ClaudeSubscriptionAdapter);
  });

  it('keeps the old priority when Claude Code is unavailable', async () => {
    const llm = await createLLMServiceFromCredentials(keys({ GOOGLE_API_KEY: 'g' }), {
      claudeCliAvailability: makeAvailability({ usable: false }),
    });
    expect(llm.config.provider).toBe('gemini');
  });

  it('does not probe the CLI when it is turned off', async () => {
    const availability = makeAvailability();
    const check = vi.spyOn(availability, 'check');
    const llm = await createLLMServiceFromCredentials(keys(), {
      claudeCliEnabled: false,
      claudeCliAvailability: availability,
    });
    expect(check).not.toHaveBeenCalled();
    expect(llm.config.provider).toBe('ollama');
  });
});
