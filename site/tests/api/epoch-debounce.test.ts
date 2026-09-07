import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bumpDataEpoch,
  forceBumpDataEpoch,
  readDataEpoch,
} from "../../src/lib/server/data-epoch";
import { resetDb } from "../utils/reset-db";

/**
 * Writes coalesce into at most one cache invalidation per debounce window.
 *
 * The epoch scheme assumed publishes were rare. During a bench run they are
 * not: every run ingest and every finalize bumped the epoch, and each bump
 * invalidates every cached aggregate in every colo. Measured 2026-09-07, the
 * epoch had reached 559 from 4 five days earlier — 555 global invalidations,
 * driving a day to 90.9% of the D1 read cap while quiet hours sat at 6-45 rows.
 *
 * The invariant these tests pin down is two-sided, and both halves matter:
 *   - a burst of writes must NOT produce a burst of invalidations, and
 *   - no write may be lost — every one becomes visible within the window.
 *
 * Time is driven by writing `pending_since` directly rather than by faking
 * clocks, because the window is evaluated in SQL and in the worker isolate.
 */

const WINDOW_MS = 60_000;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

async function state(): Promise<
  { epoch: number; pending_since: number; last_bump_at: number }
> {
  const row = await env.DB
    .prepare(
      `SELECT epoch, pending_since, last_bump_at FROM cache_epoch WHERE id = 1`,
    )
    .first<{ epoch: number; pending_since: number; last_bump_at: number }>();
  return {
    epoch: row!.epoch,
    pending_since: Number(row!.pending_since),
    last_bump_at: Number(row!.last_bump_at),
  };
}

/** Backdates the pending mark so the debounce window has provably elapsed. */
async function agePendingMark(byMs = WINDOW_MS + 1_000): Promise<void> {
  await env.DB
    .prepare(
      `UPDATE cache_epoch SET pending_since = pending_since - ? WHERE id = 1`,
    )
    .bind(byMs)
    .run();
}

describe("a write marks, it does not bump", () => {
  it("leaves the epoch alone and records a pending mark", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB);
    const after = await state();

    expect(after.epoch, "epoch must not move on the write itself").toBe(
      before.epoch,
    );
    expect(after.pending_since, "write must record a pending mark")
      .toBeGreaterThan(0);
  });

  it("keeps the FIRST mark, so a write stream cannot postpone promotion", async () => {
    await bumpDataEpoch(env.DB);
    const first = await state();
    await bumpDataEpoch(env.DB);
    await bumpDataEpoch(env.DB);
    const later = await state();

    // Taking the latest write instead would push the deadline out forever
    // under continuous ingest, and the batch would never become visible.
    expect(later.pending_since).toBe(first.pending_since);
  });
});

describe("a reader promotes once the window has passed", () => {
  it("does not promote inside the window", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB);

    const token = await readDataEpoch(env.DB);
    expect(token, "still the old epoch inside the window").toBe(
      `e${before.epoch}`,
    );
    expect((await state()).epoch).toBe(before.epoch);
  });

  it("promotes after the window and clears the mark", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB);
    await agePendingMark();

    const token = await readDataEpoch(env.DB);
    expect(token).toBe(`e${before.epoch + 1}`);

    const after = await state();
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.pending_since, "mark cleared on promotion").toBe(0);
    expect(after.last_bump_at, "promotion records its time")
      .toBeGreaterThan(0);
  });

  it("promotes exactly once even with concurrent readers", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB);
    await agePendingMark();

    // The compare-and-set is on the exact pending_since read, so the first
    // writer wins and the rest match zero rows.
    const tokens = await Promise.all([
      readDataEpoch(env.DB),
      readDataEpoch(env.DB),
      readDataEpoch(env.DB),
      readDataEpoch(env.DB),
    ]);

    expect((await state()).epoch, "at most one bump per window").toBe(
      before.epoch + 1,
    );
    // Every reader sees the promoted value, winner or not.
    for (const t of tokens) expect(t).toBe(`e${before.epoch + 1}`);
  });
});

describe("the coalescing actually coalesces", () => {
  it("turns a burst of writes into a single invalidation", async () => {
    const before = await state();

    // Stand-in for a bench batch: many ingests inside one window.
    for (let i = 0; i < 25; i++) await bumpDataEpoch(env.DB);
    expect((await state()).epoch, "no bumps during the burst").toBe(
      before.epoch,
    );

    await agePendingMark();
    await readDataEpoch(env.DB);

    // 25 writes, one invalidation. Before this change it was 25 — which is how
    // the epoch reached 559 in five days.
    expect((await state()).epoch).toBe(before.epoch + 1);
  });

  it("no write is lost: a later write still promotes", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB);
    await agePendingMark();
    await readDataEpoch(env.DB); // promotes to +1, clears the mark

    // A write after the promotion must start a fresh cycle, not be swallowed.
    await bumpDataEpoch(env.DB);
    expect((await state()).pending_since).toBeGreaterThan(0);
    await agePendingMark();
    await readDataEpoch(env.DB);

    expect((await state()).epoch).toBe(before.epoch + 2);
  });
});

describe("force bump bypasses the debounce", () => {
  it("bumps immediately and clears any pending mark", async () => {
    const before = await state();
    await bumpDataEpoch(env.DB); // leaves a pending mark, inside the window
    await forceBumpDataEpoch(env.DB);

    const after = await state();
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.pending_since, "force clears the mark too").toBe(0);
    // And a subsequent read must not double-bump on the cleared mark.
    expect(await readDataEpoch(env.DB)).toBe(`e${before.epoch + 1}`);
  });
});
