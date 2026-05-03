/**
 * Promise-based concurrency primitives for parallel execution control.
 * Used by compile-queue (compilation semaphore, test mutex) and
 * orchestrator (task-level concurrency).
 */

/**
 * Promise-based mutex for single-resource access
 */
export class Mutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }

    return new Promise((resolve) => {
      this.waiters.push(() => {
        resolve(() => this.release());
      });
    });
  }

  /**
   * Atomic try-acquire: returns release function if lock was free,
   * or `null` if it was already held. Never enqueues — caller decides
   * whether to wait elsewhere or fall back. Used by pool implementations
   * that want to lease a free slot without head-of-line blocking.
   */
  tryAcquire(): (() => void) | null {
    if (this.locked) return null;
    this.locked = true;
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  queueLength(): number {
    return this.waiters.length;
  }
}

/**
 * Bounded-concurrency semaphore for parallel execution
 */
export class Semaphore {
  private current = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  acquire(): Promise<() => void> {
    if (this.current < this.maxConcurrency) {
      this.current++;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.current++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.current--;
    const next = this.waiters.shift();
    if (next) next();
  }

  activeCount(): number {
    return this.current;
  }

  maxCount(): number {
    return this.maxConcurrency;
  }

  isIdle(): boolean {
    return this.current === 0 && this.waiters.length === 0;
  }
}
