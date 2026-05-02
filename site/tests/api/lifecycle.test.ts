import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { signLifecycleHeaders } from "../fixtures/lifecycle-sign";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("POST /api/v1/admin/lifecycle/events", () => {
  it("appends a lifecycle event with admin signature (canonical AppendEventInput shape)", async () => {
    const { keyId, keypair } = await registerMachineKey("cli", "admin");
    // Canonical shape: payload / tool_versions / envelope are OBJECTS, not pre-stringified JSON.
    const payload = {
      ts: Date.now(),
      model_slug: "anthropic/claude-opus-4-6",
      task_set_hash: "h",
      event_type: "bench.completed",
      source_id: null,
      payload_hash: "a".repeat(64),
      tool_versions: { deno: "1.46.3" },
      envelope: { git_sha: "abc1234" },
      payload: { runs_count: 1 },
      actor: "operator",
      actor_id: null,
      migration_note: null,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT model_slug, event_type, payload_json FROM lifecycle_events WHERE task_set_hash = 'h'`,
    ).first<{ model_slug: string; event_type: string; payload_json: string }>();
    expect(row?.event_type).toBe("bench.completed");
    expect(JSON.parse(row!.payload_json)).toEqual({ runs_count: 1 });
  });

  it("rejects duplicate (payload_hash, ts, event_type) for idempotency", async () => {
    const { keyId, keypair } = await registerMachineKey("cli2", "admin");
    const payload = {
      ts: 12345,
      model_slug: "m/x",
      task_set_hash: "h2",
      event_type: "bench.completed",
      source_id: null,
      payload_hash: "b".repeat(64),
      tool_versions: {},
      envelope: {},
      payload: {},
      actor: "operator",
      actor_id: null,
      migration_note: null,
    };
    const a = await createSignedPayload(payload, keyId, undefined, keypair);
    const r1 = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(a.signedRequest),
    });
    expect(r1.status).toBe(200);
    const b = await createSignedPayload(payload, keyId, undefined, keypair);
    const r2 = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b.signedRequest),
    });
    expect(r2.status).toBe(409);
  });

  it("rejects unsigned requests with 401", async () => {
    const resp = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        payload: {},
        signature: {
          alg: "Ed25519",
          key_id: 999,
          signed_at: new Date().toISOString(),
          value: "AA",
        },
      }),
    });
    expect(resp.status).toBe(401);
  });

  it("rejects non-canonical event_type with 400 invalid_event_type (C3)", async () => {
    const { keyId, keypair } = await registerMachineKey("cli-c3", "admin");
    const payload = {
      ts: 99999,
      model_slug: "m/c3",
      task_set_hash: "hc3",
      event_type: "bench.invalid_phase", // NOT in CANONICAL_EVENT_TYPES
      payload_hash: "c".repeat(64),
      tool_versions: null,
      envelope: null,
      payload: {},
      actor: "operator",
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(400);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("invalid_event_type");
  });

  it("rejects missing actor with 400 (I5)", async () => {
    const { keyId, keypair } = await registerMachineKey("cli-i5a", "admin");
    const payload = {
      ts: 88888,
      model_slug: "m/i5",
      task_set_hash: "hi5",
      event_type: "bench.completed",
      payload_hash: "d".repeat(64),
      tool_versions: null,
      envelope: null,
      payload: {},
      // actor intentionally omitted
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(400);
    const body = await resp.json() as { code: string; error: string };
    expect(body.code).toBe("missing_field");
    expect(body.error).toMatch(/actor/);
  });

  it("rejects non-canonical actor with 400 invalid_actor (I5)", async () => {
    const { keyId, keypair } = await registerMachineKey("cli-i5b", "admin");
    const payload = {
      ts: 77777,
      model_slug: "m/i5b",
      task_set_hash: "hi5b",
      event_type: "bench.completed",
      payload_hash: "e".repeat(64),
      tool_versions: null,
      envelope: null,
      payload: {},
      actor: "rogue", // NOT in CANONICAL_ACTORS
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch("https://x/api/v1/admin/lifecycle/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(400);
    const body = await resp.json() as { code: string };
    expect(body.code).toBe("invalid_actor");
  });
});

describe("GET /api/v1/admin/lifecycle/state", () => {
  it("returns the reduced state per step", async () => {
    const { keyId, keypair } = await registerMachineKey("cli3", "admin");
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(1, "m/y", "h3", "bench.completed", "operator").run();
    const headers = await signLifecycleHeaders(keypair, keyId, {
      method: "GET",
      path: "/api/v1/admin/lifecycle/state",
      query: { model: "m/y", task_set: "h3" },
    });
    const resp = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/state?model=m/y&task_set=h3`,
      { method: "GET", headers },
    );
    expect(resp.status).toBe(200);
    const json = await resp.json() as Record<string, { event_type: string }>;
    expect(json.bench?.event_type).toBe("bench.completed");
  });
});
