import { assertEquals, assertMatch } from "@std/assert";
import {
  buildEnvironmentManifest,
  invocationSnapshot,
  promptTemplateDigest,
} from "../../../src/ingest/capture.ts";
import type { ContainerInspection } from "../../../src/container/docker-inspect.ts";
import { createCommandMock } from "../../utils/command-mock.ts";

Deno.test("environment manifest reads the pinned BCH version, the runner knob and the harness fingerprint", async () => {
  const fakeInspect = (): Promise<ContainerInspection | undefined> =>
    Promise.resolve({
      imageDigest: "sha256:abc",
      artifactUrl: "https://bcartifacts/onprem/28.4/w1?sv=1",
      running: true,
    });
  Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", "0");
  const m = await buildEnvironmentManifest({
    containerName: "Cronus28",
    cwd: ".",
    inspect: fakeInspect,
  });
  Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER");
  assertEquals(m.bcch_version, "6.1.14");
  assertEquals(m.test_runner, "legacy");
  assertEquals(m.bc_artifact, "https://bcartifacts/onprem/28.4/w1"); // query string stripped
  assertEquals(m.container_image_digest, "sha256:abc");
  assertMatch(m.harness_fingerprint, /^[0-9a-f]{64}$/);
  assertMatch(m.prompt_template_digest, /^[0-9a-f]{64}$/);
});

Deno.test("environment manifest defaults test_runner to soap when the knob is unset", async () => {
  const fakeInspect = (): Promise<ContainerInspection | undefined> =>
    Promise.resolve(undefined);
  Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER");
  const m = await buildEnvironmentManifest({
    containerName: "Cronus28",
    cwd: ".",
    inspect: fakeInspect,
  });
  assertEquals(m.test_runner, "soap");
  assertEquals(m.bc_artifact, null);
  assertEquals(m.container_image_digest, null);
});

Deno.test("environment manifest tolerates an inspect failure (best-effort container facts)", async () => {
  const fakeInspect = (): Promise<ContainerInspection | undefined> =>
    Promise.reject(new Error("docker unavailable"));
  const m = await buildEnvironmentManifest({
    containerName: "Cronus28",
    cwd: ".",
    inspect: fakeInspect,
  });
  assertEquals(m.bc_artifact, null);
  assertEquals(m.container_image_digest, null);
  // The rest of the manifest is still built despite the inspect failure.
  assertMatch(m.harness_fingerprint, /^[0-9a-f]{64}$/);
});

Deno.test("environment manifest reads git sha and dirty-tree state via Deno.Command", async () => {
  const mock = createCommandMock();
  try {
    mock.install();
    mock.mockCommand(
      { command: "git", argsExact: ["rev-parse", "HEAD"] },
      { code: 0, stdout: "deadbeef1234\n", stderr: "" },
    );
    mock.mockCommand(
      { command: "git", argsExact: ["status", "--porcelain"] },
      { code: 0, stdout: " M src/foo.ts\n", stderr: "" },
    );
    const fakeInspect = (): Promise<ContainerInspection | undefined> =>
      Promise.resolve(undefined);
    const m = await buildEnvironmentManifest({
      containerName: "Cronus28",
      cwd: ".",
      inspect: fakeInspect,
    });
    assertEquals(m.centralgauge_sha, "deadbeef1234");
    assertEquals(m.dirty_tree, true);
  } finally {
    mock.restore();
  }
});

Deno.test("environment manifest reports a clean tree and null sha when git fails", async () => {
  const mock = createCommandMock();
  try {
    mock.install();
    mock.mockCommand(
      { command: "git", argsExact: ["rev-parse", "HEAD"] },
      { code: 128, stdout: "", stderr: "fatal: not a git repository" },
    );
    mock.mockCommand(
      { command: "git", argsExact: ["status", "--porcelain"] },
      { code: 128, stdout: "", stderr: "fatal: not a git repository" },
    );
    const fakeInspect = (): Promise<ContainerInspection | undefined> =>
      Promise.resolve(undefined);
    const m = await buildEnvironmentManifest({
      containerName: "Cronus28",
      cwd: ".",
      inspect: fakeInspect,
    });
    assertEquals(m.centralgauge_sha, null);
    assertEquals(m.dirty_tree, false);
  } finally {
    mock.restore();
  }
});

Deno.test("promptTemplateDigest is stable across calls and hashes missing templates as a marker", async () => {
  const d1 = await promptTemplateDigest(".");
  const d2 = await promptTemplateDigest(".");
  assertEquals(d1, d2);
  assertMatch(d1, /^[0-9a-f]{64}$/);
});

Deno.test("invocation snapshot never carries secrets and keeps the host only", () => {
  const s = invocationSnapshot({
    provider: "openrouter",
    model: "z-ai/glm-5.3",
    apiModelId: "z-ai/glm-5.3",
    baseUrl: "https://openrouter.ai/api/v1?key=SECRET",
    maxTokens: 64000,
  });
  assertEquals(s["endpoint_host"], "openrouter.ai");
  assertEquals(JSON.stringify(s).includes("SECRET"), false);
});

Deno.test("invocation snapshot defaults optional fields to null and never throws on a bad baseUrl", () => {
  const s = invocationSnapshot({
    provider: "anthropic",
    model: "sonnet",
    apiModelId: "claude-sonnet-5",
    baseUrl: "not a url",
  });
  assertEquals(s["endpoint_host"], null);
  assertEquals(s["max_tokens"], null);
  assertEquals(s["temperature"], null);
  assertEquals(s["reasoning"], null);
});

Deno.test("invocation snapshot round-trips a reasoning config through JSON (drops functions/undefined)", () => {
  const s = invocationSnapshot({
    provider: "anthropic",
    model: "sonnet",
    apiModelId: "claude-sonnet-5",
    reasoning: { budget: 4096, effort: "high" },
  });
  assertEquals(s["reasoning"], { budget: 4096, effort: "high" });
});
