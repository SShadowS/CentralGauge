import { assertEquals } from "@std/assert";
import { buildPayload } from "../../../src/ingest/envelope.ts";

Deno.test("buildPayload maps required fields and omits optionals when absent", () => {
  const payload = buildPayload({
    runId: "run-1",
    taskSetHash: "abc123",
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: { temperature: 0.2 },
    machineId: "mach-1",
    startedAt: "2026-04-21T00:00:00.000Z",
    completedAt: "2026-04-21T00:01:00.000Z",
    pricingVersion: "2026-04-01",
    results: [],
  });

  assertEquals(payload["task_set_hash"], "abc123");
  assertEquals(payload["machine_id"], "mach-1");
  assertEquals(payload["pricing_version"], "2026-04-01");
  assertEquals(payload["results"], []);
  assertEquals("centralgauge_sha" in payload, false);
  assertEquals("reproduction_bundle_sha256" in payload, false);
});

Deno.test("buildPayload includes optional fields when provided", () => {
  const payload = buildPayload({
    runId: "run-1",
    taskSetHash: "abc123",
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {},
    machineId: "mach-1",
    startedAt: "2026-04-21T00:00:00.000Z",
    completedAt: "2026-04-21T00:01:00.000Z",
    pricingVersion: "2026-04-01",
    centralgaugeSha: "deadbeef",
    reproductionBundleSha256: "a".repeat(64),
    results: [],
  });

  assertEquals(payload["centralgauge_sha"], "deadbeef");
  assertEquals(payload["reproduction_bundle_sha256"], "a".repeat(64));
});

Deno.test("buildPayload does not include run_id inside payload (it lives on the envelope)", () => {
  const payload = buildPayload({
    runId: "run-42",
    taskSetHash: "h",
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {},
    machineId: "mach",
    startedAt: "2026-04-21T00:00:00.000Z",
    completedAt: "2026-04-21T00:01:00.000Z",
    pricingVersion: "v",
    results: [],
  });
  assertEquals("run_id" in payload, false);
});
