import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import {
  appendEvent,
  queryEvents,
} from "../../src/lib/server/lifecycle-event-log";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("worker-side appendEvent helper", () => {
  it("inserts a row with object payload (helper stringifies)", async () => {
    const { id } = await appendEvent(env.DB, {
      event_type: "bench.completed",
      model_slug: "m/x",
      task_set_hash: "h",
      actor: "operator",
      payload: { runs_count: 1, tasks_count: 50 },
      tool_versions: { deno: "1.46.3" },
      envelope: { git_sha: "abc1234" },
    });
    expect(id).toBeGreaterThan(0);
    const row = await env.DB.prepare(
      `SELECT payload_json, tool_versions_json, envelope_json FROM lifecycle_events WHERE id = ?`,
    ).bind(id).first<
      {
        payload_json: string;
        tool_versions_json: string;
        envelope_json: string;
      }
    >();
    expect(JSON.parse(row!.payload_json)).toEqual({
      runs_count: 1,
      tasks_count: 50,
    });
    expect(JSON.parse(row!.tool_versions_json)).toEqual({ deno: "1.46.3" });
    expect(JSON.parse(row!.envelope_json)).toEqual({ git_sha: "abc1234" });
  });

  it("defaults ts to Date.now() when omitted", async () => {
    const before = Date.now();
    const { id } = await appendEvent(env.DB, {
      event_type: "bench.started",
      model_slug: "m/x",
      task_set_hash: "h",
      actor: "ci",
      payload: {},
    });
    const after = Date.now();
    const row = await env.DB.prepare(
      `SELECT ts FROM lifecycle_events WHERE id = ?`,
    ).bind(id).first<{ ts: number }>();
    expect(row!.ts).toBeGreaterThanOrEqual(before);
    expect(row!.ts).toBeLessThanOrEqual(after);
  });

  it("computes payload_hash when not provided", async () => {
    const { id } = await appendEvent(env.DB, {
      event_type: "analysis.completed",
      model_slug: "m/y",
      task_set_hash: "h",
      actor: "operator",
      payload: { foo: "bar" },
    });
    const row = await env.DB.prepare(
      `SELECT payload_hash FROM lifecycle_events WHERE id = ?`,
    ).bind(id).first<{ payload_hash: string }>();
    expect(row!.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("queryEvents filters by event_type_prefix and limit", async () => {
    for (
      const t of [
        "bench.started",
        "bench.completed",
        "analysis.started",
        "analysis.completed",
      ] as const
    ) {
      await appendEvent(env.DB, {
        event_type: t,
        model_slug: "m/q",
        task_set_hash: "hq",
        actor: "operator",
        payload: {},
      });
    }
    const benchOnly = await queryEvents(env.DB, {
      model_slug: "m/q",
      event_type_prefix: "bench.",
    });
    expect(benchOnly.map((e) => e.event_type)).toEqual([
      "bench.started",
      "bench.completed",
    ]);
    const limited = await queryEvents(env.DB, { model_slug: "m/q", limit: 1 });
    expect(limited.length).toBe(1);
  });
});
