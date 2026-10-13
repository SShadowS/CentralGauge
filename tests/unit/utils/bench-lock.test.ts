import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  acquireBenchLock,
  BENCH_LOCK_FILENAME,
  BenchLockHeldError,
  benchLockLost,
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

// M10-08c review 4: a holder suspended past the stale window learns that
// another process reclaimed its lock (the heartbeat alone only stops quietly).
Deno.test("benchLockLost: false while the marker carries our token, true once another process reclaimed it; refuses without a marker", async () => {
  const dir = await createTempDir("bench-lock-lost");
  try {
    assertThrows(() => benchLockLost(dir), Error, "no lock");
    const release = acquireBenchLock(dir, { command: "ours" });
    const lost = benchLockLost(dir);
    assertFalse(lost());
    const old = new Date(Date.now() - 121_000);
    Deno.utimeSync(benchLockPath(dir), old, old);
    assertFalse(lost(), "stale but not reclaimed: still ours");
    const other = tryAcquireBenchLock(dir, { command: "reclaimer" });
    assert(other.acquired, "the stale lock is reclaimed");
    assert(lost(), "reclaimed: lost");
    await release();
    assertEquals(readBenchLock(dir)?.command, "reclaimer");
    if (other.acquired) await other.release();
  } finally {
    await cleanupTempDir(dir);
  }
});

// M10-08c run 002 item 3: stale reclamation is exclusive. The interleavings
// are forced by hooking the marker's own stat (a reclaimer's look) or remove
// (a release's act): the competing step lands exactly between look and act.
const staleMarker = (dir: string, token: string) => {
  const path = benchLockPath(dir);
  Deno.writeTextFileSync(
    path,
    JSON.stringify({ pid: 1, startedAt: "x", command: token, token }),
  );
  const past = new Date(Date.now() - 10 * 60_000);
  Deno.utimeSync(path, past, past);
};

/** Run `between` once, right after the first stat of `path` (the result predates it). */
const afterFirstStat = (path: string, between: () => void) => {
  const stat = Deno.statSync;
  let armed = true;
  Object.defineProperty(Deno, "statSync", {
    configurable: true,
    writable: true,
    value: (p: string | URL) => {
      const r = stat(p);
      if (armed && String(p) === path) {
        armed = false;
        between();
      }
      return r;
    },
  });
  return () =>
    Object.defineProperty(Deno, "statSync", {
      configurable: true,
      writable: true,
      value: stat,
    });
};

Deno.test("bench-lock (M10-08c run 002 item 3): two reclaimers of one stale marker never both acquire; the marker is the winner's", async () => {
  const dir = await createTempDir("bench-lock-reclaim-race");
  try {
    staleMarker(dir, "dead-token");
    let first: ReturnType<typeof tryAcquireBenchLock> | null = null;
    const restore = afterFirstStat(benchLockPath(dir), () => {
      // B saw the stale marker; A reclaims it completely before B acts.
      first = tryAcquireBenchLock(dir, { command: "A" });
    });
    let second: ReturnType<typeof tryAcquireBenchLock>;
    try {
      second = tryAcquireBenchLock(dir, { command: "B" });
    } finally {
      restore();
    }
    const a = first as ReturnType<typeof tryAcquireBenchLock> | null;
    assert(a?.acquired, "A reclaimed the stale marker");
    assertFalse(second.acquired, "B must not take A's fresh marker");
    assertEquals(readBenchLock(dir)?.command, "A");
    await a.release();
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("bench-lock (M10-08c run 002 item 3): a heartbeat landing between a reclaimer's look and its act keeps the holder's lock", async () => {
  const dir = await createTempDir("bench-lock-heartbeat-race");
  try {
    const path = benchLockPath(dir);
    const holder = tryAcquireBenchLock(dir, { command: "holder" });
    assert(holder.acquired);
    const lost = benchLockLost(dir);
    const past = new Date(Date.now() - 10 * 60_000);
    Deno.utimeSync(path, past, past);
    const restore = afterFirstStat(path, () => {
      // The suspended holder resumes and its heartbeat renews the marker.
      const now = new Date();
      Deno.utimeSync(path, now, now);
    });
    let other: ReturnType<typeof tryAcquireBenchLock>;
    try {
      other = tryAcquireBenchLock(dir, { command: "reclaimer" });
    } finally {
      restore();
    }
    assertFalse(other.acquired, "a renewed marker is live, never reclaimed");
    assertEquals(readBenchLock(dir)?.token, holder.token);
    assertFalse(lost(), "the holder still holds");
    await holder.release();
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("bench-lock (M10-08c run 002 item 3): a release racing another process's reclaim never removes the reclaimer's marker", async () => {
  const dir = await createTempDir("bench-lock-release-race");
  try {
    const path = benchLockPath(dir);
    const holder = tryAcquireBenchLock(dir, { command: "holder" });
    assert(holder.acquired);
    const past = new Date(Date.now() - 10 * 60_000);
    Deno.utimeSync(path, past, past);
    const remove = Deno.removeSync;
    let child: Deno.ChildProcess | null = null;
    Object.defineProperty(Deno, "removeSync", {
      configurable: true,
      writable: true,
      value: (p: string | URL, o?: Deno.RemoveOptions) => {
        if (child === null && String(p) === path) {
          // The release checked its token; another process reclaims now. It
          // gets up to 5 s to finish before the release acts.
          child = new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "--allow-all",
              "tests/fixtures/bench-lock-race-child.ts",
              dir,
            ],
            stdout: "piped",
            stderr: "piped",
          }).spawn();
          const until = Date.now() + 5_000;
          const reclaimed = () => {
            const t = readBenchLock(dir)?.token;
            return t !== undefined && t !== holder.token;
          };
          while (!reclaimed() && Date.now() < until) {
            // busy wait: the release is synchronous
          }
        }
        return remove(p, o);
      },
    });
    try {
      await holder.release();
    } finally {
      Object.defineProperty(Deno, "removeSync", {
        configurable: true,
        writable: true,
        value: remove,
      });
    }
    const c = child as Deno.ChildProcess | null;
    assert(c, "the release reached the marker");
    const out = await c.output();
    assertEquals(new TextDecoder().decode(out.stdout).trim(), "acquired");
    const now = readBenchLock(dir);
    assert(now, "the reclaimer's marker survives the release");
    assert(now.token !== holder.token);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("bench-lock (M10-08c run 002 item 3): acquireBenchLock's lost() checks the token this acquisition took, never a later holder's", async () => {
  const dir = await createTempDir("bench-lock-own-token");
  try {
    const held = acquireBenchLock(dir, { command: "ours" });
    const lost = (held as { lost?: () => boolean }).lost;
    assert(lost, "the acquisition carries its own ownership check");
    assertFalse(lost());
    staleMarker(dir, "reclaimer-token");
    assert(lost(), "another token: lost");
    assert(
      benchLockLost(dir, readBenchLock(dir)!.token)() === false,
      "an explicit token is the one checked",
    );
    await held();
    assertEquals(readBenchLock(dir)?.token, "reclaimer-token");
  } finally {
    await cleanupTempDir(dir);
  }
});
