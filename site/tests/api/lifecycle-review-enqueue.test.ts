/**
 * Cluster 7 / finding V1 — review-queue enqueue endpoint tests.
 *
 * Coverage:
 *   - 401 when unsigned
 *   - 200 with a valid header-signed POST → pending_review row present
 *   - idempotent upsert on UNIQUE(analysis_event_id, concept_slug_proposed):
 *     a re-POST returns the SAME id and does not duplicate the row
 *   - 409 when analysis_event_id references no lifecycle_events row (FK guard)
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { canonicalJSON } from "../../src/lib/shared/canonical";
import { bytesToB64 } from "../../src/lib/shared/base64";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";
import type { Keypair } from "../../src/lib/shared/ed25519";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

const PATH = "/api/v1/admin/lifecycle/review/enqueue";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signPost(
  keypair: Keypair,
  keyId: number,
  bodyBytes: Uint8Array,
): Promise<Record<string, string>> {
  const signedAt = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const fields = {
    method: "POST",
    path: PATH,
    query: {},
    body_sha256: await sha256Hex(bodyBytes),
    signed_at: signedAt,
    nonce,
  };
  const sig = await ed.signAsync(
    new TextEncoder().encode(canonicalJSON(fields)),
    keypair.privateKey,
  );
  return {
    "X-CG-Signature": bytesToB64(sig),
    "X-CG-Key-Id": String(keyId),
    "X-CG-Signed-At": signedAt,
    "X-CG-Nonce": nonce,
    "content-type": "application/json",
  };
}

async function seedAnalysisEvent(): Promise<number> {
  const ev = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: "anthropic/claude-opus-4-6",
    task_set_hash: "h-test",
    ts: Date.now() - 1000,
    actor: "operator",
    actor_id: null,
    payload: { analyzer_model: "anthropic/claude-opus-4-7", entries_count: 1 },
  });
  return ev.id;
}

function enqueueBody(analysisEventId: number) {
  return {
    analysis_event_id: analysisEventId,
    model_slug: "anthropic/claude-opus-4-6",
    entry: {
      concept: "FlowField CalcFields",
      alConcept: "FlowField",
      description: "requires CalcFields",
      correctPattern: 'Rec.CalcFields("x");',
      incorrectPattern: 'if Rec."x" > 0 then ...',
      errorCodes: ["AL0606"],
      affectedTasks: ["CG-AL-E001"],
      firstSeen: "2026-04-29T00:00:00Z",
      occurrences: 1,
      confidence: 0.3,
      concept_slug_proposed: "flowfield-calcfields",
      concept_slug_existing_match: null,
      similarity_score: null,
    },
    confidence: {
      score: 0.3,
      breakdown: {
        schema_validity: 1,
        concept_cluster_consistency: 0.2,
        cross_llm_agreement: null,
      },
      sampled_for_cross_llm: false,
      above_threshold: false,
      failure_reasons: [],
    },
  };
}

describe("POST /api/v1/admin/lifecycle/review/enqueue", () => {
  it("rejects an unsigned request with 401", async () => {
    const analysisEventId = await seedAnalysisEvent();
    const res = await SELF.fetch(`https://x${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(enqueueBody(analysisEventId)),
    });
    expect(res.status).toBe(401);
  });

  it("accepts a signed request and inserts a pending_review row", async () => {
    const { keyId, keypair } = await registerMachineKey("enqueue-cli", "admin");
    const analysisEventId = await seedAnalysisEvent();
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify(enqueueBody(analysisEventId)),
    );
    const headers = await signPost(keypair, keyId, bodyBytes);
    const res = await SELF.fetch(`https://x${PATH}`, {
      method: "POST",
      headers,
      body: bodyBytes,
    });
    expect(res.status).toBe(200);
    const out = await res.json<{ id: number }>();
    expect(out.id).toBeGreaterThan(0);

    const row = await env.DB.prepare(
      `SELECT concept_slug_proposed, confidence, status FROM pending_review WHERE id = ?`,
    ).bind(out.id).first<
      { concept_slug_proposed: string; confidence: number; status: string }
    >();
    expect(row?.concept_slug_proposed).toBe("flowfield-calcfields");
    expect(row?.confidence).toBe(0.3);
    expect(row?.status).toBe("pending");
  });

  it("is idempotent on UNIQUE(analysis_event_id, concept_slug_proposed)", async () => {
    const analysisEventId = await seedAnalysisEvent();
    const body = JSON.stringify(enqueueBody(analysisEventId));

    const post = async () => {
      const { keyId, keypair } = await registerMachineKey(
        `enqueue-cli-${crypto.randomUUID()}`,
        "admin",
      );
      const bodyBytes = new TextEncoder().encode(body);
      const headers = await signPost(keypair, keyId, bodyBytes);
      return SELF.fetch(`https://x${PATH}`, {
        method: "POST",
        headers,
        body: bodyBytes,
      });
    };

    const r1 = await post();
    expect(r1.status).toBe(200);
    const id1 = (await r1.json<{ id: number }>()).id;
    const r2 = await post();
    expect(r2.status).toBe(200);
    const id2 = (await r2.json<{ id: number }>()).id;
    expect(id2).toBe(id1);

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pending_review WHERE analysis_event_id = ?`,
    ).bind(analysisEventId).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("rejects an unknown analysis_event_id with 409 (FK guard)", async () => {
    const { keyId, keypair } = await registerMachineKey("enqueue-fk", "admin");
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify(enqueueBody(999999)),
    );
    const headers = await signPost(keypair, keyId, bodyBytes);
    const res = await SELF.fetch(`https://x${PATH}`, {
      method: "POST",
      headers,
      body: bodyBytes,
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("orphan_analysis_event");
  });
});
