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

Deno.test("buildPayload carries the run-level capture when supplied", () => {
  const p = buildPayload({
    runId: "r",
    taskSetHash: "h".repeat(64),
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {},
    machineId: "mc",
    startedAt: "t0",
    completedAt: "t1",
    pricingVersion: "2026-09-03",
    results: [],
    harnessFingerprint: "a".repeat(64),
    retryPathVersion: "rp2-overlay-2026-09-01",
    environmentSha256: "b".repeat(64),
    environment: {
      bc_artifact: "u",
      container_image_digest: "d",
      bcch_version: "6.1.14",
      test_runner: "soap",
      prompt_template_digest: "c".repeat(64),
    },
    invocation: { provider: "anthropic" },
  });
  assertEquals(p["harness_fingerprint"], "a".repeat(64));
  assertEquals(p["retry_path_version"], "rp2-overlay-2026-09-01");
  assertEquals(p["environment_sha256"], "b".repeat(64));
  assertEquals(p["bc_artifact"], "u");
  assertEquals(p["container_image_digest"], "d");
  assertEquals(p["bcch_version"], "6.1.14");
  assertEquals(p["test_runner"], "soap");
  assertEquals(p["prompt_template_digest"], "c".repeat(64));
  assertEquals((p["invocation"] as { provider: string }).provider, "anthropic");
});

Deno.test("buildPayload omits the run-level capture keys when absent", () => {
  const p = buildPayload({
    runId: "r",
    taskSetHash: "h",
    model: { slug: "s", api_model_id: "m", family_slug: "f" },
    settings: {},
    machineId: "mc",
    startedAt: "t0",
    completedAt: "t1",
    pricingVersion: "v",
    results: [],
  });
  for (
    const key of [
      "harness_fingerprint",
      "retry_path_version",
      "environment_sha256",
      "bc_artifact",
      "container_image_digest",
      "bcch_version",
      "test_runner",
      "prompt_template_digest",
      "invocation",
    ]
  ) {
    assertEquals(key in p, false);
  }
});
