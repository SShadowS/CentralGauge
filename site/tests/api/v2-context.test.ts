import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import { HASH, seedSet, smallCatalog } from "../fixtures/taxonomy-v2";
import { applyRevision } from "../../src/lib/server/taxonomy-v2";
import { resolveV2Context } from "../../src/lib/server/v2-context";
import { ApiError } from "../../src/lib/server/errors";
import { normalizeCatalog } from "../../src/lib/shared/taxonomy-schema";

const actor = { key_id: 1, machine_id: "m", scope: "admin" as const };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await seedSet();
});

// ApiError's .message carries the human-readable text, not the code
// (matching every other ApiError call site in this codebase, e.g.
// taxonomy-v2-activate.test.ts) - so error-path assertions below check
// .code via try/catch, not a toThrow() regex against .message.
async function catchCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).code;
  }
  throw new Error("expected promise to reject");
}

describe("resolveV2Context", () => {
  it("404s without an active revision, resolves current by default, and honours ?set and ?revision", async () => {
    expect(
      await catchCode(
        resolveV2Context(env.DB, new URL("https://x/api/v2/taxonomy")),
      ),
    ).toBe("no_active_revision");

    const r = await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });
    const ctx = await resolveV2Context(
      env.DB,
      new URL("https://x/api/v2/taxonomy"),
    );
    expect(ctx.task_set_hash).toBe(HASH);
    expect(ctx.revision.digest).toBe(r.digest);
    expect(ctx.scoring_policy).toBeNull();

    const byHash = await resolveV2Context(
      env.DB,
      new URL(`https://x/api/v2/taxonomy?set=${HASH}&revision=${r.digest}`),
    );
    expect(byHash.revision.id).toBe(r.revisionId);

    expect(
      await catchCode(
        resolveV2Context(
          env.DB,
          new URL(`https://x/api/v2/taxonomy?revision=${"f".repeat(64)}`),
        ),
      ),
    ).toBe("no_revision");
  });

  it("rejects a set that is neither 'current' nor a 64-hex hash", async () => {
    expect(
      await catchCode(
        resolveV2Context(env.DB, new URL("https://x/api/v2/taxonomy?set=nope")),
      ),
    ).toBe("invalid_set");
  });

  it("404s set=current when no task_set is current", async () => {
    await env.DB.prepare(`UPDATE task_sets SET is_current = 0`).run();
    expect(
      await catchCode(
        resolveV2Context(env.DB, new URL("https://x/api/v2/taxonomy")),
      ),
    ).toBe("no_current_task_set");
  });

  it("resolves the scoring policy joined through task_sets.scoring_policy_id", async () => {
    await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO scoring_policies(id, schema_version, digest, policy_json, created_at) VALUES (1, 1, ?, ?, 't')`,
      ).bind("p".repeat(64), JSON.stringify({ weight: 1 })),
      env.DB.prepare(
        `UPDATE task_sets SET scoring_policy_id = 1 WHERE hash = ?`,
      ).bind(HASH),
    ]);
    const ctx = await resolveV2Context(
      env.DB,
      new URL("https://x/api/v2/taxonomy"),
    );
    expect(ctx.scoring_policy).toEqual({
      id: 1,
      digest: "p".repeat(64),
      policy: { weight: 1 },
    });
  });

  it("drops underscore-prefixed query params from ctx.query", async () => {
    await applyRevision(env.DB, {
      hash: HASH,
      normalized: normalizeCatalog(smallCatalog(), HASH),
      provenance: {},
      actor,
      signature: "s",
    });
    const ctx = await resolveV2Context(
      env.DB,
      new URL("https://x/api/v2/taxonomy?family=mechanism&_cb=123"),
    );
    expect(ctx.query).toEqual({ family: "mechanism" });
  });
});
