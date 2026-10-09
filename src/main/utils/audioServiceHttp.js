/**
 * Long-running JSON POSTs to the JD Audio Service.
 *
 * Node's built-in fetch (undici) fails any request whose response headers
 * take longer than 300s (headersTimeout) with a bare "fetch failed" — and the
 * service only answers /process once the whole job is done, so any meeting
 * that took the GPU more than five minutes was lost. Plain http has no such
 * cap.
 *
 * Local GPU work has no deadline: a long meeting on a slow GPU is still a
 * success, just a slow one. Requests fail only on real breakage — the
 * connection dropping (service crashed or was killed) or the service no
 * longer answering /health (postJsonWhileHealthy).
 */

const http = require('http');
const https = require('https');

const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 15000;
// Consecutive failed health checks before the service is considered gone
// (~2 minutes unresponsive). /health is served off the GPU lock, so it
// answers promptly even mid-transcription.
const HEALTH_MAX_MISSES = 4;

class AudioServiceHttpError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'AudioServiceHttpError';
    this.status = status;
  }
}

// FastAPI errors are {"detail": "..."}; unhandled ones are plain text.
function describeErrorBody(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.detail === 'string') return parsed.detail;
  } catch {
    // not JSON
  }
  return raw.trim().slice(0, 500);
}

/**
 * @param {string} url - Full endpoint URL
 * @param {object} payload - Serialized as the JSON body
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Optional overall deadline; none by default
 * @param {AbortSignal} [opts.signal] - Aborts the request with signal.reason
 * @returns {Promise<object>} Parsed JSON body of a 2xx response
 * @throws {AudioServiceHttpError} `status` set for non-2xx responses
 */
function postJson(url, payload, { timeoutMs = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);

    const req = transport.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });

    let deadline = null;
    const onAbort = () => req.destroy(signal.reason);
    const cleanup = () => {
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
    };

    if (timeoutMs != null) {
      deadline = setTimeout(() => {
        req.destroy(
          new AudioServiceHttpError(
            `JD Audio Service did not respond within ${Math.round(timeoutMs / 1000)}s`
          )
        );
      }, timeoutMs);
    }
    if (signal) {
      if (signal.aborted) {
        req.destroy(signal.reason);
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    req.on('response', res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        cleanup();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new AudioServiceHttpError(
              `JD Audio Service returned ${res.statusCode}: ${describeErrorBody(raw) || res.statusMessage}`,
              res.statusCode
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new AudioServiceHttpError(`Invalid JSON from JD Audio Service: ${err.message}`));
        }
      });
      res.on('error', err => {
        cleanup();
        reject(err);
      });
    });

    req.on('error', err => {
      cleanup();
      reject(
        err instanceof AudioServiceHttpError
          ? err
          : new AudioServiceHttpError(`JD Audio Service request failed: ${err.message}`)
      );
    });

    req.end(body);
  });
}

async function isHealthy(baseUrl, timeoutMs) {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST with no time limit, watched by a /health heartbeat: the request is
 * abandoned only if the service stops answering health checks, never because
 * the work is taking a long time.
 *
 * @param {string} baseUrl - Service base URL (e.g. http://localhost:8374)
 * @param {string} route - Endpoint path (e.g. '/process')
 * @param {object} payload - JSON body
 * @param {object} [opts]
 * @param {(elapsedMs: number) => void} [opts.onHeartbeat] - Called after each
 *   successful health check, for progress display
 * @param {number} [opts.intervalMs] - Health check interval
 * @param {number} [opts.healthTimeoutMs] - Per-check timeout
 * @param {number} [opts.maxMisses] - Consecutive misses before giving up
 */
async function postJsonWhileHealthy(
  baseUrl,
  route,
  payload,
  {
    onHeartbeat = null,
    intervalMs = HEALTH_CHECK_INTERVAL_MS,
    healthTimeoutMs = HEALTH_CHECK_TIMEOUT_MS,
    maxMisses = HEALTH_MAX_MISSES,
  } = {}
) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let misses = 0;
  let checking = false;

  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (await isHealthy(baseUrl, healthTimeoutMs)) {
        misses = 0;
        onHeartbeat?.(Date.now() - startedAt);
      } else if (++misses >= maxMisses) {
        controller.abort(
          new AudioServiceHttpError(
            `JD Audio Service stopped responding (no answer to ${misses} health checks in a row)`
          )
        );
      }
    } finally {
      checking = false;
    }
  }, intervalMs);

  try {
    return await postJson(`${baseUrl}${route}`, payload, { signal: controller.signal });
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = { postJson, postJsonWhileHealthy, AudioServiceHttpError };
