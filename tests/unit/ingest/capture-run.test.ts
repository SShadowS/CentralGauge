import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import {
  buildEnvironmentManifest,
  invocationSnapshot,
  promptTemplateDigest,
} from "../../../src/ingest/capture.ts";
import type { ContainerInspection } from "../../../src/container/docker-inspect.ts";
import { createCommandMock } from "../../utils/command-mock.ts";

/**
 * Every `buildEnvironmentManifest` test installs this so the git facts come
 * from the mock instead of a real subprocess spawn — even when a test
 * doesn't assert on `centralgauge_sha`/`dirty_tree`, leaving git unmocked
 * means a real `git rev-parse`/`git status` runs against this actual repo
 * on every test run (slow, and non-deterministic across a dirty tree).
 */
function installCleanGitMock(mock: ReturnType<typeof createCommandMock>) {
  mock.install();
  mock.mockCommand(
    { command: "git", argsExact: ["rev-parse", "HEAD"] },
    {
      code: 0,
      stdout: "0000000000000000000000000000000000000000\n",
      stderr: "",
    },
  );
  mock.mockCommand(
    { command: "git", argsExact: ["status", "--porcelain"] },
    { code: 0, stdout: "", stderr: "" },
  );
}

Deno.test("environment manifest reads the pinned BCH version, the runner knob and the harness fingerprint", async () => {
  const mock = createCommandMock();
  try {
    installCleanGitMock(mock);
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
  } finally {
    mock.restore();
  }
});

Deno.test("environment manifest defaults test_runner to soap when the knob is unset", async () => {
  const mock = createCommandMock();
  try {
    installCleanGitMock(mock);
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
  } finally {
    mock.restore();
  }
});

Deno.test("environment manifest tolerates an inspect failure (best-effort container facts)", async () => {
  const mock = createCommandMock();
  try {
    installCleanGitMock(mock);
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
  } finally {
    mock.restore();
  }
});

Deno.test("environment manifest THROWS when a harness input is missing (capture must never block ingest is the caller's job)", async () => {
  // Documents the exact failure mode Important-3 guards against: unlike the
  // container/git facts above (both best-effort, both swallowed inside this
  // function), `harnessFingerprint` fails loudly (`missing: "throw"`) on a
  // fixed list of committed files. `buildEnvironmentManifest` does NOT catch
  // this itself, by design (a narrowed/wrong fingerprint must never be
  // silently substituted, see `promptTemplateDigest`'s opposite choice
  // above) — so every caller of `buildEnvironmentManifest` MUST wrap the
  // call in its own try/catch rather than let a bench-time ingest abort on
  // it (`ingestBenchResults` in `cli/commands/bench-command.ts` does this).
  const emptyRoot = await Deno.makeTempDir({ prefix: "cg-no-harness-" });
  const mock = createCommandMock();
  try {
    installCleanGitMock(mock);
    const fakeInspect = (): Promise<ContainerInspection | undefined> =>
      Promise.resolve(undefined);
    let threw = false;
    try {
      await buildEnvironmentManifest({
        containerName: "Cronus28",
        cwd: emptyRoot,
        inspect: fakeInspect,
      });
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    mock.restore();
    await Deno.remove(emptyRoot, { recursive: true });
  }
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

Deno.test("promptTemplateDigest is deterministic and sensitive to a template's content", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-prompt-digest-" });
  try {
    await Deno.mkdir(`${dir}/templates`);
    // Only 2 of the 5 fixed template names are present in this synthetic
    // dir — the other 3 (diagnose.md, diagnose-objects.md,
    // diagnose-contract.md) are intentionally absent so this also exercises
    // the missing-template path without touching the real templates/ dir.
    await Deno.writeTextFile(
      `${dir}/templates/code-gen.md`,
      "Generate AL code.\n",
    );
    await Deno.writeTextFile(`${dir}/templates/bugfix.md`, "Fix the bug.\n");

    const d1 = await promptTemplateDigest(dir);
    const d2 = await promptTemplateDigest(dir);
    assertEquals(d1, d2);
    assertMatch(d1, /^[0-9a-f]{64}$/);

    await Deno.writeTextFile(
      `${dir}/templates/code-gen.md`,
      "Generate AL code, differently this time.\n",
    );
    const d3 = await promptTemplateDigest(dir);
    assertNotEquals(d1, d3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("promptTemplateDigest hashes a missing template as a distinct marker from an empty one", async () => {
  const dirMissing = await Deno.makeTempDir({
    prefix: "cg-prompt-digest-missing-",
  });
  const dirEmpty = await Deno.makeTempDir({
    prefix: "cg-prompt-digest-empty-",
  });
  try {
    await Deno.mkdir(`${dirMissing}/templates`);
    // diagnose.md left entirely absent here -> hashed as the "<missing>" marker.

    await Deno.mkdir(`${dirEmpty}/templates`);
    await Deno.writeTextFile(`${dirEmpty}/templates/diagnose.md`, ""); // present but empty

    const dMissing = await promptTemplateDigest(dirMissing);
    const dEmpty = await promptTemplateDigest(dirEmpty);
    assertNotEquals(dMissing, dEmpty);
  } finally {
    await Deno.remove(dirMissing, { recursive: true });
    await Deno.remove(dirEmpty, { recursive: true });
  }
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
