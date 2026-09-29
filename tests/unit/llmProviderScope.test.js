/**
 * LLMService.runWithPreference — per-call-chain provider/model scoping.
 *
 * Previously withProviderSwitch mutated the single global provider for the
 * whole duration of an async summary. Two overlapping summaries (e.g. meeting
 * A's auto-summary while meeting B's template summary runs) then used each
 * other's model and left the global default changed afterwards.
 */
const {
  LLMService,
  AnthropicAdapter,
  GeminiAdapter,
} = require('../../src/main/services/llmService');

function makeService() {
  return new LLMService({
    provider: 'anthropic',
    anthropic: { apiKey: 'test-key', model: 'claude-haiku-4-5-20251001' },
    gemini: { apiKey: 'test-key', model: 'gemini-3.5-flash-lite' },
    ollama: { model: 'llama3', baseUrl: 'http://localhost:11434' },
  });
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('LLMService.runWithPreference', () => {
  let anthropicSpy;
  let geminiSpy;

  beforeEach(() => {
    anthropicSpy = vi
      .spyOn(AnthropicAdapter.prototype, 'generateCompletion')
      .mockImplementation(async function () {
        await tick();
        return { content: 'ok', model: this.model };
      });
    geminiSpy = vi
      .spyOn(GeminiAdapter.prototype, 'generateCompletion')
      .mockImplementation(async function () {
        await tick();
        return { content: 'ok', model: this.model };
      });
  });

  afterEach(() => {
    anthropicSpy.mockRestore();
    geminiSpy.mockRestore();
  });

  it('overlapping scopes each keep their own model across awaits', async () => {
    const llm = makeService();

    const runA = llm.runWithPreference('claude-sonnet-5-5', async () => {
      await tick();
      const first = await llm.generateCompletion({ userPrompt: 'a1' });
      await tick();
      const second = await llm.generateCompletion({ userPrompt: 'a2' });
      return [first.model, second.model, llm.getCurrentModel()];
    });
    const runB = llm.runWithPreference('gemini-3.5-flash-lite', async () => {
      const first = await llm.generateCompletion({ userPrompt: 'b1' });
      await tick();
      const second = await llm.generateCompletion({ userPrompt: 'b2' });
      return [first.model, second.model, llm.getProviderName()];
    });

    const [a, b] = await Promise.all([runA, runB]);
    expect(a).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
    expect(b[0]).toBe('gemini-3.5-flash-lite');
    expect(b[1]).toBe('gemini-3.5-flash-lite');
    expect(b[2]).toMatch(/gemini/i);
  });

  it('leaves the global provider and model untouched', async () => {
    const llm = makeService();
    await llm.runWithPreference('gemini-3.5-flash-lite', () => llm.generateCompletion({}));
    expect(llm.config.provider).toBe('anthropic');
    expect(llm.getCurrentModel()).toBe('claude-haiku-4-5-20251001');
    const result = await llm.generateCompletion({});
    expect(result.model).toBe('claude-haiku-4-5-20251001');
  });

  it('an explicit (user-chosen) scope is not overridden by a nested default scope', async () => {
    const llm = makeService();
    const model = await llm.runWithPreference(
      'claude-opus-5-5',
      () =>
        llm.runWithPreference('claude-sonnet-5-5', () => llm.getCurrentModel(), {
          yieldToExplicit: true,
        }),
      { explicit: true }
    );
    expect(model).toBe('claude-opus-5-5');
  });

  it('a nested default scope still overrides an outer default scope', async () => {
    const llm = makeService();
    const model = await llm.runWithPreference('claude-haiku-4-5', () =>
      llm.runWithPreference('claude-sonnet-5-5', () => llm.getCurrentModel(), {
        yieldToExplicit: true,
      })
    );
    expect(model).toBe('claude-sonnet-5-5');
  });
});
