/**
 * Unit tests for ContainerSessionSlot — encapsulates per-container persistent
 * session lifecycle (lock + session ref + disposal state).
 */
import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  ContainerSessionSlot,
  type SessionLike,
} from "../../../src/container/session-slot.ts";
import { PwshSessionError } from "../../../src/errors.ts";

interface StubFactoryOptions {
  /** Delay (ms) before init resolves — lets concurrent callers race. */
  initDelayMs?: number;
  /** Delay (ms) before execute resolves. */
  executeDelayMs?: number;
  /** Force init to throw on first call only. */
  initFailFirst?: boolean;
}

class StubSession implements SessionLike {
  private _state: SessionLike["state"] = "dead";
  private pendingError: PwshSessionError | null = null;
  private _shouldRecycle = false;
  initCalls = 0;
  executeCalls = 0;
  recycleCalls = 0;
  disposeCalls = 0;

  constructor(private readonly opts: StubFactoryOptions = {}) {}

  get state(): SessionLike["state"] {
    return this._state;
  }
  get isHealthy(): boolean {
    return this._state === "idle";
  }
  get shouldRecycle(): boolean {
    return this._shouldRecycle;
  }

  setShouldRecycle(v: boolean): void {
    this._shouldRecycle = v;
  }
  throwOnNextExecute(err: PwshSessionError): void {
    this.pendingError = err;
  }

  async init(): Promise<void> {
    this.initCalls++;
    if (this.opts.initDelayMs) {
      await new Promise((r) => setTimeout(r, this.opts.initDelayMs));
    }
    if (this.opts.initFailFirst && this.initCalls === 1) {
      this._state = "dead";
      throw new PwshSessionError(
        "stub init fail",
        "session_init_failed",
        { container: "stub" },
      );
    }
    this._state = "idle";
  }

  async execute(_script: string) {
    this.executeCalls++;
    this._state = "running";
    if (this.opts.executeDelayMs) {
      await new Promise((r) => setTimeout(r, this.opts.executeDelayMs));
    }
    if (this.pendingError) {
      const err = this.pendingError;
      this.pendingError = null;
      this._state = "dead";
      throw err;
    }
    this._state = "idle";
    return { output: "ok", exitCode: 0, durationMs: 1 };
  }

  recycle(): Promise<void> {
    this.recycleCalls++;
    this._state = "idle";
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.disposeCalls++;
    this._state = "dead";
    return Promise.resolve();
  }
}

function createStubSession(opts: StubFactoryOptions = {}): StubSession {
  return new StubSession(opts);
}

describe("ContainerSessionSlot - persistent path", () => {
  it("calls factory exactly once across concurrent runScript callers", async () => {
    let factoryCalls = 0;
    const stub = createStubSession({ initDelayMs: 25, executeDelayMs: 5 });
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => {
        factoryCalls++;
        return stub;
      },
      fallback: () => Promise.reject(new Error("fallback should not run")),
    });

    await Promise.all([
      slot.runScript("a"),
      slot.runScript("b"),
      slot.runScript("c"),
    ]);

    assertEquals(factoryCalls, 1, "factory must be called exactly once");
    assertEquals(stub.initCalls, 1, "session.init must be called exactly once");
    assertEquals(stub.executeCalls, 3, "all three scripts must execute");
    await slot.dispose();
  });

  it("reuses session across runScript calls (idle→running→idle)", async () => {
    const stub = createStubSession();
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => Promise.reject(new Error("fallback should not run")),
    });

    await slot.runScript("first");
    await slot.runScript("second");
    assertEquals(stub.initCalls, 1);
    assertEquals(stub.executeCalls, 2);
    await slot.dispose();
  });

  it("falls back to spawn when retry execute also throws PwshSessionError", async () => {
    let factoryCalls = 0;
    const stub1 = createStubSession();
    const stub2 = createStubSession();
    const stubs = [stub1, stub2];
    let fbCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => {
        const s = stubs[factoryCalls++];
        if (!s) throw new Error("factory called too many times");
        return s;
      },
      fallback: () => {
        fbCalls++;
        return Promise.resolve({ output: "fb", exitCode: 0 });
      },
    });

    // First attempt: crash. Retry attempt: also crash. Slot should fall back.
    stub1.throwOnNextExecute(
      new PwshSessionError("first boom", "session_crashed", {
        container: "stub",
      }),
    );
    stub2.throwOnNextExecute(
      new PwshSessionError("retry boom", "session_crashed", {
        container: "stub",
      }),
    );

    const r = await slot.runScript("payload");
    assertEquals(r.output, "fb", "fallback served the call after retry failed");
    assertEquals(fbCalls, 1);
    assertEquals(stub1.executeCalls, 1);
    assertEquals(stub2.executeCalls, 1);
    assertEquals(slot.metrics.crashRetryCount, 1);
    assertEquals(slot.metrics.fallbackCount, 1);
    await slot.dispose();
  });

  it("falls back to spawn when factory itself throws", async () => {
    let fbCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => {
        throw new Error("factory bug");
      },
      fallback: () => {
        fbCalls++;
        return Promise.resolve({ output: "fb", exitCode: 0 });
      },
    });

    const r = await slot.runScript("p");
    assertEquals(r.output, "fb");
    assertEquals(fbCalls, 1);
    assertEquals(slot.metrics.fallbackCount, 1);
    await slot.dispose();
  });

  it("retries once on session_crashed with a fresh session", async () => {
    let factoryCalls = 0;
    const stub1 = createStubSession();
    const stub2 = createStubSession();
    const stubs = [stub1, stub2];
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => {
        const s = stubs[factoryCalls++];
        if (!s) throw new Error("factory called too many times");
        return s;
      },
      fallback: () => Promise.reject(new Error("fallback should not run")),
    });

    stub1.throwOnNextExecute(
      new PwshSessionError("boom", "session_crashed", { container: "stub" }),
    );

    const r = await slot.runScript("payload");
    assertEquals(r.output, "ok");
    assertEquals(stub1.executeCalls, 1, "stub1 attempted once");
    assertEquals(stub2.initCalls, 1, "stub2 was created and initialized");
    assertEquals(stub2.executeCalls, 1, "stub2 served the retry");
    assertEquals(factoryCalls, 2, "factory was called twice");
    await slot.dispose();
  });

  it("falls back to spawn-per-call when init throws", async () => {
    const stub = createStubSession({ initFailFirst: true });
    let fallbackCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => {
        fallbackCalls++;
        return Promise.resolve({ output: "fb", exitCode: 0 });
      },
    });

    const r = await slot.runScript("p");
    assertEquals(r.output, "fb", "fallback served the call after init failure");
    assertEquals(fallbackCalls, 1);
    await slot.dispose();
  });
});

describe("ContainerSessionSlot - persistentEnabled=false", () => {
  it("never calls factory; always uses fallback", async () => {
    let factoryCalls = 0;
    let fallbackCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: false,
      factory: () => {
        factoryCalls++;
        throw new Error("factory should not be called");
      },
      fallback: () => Promise.resolve({ output: "fallback-out", exitCode: 0 }),
    });

    await slot.runScript("a");
    await slot.runScript("b");
    assertEquals(factoryCalls, 0);
    assertEquals(slot.metrics.fallbackCount, 2);
    fallbackCalls = 0; // suppress unused warning
    void fallbackCalls;
    await slot.dispose();
  });

  it("runs fallback in parallel (no slot-wide lock for fallback)", async () => {
    // Verify parallelism via observed concurrency counter rather than
    // wall-clock timing — timing-based assertions flake on slow CI runners.
    let inFlight = 0;
    let maxObserved = 0;
    let releaseAll!: () => void;
    const allReleased = new Promise<void>((r) => {
      releaseAll = r;
    });

    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: false,
      factory: () => {
        throw new Error("unused");
      },
      fallback: async () => {
        inFlight++;
        if (inFlight > maxObserved) maxObserved = inFlight;
        // Hold here until all three callers have entered, then drain together.
        if (inFlight === 3) releaseAll();
        await allReleased;
        inFlight--;
        return { output: "fb", exitCode: 0 };
      },
    });

    await Promise.all([
      slot.runScript("a"),
      slot.runScript("b"),
      slot.runScript("c"),
    ]);

    assertEquals(
      maxObserved,
      3,
      "all three fallback calls must run concurrently (no slot-wide lock)",
    );
    await slot.dispose();
  });
});

describe("ContainerSessionSlot - dispose semantics", () => {
  it("rejects new work after dispose() returns", async () => {
    const stub = createStubSession();
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => Promise.resolve({ output: "fb", exitCode: 0 }),
    });

    await slot.runScript("first");
    await slot.dispose();
    assertEquals(slot.isDisposed, true);
    await assertRejects(
      () => slot.runScript("after-dispose"),
      Error,
      "disposed",
    );
  });

  it("rejects new work that arrives DURING dispose (disposing flag)", async () => {
    const stub = createStubSession({ executeDelayMs: 30 });
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => Promise.resolve({ output: "fb", exitCode: 0 }),
    });

    // Start an in-flight execute that the slot lock will hold.
    const inFlight = slot.runScript("in-flight");
    // Briefly yield so the in-flight call grabs the lock + enters execute.
    await new Promise((r) => setTimeout(r, 5));

    // Begin dispose — sets disposing=true, then waits for the lock.
    const disposing = slot.dispose();
    // Yield so dispose's lock acquire is queued behind the in-flight call.
    await new Promise((r) => setTimeout(r, 5));

    // A new caller that arrives while disposing should be rejected immediately.
    await assertRejects(
      () => slot.runScript("late"),
      Error,
      "disposed",
    );

    // In-flight call still completes successfully.
    const r = await inFlight;
    assertEquals(r.output, "ok");
    await disposing;
    assertEquals(slot.isDisposed, true);
  });

  it("dispose is idempotent", async () => {
    const stub = createStubSession();
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => Promise.resolve({ output: "fb", exitCode: 0 }),
    });
    await slot.runScript("warm");
    await slot.dispose();
    await slot.dispose(); // must not throw
    assertEquals(stub.disposeCalls, 1, "underlying session disposed once");
  });
});

describe("ContainerSessionSlot - maybeRecycle", () => {
  it("waits for in-flight execute before calling recycle", async () => {
    const stub = createStubSession({ executeDelayMs: 40 });
    // Force shouldRecycle by overriding the getter post-construction.
    stub.setShouldRecycle(true);

    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => Promise.resolve({ output: "fb", exitCode: 0 }),
    });

    // Warm the session so metrics+ref exist.
    await slot.runScript("warm");

    // Now start an execute that holds the lock for 40ms.
    const inFlight = slot.runScript("blocker");
    await new Promise((r) => setTimeout(r, 5));
    const executeCallsBefore = stub.executeCalls;
    const recycleCallsBefore = stub.recycleCalls;

    // Recycle must wait for the in-flight execute, not abort it.
    const recycle = slot.maybeRecycle();
    await new Promise((r) => setTimeout(r, 10));
    assertEquals(
      stub.recycleCalls,
      recycleCallsBefore,
      "recycle has not started yet — still queued behind execute",
    );

    await inFlight;
    await recycle;
    assertEquals(
      stub.executeCalls,
      executeCallsBefore,
      "recycle does not trigger an execute",
    );
    assertEquals(stub.recycleCalls, recycleCallsBefore + 1);
    await slot.dispose();
  });

  it("is no-op when no session exists yet", async () => {
    let factoryCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => {
        factoryCalls++;
        return createStubSession();
      },
      fallback: () => Promise.resolve({ output: "fb", exitCode: 0 }),
    });
    await slot.maybeRecycle();
    assertEquals(factoryCalls, 0, "no factory call");
    await slot.dispose();
  });
});

describe("ContainerSessionSlot - metrics", () => {
  it("counts init, execute, recycle, fallback", async () => {
    const stub = createStubSession();
    stub.setShouldRecycle(true);
    let fbCalls = 0;
    const slot = new ContainerSessionSlot("Cronus28", {
      persistentEnabled: true,
      factory: () => stub,
      fallback: () => {
        fbCalls++;
        return Promise.resolve({ output: "fb", exitCode: 0 });
      },
    });
    await slot.runScript("a");
    await slot.runScript("b");
    await slot.maybeRecycle();
    assertEquals(slot.metrics.initCount, 1);
    assertEquals(slot.metrics.executeCount, 2);
    assertEquals(slot.metrics.recycleCount, 1);
    assertEquals(slot.metrics.fallbackCount, 0);
    void fbCalls;
    await slot.dispose();
  });
});
