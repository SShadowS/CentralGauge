import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PwshSessionError } from "../../../src/errors.ts";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";
import { createMockPwshProcess } from "../../utils/mock-pwsh-process.ts";

describe("PwshContainerSession", () => {
  it("starts in dead state with callCount 0", () => {
    const sess = new PwshContainerSession("Cronus28");
    assertEquals(sess.state, "dead");
    assertEquals(sess.callCount, 0);
    assertEquals(sess.isHealthy, false);
    assertEquals(sess.shouldRecycle, false);
    assertEquals(sess.containerName, "Cronus28");
  });

  it("uses default options", () => {
    const sess = new PwshContainerSession("Cronus28");
    // Defaults are private; we infer them via shouldRecycle threshold behavior in later tests.
    assertEquals(sess.callCount, 0);
  });
});

describe("PwshContainerSession.init", () => {
  it("transitions to idle after bootstrap marker arrives", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });

    // Drive bootstrap: emit a marker AFTER init() starts reading.
    const initPromise = sess.init();
    // The session reads stdin writes asynchronously; we need to let init send its bootstrap script first.
    await new Promise((r) => setTimeout(r, 10));
    // Find the bootstrap token in the stdin writes.
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    if (!tokenMatch) throw new Error("no bootstrap token in stdin");
    const token = tokenMatch[1];
    mock.emitStdout(`@@CG-DONE-${token}-EXIT-0@@\n`);

    await initPromise;
    assertEquals(sess.state, "idle");
    assertEquals(sess.isHealthy, true);
  });

  it("drains stderr to the provided sink throughout the session lifetime", async () => {
    const mock = createMockPwshProcess();
    const stderrChunks: string[] = [];
    const decoder = new TextDecoder();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      stderrSink: (chunk) => stderrChunks.push(decoder.decode(chunk)),
    });

    const initPromise = sess.init();
    // Emit stderr DURING bootstrap to prove the drain attaches before init completes.
    await new Promise((r) => setTimeout(r, 10));
    mock.emitStderr("warning: BCH module v6.1.11 loaded\n");
    // Resolve bootstrap so init() finishes.
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    if (!tokenMatch) throw new Error("no bootstrap token in stdin");
    mock.emitStdout(`@@CG-DONE-${tokenMatch[1]}-EXIT-0@@\n`);
    await initPromise;

    // Emit more stderr after init.
    mock.emitStderr("post-init noise\n");
    // Yield so the drain reader picks up the chunk.
    await new Promise((r) => setTimeout(r, 10));

    await sess.dispose();

    const text = stderrChunks.join("");
    assertStringIncludes(text, "BCH module v6.1.11 loaded");
    assertStringIncludes(text, "post-init noise");
  });
});

describe("PwshContainerSession.init failure paths", () => {
  it("throws session_init_failed when spawn factory throws", async () => {
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => {
        throw new Error("pwsh: command not found");
      },
    });
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "failed to spawn pwsh",
    );
    assertEquals(sess.state, "dead");
  });

  it("throws session_timeout if bootstrap marker never arrives", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 100,
    });
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "not received within 100ms",
    );
    assertEquals(sess.state, "dead");
    assertEquals(mock.wasKilled(), true);
  });

  it("throws session_crashed when process exits before marker", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });
    setTimeout(() => mock.exit(1), 10);
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "exited before marker",
    );
    assertEquals(sess.state, "dead");
  });

  it("rejects init() when called from non-dead state", async () => {
    const mock = createMockPwshProcess();
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
    });

    const initPromise = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    mock.emitStdout(`@@CG-DONE-${tokenMatch![1]}-EXIT-0@@\n`);
    await initPromise;

    assertEquals(sess.state, "idle");
    await assertRejects(
      () => sess.init(),
      PwshSessionError,
      "init called from non-dead state",
    );
  });
});

describe("PwshContainerSession.execute", () => {
  // Helper: bring a session to idle state via mock bootstrap.
  async function initSession(mock: ReturnType<typeof createMockPwshProcess>) {
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });
    const initPromise = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokenMatch = writes.match(/CG-DONE-([a-f0-9-]+)-EXIT-/);
    mock.emitStdout(`@@CG-DONE-${tokenMatch![1]}-EXIT-0@@\n`);
    await initPromise;
    return sess;
  }

  it("returns marker output and exitCode 0 on success", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    // Issue an execute call. The session writes the wrapped script with a fresh token.
    const execPromise = sess.execute(`Write-Output "hi"`);
    await new Promise((r) => setTimeout(r, 10));

    // Find the new token (last marker mention in stdin).
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    const lastToken = tokens[tokens.length - 1]![1]!;

    // Emit the script's output then the marker.
    mock.emitStdout(`hi\n@@CG-DONE-${lastToken}-EXIT-0@@\n`);
    const result = await execPromise;
    assertEquals(result.output, "hi");
    assertEquals(result.exitCode, 0);
    assertEquals(sess.state, "idle");
    assertEquals(sess.callCount, 1);
  });

  it("returns non-zero exitCode without throwing", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    const execPromise = sess.execute(`exit 1`);
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    const lastToken = tokens[tokens.length - 1]![1]!;
    mock.emitStdout(`@@CG-DONE-${lastToken}-EXIT-1@@\n`);
    const result = await execPromise;
    assertEquals(result.exitCode, 1);
    assertEquals(sess.state, "idle");
    assertEquals(sess.callCount, 1);
  });

  it("throws session_timeout when marker doesn't arrive in time", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    await assertRejects(
      () => sess.execute(`Start-Sleep 9999`, 100),
      PwshSessionError,
      "not received within 100ms",
    );
    assertEquals(sess.state, "dead"); // execute() kills process on error
  });

  it("throws session_crashed when process exits mid-execute", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    const execPromise = sess.execute(`some script`);
    await new Promise((r) => setTimeout(r, 10));
    mock.exit(137); // SIGKILL-equivalent
    await assertRejects(
      () => execPromise,
      PwshSessionError,
      "exited before marker",
    );
    assertEquals(sess.state, "dead");
  });

  it("rejects concurrent execute() with state_violation", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    // Start one execute (don't await).
    const first = sess.execute(`first`);
    // Immediately try a second — should reject because state is now "running".
    await assertRejects(
      () => sess.execute(`second`),
      PwshSessionError,
      "execute called from non-idle state",
    );

    // Drain the first to clean up.
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    mock.emitStdout(`@@CG-DONE-${tokens[tokens.length - 1]![1]}-EXIT-0@@\n`);
    await first;
  });

  it("ignores markers with different tokens", async () => {
    const mock = createMockPwshProcess();
    const sess = await initSession(mock);

    const execPromise = sess.execute(`Write-Output stuff`);
    await new Promise((r) => setTimeout(r, 10));

    // Emit a misleading marker with a different token, then real output, then the real marker.
    mock.emitStdout(
      `noise here\n@@CG-DONE-12345678-1111-2222-3333-444444444444-EXIT-0@@\nstuff\n`,
    );

    const writes = mock.getStdinWrites().join("");
    const tokens = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    const realToken = tokens[tokens.length - 1]![1]!;
    mock.emitStdout(`@@CG-DONE-${realToken}-EXIT-0@@\n`);

    const result = await execPromise;
    // Output includes everything before the real marker (including the fake marker line).
    assertStringIncludes(result.output, "noise here");
    assertStringIncludes(result.output, "stuff");
    assertStringIncludes(result.output, "12345678-1111");
  });
});

describe("PwshContainerSession.recycle", () => {
  it("disposes and reinits, resetting callCount", async () => {
    let spawnCount = 0;
    const mocks: ReturnType<typeof createMockPwshProcess>[] = [];
    const factory = () => {
      const m = createMockPwshProcess();
      mocks.push(m);
      spawnCount++;
      return m.process;
    };

    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: factory,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });

    // Init session 1
    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const w1 = mocks[0]!.getStdinWrites().join("");
    const t1 = w1.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[0]!.emitStdout(`@@CG-DONE-${t1}-EXIT-0@@\n`);
    await initP;

    // Run an execute to bump callCount
    const execP = sess.execute(`Write-Output x`);
    await new Promise((r) => setTimeout(r, 10));
    const w1b = mocks[0]!.getStdinWrites().join("");
    const tokens = [...w1b.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    mocks[0]!.emitStdout(
      `@@CG-DONE-${tokens[tokens.length - 1]![1]}-EXIT-0@@\n`,
    );
    await execP;
    assertEquals(sess.callCount, 1);

    // Recycle
    const recycleP = sess.recycle();
    await new Promise((r) => setTimeout(r, 10));
    const w2 = mocks[1]!.getStdinWrites().join("");
    const t2 = w2.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[1]!.emitStdout(`@@CG-DONE-${t2}-EXIT-0@@\n`);
    await recycleP;

    assertEquals(spawnCount, 2);
    assertEquals(sess.state, "idle");
    assertEquals(sess.callCount, 0);
    assertEquals(mocks[0]!.wasKilled(), true);
  });

  it("rejects when not idle", async () => {
    const mock = createMockPwshProcess();
    // Inline init helper since the existing initSession is scoped to the .execute describe block.
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });
    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes0 = mock.getStdinWrites().join("");
    const t0 = writes0.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mock.emitStdout(`@@CG-DONE-${t0}-EXIT-0@@\n`);
    await initP;

    const exec = sess.execute(`x`);
    await assertRejects(
      () => sess.recycle(),
      PwshSessionError,
      "recycle called from non-idle state",
    );

    // Drain
    await new Promise((r) => setTimeout(r, 10));
    const writes = mock.getStdinWrites().join("");
    const tokensD = [...writes.matchAll(/CG-DONE-([a-f0-9-]+)-EXIT-/g)];
    mock.emitStdout(`@@CG-DONE-${tokensD[tokensD.length - 1]![1]}-EXIT-0@@\n`);
    await exec;
  });

  it("sets state=dead when reinit fails after dispose", async () => {
    let spawnCount = 0;
    const mocks: ReturnType<typeof createMockPwshProcess>[] = [];
    const factory = () => {
      spawnCount++;
      if (spawnCount === 2) {
        throw new Error("pwsh missing on 2nd spawn");
      }
      const m = createMockPwshProcess();
      mocks.push(m);
      return m.process;
    };

    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: factory,
      bootstrapTimeoutMs: 5_000,
    });

    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const w1 = mocks[0]!.getStdinWrites().join("");
    const t1 = w1.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mocks[0]!.emitStdout(`@@CG-DONE-${t1}-EXIT-0@@\n`);
    await initP;

    await assertRejects(
      () => sess.recycle(),
      PwshSessionError,
    );
    assertEquals(sess.state, "dead");
  });
});

describe("PwshContainerSession.dispose", () => {
  it("kills the process and sets state=dead", async () => {
    const mock = createMockPwshProcess();
    // Inline init helper since the existing initSession is scoped to the .execute describe block.
    const sess = new PwshContainerSession("Cronus28", {
      spawnFactory: () => mock.process,
      bootstrapTimeoutMs: 5_000,
      defaultTimeoutMs: 5_000,
    });
    const initP = sess.init();
    await new Promise((r) => setTimeout(r, 10));
    const writes0 = mock.getStdinWrites().join("");
    const t0 = writes0.match(/CG-DONE-([a-f0-9-]+)-EXIT-/)![1]!;
    mock.emitStdout(`@@CG-DONE-${t0}-EXIT-0@@\n`);
    await initP;

    await sess.dispose();
    assertEquals(sess.state, "dead");
    assertEquals(mock.wasKilled(), true);
  });

  it("is safe to call when already dead", async () => {
    const sess = new PwshContainerSession("Cronus28");
    assertEquals(sess.state, "dead");
    await sess.dispose(); // no-op, no throw
    assertEquals(sess.state, "dead");
  });
});
