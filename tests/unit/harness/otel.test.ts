import { assertEquals, assertThrows } from "@std/assert";
import { apiRequests } from "../../../src/harness/otel.ts";

// Recorded from claude 2.1.300 -p against stub-anthropic (H-10 spike): main
// spawns a general-purpose child, the child spawns a grandchild; five requests.
const FIXTURE = "tests/fixtures/harness/otel-nested-stub.json";

Deno.test("otel: api_request rows of a nested run sum to the result's modelUsage", async () => {
  const rows = apiRequests(JSON.parse(await Deno.readTextFile(FIXTURE)));
  assertEquals(rows.length, 5);
  const sum = (
    k:
      | "input_tokens"
      | "output_tokens"
      | "cache_read_tokens"
      | "cache_creation_tokens",
  ) => rows.reduce((n, r) => n + r[k], 0);
  // result.modelUsage of that run: 65 / 115 / 515 / 5015.
  assertEquals(
    [
      sum("input_tokens"),
      sum("output_tokens"),
      sum("cache_read_tokens"),
      sum("cache_creation_tokens"),
    ],
    [65, 115, 515, 5015],
  );
  assertEquals(rows.map((r) => r.agent_name), [
    null,
    "general-purpose",
    "general-purpose",
    "general-purpose",
    null,
  ]);
  assertEquals(rows[0]!.execution_id, "exec-spike");
  // Allow-listed fields only: no prompt or response attribute survives.
  assertEquals(Object.keys(rows[0]!).sort(), [
    "agent_name",
    "cache_creation_tokens",
    "cache_read_tokens",
    "cost_usd",
    "execution_id",
    "input_tokens",
    "model",
    "output_tokens",
    "prompt_id",
    "query_source",
    "request_id",
    "sequence",
    "session_id",
    "timestamp",
  ]);
});

Deno.test("otel: an api_request missing a token count throws, never reads as zero", () => {
  const rec = (attrs: { key: string; value: unknown }[]) => ({
    resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: attrs }] }] }],
  });
  const base = [
    { key: "event.name", value: { stringValue: "api_request" } },
    { key: "model", value: { stringValue: "m" } },
    { key: "input_tokens", value: { intValue: "1" } },
    { key: "output_tokens", value: { intValue: 2 } },
    { key: "cache_read_tokens", value: { intValue: 3 } },
  ];
  assertThrows(() => apiRequests(rec(base)));
  const ok = apiRequests(
    rec([...base, { key: "cache_creation_tokens", value: { intValue: 4 } }]),
  );
  assertEquals(ok[0]!.input_tokens, 1, "int64 as a JSON string");
  assertThrows(() => apiRequests({}));
  assertEquals(apiRequests({ resourceLogs: [] }), []);
});
