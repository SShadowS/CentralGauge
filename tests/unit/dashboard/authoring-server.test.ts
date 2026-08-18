import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { createHandler, startServer } from "../../../src/dashboard/server.ts";
import { loadTrapSources } from "../../../src/dashboard/source-loader.ts";
import { runQuick } from "../../../src/dashboard/run-manager.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const CORRECT = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Validate(Qty, 1);
    end;
}`;
const NAIVE = `codeunit 71410 "A"
{
    procedure P()
    begin
        Q.Qty := 1;
    end;
}`;
// Stands in for the oracle the workbench draft layout scaffolds inside
// correct/ (CLAUDE.md's "Workbench Draft Layout"): `<id>.Test.al`. A
// distinct object id (80054) from the solution's (71410) so an unfiltered
// read would produce a second, spurious matrix row.
const ORACLE = `codeunit 80054 "CG-AL-X054 Test"
{
    Subtype = Test;

    [Test]
    procedure TestSomething()
    begin
    end;
}`;

const deps = {
  scratchDir: "/tmp/nope",
  listDrafts: () =>
    Promise.resolve([
      { id: "CG-AL-X054", dir: "/tmp/nope/CG-AL-X054", hasPrereq: false },
    ]),
  loadTrapSources: () =>
    Promise.resolve({ correctSources: [], naiveSources: [] }),
  createModelCaller: () => () =>
    Promise.reject(new Error("not called in this test")),
  runQuick: () => Promise.reject(new Error("not called in this test")),
  defaultModels: [],
} as unknown as Parameters<typeof createHandler>[0];

describe("dashboard/server", () => {
  it("serves the draft list as JSON", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/drafts"),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.drafts[0].id, "CG-AL-X054");
  });

  it("serves the UI at the root", async () => {
    const res = await createHandler(deps)(new Request("http://localhost/"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type")?.includes("text/html"), true);
  });

  it("404s an unknown path", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/nope"),
    );
    assertEquals(res.status, 404);
  });

  it("rejects a run request with no models", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-X054", models: [] }),
      }),
    );
    assertEquals(res.status, 400);
  });

  it("rejects a run request naming an unknown draft", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-NOPE", models: ["m"] }),
      }),
    );
    assertEquals(res.status, 400);
  });

  // Positive control for the two 400 tests above. Without it, a handler that
  // returned 400 for EVERY /api/run request would satisfy them both. This
  // asserts a well-formed request gets past validation and reaches runQuick —
  // the injected runQuick rejects, so anything other than a 400 proves the
  // request was accepted.
  it("accepts a well-formed run request", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: JSON.stringify({ draftId: "CG-AL-X054", models: ["m"] }),
      }),
    );
    assertEquals(res.status === 400, false);
  });

  it("serves an empty default-models list when none was resolved", async () => {
    const res = await createHandler(deps)(
      new Request("http://localhost/api/defaults"),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.defaultModels, []);
  });

  // The CLI resolves `--preset` against .centralgauge.yml (workbench-command.ts)
  // and hands the result to startServer as plain data — this proves the
  // handler passes that data straight through rather than re-deriving it.
  it("serves the CLI-resolved default models as JSON", async () => {
    const withDefaults = {
      ...deps,
      defaultModels: ["anthropic/claude-opus-4-7", "openai/gpt-5.5"],
    } as unknown as Parameters<typeof createHandler>[0];
    const res = await createHandler(withDefaults)(
      new Request("http://localhost/api/defaults"),
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.defaultModels, [
      "anthropic/claude-opus-4-7",
      "openai/gpt-5.5",
    ]);
  });

  it("binds loopback only", async () => {
    const server = await startServer({ scratchDir: "/tmp/nope", port: 0 });
    try {
      assertEquals(server.hostname, "127.0.0.1");
    } finally {
      await server.shutdown();
    }
  });

  // Real runQuick + real loadTrapSources, fake (non-provider) caller: proves
  // the wiring end to end without any test reaching an LLM provider.
  it("a well-formed run reaches the injected caller and returns a matrix", async () => {
    const dir = await createTempDir("dashboard-server-run-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.mkdir(`${dir}/naive`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, CORRECT);
      await Deno.writeTextFile(`${dir}/naive/A.al`, NAIVE);

      const runDeps = {
        scratchDir: dir,
        listDrafts: () =>
          Promise.resolve([{ id: "CG-AL-X054", dir, hasPrereq: false }]),
        loadTrapSources,
        createModelCaller:
          (_context: unknown) => (_model: string, _prompt: string) =>
            Promise.resolve({
              content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
              finishReason: "stop" as const,
            }),
        runQuick,
      } as unknown as Parameters<typeof createHandler>[0];

      const res = await createHandler(runDeps)(
        new Request("http://localhost/api/run", {
          method: "POST",
          body: JSON.stringify({ draftId: "CG-AL-X054", models: ["m"] }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.responses.length, 1);
      assertEquals(
        body.responses[0].classification.verdict,
        "avoided-the-mistake",
      );
      assertEquals(Array.isArray(body.rows), true);
      assertEquals(body.rows.length > 0, true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  // The workbench draft layout puts the oracle test codeunit inside
  // correct/, alongside the solution. buildRowUniverse turns every
  // reference object into a row unconditionally, so an unfiltered read
  // would add a permanent "not written" row for an object no model was
  // ever asked to write. Confirmed live: scratch/CG-AL-X053/correct/
  // contains CG-AL-X053.Test.al today.
  it("excludes the oracle from correct/ so it produces no reference row", async () => {
    const dir = await createTempDir("dashboard-server-oracle-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.mkdir(`${dir}/naive`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, CORRECT);
      await Deno.writeTextFile(`${dir}/correct/CG-AL-X054.Test.al`, ORACLE);
      await Deno.writeTextFile(`${dir}/naive/A.al`, NAIVE);

      const runDeps = {
        scratchDir: dir,
        listDrafts: () =>
          Promise.resolve([{ id: "CG-AL-X054", dir, hasPrereq: false }]),
        loadTrapSources,
        createModelCaller:
          (_context: unknown) => (_model: string, _prompt: string) =>
            Promise.resolve({
              content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
              finishReason: "stop" as const,
            }),
        runQuick,
      } as unknown as Parameters<typeof createHandler>[0];

      const res = await createHandler(runDeps)(
        new Request("http://localhost/api/run", {
          method: "POST",
          body: JSON.stringify({ draftId: "CG-AL-X054", models: ["m"] }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      // Exactly one reference row (the solution, codeunit 71410) — none for
      // the oracle (codeunit 80054).
      assertEquals(body.rows.length, 1);
      assertEquals(body.rows[0].key, "codeunit|71410");
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("a missing naive/ produces cannot-compare rather than an error", async () => {
    const dir = await createTempDir("dashboard-server-no-naive-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, CORRECT);
      // Deliberately no naive/ directory.

      const runDeps = {
        scratchDir: dir,
        listDrafts: () =>
          Promise.resolve([{ id: "CG-AL-X054", dir, hasPrereq: false }]),
        loadTrapSources,
        createModelCaller:
          (_context: unknown) => (_model: string, _prompt: string) =>
            Promise.resolve({
              content: `BEGIN-CODE\n${CORRECT}\nEND-CODE`,
              finishReason: "stop" as const,
            }),
        runQuick,
      } as unknown as Parameters<typeof createHandler>[0];

      const res = await createHandler(runDeps)(
        new Request("http://localhost/api/run", {
          method: "POST",
          body: JSON.stringify({ draftId: "CG-AL-X054", models: ["m"] }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.responses[0].classification.verdict, "cannot-compare");
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

describe("dashboard/source-loader", () => {
  it("reads multiple .al files from correct/ and naive/, sorted by filename", async () => {
    const dir = await createTempDir("dashboard-source-loader-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.mkdir(`${dir}/naive`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, "content-A");
      await Deno.writeTextFile(`${dir}/correct/B.al`, "content-B");
      // A non-.al file must be ignored.
      await Deno.writeTextFile(`${dir}/correct/app.json`, "{}");
      await Deno.writeTextFile(`${dir}/naive/C.al`, "content-C");

      const sources = await loadTrapSources("CG-AL-X999", dir);
      assertEquals(sources.correctSources, ["content-A", "content-B"]);
      assertEquals(sources.naiveSources, ["content-C"]);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("treats a missing naive/ as an empty array, not an error", async () => {
    const dir = await createTempDir("dashboard-source-loader-missing-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, "content-A");
      // Deliberately no naive/ directory.

      const sources = await loadTrapSources("CG-AL-X999", dir);
      assertEquals(sources.correctSources, ["content-A"]);
      assertEquals(sources.naiveSources, []);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  // The oracle (<id>.Test.al) plus any companion (<id>.Mock.al, etc.) are
  // oracle-side per the reserved "<id>." prefix (src/workbench/oracle-files.ts)
  // and must not be treated as reference solution sources.
  it("excludes <id>-prefixed oracle/companion files from both correct/ and naive/", async () => {
    const dir = await createTempDir("dashboard-source-loader-oracle-test");
    try {
      await Deno.mkdir(`${dir}/correct`, { recursive: true });
      await Deno.mkdir(`${dir}/naive`, { recursive: true });
      await Deno.writeTextFile(`${dir}/correct/A.al`, "content-A");
      await Deno.writeTextFile(
        `${dir}/correct/CG-AL-X054.Test.al`,
        "oracle-content",
      );
      await Deno.writeTextFile(
        `${dir}/correct/CG-AL-X054.Mock.al`,
        "companion-content",
      );
      await Deno.writeTextFile(`${dir}/naive/B.al`, "content-B");

      const sources = await loadTrapSources("CG-AL-X054", dir);
      assertEquals(sources.correctSources, ["content-A"]);
      assertEquals(sources.naiveSources, ["content-B"]);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
