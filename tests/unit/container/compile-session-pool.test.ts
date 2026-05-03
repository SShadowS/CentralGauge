/**
 * Unit tests for CompileSessionPool.
 *
 * Pool semantics: lazy-grows up to N independent ContainerSessionSlot
 * instances per container, dispatches each runScript to a free slot
 * atomically (pool-side busy[] bookkeeping is sync, no race), falls
 * back to round-robin onto an existing slot when all N are busy.
 */
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { CompileSessionPool } from "../../../src/container/compile-session-pool.ts";
import { ContainerSessionSlot } from "../../../src/container/session-slot.ts";

interface StubFactoryOptions {
  initDelayMs?: number;
  executeDelayMs?: number;
}

/**
 * Build a real ContainerSessionSlot with stubbed init/execute that doesn't
 * touch pwsh. Slot's lock + lifecycle + dispose semantics are exercised
 * authentically; only the underlying PwshContainerSession is faked.
 */
function buildStubSlot(opts: StubFactoryOptions = {}): ContainerSessionSlot {
  const stubSession = {
    _state: "dead" as "idle" | "running" | "recycling" | "dead",
    initCalls: 0,
    executeCalls: 0,
    disposeCalls: 0,
    get state() {
      return this._state;
    },
    get isHealthy() {
      return this._state === "idle";
    },
    get shouldRecycle() {
      return false;
    },
    async init() {
      this.initCalls++;
      if (opts.initDelayMs) {
        await new Promise((r) => setTimeout(r, opts.initDelayMs));
      }
      this._state = "idle";
    },
    async execute(_script: string) {
      this.executeCalls++;
      this._state = "running";
      if (opts.executeDelayMs) {
        await new Promise((r) => setTimeout(r, opts.executeDelayMs));
      }
      this._state = "idle";
      return { output: "ok", exitCode: 0, durationMs: 1 };
    },
    recycle(): Promise<void> {
      this._state = "idle";
      return Promise.resolve();
    },
    dispose(): Promise<void> {
      this.disposeCalls++;
      this._state = "dead";
      return Promise.resolve();
    },
  };
  return new ContainerSessionSlot("Cronus28", {
    persistentEnabled: true,
    factory: () => stubSession,
    fallback: () => Promise.reject(new Error("fallback should not run")),
  });
}

describe("CompileSessionPool - lazy growth", () => {
  it("creates first slot only on first runScript call", async () => {
    let factoryCalls = 0;
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory: () => {
        factoryCalls++;
        return buildStubSlot();
      },
    });

    assertEquals(factoryCalls, 0, "no factory calls before first runScript");
    await pool.runScript("a");
    assertEquals(factoryCalls, 1, "first call creates one slot");
    await pool.dispose();
  });

  it("reuses existing free slot before creating new", async () => {
    let factoryCalls = 0;
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory: () => {
        factoryCalls++;
        return buildStubSlot();
      },
    });

    await pool.runScript("a");
    await pool.runScript("b");
    await pool.runScript("c");
    assertEquals(
      factoryCalls,
      1,
      "sequential calls reuse the same free slot — no new spawns",
    );
    await pool.dispose();
  });
});

describe("CompileSessionPool - parallelism", () => {
  it("N concurrent runs use N distinct slots", async () => {
    let factoryCalls = 0;
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory: () => {
        factoryCalls++;
        return buildStubSlot({ executeDelayMs: 30 });
      },
    });

    await Promise.all([
      pool.runScript("a"),
      pool.runScript("b"),
      pool.runScript("c"),
    ]);
    assertEquals(
      factoryCalls,
      3,
      "three concurrent calls must spawn three slots (true parallelism)",
    );
    await pool.dispose();
  });

  it("does not exceed poolMax (N+M concurrent → N parallel + M round-robin)", async () => {
    let factoryCalls = 0;
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 2,
      slotFactory: () => {
        factoryCalls++;
        return buildStubSlot({ executeDelayMs: 20 });
      },
    });

    // 5 concurrent calls with poolMax=2 → at most 2 slots created
    await Promise.all([
      pool.runScript("a"),
      pool.runScript("b"),
      pool.runScript("c"),
      pool.runScript("d"),
      pool.runScript("e"),
    ]);
    assertEquals(
      factoryCalls,
      2,
      "factoryCalls must not exceed poolMax under any concurrency",
    );
    await pool.dispose();
  });

  it("verifies actual parallelism via observed concurrency counter", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    let releaseAll!: () => void;
    const allReleased = new Promise<void>((r) => {
      releaseAll = r;
    });

    const slotFactory = () => {
      const blockingSession = {
        _state: "dead" as "idle" | "running" | "recycling" | "dead",
        get state() {
          return this._state;
        },
        get isHealthy() {
          return this._state === "idle";
        },
        get shouldRecycle() {
          return false;
        },
        init(): Promise<void> {
          this._state = "idle";
          return Promise.resolve();
        },
        async execute(_script: string) {
          inFlight++;
          if (inFlight > maxObserved) maxObserved = inFlight;
          if (inFlight === 3) releaseAll();
          await allReleased;
          inFlight--;
          return { output: "ok", exitCode: 0, durationMs: 1 };
        },
        recycle(): Promise<void> {
          return Promise.resolve();
        },
        dispose(): Promise<void> {
          this._state = "dead";
          return Promise.resolve();
        },
      };
      return new ContainerSessionSlot("Cronus28", {
        persistentEnabled: true,
        factory: () => blockingSession,
        fallback: () => Promise.reject(new Error("no fallback")),
      });
    };

    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory,
    });
    await Promise.all([
      pool.runScript("a"),
      pool.runScript("b"),
      pool.runScript("c"),
    ]);
    assertEquals(maxObserved, 3, "all three callers must run concurrently");
    await pool.dispose();
  });
});

describe("CompileSessionPool - dispose", () => {
  it("disposes all created slots", async () => {
    const slots: ContainerSessionSlot[] = [];
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory: () => {
        const s = buildStubSlot();
        slots.push(s);
        return s;
      },
    });
    await Promise.all([
      pool.runScript("a"),
      pool.runScript("b"),
    ]);
    assertEquals(slots.length, 2);
    await pool.dispose();
    for (const s of slots) {
      assertEquals(s.isDisposed, true, "every created slot must be disposed");
    }
  });

  it("dispose is idempotent", async () => {
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 1,
      slotFactory: () => buildStubSlot(),
    });
    await pool.runScript("a");
    await pool.dispose();
    await pool.dispose(); // must not throw
  });

  it("rejects new runScript after dispose", async () => {
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 2,
      slotFactory: () => buildStubSlot(),
    });
    await pool.dispose();
    let threw = false;
    try {
      await pool.runScript("after-dispose");
    } catch {
      threw = true;
    }
    assertEquals(threw, true, "runScript must reject after dispose");
  });
});

describe("CompileSessionPool - maybeRecycle", () => {
  it("forwards to all created slots", async () => {
    let recycleCalls = 0;
    const pool = new CompileSessionPool("Cronus28", {
      poolMax: 3,
      slotFactory: () => {
        const slot = buildStubSlot();
        // Spy on slot.maybeRecycle
        const orig = slot.maybeRecycle.bind(slot);
        slot.maybeRecycle = () => {
          recycleCalls++;
          return orig();
        };
        return slot;
      },
    });
    await Promise.all([pool.runScript("a"), pool.runScript("b")]);
    await pool.maybeRecycle();
    assertEquals(recycleCalls, 2, "must forward to each created slot");
    await pool.dispose();
  });
});
