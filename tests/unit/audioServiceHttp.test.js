import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

const {
  postJson,
  postJsonWhileHealthy,
  AudioServiceHttpError,
} = require('../../src/main/utils/audioServiceHttp.js');

let server;
let baseUrl;
let healthy = true;
const received = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, body: raw });
      const reply = (status, body, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(body);
      };
      if (req.url === '/health') return reply(healthy ? 200 : 503, '{}');
      if (req.url === '/ok') return reply(200, JSON.stringify({ echo: JSON.parse(raw) }));
      if (req.url === '/slow') return setTimeout(() => reply(200, '{"done":true}'), 300);
      if (req.url === '/hang') return; // never answers
      if (req.url === '/detail') return reply(503, JSON.stringify({ detail: 'GPU unavailable' }));
      if (req.url === '/plain') return reply(500, 'Internal Server Error', 'text/plain');
      return reply(404, JSON.stringify({ detail: 'Not Found' }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.closeAllConnections();
  return new Promise(r => server.close(r));
});

describe('audioServiceHttp.postJson', () => {
  it('POSTs the payload as JSON and resolves the parsed body', async () => {
    const result = await postJson(`${baseUrl}/ok`, { audioPath: 'C:/a.mp3' });
    expect(result).toEqual({ echo: { audioPath: 'C:/a.mp3' } });
    expect(received.at(-1).method).toBe('POST');
  });

  it('has no deadline by default', async () => {
    await expect(postJson(`${baseUrl}/slow`, {})).resolves.toEqual({ done: true });
  });

  it('honors an explicit deadline', async () => {
    await expect(postJson(`${baseUrl}/slow`, {}, { timeoutMs: 50 })).rejects.toThrow(
      /did not respond within/
    );
  });

  it('aborts with the signal reason', async () => {
    const controller = new AbortController();
    const pending = postJson(`${baseUrl}/hang`, {}, { signal: controller.signal });
    controller.abort(new AudioServiceHttpError('gone'));
    await expect(pending).rejects.toThrow('gone');
  });

  it('surfaces FastAPI detail and the status code', async () => {
    const err = await postJson(`${baseUrl}/detail`, {}).catch(e => e);
    expect(err).toBeInstanceOf(AudioServiceHttpError);
    expect(err.status).toBe(503);
    expect(err.message).toBe('JD Audio Service returned 503: GPU unavailable');
  });

  it('falls back to the plain-text body', async () => {
    await expect(postJson(`${baseUrl}/plain`, {})).rejects.toThrow(
      'JD Audio Service returned 500: Internal Server Error'
    );
  });

  it('exposes 404 so callers can detect an older service', async () => {
    const err = await postJson(`${baseUrl}/missing`, {}).catch(e => e);
    expect(err.status).toBe(404);
  });

  it('reports connection failures with context', async () => {
    await expect(postJson('http://127.0.0.1:1/process', {})).rejects.toThrow(
      /JD Audio Service request failed/
    );
  });
});

describe('audioServiceHttp.postJsonWhileHealthy', () => {
  const fast = { intervalMs: 20, healthTimeoutMs: 200, maxMisses: 3 };

  it('keeps waiting on slow work while the service stays healthy', async () => {
    healthy = true;
    const beats = [];
    const result = await postJsonWhileHealthy(
      baseUrl,
      '/slow',
      {},
      {
        ...fast,
        onHeartbeat: ms => beats.push(ms),
      }
    );
    expect(result).toEqual({ done: true });
    expect(beats.length).toBeGreaterThan(0);
  });

  it('gives up only once the service stops answering health checks', async () => {
    healthy = false;
    try {
      await expect(postJsonWhileHealthy(baseUrl, '/hang', {}, fast)).rejects.toThrow(
        /stopped responding \(no answer to 3 health checks in a row\)/
      );
    } finally {
      healthy = true;
    }
  });
});
