/**
 * Local Transcription Provider Tests
 *
 * Tests:
 *   1. Provider map — 'local' exists, 'recallai' does not
 *   2. POST /process called with correct payload
 *   3. Response normalized to standard shape (text, entries, provider:'local', confidence, audio_duration)
 *   4. Timestamps converted from seconds → milliseconds
 *   5. Error thrown when health check fails
 */

const { describe, it, expect, vi, beforeEach, afterEach } = await import('vitest');

// ============================================================
// Module under test
// The service is a singleton — require directly.
// ============================================================
const transcriptionService = require('../../src/main/services/transcriptionService.js');

// ============================================================
// Helpers / fixtures
// ============================================================

function makeMockFetch({ healthOk = true, processData = null } = {}) {
  return vi.fn(async (url, _opts) => {
    if (url.endsWith('/health')) {
      return { ok: healthOk, status: healthOk ? 200 : 503 };
    }
    if (url.endsWith('/process')) {
      const body = processData ?? {
        text: 'Hello world',
        entries: [
          {
            speaker: 'Speaker A',
            speakerId: 'spk_0',
            text: 'Hello world',
            timestamp: 1.5, // seconds
            words: [{ word: 'Hello', start: 1.5, end: 1.8 }],
          },
        ],
        segments: null,
        confidence: 0.92,
        audio_duration: 45.0,
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

/** Minimal mock backgroundTaskManager */
function makeMockTaskManager() {
  return {
    addTask: vi.fn(() => 'task-001'),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
  };
}

// ============================================================
// Tests
// ============================================================

describe('TranscriptionService — provider map', () => {
  it('includes "local" provider', () => {
    expect(transcriptionService.providers).toHaveProperty('local');
    expect(typeof transcriptionService.providers.local).toBe('function');
  });

  it('includes "assemblyai" provider', () => {
    expect(transcriptionService.providers).toHaveProperty('assemblyai');
  });

  it('includes "deepgram" provider', () => {
    expect(transcriptionService.providers).toHaveProperty('deepgram');
  });

  it('does NOT include "recallai" provider', () => {
    expect(transcriptionService.providers).not.toHaveProperty('recallai');
  });
});

describe('transcribeWithLocal — success path', () => {
  let mockFetch;
  let mockTaskManager;

  beforeEach(() => {
    mockFetch = makeMockFetch();
    vi.stubGlobal('fetch', mockFetch);

    mockTaskManager = makeMockTaskManager();
    transcriptionService.setBackgroundTaskManager(mockTaskManager);

    // Stub fs.statSync so the file doesn't need to exist
    vi.spyOn(require('fs'), 'statSync').mockReturnValue({ size: 5 * 1024 * 1024 }); // 5 MB
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    transcriptionService.setBackgroundTaskManager(null);
  });

  it('performs a health check GET /health before processing', async () => {
    await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
    });

    const healthCall = mockFetch.mock.calls.find(([url]) => url.endsWith('/health'));
    expect(healthCall).toBeDefined();
    expect(healthCall[0]).toBe('http://localhost:8374/health');
  });

  it('POSTs to /process with correct payload', async () => {
    await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
      speakerNames: ['Alice', 'Bob'],
      minSpeakers: 2,
      maxSpeakers: 4,
      vocabulary: ['Acme', 'TPS'],
    });

    const processCall = mockFetch.mock.calls.find(([url]) => url.endsWith('/process'));
    expect(processCall).toBeDefined();

    const [url, reqOpts] = processCall;
    expect(url).toBe('http://localhost:8374/process');
    expect(reqOpts.method).toBe('POST');

    const body = JSON.parse(reqOpts.body);
    expect(body.audioPath).toBe('/fake/audio.mp3');
    expect(body.options.speakerNames).toEqual(['Alice', 'Bob']);
    expect(body.options.minSpeakers).toBe(2);
    expect(body.options.maxSpeakers).toBe(4);
    expect(body.options.vocabulary).toEqual(['Acme', 'TPS']);
  });

  it('returns correct normalized shape', async () => {
    const result = await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
    });

    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('provider', 'local');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('audio_duration');
    // segments field present (may be null)
    expect('segments' in result).toBe(true);
  });

  it('carries through text, confidence, and audio_duration from service', async () => {
    const result = await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
    });

    expect(result.text).toBe('Hello world');
    expect(result.confidence).toBe(0.92);
    expect(result.audio_duration).toBe(45.0);
  });

  it('converts entry timestamps from seconds to milliseconds', async () => {
    const result = await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
    });

    expect(result.entries).toHaveLength(1);
    // Service returns 1.5 s — should become 1500 ms
    expect(result.entries[0].timestamp).toBe(1500);
  });

  it('maps entry fields to standard shape', async () => {
    const result = await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
    });

    const entry = result.entries[0];
    expect(entry).toHaveProperty('speaker', 'Speaker A');
    expect(entry).toHaveProperty('speakerId', 'spk_0');
    expect(entry).toHaveProperty('text', 'Hello world');
    expect(Array.isArray(entry.words)).toBe(true);
  });

  it('uses default aiServiceUrl http://localhost:8374 when not specified', async () => {
    await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {});

    const healthCall = mockFetch.mock.calls.find(([url]) => url.endsWith('/health'));
    expect(healthCall[0]).toBe('http://localhost:8374/health');
  });

  it('creates and completes a background task', async () => {
    await transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
      aiServiceUrl: 'http://localhost:8374',
      meetingId: 'meeting-xyz',
    });

    expect(mockTaskManager.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcription',
        meetingId: 'meeting-xyz',
        metadata: expect.objectContaining({ provider: 'local' }),
      })
    );
    expect(mockTaskManager.completeTask).toHaveBeenCalledWith('task-001', expect.any(Object));
  });
});

describe('transcribeWithLocal — error paths', () => {
  let mockTaskManager;

  beforeEach(() => {
    mockTaskManager = makeMockTaskManager();
    transcriptionService.setBackgroundTaskManager(mockTaskManager);
    vi.spyOn(require('fs'), 'statSync').mockReturnValue({ size: 1 * 1024 * 1024 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    transcriptionService.setBackgroundTaskManager(null);
  });

  it('throws with "not running" message when health check returns non-ok', async () => {
    vi.stubGlobal('fetch', makeMockFetch({ healthOk: false }));

    await expect(
      transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
        aiServiceUrl: 'http://localhost:8374',
      })
    ).rejects.toThrow('JD Audio Service is not running');
  });

  it('throws with "not running" message when health check fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(
      transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
        aiServiceUrl: 'http://localhost:8374',
      })
    ).rejects.toThrow('JD Audio Service is not running');
  });

  it('calls failTask on the background task manager when health check fails', async () => {
    vi.stubGlobal('fetch', makeMockFetch({ healthOk: false }));

    await expect(
      transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
        aiServiceUrl: 'http://localhost:8374',
      })
    ).rejects.toThrow();

    expect(mockTaskManager.failTask).toHaveBeenCalledWith('task-001', expect.any(String));
  });

  it('throws when /process returns a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        if (url.endsWith('/health')) return { ok: true, status: 200 };
        return { ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'crash' };
      })
    );

    await expect(
      transcriptionService.transcribeWithLocal('/fake/audio.mp3', {
        aiServiceUrl: 'http://localhost:8374',
      })
    ).rejects.toThrow('JD Audio Service returned 500');
  });
});

describe('ipcSchemas — transcriptionProviderSchema', () => {
  it('accepts "local" as a valid provider', () => {
    const { transcriptionProviderSchema } = require('../../src/main/validation/ipcSchemas.js');
    expect(() => transcriptionProviderSchema.parse('local')).not.toThrow();
  });

  it('accepts "assemblyai" as a valid provider', () => {
    const { transcriptionProviderSchema } = require('../../src/main/validation/ipcSchemas.js');
    expect(() => transcriptionProviderSchema.parse('assemblyai')).not.toThrow();
  });

  it('accepts "deepgram" as a valid provider', () => {
    const { transcriptionProviderSchema } = require('../../src/main/validation/ipcSchemas.js');
    expect(() => transcriptionProviderSchema.parse('deepgram')).not.toThrow();
  });

  it('rejects "recallai" as an invalid provider', () => {
    const { transcriptionProviderSchema } = require('../../src/main/validation/ipcSchemas.js');
    expect(() => transcriptionProviderSchema.parse('recallai')).toThrow();
  });

  it('accepts undefined (schema is optional)', () => {
    const { transcriptionProviderSchema } = require('../../src/main/validation/ipcSchemas.js');
    expect(() => transcriptionProviderSchema.parse(undefined)).not.toThrow();
  });
});
