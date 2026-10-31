import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { bytesToB64 } from "../../src/lib/shared/base64";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { sign } from "../../src/lib/shared/ed25519";
import { sealKey } from "../../src/lib/server/submission-crypto";
import type { SetupPublishPayload } from "../../src/lib/shared/setup-publish";

const URL_ = "https://x/api/v1/admin/setups/publish";
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const HASH = "b".repeat(64);
const SHA = "c".repeat(64);

let keyId: number;
let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

async function signed(payload: unknown) {
  const signedAt = new Date().toISOString();
  const message = canonicalJSON({
    payload,
    path: new URL(URL_).pathname,
    signed_at: signedAt,
  });
  const value = bytesToB64(
    await sign(new TextEncoder().encode(message), keypair.privateKey),
  );
  return {
    signature: { alg: "Ed25519", key_id: keyId, signed_at: signedAt, value },
    payload,
  };
}

const post = (body: unknown) =>
  SELF.fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function payload(over: Partial<SetupPublishPayload> & {
  runId?: string;
  setupId?: string;
} = {}): SetupPublishPayload {
  return {
    setup: {
      id: over.setupId ?? "pub-setup",
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
      hash: HASH,
      display_name: "HX set bbbbbbbb",
      tasks: [
        { task_id: "t1", description_sha: SHA },
        { task_id: "t2", description_sha: SHA },
      ],
    },
    run: {
      id: over.runId ?? "camp1:arm-a",
      tool_version: "1.2.3",
      score: 0.75,
      cost_per_solved_usd: 0.4,
      price_note: null,
      excluded_cells: 0,
      repeats: 2,
      cells: [1, 2].flatMap((repeat) => [
        {
          task_id: "t1",
          repeat,
          outcome: "pass" as const,
          cost_usd: 0.1,
          duration_ms: 1000,
        },
        {
          task_id: "t2",
          repeat,
          outcome: repeat === 1 ? ("pass" as const) : ("fail" as const),
          cost_usd: null,
          duration_ms: null,
        },
      ]),
    },
    ...over,
  } as SetupPublishPayload;
}

const count = async (sql: string, ...b: unknown[]) =>
  (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

async function seedSubmission(id: string, status: "new" | "approved") {
  const sealed = await sealKey("sk-plain", SECRET);
  await env.DB.prepare(
    `INSERT INTO setup_submissions (id, created_at, ip_hash, agent_tool, base_model,
       description, visibility, instructions_name, instructions_md, roles_json, flow,
       zip_key, zip_bytes, zip_sha256, key_ciphertext, key_iv, key_expires_on,
       edit_token_hash, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      "2026-10-01T00:00:00.000Z",
      "ip",
      "claude-code",
      "claude-opus-5",
      "From submission",
      "private",
      "CLAUDE.md",
      "# i",
      JSON.stringify([{ role: "sub", model: "m", effort: null }]),
      "the flow",
      `submissions/${id}.zip`,
      1,
      "sha",
      sealed.ciphertext,
      sealed.iv,
      "2099-01-01",
      "th",
      status,
      "2026-10-01T00:00:00.000Z",
    )
    .run();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ keyId, keypair } = await registerMachineKey("cli", "admin"));
  await seedSubmission("sub-ok", "approved");
  await seedSubmission("sub-new", "new");
});

describe("POST /api/v1/admin/setups/publish", () => {
  it("rejects unsigned calls", async () => {
    const r = await post(payload());
    expect([401, 403]).toContain(r.status);
  });

  it("publishes a run with cells, tasks and a non-current task set", async () => {
    const before = await env.DB.prepare(
      "SELECT epoch FROM data_epoch WHERE id = 1",
    ).first<{ epoch: number }>().catch(() => null);
    const r = await post(await signed(payload()));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      run_id: "camp1:arm-a",
      setup_id: "pub-setup",
      task_set_hash: HASH,
    });
    expect(await count("SELECT COUNT(*) n FROM setup_runs")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM setup_cells")).toBe(4);
    expect(await count("SELECT COUNT(*) n FROM hx_tasks")).toBe(2);
    expect(
      await count(
        "SELECT COUNT(*) n FROM setup_task_sets WHERE hash = ? AND is_current = 0",
        HASH,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) n FROM admin_audit WHERE event = 'setup.published'",
      ),
    ).toBe(1);
    if (before) {
      const after = await env.DB.prepare(
        "SELECT epoch FROM data_epoch WHERE id = 1",
      ).first<{ epoch: number }>();
      expect(after!.epoch).toBeGreaterThan(before.epoch);
    }
  });

  it("refuses a second publish of the same run id and leaves counts alone", async () => {
    const r = await post(await signed(payload()));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe(
      "already_published",
    );
    expect(await count("SELECT COUNT(*) n FROM setup_runs")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM setup_cells")).toBe(4);
  });

  it("returns 400 invalid_publish for a bad payload", async () => {
    const p = payload({ runId: "camp1:bad" });
    p.run.score = 2;
    const r = await post(await signed(p));
    expect(r.status).toBe(400);
    const body = (await r.json()) as {
      code: string; details: string[];
    };
    expect(body.code).toBe("invalid_publish");
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("lists the setup in the ranking with the published score", async () => {
    const r = await SELF.fetch(`https://x/api/v1/setups?set=${HASH}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      rows: { id: string; score: number }[];
    };
    const row = body.rows.find((x) => x.id === "pub-setup");
    expect(row?.score).toBe(0.75);
  });

  it("links an approved submission, deletes its key and takes its fields", async () => {
    const p = payload({ runId: "camp2:arm-b", setupId: "from-sub" });
    p.submission_id = "sub-ok";
    p.setup.description = null;
    p.setup.visibility = null;
    const r = await post(await signed(p));
    expect(r.status).toBe(201);
    const sub = await env.DB.prepare(
      "SELECT setup_id, key_ciphertext, key_iv, key_deleted_at FROM setup_submissions WHERE id = 'sub-ok'",
    ).first<Record<string, unknown>>();
    expect(sub!.setup_id).toBe("from-sub");
    expect(sub!.key_ciphertext).toBeNull();
    expect(sub!.key_iv).toBeNull();
    expect(sub!.key_deleted_at).not.toBeNull();
    const s = await env.DB.prepare(
      "SELECT description, visibility, flow, roles_json FROM setups WHERE id = 'from-sub'",
    ).first<Record<string, string>>();
    expect(s!.description).toBe("From submission");
    expect(s!.visibility).toBe("private");
    expect(s!.flow).toBe("the flow");
    expect(JSON.parse(s!.roles_json)[0].role).toBe("sub");
  });

  it("refuses a submission that is not approved", async () => {
    const p = payload({ runId: "camp3:arm-c", setupId: "from-new" });
    p.submission_id = "sub-new";
    const r = await post(await signed(p));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe(
      "submission_not_approved",
    );
    expect(await count("SELECT COUNT(*) n FROM setups WHERE id = 'from-new'")).toBe(0);
  });

  it("returns 404 for an unknown submission", async () => {
    const p = payload({ runId: "camp4:arm-d", setupId: "from-none" });
    p.submission_id = "nope";
    const r = await post(await signed(p));
    expect(r.status).toBe(404);
  });
});
