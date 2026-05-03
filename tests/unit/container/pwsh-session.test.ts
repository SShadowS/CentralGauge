import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";

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
