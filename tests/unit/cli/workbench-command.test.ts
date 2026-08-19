import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { join } from "@std/path";

import {
  createEscalationVerify,
  resolveServeOptions,
} from "../../../cli/commands/workbench-command.ts";

describe("cli/workbench-command", () => {
  it("defaults to the repo's scratch directory", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(o.scratchDir.replaceAll("\\", "/"), "/repo/scratch");
  });

  // It used to be the relative literal `"tests/al/dependencies"` inside
  // server.ts, resolved against `Deno.cwd()` at request time: started from
  // anywhere but the repo root, every chained prereq dependency silently
  // failed to resolve, which is indistinguishable from the legitimate
  // base-app case, so their fields vanished from the index and a model
  // referencing one was told it made the field up. Absolutised here,
  // against the same root as `scratchDir`.
  it("absolutises the chained-prereq dependencies root against the repo root", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(
      o.dependenciesRoot.replaceAll("\\", "/"),
      "/repo/tests/al/dependencies",
    );
  });

  it("honours an explicit port", () => {
    assertEquals(resolveServeOptions({ port: 4321 }, "/repo").port, 4321);
  });

  it("leaves the port unset when not given, so the server picks one", () => {
    assertEquals(resolveServeOptions({}, "/repo").port, undefined);
  });

  it("resolves default models from a named preset in config", () => {
    const o = resolveServeOptions(
      { preset: "flagship" },
      "/repo",
      { benchmarkPresets: { flagship: { llms: ["a/b", "c/d"] } } },
    );
    assertEquals(o.defaultModels, ["a/b", "c/d"]);
  });

  it("leaves defaultModels empty when no preset is given", () => {
    const o = resolveServeOptions(
      {},
      "/repo",
      { benchmarkPresets: { flagship: { llms: ["a/b"] } } },
    );
    assertEquals(o.defaultModels, []);
  });

  it("an unknown preset yields an empty list rather than throwing", () => {
    const o = resolveServeOptions({ preset: "nope" }, "/repo", {});
    assertEquals(o.defaultModels, []);
  });

  // `mcp/al-tools-server.ts`'s `prereqCache` (compiled artifacts) and
  // `publishedPrereqCache` (the publish promise) are module-level, so under
  // `workbench serve` they live for the whole session rather than one short
  // CLI invocation. An author who clicks "Compile & test", sees a failure
  // caused by their own prereq, edits `scratch/<id>/prereq/` and clicks
  // again was silently verified against the prereq from the FIRST click,
  // with nothing saying so and no recovery short of restarting the
  // dashboard.
  //
  // The draft directory below has no oracle, so `stageResponse` throws out
  // of `verifyResponse` (`VerifyQueue.runNext` is what turns that into an
  // `errored` outcome in production) before anything reaches a container or
  // a model: this exercises the real adapter without either. The clear must
  // therefore happen BEFORE the delegation, which is also what makes it
  // observable here.
  it("clears the prereq caches once per job", async () => {
    const scratchDir = await Deno.makeTempDir({ prefix: "cg-wb-" });
    try {
      let cleared = 0;
      const verify = createEscalationVerify({
        clearCaches: () => {
          cleared++;
        },
        // Required so no caller can forget it. This job names no container
        // and no `defaultContainerName` is given, so the preflight is
        // skipped entirely and these never reach a provider.
        credentials: { username: "test", password: "test" },
      });

      const job = {
        draftDir: join(scratchDir, "CG-AL-X070"),
        taskId: "CG-AL-X070",
        model: "fake/model",
        code: "table 70001 A { }",
      };

      await verify(job).catch(() => {});
      assertEquals(cleared, 1);

      await verify(job).catch(() => {});
      assertEquals(cleared, 2, "cleared per job, not once per process");
    } finally {
      await Deno.remove(scratchDir, { recursive: true });
    }
  });

  // CONTRACT TEST. Every other test of this pipeline injects a fake
  // verifier, which is why the suite stayed green while escalation could
  // not publish at all: nothing asserted that the pipeline is WIRED to the
  // container preflight the bench runs. The real-container smoke test
  // (`tests/integration/dashboard/escalation-smoke.test.ts`) proves the
  // wiring end to end but is opt-in and needs hardware. This asserts the
  // same wiring with a fake, so a refactor that drops the preflight fails
  // in the default suite instead of in production.
  it("prepares the container before verifying, once per container", async () => {
    const scratchDir = await Deno.makeTempDir({ prefix: "cg-wb-" });
    try {
      const prepared: Array<
        { container: string; username: string | undefined }
      > = [];
      const verify = createEscalationVerify({
        clearCaches: () => {},
        credentials: { username: "sshadows", password: "1234" },
        defaultContainerName: "Cronus28",
        prepareContainer: (containerName, creds) => {
          prepared.push({
            container: containerName,
            username: creds?.username,
          });
          return Promise.resolve();
        },
      });

      const job = {
        draftDir: join(scratchDir, "CG-AL-X071"),
        taskId: "CG-AL-X071",
        model: "fake/model",
        code: "table 70001 A { }",
      };

      await verify(job).catch(() => {});
      assertEquals(
        prepared.length,
        1,
        "the preflight must run before verifying",
      );
      assertEquals(prepared[0]?.container, "Cronus28");
      assertEquals(
        prepared[0]?.username,
        "sshadows",
        "credentials must reach the preflight; without them the provider " +
          "falls back to admin/admin and every publish is unauthorized",
      );

      await verify(job).catch(() => {});
      assertEquals(
        prepared.length,
        1,
        "memoised per container: an author should not wait for a harness " +
          "probe on every click",
      );
    } finally {
      await Deno.remove(scratchDir, { recursive: true });
    }
  });

  it("retries the preflight after it fails", async () => {
    const scratchDir = await Deno.makeTempDir({ prefix: "cg-wb-" });
    try {
      let attempts = 0;
      const verify = createEscalationVerify({
        clearCaches: () => {},
        credentials: { username: "sshadows", password: "1234" },
        defaultContainerName: "Cronus28",
        prepareContainer: () => {
          attempts++;
          return Promise.reject(new Error("container unreachable"));
        },
      });

      const job = {
        draftDir: join(scratchDir, "CG-AL-X072"),
        taskId: "CG-AL-X072",
        model: "fake/model",
        code: "table 70001 A { }",
      };

      await verify(job).catch(() => {});
      await verify(job).catch(() => {});
      // A failed preflight must not be cached: an author who fixes the
      // container should not have to restart the dashboard.
      assertEquals(attempts, 2, "a failed preflight must be retried");
    } finally {
      await Deno.remove(scratchDir, { recursive: true });
    }
  });
});
