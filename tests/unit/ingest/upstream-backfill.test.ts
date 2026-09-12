// tests/unit/ingest/upstream-backfill.test.ts
//
// `runs backfill-upstream`'s two halves (spec 2026-09-11 D6, Task 15):
// reading `result.raw.provider` out of a finished batch run's stored
// responses, and the signed POST to the admin endpoint that records them.
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  collectBatchServedUpstreams,
  postUpstreamBackfill,
} from "../../../src/ingest/upstream-backfill.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

/** Ed25519 seeds are 32 raw bytes; the value is irrelevant against a stub fetch. */
const PRIVATE_KEY = new Uint8Array(32).fill(7);

Deno.test("collectBatchServedUpstreams reads result.raw.provider per attempt and reports what it skipped", async () => {
  const dir = await createTempDir("backfill");
  try {
    await Deno.mkdir(join(dir, "responses"));
    await Deno.writeTextFile(
      join(dir, "state.json"),
      JSON.stringify({
        tasks: {
          "easy/t1": {
            attempt1: { itemId: "i1", state: "evaluated" },
            attempt2: { itemId: "i2", state: "evaluated" },
          },
          "easy/t2": { attempt1: { itemId: "i3", state: "errored" } },
        },
      }),
    );
    await Deno.writeTextFile(
      join(dir, "responses", "i1.json"),
      JSON.stringify({
        result: {
          itemId: "i1",
          ok: true,
          raw: { provider: "Google", choices: [] },
          httpStatus: 200,
        },
      }),
    );
    await Deno.writeTextFile(
      join(dir, "responses", "i2.json"),
      JSON.stringify({
        result: { itemId: "i2", ok: true, raw: { choices: [] }, httpStatus: 200 },
      }),
    );
    const out = await collectBatchServedUpstreams(dir);
    assertEquals(out.entries, [
      { task_id: "easy/t1", attempt: 1, served_upstream: "Google" },
    ]);
    assertEquals(
      out.skipped.map((s) => `${s.task_id}#${s.attempt}:${s.why}`),
      ["easy/t1#2:no provider field", "easy/t2#1:no response file"],
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectBatchServedUpstreams reports an unreadable response instead of aborting the run", async () => {
  const dir = await createTempDir("backfill-bad");
  try {
    await Deno.mkdir(join(dir, "responses"));
    await Deno.writeTextFile(
      join(dir, "state.json"),
      JSON.stringify({
        tasks: {
          "easy/t1": { attempt1: { itemId: "i1", state: "evaluated" } },
          "easy/t2": { attempt1: { itemId: "i2", state: "evaluated" } },
        },
      }),
    );
    await Deno.writeTextFile(join(dir, "responses", "i1.json"), "{ not json");
    await Deno.writeTextFile(
      join(dir, "responses", "i2.json"),
      JSON.stringify({
        result: {
          itemId: "i2",
          ok: true,
          raw: { provider: "Novita" },
          httpStatus: 200,
        },
      }),
    );
    const out = await collectBatchServedUpstreams(dir);
    assertEquals(out.entries, [
      { task_id: "easy/t2", attempt: 1, served_upstream: "Novita" },
    ]);
    assertEquals(out.skipped, [
      { task_id: "easy/t1", attempt: 1, why: "unreadable response file" },
    ]);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("postUpstreamBackfill signs and posts to the admin endpoint", async () => {
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, run_id: "r1", updated: 1 }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const res = await postUpstreamBackfill(
    { url: "https://x", adminKeyId: 7 },
    PRIVATE_KEY,
    {
      runId: "r1",
      results: [{ task_id: "easy/t1", attempt: 1, served_upstream: "Google" }],
    },
    { fetchFn },
  );
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
  assertEquals(res.updated, 1);
  const captured = seen as unknown as {
    url: string;
    body: Record<string, unknown>;
  };
  assertEquals(captured.url, "https://x/api/v1/admin/runs/upstream");
  assertEquals(captured.body["version"], 1);
  const payload = captured.body["payload"] as Record<string, unknown>;
  assertEquals(payload["run_id"], "r1");
  assertEquals(payload["results"], [
    { task_id: "easy/t1", attempt: 1, served_upstream: "Google" },
  ]);
  const signature = captured.body["signature"] as Record<string, unknown>;
  assertEquals(signature["alg"], "Ed25519");
  assertEquals(signature["key_id"], 7);
});

Deno.test("postUpstreamBackfill surfaces a refusal without throwing", async () => {
  const fetchFn = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ code: "unknown_attempt", error: "no such attempt" }),
        { status: 400 },
      ),
    )) as typeof fetch;
  const res = await postUpstreamBackfill(
    { url: "https://x/", adminKeyId: 7 },
    PRIVATE_KEY,
    {
      runId: "r1",
      results: [{ task_id: "easy/t1", attempt: 2, served_upstream: "Google" }],
    },
    { fetchFn },
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 400);
  assertEquals(res.code, "unknown_attempt");
  assertEquals(res.message, "no such attempt");
});
