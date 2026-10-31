import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { sealKey } from "../../src/lib/server/submission-crypto";

const BASE = "https://x/api/v1/admin/setup-submissions";
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 9, 8, 7]);
const PLAINTEXT = "sk-test-plaintext-key";

async function seed(id: string, createdAt: string, withKey = true) {
  const sealed = await sealKey(PLAINTEXT, SECRET);
  await env.DB.prepare(
    `INSERT INTO setup_submissions (id, created_at, ip_hash, agent_tool, base_model,
       description, visibility, instructions_name, instructions_md, roles_json, flow,
       zip_key, zip_bytes, zip_sha256, key_ciphertext, key_iv, key_expires_on,
       edit_token_hash, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      createdAt,
      "iphash",
      "claude-code",
      "claude-opus-5",
      "desc " + id,
      "public",
      "CLAUDE.md",
      "# secret instructions",
      "[]",
      null,
      `submissions/${id}.zip`,
      ZIP.length,
      "sha",
      withKey ? sealed.ciphertext : null,
      withKey ? sealed.iv : null,
      withKey ? "2099-01-01" : null,
      "tokenhash",
      createdAt,
    )
    .run();
}

let keyId: number;
let keypair: Awaited<ReturnType<typeof registerMachineKey>>["keypair"];

async function call(path: string, payload: Record<string, unknown> = {}) {
  const { signedRequest } = await createSignedPayload(
    payload,
    keyId,
    undefined,
    keypair,
  );
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedRequest),
  });
}

const audits = async (event: string) =>
  (
    await env.DB.prepare("SELECT details_json FROM admin_audit WHERE event = ?")
      .bind(event)
      .all<{ details_json: string }>()
  ).results;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ({ keyId, keypair } = await registerMachineKey("cli", "admin"));
  await seed("sub-a", "2026-10-01T00:00:00.000Z");
  await seed("sub-b", "2026-10-02T00:00:00.000Z");
  await seed("sub-c", "2026-10-03T00:00:00.000Z");
  await seed("sub-d", "2026-10-04T00:00:00.000Z");
  await env.BLOBS.put("submissions/sub-a.zip", ZIP);
});

describe("admin setup-submissions", () => {
  it("rejects unsigned calls", async () => {
    const r = await SELF.fetch(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect([401, 403]).toContain(r.status);
  });

  it("lists newest first without key or instructions fields", async () => {
    const r = await call("");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { submissions } = (await r.json()) as {
      submissions: Record<string, unknown>[];
    };
    expect(submissions.map((s) => s.id)).toEqual([
      "sub-d",
      "sub-c",
      "sub-b",
      "sub-a",
    ]);
    expect(submissions[0].has_key).toBe(true);
    const text = JSON.stringify(submissions);
    for (const f of [
      "key_ciphertext",
      "key_iv",
      "instructions_md",
      "edit_token_hash",
      "ip_hash",
    ]) {
      expect(text).not.toContain(f);
    }
    expect(text).not.toContain("secret instructions");
  });

  it("detail omits key columns but includes instructions", async () => {
    const r = await call("/sub-a");
    expect(r.status).toBe(200);
    const b = (await r.json()) as Record<string, unknown>;
    expect(b.instructions_md).toBe("# secret instructions");
    expect(b.roles).toEqual([]);
    expect(b.zip_sha256).toBe("sha");
    expect(JSON.stringify(b)).not.toMatch(
      /key_ciphertext|key_iv|edit_token_hash|ip_hash/,
    );
  });

  it("zip streams the seeded bytes as an attachment", async () => {
    const r = await call("/sub-a/zip");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/zip");
    expect(r.headers.get("content-disposition")).toBe(
      'attachment; filename="sub-a.zip"',
    );
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(ZIP);
  });

  it("key reveal returns plaintext and audits without the key", async () => {
    const r = await call("/sub-a/key");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({
      key: PLAINTEXT,
      key_expires_on: "2099-01-01",
    });
    const rows = await audits("submission.key_revealed");
    expect(rows).toHaveLength(1);
    expect(rows[0].details_json).not.toContain(PLAINTEXT);
    expect(JSON.parse(rows[0].details_json).submission_id).toBe("sub-a");
  });

  it("a corrupt ciphertext gives a controlled 500", async () => {
    await env.DB.prepare(
      "UPDATE setup_submissions SET key_iv = ? WHERE id = 'sub-d'",
    )
      .bind(new Uint8Array(12))
      .run();
    const r = await call("/sub-d/key");
    expect(r.status).toBe(500);
    expect(((await r.json()) as { code: string }).code).toBe("internal_error");
    expect(await audits("submission.key_revealed")).toHaveLength(1);
  });

  it("rejecting deletes the key; reveal then gives 404 no_key", async () => {
    const r = await call("/sub-b/review", {
      status: "rejected",
      note: "no thanks",
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT status, review_note, reviewed_at, key_ciphertext, key_iv, key_deleted_at FROM setup_submissions WHERE id = 'sub-b'",
    ).first<Record<string, unknown>>();
    expect(row?.status).toBe("rejected");
    expect(row?.review_note).toBe("no thanks");
    expect(row?.reviewed_at).toBeTruthy();
    expect(row?.key_ciphertext).toBeNull();
    expect(row?.key_iv).toBeNull();
    expect(row?.key_deleted_at).toBeTruthy();
    const k = await call("/sub-b/key");
    expect(k.status).toBe(404);
    expect(((await k.json()) as { code: string }).code).toBe("no_key");
    expect(await audits("submission.reviewed")).toHaveLength(1);
  });

  it("approving keeps the key; invalid status is 400", async () => {
    expect((await call("/sub-c/review", { status: "approved" })).status).toBe(
      200,
    );
    const row = await env.DB.prepare(
      "SELECT key_ciphertext FROM setup_submissions WHERE id = 'sub-c'",
    ).first<{ key_ciphertext: unknown }>();
    expect(row?.key_ciphertext).not.toBeNull();
    expect((await call("/sub-c/review", { status: "bogus" })).status).toBe(400);
  });

  it("delete-key is idempotent", async () => {
    expect((await call("/sub-c/delete-key")).status).toBe(200);
    expect((await call("/sub-c/delete-key")).status).toBe(200);
    expect((await call("/sub-c/key")).status).toBe(404);
    expect((await call("/nope/delete-key")).status).toBe(404);
  });

  it("list filters by status", async () => {
    const r = await call("", { status: "approved" });
    const { submissions } = (await r.json()) as {
      submissions: { id: string }[];
    };
    expect(submissions.map((s) => s.id)).toEqual(["sub-c"]);
  });
});
