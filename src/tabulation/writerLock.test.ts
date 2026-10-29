import { describe, expect, it } from 'vitest';
import { memoryStorage } from './store';
import { createWriterLock, LEASE_KEY, type LockManagerLike } from './writerLock';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal Web Locks implementation with the parts the writer lock uses (ifAvailable, steal, queue). */
function fakeLocks(): LockManagerLike {
  let holder: { abort: (error: Error) => void } | null = null;
  const queue: Array<() => void> = [];
  const next = () => queue.shift()?.();
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const grant = () => {
          const current = { abort: reject };
          holder = current;
          Promise.resolve(callback({ name })).then((value) => {
            if (holder === current) { holder = null; next(); }
            resolve(value);
          });
        };
        if (options.steal) {
          holder?.abort(Object.assign(new Error('Lock stolen'), { name: 'AbortError' }));
          holder = null;
          grant();
        } else if (!holder) grant();
        else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject);
        else queue.push(grant);
      });
    },
  };
}

describe('writer lock with Web Locks', () => {
  it('lets the first tab write, keeps the second read-only and hands over when the first closes', async () => {
    const locks = fakeLocks();
    const first = createWriterLock({ name: 'tab', locks });
    await tick();
    const second = createWriterLock({ name: 'tab', locks });
    await tick();
    expect([first.isWriter(), second.isWriter()]).toEqual([true, false]);
    first.release();
    await tick();
    await tick();
    expect(second.isWriter()).toBe(true);
  });

  it('takes control from another tab, which becomes read-only and notifies', async () => {
    const locks = fakeLocks();
    const first = createWriterLock({ name: 'tab', locks });
    await tick();
    const second = createWriterLock({ name: 'tab', locks });
    await tick();
    let notified = 0;
    first.subscribe(() => notified++);
    second.takeOver();
    await tick();
    await tick();
    expect([first.isWriter(), second.isWriter()]).toEqual([false, true]);
    expect(notified).toBeGreaterThan(0);
  });
});

describe('writer lock with a storage lease (no Web Locks)', () => {
  function clock() {
    let time = 0;
    const timers: Array<{ at: number; callback: () => void }> = [];
    return {
      now: () => time,
      schedule: (callback: () => void, delay: number) => {
        const timer = { at: time + delay, callback };
        timers.push(timer);
        return () => { timers.splice(timers.indexOf(timer), 1); };
      },
      advance(ms: number) {
        time += ms;
        for (const timer of timers.filter((item) => item.at <= time)) {
          timers.splice(timers.indexOf(timer), 1);
          timer.callback();
        }
      },
    };
  }

  it('keeps one writer, renews the lease and lets another tab take over when it expires', () => {
    const storage = memoryStorage();
    const time = clock();
    const first = createWriterLock({ name: 'tab', locks: null, storage, tabId: 'a', now: time.now, schedule: time.schedule });
    const second = createWriterLock({ name: 'tab', locks: null, storage, tabId: 'b', now: time.now, schedule: time.schedule });
    expect([first.isWriter(), second.isWriter()]).toEqual([true, false]);
    time.advance(10_000);
    expect([first.isWriter(), second.isWriter()]).toEqual([true, false]);
    first.dispose();
    time.advance(10_000);
    expect(second.isWriter()).toBe(true);
    expect(JSON.parse(storage.getItem(LEASE_KEY)!).tabId).toBe('b');
  });

  it('takes control explicitly; the previous writer notices on its next renewal', () => {
    const storage = memoryStorage();
    const time = clock();
    const first = createWriterLock({ name: 'tab', locks: null, storage, tabId: 'a', now: time.now, schedule: time.schedule });
    const second = createWriterLock({ name: 'tab', locks: null, storage, tabId: 'b', now: time.now, schedule: time.schedule });
    second.takeOver();
    expect(second.isWriter()).toBe(true);
    time.advance(2_000);
    expect(first.isWriter()).toBe(false);
  });

  it('is always the writer when no coordination is available', () => {
    expect(createWriterLock({ name: 'tab', locks: null, storage: null }).isWriter()).toBe(true);
  });
});
