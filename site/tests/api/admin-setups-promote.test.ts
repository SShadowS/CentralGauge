import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { bytesToB64 } from "../../src/lib/shared/base64";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { sign } from "../../src/lib/shared/ed25519";

const BASE = "https://x/api/v1/admin/setups";
const HASH_A = "a".repeat(64);
const HASH_B = "d".repeat(64);
const SHA = "c".repeat(64);

let keyId: number;
let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

async function signed(path: string, payload: unknown) {
  const signedAt = new Date().toISOString();
  const message = canonicalJSON({ payload, path, signed_at: signedAt });
  const value = bytesToB64(
    await sign(new TextEncoder().encode(message), keypair.privateKey),
  );
  return {
    signature: { alg: "Ed25519", key_id: keyId, signed_at: signedAt, value },
    payload,
  };
}

const post = (url: string, body: unknown) =>
  SELF.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const promote = async (hash: string) =>
  post(
    `${BASE}/task-sets/promote`,
    await signed("/api/v1/admin/setups/task-sets/promote", { hash }),
  );

function publishPayload(hash: string, setupId: string) {
  return {
    setup: {
      id: setupId,
      agent_tool: "claude-code",
      base_model: "claude-opus-5",
      description: "Published setup",
      visibility: "public",
      roles: [{ role: "main", model: "claude-opus-5", effort: null }],
      ingredients: {
        instructions: null,
        rules: [],
        settings: null,
        skills: [],
        mcp: [],
        hooks: [],
      },
    },
    submission_id: null,
    task_set: {
      hash,
      display_name: `HX set ${hash.slice(0, 8)}`,
      tasks: [{ task_id: "t1", description_sha: SHA }],
    },
    run: {
      id: `run-${setupId}`,
      tool_version: "1.0.0",
      score: 0.5,
      cost_per_solved_usd: 0.4,
      price_note: null,
      excluded_cells: 0,
      repeats: 1,
      cells: [
        { task_id: "t1", repeat: 1, outcome: "pass", cost_usd: 0.1, duration_ms: 1 },
      ],
    },
  };
}

const currentHashes = async () =>
  (await env.DB.prepare(
    "SELECT hash FROM setup_task_sets WHERE is_current = 1",
  ).all<{ hash: string }>()).results.map((r) => r.hash);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ keyId, keypair } = await registerMachineKey("cli", "admin"));
  for (const [h, id] of [[HASH_A, "setup-a"], [HASH_B, "setup-b"]]) {
    const r = await post(
      `${BASE}/publish`,
      await signed("/api/v1/admin/setups/publish", publishPayload(h, id)),
    );
    expect(r.status).toBe(201);
  }
});

describe("POST /api/v1/admin/setups/task-sets/promote", () => {
  it("rejects unsigned calls", async () => {
    const r = await post(`${BASE}/task-sets/promote`, { hash: HASH_A });
    expect(r.status).toBe(401);
  });

  it("returns 404 for an unknown hash and changes nothing", async () => {
    const before = await currentHashes();
    const r = await promote("e".repeat(64));
    expect(r.status).toBe(404);
    expect(((await r.json()) as { code: string }).code).toBe("not_found");
    expect(await currentHashes()).toEqual(before);
  });

  it("keeps exactly one current set across promotes and serves its ranking", async () => {
    let r = await promote(HASH_A);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { hash: string; promoted_at: string };
    expect(body.hash).toBe(HASH_A);
    expect(body.promoted_at).toBeTruthy();
    expect(await currentHashes()).toEqual([HASH_A]);

    r = await promote(HASH_B);
    expect(r.status).toBe(200);
    expect(await currentHashes()).toEqual([HASH_B]);

    const list = (await (await SELF.fetch("https://x/api/v1/setups")).json()) as {
      task_set: { hash: string } | null;
      rows: { setup_id?: string; id?: string }[];
    };
    expect(list.task_set?.hash).toBe(HASH_B);
    expect(JSON.stringify(list.rows)).toContain("setup-b");
    expect(JSON.stringify(list.rows)).not.toContain("setup-a");
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM admin_audit WHERE event = 'setup_task_set.promoted'",
      ).first<{ n: number }>())!.n,
    ).toBe(2);
  });
});
