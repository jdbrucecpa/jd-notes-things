/**
 * Serial queue for JD Audio Service GPU requests.
 *
 * The service runs every GPU endpoint (/process, /embed-speakers, /warmup, ...)
 * behind a single lock. If two meetings are processed at once, the second
 * request waits server-side — but its client timeout was already running, so
 * e.g. a 30s /embed-speakers call behind a multi-minute /process timed out and
 * silently dropped voice-profile matching for that meeting. Queueing here
 * means a request's timeout starts only when it is actually sent.
 *
 * Never call run() from inside a job on the same queue (it would deadlock).
 */
function createSerialQueue() {
  let tail = Promise.resolve();
  let pending = 0;

  return {
    /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
    run(job) {
      pending++;
      const result = tail.then(async () => {
        try {
          return await job();
        } finally {
          pending--;
        }
      });
      tail = result.catch(() => {}); // a failed job must not block the next one
      return result;
    },
    /** Jobs queued or running. */
    get pending() {
      return pending;
    },
  };
}

// Shared by every caller of the local audio service in this process.
const audioServiceGpuQueue = createSerialQueue();

module.exports = { createSerialQueue, audioServiceGpuQueue };
