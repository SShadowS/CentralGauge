import { assertEquals } from "@std/assert";
import { acquireLock } from "../../../src/container/folder-lock.ts";

Deno.test("acquireLock takes a free lock and releases it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-" });
  try {
    const lock = await acquireLock(`${dir}/a.lock`);
    assertEquals(lock.acquired, true);
    await lock.release();
    // Released means re-acquirable.
    const again = await acquireLock(`${dir}/a.lock`);
    assertEquals(again.acquired, true);
    await again.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("acquireLock times out when the lock is held by a live process", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-busy-" });
  try {
    const held = await acquireLock(`${dir}/b.lock`);
    assertEquals(held.acquired, true);
    // staleMs high so the live holder is never considered stale.
    const second = await acquireLock(`${dir}/b.lock`, {
      timeoutMs: 150,
      staleMs: 60_000,
    });
    // Not acquired — but the caller still proceeds, so this must not throw.
    assertEquals(second.acquired, false);
    await held.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("acquireLock breaks a stale lock", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-stale-" });
  try {
    // A lock file from a process that died without releasing.
    await Deno.writeTextFile(
      `${dir}/c.lock`,
      JSON.stringify({ pid: 999999, at: new Date(0).toISOString() }),
    );
    const lock = await acquireLock(`${dir}/c.lock`, {
      timeoutMs: 2000,
      staleMs: 1,
    });
    assertEquals(lock.acquired, true);
    await lock.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("release is safe to call twice", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lock-rel-" });
  try {
    const lock = await acquireLock(`${dir}/d.lock`);
    await lock.release();
    await lock.release();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
