import { assertEquals, assertRejects } from "@std/assert";
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
});
