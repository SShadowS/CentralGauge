/**
 * Plan F / Wave 5 quality review — IMPORTANT 4 regression coverage.
 *
 * Two queue endpoints `JSON.parse(r.payload_json)` per row in a tight
 * map without try/catch:
 *
 *   - GET  /api/v1/admin/lifecycle/review/queue
 *   - POST /api/v1/admin/lifecycle/cluster-review/queue
 *
 * Pre-fix a single corrupted `pending_review.payload_json` row crashed
 * the entire queue request (the SyntaxError surfaced as 500
 * internal_error to the operator, blocking the whole review UI).
 *
 * Fix: per-row try/catch. On parse failure surface the row with
 * `payload: null` + `_parse_error: '<msg>'`, console.warn the row id,
 * and serve the rest of the queue normally.
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedModelAndConcept() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
       VALUES (1, 'anthropic', 'anthropic', 'Anthropic')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Claude Opus 4.6', 46)`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'good-slug', 'Good', 'al', 'd', 1, 2)`,
    ),
  ]);
}

async function seedTwoRowsBadPlusGood(): Promise<{
  badId: number;
  goodId: number;
}> {
  await seedModelAndConcept();
  // Need a valid analysis_event_id (FK NOT NULL).
  const ev1 = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: "anthropic/claude-opus-4-6",
    task_set_hash: "h-bad",
    actor: "operator",
    actor_id: null,
    payload: {},
  });
  const ev2 = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: "anthropic/claude-opus-4-6",
    task_set_hash: "h-good",
    actor: "operator",
    actor_id: null,
    payload: {},
  });
  // BAD row: payload_json is broken JSON. Produces SyntaxError on parse.
  const bad = await env.DB.prepare(
    `INSERT INTO pending_review
       (analysis_event_id, model_slug, concept_slug_proposed, payload_json,
        confidence, created_at, status, reviewer_decision_event_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
  )
    .bind(
      ev1.id,
      "anthropic/claude-opus-4-6",
      "bad-slug",
      "{this-is-not-valid-json",
      0.4,
      1700000000000,
    )
    .run();
  // GOOD row: canonical { entry, confidence } shape.
  const good = await env.DB.prepare(
    `INSERT INTO pending_review
       (analysis_event_id, model_slug, concept_slug_proposed, payload_json,
        confidence, created_at, status, reviewer_decision_event_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
  )
    .bind(
      ev2.id,
      "anthropic/claude-opus-4-6",
      "good-slug",
      JSON.stringify({
        entry: {
          concept_slug_proposed: "good-slug",
          al_concept: "x",
          alConcept: "x",
          description: "good description",
          sample_descriptions: ["a"],
          _cluster: {
            proposed_slug: "good-slug",
            nearest_concept_id: 1,
            similarity: 0.5,
            shortcoming_ids: [],
          },
        },
        confidence: { score: 0.5 },
      }),
      0.5,
      1700000000001,
    )
    .run();
  return {
    badId: Number(bad.meta!.last_row_id!),
    goodId: Number(good.meta!.last_row_id!),
  };
}

describe("IMPORTANT 4 — review/queue tolerates bad payload_json per-row", () => {
  it("call the GET handler with a stubbed platform.env to exercise per-row parse robustness", async () => {
    const { badId, goodId } = await seedTwoRowsBadPlusGood();
    // The /review/queue endpoint accepts CF Access JWT only (no signed-body
    // transport for GET). Vitest doesn't have CF_ACCESS_AUD wired, so
    // SELF.fetch via the full worker would 4xx on auth before reaching
    // the parse path. Hook into the auth gate by passing a synthetic CF
    // Access JWT + setting CF_ACCESS_AUD. We synthesize the JWK + JWT
    // exactly as cf-access.test.ts does.
    const {
      __setJwksCacheForTests,
      __resetJwksCacheForTests,
    } = await import("../../src/lib/server/cf-access");
    const KID = "queue-test-kid";
    const AUD = "queue-aud";
    const TEAM = "t.cloudflareaccess.com";
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
    publicJwk.kid = KID;
    publicJwk.alg = "RS256";
    __setJwksCacheForTests([publicJwk]);
    function b64url(buf: ArrayBuffer | Uint8Array): string {
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]!);
      }
      return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(
        /\//g,
        "_",
      );
    }
    const headerB64 = b64url(
      new TextEncoder().encode(
        JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }),
      ),
    );
    const claimsB64 = b64url(
      new TextEncoder().encode(
        JSON.stringify({
          aud: AUD,
          email: "op@example.com",
          sub: "u-1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    );
    const data = new TextEncoder().encode(`${headerB64}.${claimsB64}`);
    const sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      data,
    );
    const jwt = `${headerB64}.${claimsB64}.${b64url(sig)}`;

    try {
      // Import the route module fresh + call its GET directly with an
      // augmented env that has CF_ACCESS_AUD set (the test harness env
      // doesn't carry it).
      const { GET } = await import(
        "../../src/routes/api/v1/admin/lifecycle/review/queue/+server"
      );
      const req = new Request(
        "https://x/api/v1/admin/lifecycle/review/queue",
        {
          method: "GET",
          headers: { "cf-access-jwt-assertion": jwt },
        },
      );
      // deno-lint-ignore no-explicit-any
      const r = await (GET as any)({
        request: req,
        platform: {
          env: {
            ...env,
            CF_ACCESS_AUD: AUD,
            CF_ACCESS_TEAM_DOMAIN: TEAM,
          },
        },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        entries: Array<{
          id: number;
          payload: unknown;
          _parse_error?: string;
        }>;
        count: number;
      };
      expect(body.count).toBe(2);
      const badRow = body.entries.find((e) => e.id === badId);
      const goodRow = body.entries.find((e) => e.id === goodId);
      expect(badRow).toBeTruthy();
      expect(badRow!.payload).toBeNull();
      expect(typeof badRow!._parse_error).toBe("string");
      expect(goodRow).toBeTruthy();
      expect(goodRow!.payload).toBeTruthy();
      expect(goodRow!._parse_error).toBeUndefined();
    } finally {
      __resetJwksCacheForTests();
    }
  });
});

describe("IMPORTANT 4 — cluster-review/queue tolerates bad payload_json per-row", () => {
  it("does NOT 500 the whole queue when one row has malformed payload_json", async () => {
    const { badId, goodId } = await seedTwoRowsBadPlusGood();
    const { keyId, keypair } = await registerMachineKey(
      "cluster-bad-row",
      "admin",
    );
    const payload = { scope: "list", ts: 1700000000000 };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const r = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/cluster-review/queue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      rows: Array<{
        id: number;
        payload: Record<string, unknown> | null;
        _parse_error?: string;
      }>;
    };
    const badRow = body.rows.find((r) => r.id === badId);
    const goodRow = body.rows.find((r) => r.id === goodId);
    expect(badRow).toBeTruthy();
    expect(badRow!.payload).toBeNull();
    expect(typeof badRow!._parse_error).toBe("string");
    expect(goodRow).toBeTruthy();
    expect(goodRow!.payload).toBeTruthy();
    expect(goodRow!._parse_error).toBeUndefined();
  });
});
