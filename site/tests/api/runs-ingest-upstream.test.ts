import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import {
  makeRunPayload,
  registerIngestKey,
  seedMinimalRefData,
} from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import type { ResultInput, SignedRunPayload } from "../../src/lib/shared/types";

type RunPayload = SignedRunPayload["payload"];

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
});

async function post(payload: RunPayload, runId: string): Promise<Response> {
  const { keyId, keypair } = await registerIngestKey();
  const { signedRequest } = await createSignedPayload(
    payload as unknown as Record<string, unknown>,
    keyId,
    undefined,
    keypair,
  );
  signedRequest.signature.key_id = keyId;
  signedRequest.run_id = runId;
  return SELF.fetch("http://x/api/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
}

const orResult = (over: Record<string, unknown> = {}): ResultInput => ({
  ...makeRunPayload().results[0]!,
  requested_upstream: "novita/fp8",
  served_upstream: "Novita",
  served_upstream_model: "v1",
  upstream_identity_source: "both",
  upstream_verification: "verified",
  ...over,
});

const orPayload = (over: Partial<RunPayload> = {}): RunPayload =>
  makeRunPayload({
    invocation_mode: "batch",
    invocation: { upstream_pin: "novita/fp8", invocation_schema: 2 },
    results: [orResult()],
    ...over,
  });

describe("POST /api/v1/runs upstream lock", () => {
  it("stores the five fields and claims an <upstream slug> profile", async () => {
    const res = await post(orPayload(), "r-up-1");
    expect(res.status).toBe(202);
    const row = await env.DB.prepare(
      `SELECT requested_upstream, served_upstream, served_upstream_model, upstream_identity_source, upstream_verification FROM results WHERE run_id = ?`,
    ).bind("r-up-1").first();
    expect(row).toMatchObject({
      requested_upstream: "novita/fp8",
      served_upstream: "Novita",
      served_upstream_model: "v1",
      upstream_identity_source: "both",
      upstream_verification: "verified",
    });
    const prof = await env.DB.prepare(
      `SELECT profile_key FROM upstream_profiles`,
    ).first<{ profile_key: string }>();
    expect(prof?.profile_key).toBe("novita/fp8");
  });

  it("claims <unpinned> for a payload without a pin and stamps not_applicable rows explicitly", async () => {
    const res = await post(
      makeRunPayload({
        results: [{
          ...makeRunPayload().results[0]!,
          upstream_verification: "not_applicable",
        }],
      }),
      "r-up-2",
    );
    expect(res.status).toBe(202);
    const prof = await env.DB.prepare(
      `SELECT profile_key FROM upstream_profiles`,
    ).first<{ profile_key: string }>();
    expect(prof?.profile_key).toBe("<unpinned>");
    const v = await env.DB.prepare(
      `SELECT upstream_verification FROM results WHERE run_id = ?`,
    ).bind("r-up-2").first<{ upstream_verification: string }>();
    expect(v?.upstream_verification).toBe("not_applicable");
  });

  it("refuses a second profile for the same model, set and mode with 409 naming the runs", async () => {
    expect((await post(orPayload(), "r-a")).status).toBe(202);
    const res = await post(
      orPayload({
        invocation: { upstream_pin: "together", invocation_schema: 2 },
        results: [
          orResult({
            requested_upstream: "together",
            served_upstream: "Together",
          }),
        ],
      }),
      "r-b",
    );
    expect(res.status).toBe(409);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("upstream_profile_conflict");
    expect(body.error).toContain("novita/fp8");
    expect(body.error).toContain("r-a");
    const gone = await env.DB.prepare(`SELECT id FROM runs WHERE id = ?`)
      .bind("r-b").first();
    expect(gone).toBeNull();
    const orphans = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM results WHERE run_id = ?`,
    ).bind("r-b").first<{ n: number }>();
    expect(Number(orphans?.n)).toBe(0);
  });

  it("answers a replayed run id before any profile logic", async () => {
    expect((await post(orPayload(), "r-rep")).status).toBe(202);
    const again = await post(
      orPayload({
        invocation: { upstream_pin: "together", invocation_schema: 2 },
      }),
      "r-rep",
    );
    expect(again.status).toBe(200);
    expect((await again.json<{ status: string }>()).status).toBe("exists");
  });

  it("stores a compromised run already excluded, with code, reason and audit, in one batch", async () => {
    const res = await post(
      orPayload({
        results: [
          orResult(),
          orResult({
            task_id: "easy/task-2",
            served_upstream: "Together",
            upstream_verification: "mismatch",
            passed: false,
            score: 0,
          }),
        ],
        excluded: {
          code: "upstream_mismatch",
          reason: "upstream mismatch on 1 attempt",
          attempts: [{ task_id: "easy/task-2", attempt: 1 }],
        },
      }),
      "r-comp",
    );
    expect(res.status).toBe(202);
    const run = await env.DB.prepare(
      `SELECT excluded_at, excluded_code, excluded_reason FROM runs WHERE id = ?`,
    ).bind("r-comp").first<{
      excluded_at: string | null;
      excluded_code: string | null;
      excluded_reason: string | null;
    }>();
    expect(run?.excluded_at).toBeTruthy();
    expect(run?.excluded_code).toBe("upstream_mismatch");
    const audit = await env.DB.prepare(
      `SELECT event, details_json FROM admin_audit WHERE event = 'run.auto_excluded' ORDER BY id DESC LIMIT 1`,
    ).first<{ event: string; details_json: string }>();
    expect(JSON.parse(audit!.details_json)).toMatchObject({
      run_id: "r-comp",
      code: "upstream_mismatch",
      attempts: [{ task_id: "easy/task-2", attempt: 1 }],
    });
    // An excluded run does not hold the profile.
    const prof = await env.DB.prepare(
      `SELECT profile_key FROM upstream_profiles`,
    ).first();
    expect(prof).toBeNull();
  });

  it("rejects an exclusion whose named attempt is not compromised in the payload", async () => {
    const res = await post(
      orPayload({
        excluded: {
          code: "upstream_mismatch",
          reason: "x",
          attempts: [{ task_id: "easy/task-1", attempt: 1 }],
        },
      }),
      "r-badx",
    );
    expect(res.status).toBe(400);
    expect((await res.json<{ code: string }>()).code).toBe("invalid_exclusion");
  });

  it("rejects relational violations", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { requested_upstream: null, upstream_verification: "verified" },
        "verified requires a requested_upstream",
      ],
      [
        { upstream_verification: "unpinned" },
        "unpinned requires a null requested_upstream",
      ],
      [
        { served_upstream: null, upstream_verification: "verified" },
        "verified requires a served_upstream",
      ],
      [
        { upstream_verification: "bogus" },
        "upstream_verification must be one of",
      ],
      [{ requested_upstream: "together" }, "must equal the run's upstream_pin"],
    ];
    let n = 0;
    for (const [over, msg] of cases) {
      const res = await post(
        orPayload({ results: [orResult(over)] }),
        `r-rel-${n++}`,
      );
      expect(res.status, msg).toBe(400);
      const body = await res.json<{ code: string; error: string }>();
      expect(body.code).toBe("invalid_upstream");
      expect(body.error).toContain(msg.split(" ")[0]!);
    }
  });

  it("two concurrent first ingests with different pins leave exactly one profile and one run", async () => {
    const [a, b] = await Promise.all([
      post(orPayload(), "r-race-a"),
      post(
        orPayload({
          invocation: { upstream_pin: "together", invocation_schema: 2 },
          results: [
            orResult({
              requested_upstream: "together",
              served_upstream: "Together",
            }),
          ],
        }),
        "r-race-b",
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const n = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM upstream_profiles`,
    ).first<{ n: number }>();
    expect(Number(n?.n)).toBe(1);
    const runs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs`)
      .first<{ n: number }>();
    expect(Number(runs?.n)).toBe(1);
  });
});
