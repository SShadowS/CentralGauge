import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  acquireBenchLock,
  BENCH_LOCK_FILENAME,
  BenchLockHeldError,
  benchLockPath,
  isBenchRunning,
  readBenchLock,
  tryAcquireBenchLock,
} from "../../../src/utils/bench-lock.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("bench-lock", async (t) => {
  await t.step("benchLockPath joins the lock filename", () => {
    assertEquals(
      benchLockPath("results"),
      join("results", BENCH_LOCK_FILENAME),
    );
  });

  await t.step("isBenchRunning is false when no lock file exists", async () => {
    const dir = await createTempDir("bench-lock-none");
    try {
      assertFalse(isBenchRunning(dir));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("acquire creates a live lock, release removes it", async () => {
    const dir = await createTempDir("bench-lock-cycle");
    try {
      const release = acquireBenchLock(dir, { command: "bench --llms x" });
      assert(
        isBenchRunning(dir),
        "lock should read as live right after acquire",
      );

      const info = readBenchLock(dir);
      assert(info, "lock file should be readable");
      assertEquals(info.pid, Deno.pid);
      assertEquals(info.command, "bench --llms x");

      await release();
      assertFalse(isBenchRunning(dir), "lock should be gone after release");
      assertEquals(readBenchLock(dir), null);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("release is idempotent", async () => {
    const dir = await createTempDir("bench-lock-idempotent");
    try {
      const release = acquireBenchLock(dir);
      await release();
      await release();
      assertFalse(isBenchRunning(dir));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("a stale heartbeat does not count as running", async () => {
    const dir = await createTempDir("bench-lock-stale");
    try {
      const release = acquireBenchLock(dir);
      const path = benchLockPath(dir);
      // Simulate a crashed bench: the file survives but the heartbeat stopped.
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await Deno.utime(path, old, old);

      assertFalse(
        isBenchRunning(dir),
        "a heartbeat older than the stale window means no live bench",
      );
      assert(
        isBenchRunning(dir, { staleAfterMs: 60 * 60 * 1000 }),
        "the same file is still live under a wider stale window",
      );
      await release();
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("a corrupt but fresh lock still counts as running", async () => {
    // Fail-safe direction: a half-written lock must never be read as "no bench
    // is running" — that is the answer that lets a test run corrupt a live
    // bench. Liveness is mtime-only; only the metadata parse can fail.
    const dir = await createTempDir("bench-lock-corrupt");
    try {
      await Deno.writeTextFile(benchLockPath(dir), "{not json");
      assertEquals(readBenchLock(dir), null);
      assert(isBenchRunning(dir));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step(
    "second acquire fails with BenchLockHeldError naming the holder",
    async () => {
      const dir = await createTempDir("bench-lock-exclusive");
      try {
        const release = acquireBenchLock(dir, { command: "bench --llms a" });
        const err = assertThrows(
          () => acquireBenchLock(dir, { command: "bench --llms b" }),
          BenchLockHeldError,
        );
        assertEquals(err.holder?.pid, Deno.pid);
        assertEquals(err.holder?.command, "bench --llms a");
        const second = tryAcquireBenchLock(dir);
        assertEquals(second.acquired, false);
        await release();
        const third = tryAcquireBenchLock(dir);
        assert(third.acquired, "lock is free again after release");
        await third.release();
      } finally {
        await cleanupTempDir(dir);
      }
    },
  );

  await t.step("a stale lock is reclaimed by the next acquirer", async () => {
    const dir = await createTempDir("bench-lock-stale");
    try {
      const path = benchLockPath(dir);
      Deno.writeTextFileSync(
        path,
        JSON.stringify({
          pid: 1,
          startedAt: "x",
          command: "dead",
          token: "dead-token",
        }),
      );
      const past = new Date(Date.now() - 10 * 60_000);
      Deno.utimeSync(path, past, past);
      const got = tryAcquireBenchLock(dir, { command: "reclaimer" });
      assert(got.acquired, "stale lock must be reclaimable");
      assertEquals(readBenchLock(dir)?.pid, Deno.pid);
      assertEquals(readBenchLock(dir)?.token, got.token);
      await got.release();
      assertFalse(isBenchRunning(dir));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("release leaves a lock it does not own in place", async () => {
    const dir = await createTempDir("bench-lock-owner");
    try {
      const release = acquireBenchLock(dir, { command: "mine" });
      const path = benchLockPath(dir);
      Deno.writeTextFileSync(
        path,
        JSON.stringify({
          pid: 99,
          startedAt: "y",
          command: "theirs",
          token: "other-token",
        }),
      );
      await release();
      assertEquals(readBenchLock(dir)?.token, "other-token");
      Deno.removeSync(path);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("six processes race; exactly one acquires", async () => {
    const dir = await createTempDir("bench-lock-race");
    try {
      const children = Array.from(
        { length: 6 },
        () =>
          new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "--allow-all",
              "tests/fixtures/bench-lock-race-child.ts",
              dir,
            ],
            stdout: "piped",
            stderr: "piped",
          }).output(),
      );
      const outputs = await Promise.all(children);
      const verdicts = outputs.map((o) =>
        new TextDecoder().decode(o.stdout).trim()
      );
      assertEquals(
        verdicts.filter((v) => v === "acquired").length,
        1,
        verdicts.join(","),
      );
      assertEquals(
        verdicts.filter((v) => v === "held").length,
        5,
        verdicts.join(","),
      );
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
