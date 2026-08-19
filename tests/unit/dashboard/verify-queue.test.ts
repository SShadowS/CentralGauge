import { assert, assertEquals } from "@std/assert";
import { VerifyQueue } from "../../../src/dashboard/verify-queue.ts";
import type { VerifyOutcome } from "../../../src/dashboard/verify-types.ts";

Deno.test("verify-queue", async (t) => {
  await t.step("runs jobs one at a time, never overlapping", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { state: "passed_first_try", passed: 1, total: 1 };
      },
    });
    for (let i = 0; i < 4; i++) {
      q.enqueue({
        draftDir: "d",
        taskId: "CG-AL-X001",
        model: `m${i}`,
        code: "x",
      });
    }
    await q.drain();
    assertEquals(maxInFlight, 1, "serial, always");
  });

  await t.step("preserves FIFO order", async () => {
    const seen: string[] = [];
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: (job) => {
        seen.push(job.model);
        return Promise.resolve({
          state: "passed_first_try",
          passed: 1,
          total: 1,
        });
      },
    });
    for (const m of ["a", "b", "c"]) {
      q.enqueue({ draftDir: "d", taskId: "CG-AL-X001", model: m, code: "x" });
    }
    await q.drain();
    assertEquals(seen, ["a", "b", "c"]);
  });

  await t.step("re-checks the gate per job, not once per batch", async () => {
    let allowed = true;
    let ran = 0;
    const q = new VerifyQueue({
      gate: () =>
        allowed ? { allowed: true } : { allowed: false, reason: "bench live" },
      verify: () => {
        ran++;
        allowed = false; // a bench starts while the batch is in flight
        return Promise.resolve({
          state: "passed_first_try",
          passed: 1,
          total: 1,
        });
      },
    });
    for (const m of ["a", "b", "c"]) {
      q.enqueue({ draftDir: "d", taskId: "CG-AL-X001", model: m, code: "x" });
    }
    await q.drain();
    assertEquals(ran, 1, "only the first job ran");
    const refused = q.snapshot().filter((j) => j.outcome.state === "refused");
    assertEquals(refused.length, 2);
  });

  await t.step(
    "emits a transition per job so results land as they finish",
    async () => {
      const states: string[] = [];
      const q = new VerifyQueue({
        gate: () => ({ allowed: true }),
        verify: () =>
          Promise.resolve({
            state: "passed_first_try",
            passed: 1,
            total: 1,
          }),
      });
      q.on((e) => states.push(e.outcome.state));
      q.enqueue({ draftDir: "d", taskId: "CG-AL-X001", model: "a", code: "x" });
      await q.drain();
      assert(states.includes("queued"));
      assert(states.includes("passed_first_try"));
    },
  );

  await t.step("one throwing job does not stop the queue", async () => {
    let ran = 0;
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: (job) => {
        ran++;
        if (job.model === "a") return Promise.reject(new Error("boom"));
        return Promise.resolve({
          state: "passed_first_try",
          passed: 1,
          total: 1,
        });
      },
    });
    for (const m of ["a", "b"]) {
      q.enqueue({ draftDir: "d", taskId: "CG-AL-X001", model: m, code: "x" });
    }
    await q.drain();
    assertEquals(ran, 2, "job b still ran");
  });

  await t.step("shutdown is permanent: later jobs refuse too", async () => {
    let ran = 0;
    const q = new VerifyQueue({
      gate: () => ({ allowed: true }),
      verify: () => {
        ran++;
        return Promise.resolve({
          state: "passed_first_try",
          passed: 1,
          total: 1,
        });
      },
    });
    q.shutdown("stopping");
    const id = q.enqueue({
      draftDir: "d",
      taskId: "CG-AL-X001",
      model: "a",
      code: "x",
    });
    await q.drain();
    assertEquals(ran, 0, "the job never reached verify()");
    const view = q.snapshot().find((j) => j.id === id);
    assertEquals(view?.outcome, { state: "refused", reason: "stopping" });
  });

  await t.step(
    "shutdown does not misreport an in-flight job as refused",
    async () => {
      let resolveVerify!: (outcome: VerifyOutcome) => void;
      const pending = new Promise<VerifyOutcome>((resolve) => {
        resolveVerify = resolve;
      });
      let markRunningSeen!: () => void;
      const runningSeen = new Promise<void>((resolve) => {
        markRunningSeen = resolve;
      });
      const states: string[] = [];
      const q = new VerifyQueue({
        gate: () => ({ allowed: true }),
        verify: () => pending,
      });
      q.on((e) => {
        states.push(e.outcome.state);
        if (e.outcome.state === "running") markRunningSeen();
      });

      const id = q.enqueue({
        draftDir: "d",
        taskId: "CG-AL-X001",
        model: "a",
        code: "x",
      });

      // Wait until the pump has actually dispatched the job - verify() is
      // observably in flight - before calling shutdown().
      await runningSeen;

      q.shutdown("server stopping");

      // shutdown() must not touch a job that is already running.
      const afterShutdown = q.snapshot().find((j) => j.id === id);
      assertEquals(afterShutdown?.outcome.state, "running");

      resolveVerify({ state: "passed_first_try", passed: 1, total: 1 });
      await q.drain();

      const finalView = q.snapshot().find((j) => j.id === id);
      assertEquals(finalView?.outcome, {
        state: "passed_first_try",
        passed: 1,
        total: 1,
      });
      assert(!states.includes("refused"), "job never reported refused");
    },
  );
});
