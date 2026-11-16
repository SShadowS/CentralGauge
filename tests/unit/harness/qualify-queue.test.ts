import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  CLAIM_STALE_MS,
  claimVariant,
  joinQueue,
  type QueueDeps,
  type QueueOwner,
} from "../../../src/harness/qualify-queue.ts";
import { ConfigurationError } from "../../../src/errors.ts";

const owner = (token: string, over: Partial<QueueOwner> = {}): QueueOwner => ({
  token,
  pid: 4242,
  host: "host-a",
  private_root: `P:/${token}`,
  containers: [`Cronus-${token}`],
  env_fp: "f".repeat(64),
  ...over,
});

/** A clock at `now`, on host-a, where `alive` lists the live PIDs. */
const deps = (now: number, alive: number[] = []): QueueDeps => ({
  now: () => now,
  host: "host-a",
  pidAlive: (pid) => Promise.resolve(alive.includes(pid)),
});

const T0 = Date.parse("2026-11-16T10:00:00Z");

/** Ages the claim of task/variant to `ms` old (as of T0). */
async function age(dir: string, task: string, variant: string, ms: number) {
  const p = join(
    dir,
    "claims",
    `${encodeURIComponent(`${task}/${variant}`)}.json`,
  );
  const t = new Date(T0 - ms);
  await Deno.utime(p, t, t);
}

Deno.test("qualify queue (H-106): two claimers racing over the same variants never get the same one", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const variants = Array.from({ length: 25 }, (_, i) => `naive/v${i}`);
    const d = deps(T0, [4242]);
    const [a, b] = await Promise.all(
      ["A", "B"].map((tok) =>
        Promise.all(
          variants.map((v) => claimVariant(dir, "HX-001", v, owner(tok), d)),
        )
      ),
    );
    for (let i = 0; i < variants.length; i++) {
      assert(
        (a![i] === null) !== (b![i] === null),
        `${variants[i]}: exactly one claimer`,
      );
    }
    // A live claim is never taken again, by anyone.
    for (const v of variants) {
      assertEquals(await claimVariant(dir, "HX-001", v, owner("C"), d), null);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("qualify queue (H-106): a claim older than 10 min whose PID is gone is reclaimed, by exactly one of two reclaimers", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const dead = await claimVariant(
      dir,
      "HX-001",
      "correct",
      owner("A"),
      deps(T0),
    );
    assert(dead);
    await age(dir, "HX-001", "correct", CLAIM_STALE_MS + 60_000);
    const got = await Promise.all(
      ["B", "C"].map((tok) =>
        claimVariant(dir, "HX-001", "correct", owner(tok), deps(T0))
      ),
    );
    assertEquals(got.filter((c) => c !== null).length, 1);
    const winner = got.find((c) => c !== null)!;
    assert(await winner.holds());
    // The dead owner lost it: its token check fails, and its release leaves the new claim.
    assertEquals(await dead.holds(), false);
    await dead.release();
    assert(await winner.holds());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("qualify queue (H-106): a reclaimer that died after its marker never blocks the variant; a live reclaimer's marker does", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assert(await claimVariant(dir, "HX-001", "correct", owner("A"), deps(T0)));
    await age(dir, "HX-001", "correct", CLAIM_STALE_MS + 60_000);
    const claim = join(
      dir,
      "claims",
      `${encodeURIComponent("HX-001/correct")}.json`,
    );
    // Reclaimer R created the marker for A's stale claim, then nothing more.
    const marker = `${claim}.reclaim-A`;
    await Deno.writeTextFile(
      marker,
      JSON.stringify({ v: 1, owner: owner("R", { pid: 7 }) }),
    );
    // R is fresh (under 10 min): it is still reclaiming, leave it.
    await Deno.utime(marker, new Date(T0), new Date(T0));
    assertEquals(
      await claimVariant(dir, "HX-001", "correct", owner("B"), deps(T0)),
      null,
    );
    // R is stale and its PID is gone: B takes over the marker, then the claim.
    const t = new Date(T0 - CLAIM_STALE_MS - 60_000);
    await Deno.utime(marker, t, t);
    const b = await claimVariant(
      dir,
      "HX-001",
      "correct",
      owner("B"),
      deps(T0),
    );
    assert(b);
    assert(await b.holds());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("qualify queue (H-106): a fresh-but-slow claim is not reclaimed (under 10 min, or its PID alive on this host)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assert(await claimVariant(dir, "HX-001", "correct", owner("A"), deps(T0)));
    // 9 min without a heartbeat (a stalled call), PID gone: still fresh.
    await age(dir, "HX-001", "correct", CLAIM_STALE_MS - 60_000);
    assertEquals(
      await claimVariant(dir, "HX-001", "correct", owner("B"), deps(T0)),
      null,
    );
    // 11 min, but the PID still runs on this host: never reclaimed.
    await age(dir, "HX-001", "correct", CLAIM_STALE_MS + 60_000);
    assertEquals(
      await claimVariant(
        dir,
        "HX-001",
        "correct",
        owner("B"),
        deps(T0, [4242]),
      ),
      null,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("qualify queue (H-106): another host's claim is judged by age alone; a heartbeat keeps a claim fresh", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const far = await claimVariant(
      dir,
      "HX-001",
      "correct",
      owner("A", { host: "host-b" }),
      deps(T0),
    );
    assert(far);
    await age(dir, "HX-001", "correct", CLAIM_STALE_MS + 60_000);
    // Its PID number is alive here, but it is another host's PID.
    assert(
      await claimVariant(
        dir,
        "HX-001",
        "correct",
        owner("B"),
        deps(T0, [4242]),
      ),
    );
    const mine = await claimVariant(
      dir,
      "HX-001",
      "naive/a",
      owner("C"),
      deps(T0),
    );
    assert(mine);
    await age(dir, "HX-001", "naive/a", CLAIM_STALE_MS + 60_000);
    await mine.heartbeat();
    // The heartbeat stamps the owner's clock (T0): fresh again.
    assertEquals(
      await claimVariant(dir, "HX-001", "naive/a", owner("D"), deps(T0)),
      null,
    );
    await mine.release();
    assert(await claimVariant(dir, "HX-001", "naive/a", owner("D"), deps(T0)));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("qualify queue (H-106): joining needs the same binding; a different env_fp is refused", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const b = { manifest_sha256: "a".repeat(64), env_fp: "1".repeat(64) };
    const [x, y] = await Promise.all([
      joinQueue(dir, b, T0),
      joinQueue(dir, b, T0),
    ]);
    assertEquals(x.queue_id, y.queue_id);
    const err = await assertRejects(
      () => joinQueue(dir, { ...b, env_fp: "2".repeat(64) }, T0),
      ConfigurationError,
    );
    assert(err.message.includes("env_fp"), err.message);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
