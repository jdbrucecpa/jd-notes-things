/**
 * Claude request params + model preference mapping Unit Tests
 *
 * Tests:
 *   1. Opus 5.5 / Sonnet 5.5 / Haiku 5.5 run at model defaults (no thinking/effort fields) with
 *      thinking headroom on max_tokens — never thinking:disabled (400s), despite the
 *      prefix trap vs 'claude-opus-5' / 'claude-sonnet-5'
 *   2. Headroom stays under the SDK non-streaming max_tokens ceiling
 *   3. Sonnet 5 disables thinking; Haiku 4.5 keeps temperature
 *   4. Legacy preference strings map to current models
 */

const { describe, it, expect } = await import('vitest');

const {
  applyClaudeModelParams,
  extractModelFromPreference,
} = require('../../src/main/services/llmService');

const build = model => applyClaudeModelParams({ model, max_tokens: 15000 }, 0.7);

describe('applyClaudeModelParams', () => {
  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])(
    'runs %s at model defaults with thinking headroom',
    model => {
      const params = build(model);
      // Omitted thinking/effort = adaptive thinking at the model's default effort
      // (Sonnet 5.5: high, Opus 5.5 / Haiku 5.5: medium). Haiku 5.5 also 400s on
      // non-default temperature.
      expect(params.thinking).toBeUndefined();
      expect(params.output_config).toBeUndefined();
      expect(params.temperature).toBeUndefined();
      expect(params.max_tokens).toBe(19000);
    }
  );

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])(
    'keeps %s under the SDK non-streaming max_tokens ceiling',
    model => {
      // SDK throws for non-streaming requests above 128000 * 10/60 ≈ 21,333 tokens
      expect(build(model).max_tokens).toBeLessThanOrEqual(21333);
    }
  );

  it('disables thinking on Sonnet 5 without sampling params', () => {
    const params = build('claude-sonnet-5');
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.temperature).toBeUndefined();
    expect(params.output_config).toBeUndefined();
    expect(params.max_tokens).toBe(15000);
  });

  it('keeps temperature on Haiku 4.5', () => {
    const params = build('claude-haiku-4-5-20251001');
    expect(params.temperature).toBe(0.7);
    expect(params.thinking).toBeUndefined();
  });
});

describe('extractModelFromPreference', () => {
  it.each([
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-opus-5', 'claude-opus-5-5'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
    ['claude-sonnet-5', 'claude-sonnet-5-5'],
    ['claude-haiku-5-5', 'claude-haiku-5-5'],
    ['claude-haiku-4-5', 'claude-haiku-5-5'],
    ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite'],
    ['gemini-3.8-flash', 'gemini-3.8-flash'],
    ['gemini-3.7-flash', 'gemini-3.8-flash'],
    ['gemini-3.5-flash', 'gemini-3.8-flash'],
    ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  ])('%s → %s', (pref, expected) => {
    expect(extractModelFromPreference(pref)).toBe(expected);
  });
});
