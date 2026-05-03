import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
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
