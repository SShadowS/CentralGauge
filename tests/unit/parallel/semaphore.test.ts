/**
 * Unit tests for Mutex and Semaphore concurrency primitives
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { Mutex, Semaphore } from "../../../src/parallel/semaphore.ts";

describe("Mutex", () => {
  it("should start unlocked", () => {
    const mutex = new Mutex();

    assertEquals(mutex.isLocked(), false);
    assertEquals(mutex.queueLength(), 0);
  });

  it("should lock on first acquire", async () => {
    const mutex = new Mutex();

    const release = await mutex.acquire();

    assertEquals(mutex.isLocked(), true);
    release();
  });

  it("should unlock after release", async () => {
    const mutex = new Mutex();

    const release = await mutex.acquire();
    release();

    assertEquals(mutex.isLocked(), false);
  });

  it("should queue waiters when locked", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const release1 = await mutex.acquire();
    assertEquals(mutex.isLocked(), true);

    // Start a second acquire (will wait)
    const p2 = mutex.acquire().then((release) => {
      order.push(2);
      release();
    });

    assertEquals(mutex.queueLength(), 1);

    // Release first lock, allowing second to proceed
    order.push(1);
    release1();

    await p2;

    assertEquals(order, [1, 2]);
    assertEquals(mutex.isLocked(), false);
    assertEquals(mutex.queueLength(), 0);
  });

  it("should process waiters in FIFO order", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const release1 = await mutex.acquire();

    const p2 = mutex.acquire().then((release) => {
      order.push(2);
      release();
    });
    const p3 = mutex.acquire().then((release) => {
      order.push(3);
      release();
    });

    assertEquals(mutex.queueLength(), 2);

    release1();
    await Promise.all([p2, p3]);

    assertEquals(order, [2, 3]);
  });

  it("tryAcquire returns release fn when free", () => {
    const mutex = new Mutex();
    const release = mutex.tryAcquire();
    assertEquals(typeof release, "function");
    assertEquals(mutex.isLocked(), true);
    release!();
    assertEquals(mutex.isLocked(), false);
  });

  it("tryAcquire returns null when already locked", async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();
    const result = mutex.tryAcquire();
    assertEquals(result, null);
    assertEquals(mutex.queueLength(), 0, "tryAcquire must not enqueue");
    release1();
  });

  it("tryAcquire is atomic (no waiters created on failure)", async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();
    // Hammer with 10 concurrent tryAcquire calls — none should succeed,
    // none should enqueue.
    const results = Array.from({ length: 10 }, () => mutex.tryAcquire());
    assertEquals(results.every((r) => r === null), true);
    assertEquals(mutex.queueLength(), 0);
    release1();
    assertEquals(mutex.isLocked(), false);
  });
});

describe("Semaphore", () => {
  it("should allow up to N concurrent acquisitions", async () => {
    const semaphore = new Semaphore(3);
    const releases: Array<() => void> = [];

    releases.push(await semaphore.acquire());
    releases.push(await semaphore.acquire());
    releases.push(await semaphore.acquire());

    assertEquals(semaphore.activeCount(), 3);
    assertEquals(semaphore.isIdle(), false);

    for (const r of releases) r();
  });

  it("should block at capacity", async () => {
    const semaphore = new Semaphore(2);
    let fourthAcquired = false;

    const r1 = await semaphore.acquire();
    const r2 = await semaphore.acquire();

    assertEquals(semaphore.activeCount(), 2);

    // This acquire should block
    const p3 = semaphore.acquire().then((release) => {
      fourthAcquired = true;
      return release;
    });

    // Give the microtask queue a chance to process
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(fourthAcquired, false);

    // Release one slot
    r1();

    const r3 = await p3;
    assertEquals(fourthAcquired, true);
    assertEquals(semaphore.activeCount(), 2);

    r2();
    r3();
  });

  it("should report idle when all released", async () => {
    const semaphore = new Semaphore(2);

    assertEquals(semaphore.isIdle(), true);

    const r1 = await semaphore.acquire();
    assertEquals(semaphore.isIdle(), false);

    r1();
    assertEquals(semaphore.isIdle(), true);
  });

  it("should handle concurrent acquire/release correctly", async () => {
    const semaphore = new Semaphore(2);
    const results: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) =>
      (async () => {
        const release = await semaphore.acquire();
        results.push(i);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert(semaphore.activeCount() <= 2);
        release();
      })());

    await Promise.all(tasks);

    assertEquals(results.length, 5);
    // All 5 tasks should have completed
    assertEquals(new Set(results).size, 5);
  });

  it("should work with concurrency of 1 (like a mutex)", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];

    const r1 = await semaphore.acquire();
    assertEquals(semaphore.activeCount(), 1);

    const p2 = semaphore.acquire().then((release) => {
      order.push(2);
      release();
    });

    order.push(1);
    r1();
    await p2;

    assertEquals(order, [1, 2]);
    assertEquals(semaphore.isIdle(), true);
  });
});
