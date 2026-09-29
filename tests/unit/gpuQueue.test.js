/**
 * Serial queue for JD Audio Service GPU work. The service serializes GPU
 * endpoints behind one lock, so a client-side timeout that starts at request
 * time also counts time spent waiting for ANOTHER meeting's job. Queueing on
 * the Node side means each job's timeout starts only when it is dispatched.
 */
const { createSerialQueue } = require('../../src/main/services/gpuQueue');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createSerialQueue', () => {
  it('runs jobs one at a time, in order', async () => {
    const queue = createSerialQueue();
    const first = deferred();
    const started = [];

    const a = queue.run(async () => {
      started.push('a');
      return first.promise;
    });
    const b = queue.run(async () => {
      started.push('b');
      return 'b-done';
    });

    await new Promise(r => setTimeout(r, 5));
    expect(started).toEqual(['a']); // b has not been dispatched yet
    expect(queue.pending).toBe(2);

    first.resolve('a-done');
    await expect(a).resolves.toBe('a-done');
    await expect(b).resolves.toBe('b-done');
    expect(started).toEqual(['a', 'b']);
    expect(queue.pending).toBe(0);
  });

  it('a failed job rejects its caller but does not block the next job', async () => {
    const queue = createSerialQueue();
    const a = queue.run(async () => {
      throw new Error('GPU busy');
    });
    const b = queue.run(async () => 'ok');

    await expect(a).rejects.toThrow('GPU busy');
    await expect(b).resolves.toBe('ok');
  });

  it('reports whether a new job would have to wait', async () => {
    const queue = createSerialQueue();
    expect(queue.pending).toBe(0);
    const hold = deferred();
    const job = queue.run(() => hold.promise);
    expect(queue.pending).toBe(1);
    hold.resolve();
    await job;
    expect(queue.pending).toBe(0);
  });
});
