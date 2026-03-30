/**
 * LocalLLMAdapter / fetchLocalModels Unit Tests
 *
 * Tests:
 *   1. Returns models from Ollama /api/tags when that endpoint succeeds
 *   2. Falls back to OpenAI /v1/models when /api/tags fails
 *   3. Returns empty array when both endpoints fail
 */

const { describe, it, expect, vi, afterEach } = await import('vitest');

const { fetchLocalModels } = require('../../src/main/services/llmService');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLocalModels', () => {
  it('returns models from Ollama /api/tags when endpoint succeeds', async () => {
    const mockTags = {
      models: [
        { name: 'llama3:latest', size: 4_000_000_000, modified_at: '2025-01-01T00:00:00Z' },
        { name: 'mistral:7b', size: 7_000_000_000, modified_at: '2025-02-01T00:00:00Z' },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTags,
    });

    vi.stubGlobal('fetch', mockFetch);

    const models = await fetchLocalModels('http://localhost:11434');

    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      name: 'llama3:latest',
      size: 4_000_000_000,
      modifiedAt: '2025-01-01T00:00:00Z',
    });
    expect(models[1]).toEqual({
      name: 'mistral:7b',
      size: 7_000_000_000,
      modifiedAt: '2025-02-01T00:00:00Z',
    });

    // Should have called /api/tags and not needed /v1/models
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/tags$/);
  });

  it('falls back to OpenAI /v1/models when /api/tags fails', async () => {
    const mockV1Models = {
      data: [{ id: 'lm-studio-model' }, { id: 'another-model' }],
    };

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // /api/tags fails
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockV1Models,
      }); // /v1/models succeeds

    vi.stubGlobal('fetch', mockFetch);

    const models = await fetchLocalModels('http://localhost:1234');

    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({ name: 'lm-studio-model', size: 0, modifiedAt: null });
    expect(models[1]).toEqual({ name: 'another-model', size: 0, modifiedAt: null });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/api\/tags$/);
    expect(mockFetch.mock.calls[1][0]).toMatch(/\/v1\/models$/);
  });

  it('returns empty array when both endpoints fail', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // /api/tags fails
      .mockRejectedValueOnce(new Error('ECONNREFUSED')); // /v1/models fails

    vi.stubGlobal('fetch', mockFetch);

    const models = await fetchLocalModels('http://localhost:11434');

    expect(models).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
