import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  MutateLockHeldError,
  withMutateLock,
} from "../../../src/batch/mutate-lock.ts";
import { RUN_FILES } from "../../../src/batch/paths.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("withMutateLock rejects a nested call, then succeeds again once released", async () => {
  const dir = await createTempDir("mutate-lock");
  try {
    let innerRan = false;
    await withMutateLock(dir, async () => {
      await assertRejects(
        () =>
          withMutateLock(dir, () => {
            innerRan = true;
            return Promise.resolve();
          }),
        MutateLockHeldError,
      );
    });
    assertEquals(innerRan, false);

    let outerRan = false;
    await withMutateLock(dir, () => {
      outerRan = true;
      return Promise.resolve();
    });
    assertEquals(outerRan, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("withMutateLock reclaims a stale lock", async () => {
  const dir = await createTempDir("mutate-lock-stale");
  try {
    const lockPath = join(dir, RUN_FILES.mutateLock);
    await Deno.writeTextFile(lockPath, "stale");
    const staleTime = new Date(Date.now() - 20 * 60 * 1000);
    await Deno.utime(lockPath, staleTime, staleTime);

    let ran = false;
    await withMutateLock(dir, () => {
      ran = true;
      return Promise.resolve();
    });
    assertEquals(ran, true);

    // The reclaimed lock is released again once the run completes.
    const exists = await Deno.stat(lockPath).then(() => true).catch(() =>
      false
    );
    assertEquals(exists, false);
  } finally {
    await cleanupTempDir(dir);
  }
});
