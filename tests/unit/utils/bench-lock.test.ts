import { assert, assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";
import {
  acquireBenchLock,
  BENCH_LOCK_FILENAME,
  benchLockPath,
  isBenchRunning,
  readBenchLock,
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
});
