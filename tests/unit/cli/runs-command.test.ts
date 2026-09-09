import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  findResultsFileForRun,
  postRunExclusion,
  stampBatchRunDir,
  stampResultsFile,
} from "../../../src/ingest/run-exclusion.ts";
import { canonicalJSON } from "../../../src/ingest/canonical.ts";

/**
 * `centralgauge runs exclude` / `runs include`: the signed admin POST and the
 * local results-file stamp (migration 0022, site side).
 */

const RUN_ID = "20a0f409-7e1a-4ea8-a060-b3a8429bcf31";
const OTHER_RUN_ID = "8e71584d-0000-0000-0000-000000000000";
const REASON = "host OOM during evaluation";
// Ed25519 seeds are 32 bytes; the value is irrelevant here because the POST
// path is exercised against a stub fetch, but signPayload must be able to
// derive a key from it.
const PRIVATE_KEY = new Uint8Array(32).fill(7);

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "cg-run-exclusion-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** A results file shaped like the bench writes: run ids under `ingest.run_ids`. */
async function writeResultsFile(
  dir: string,
  stamp: string,
  runIds: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const path = join(dir, `benchmark-results-${stamp}.json`);
  await Deno.writeTextFile(
    path,
    JSON.stringify(
      {
        results: [{ taskId: "CG-AL-E001" }],
        stats: { totalCost: 1.23 },
        ingest: { schema: 4, pricing_version: "2026-09-08", run_ids: runIds },
        ...extra,
      },
      null,
      2,
    ),
  );
  return path;
}

Deno.test("findResultsFileForRun matches on the persisted ingest run id", async (t) => {
  await withTempDir(async (dir) => {
    const wanted = await writeResultsFile(dir, "1766231317889", {
      "variant-a": RUN_ID,
    });
    await writeResultsFile(dir, "1766231317000", { "variant-a": OTHER_RUN_ID });
    // Not a results file at all; must be ignored rather than parsed as one.
    await Deno.writeTextFile(join(dir, "notes.json"), "{}");
    // Malformed JSON must not abort the scan.
    await Deno.writeTextFile(
      join(dir, "benchmark-results-1766231399999.json"),
      "{ not json",
    );

    await t.step("finds the file whose run_ids contain the run", async () => {
      const found = await findResultsFileForRun(dir, RUN_ID);
      assertEquals(found?.path, wanted);
      assertEquals(found?.runIds, [RUN_ID]);
    });

    await t.step("returns null for a run with no local file", async () => {
      assertEquals(
        await findResultsFileForRun(dir, "no-such-run-id"),
        null,
      );
    });

    await t.step("returns null when the directory is absent", async () => {
      assertEquals(
        await findResultsFileForRun(join(dir, "nope"), RUN_ID),
        null,
      );
    });
  });
});

Deno.test("stampResultsFile marks and unmarks the local results file", async (t) => {
  await withTempDir(async (dir) => {
    const path = await writeResultsFile(dir, "1766231317889", {
      "variant-a": RUN_ID,
    });

    await t.step("adds a top-level excluded object", async () => {
      const outcome = await stampResultsFile(path, RUN_ID, {
        at: "2026-09-08T00:00:00.000Z",
        reason: REASON,
      });
      assertEquals(outcome, "stamped");
      const parsed = JSON.parse(await Deno.readTextFile(path)) as {
        excluded?: { at: string; reason: string; run_ids: string[] };
        results: unknown[];
        ingest: unknown;
      };
      assertEquals(parsed.excluded?.at, "2026-09-08T00:00:00.000Z");
      assertEquals(parsed.excluded?.reason, REASON);
      assertEquals(parsed.excluded?.run_ids, [RUN_ID]);
      // Everything else survives the rewrite.
      assertEquals(parsed.results.length, 1);
      assert(parsed.ingest !== undefined);
    });

    await t.step("re-stamping updates the reason in place", async () => {
      await stampResultsFile(path, RUN_ID, {
        at: "2026-09-09T00:00:00.000Z",
        reason: "corrected",
      });
      const parsed = JSON.parse(await Deno.readTextFile(path)) as {
        excluded?: { reason: string; run_ids: string[] };
      };
      assertEquals(parsed.excluded?.reason, "corrected");
      assertEquals(parsed.excluded?.run_ids, [RUN_ID]);
    });

    await t.step("clearing removes the key entirely", async () => {
      const outcome = await stampResultsFile(path, RUN_ID, null);
      assertEquals(outcome, "cleared");
      const parsed = JSON.parse(await Deno.readTextFile(path)) as
        & Record<string, unknown>
        & { excluded?: unknown };
      assertEquals("excluded" in parsed, false);
    });

    await t.step("clearing an unmarked file is a no-op", async () => {
      assertEquals(await stampResultsFile(path, RUN_ID, null), "unchanged");
    });
  });
});

Deno.test("stampResultsFile keeps the file excluded while another run in it is still excluded", async () => {
  await withTempDir(async (dir) => {
    // One results file, two variants, hence two ingest run ids. The local
    // stats importer treats a file as ONE run and cannot split it by variant,
    // so the file stays marked until every excluded run in it is included
    // again. Otherwise re-including one variant would quietly re-admit the
    // other one's numbers to the local score tables.
    const path = await writeResultsFile(dir, "1766231317889", {
      "variant-a": RUN_ID,
      "variant-b": OTHER_RUN_ID,
    });
    await stampResultsFile(path, RUN_ID, { at: "t1", reason: "a" });
    await stampResultsFile(path, OTHER_RUN_ID, { at: "t2", reason: "b" });
    let parsed = JSON.parse(await Deno.readTextFile(path)) as {
      excluded?: { run_ids: string[] };
    };
    assertEquals(parsed.excluded?.run_ids, [RUN_ID, OTHER_RUN_ID]);

    assertEquals(await stampResultsFile(path, RUN_ID, null), "stamped");
    parsed = JSON.parse(await Deno.readTextFile(path)) as {
      excluded?: { run_ids: string[] };
    };
    assertEquals(parsed.excluded?.run_ids, [OTHER_RUN_ID]);

    assertEquals(await stampResultsFile(path, OTHER_RUN_ID, null), "cleared");
    const final = JSON.parse(await Deno.readTextFile(path)) as Record<
      string,
      unknown
    >;
    assertEquals("excluded" in final, false);
  });
});

Deno.test("stampBatchRunDir writes and removes the batch run marker", async (t) => {
  await withTempDir(async (dir) => {
    const runDir = join(dir, "batch", RUN_ID);
    await Deno.mkdir(runDir, { recursive: true });

    await t.step("writes excluded.json into an existing run dir", async () => {
      const outcome = await stampBatchRunDir(dir, RUN_ID, {
        at: "2026-09-08T00:00:00.000Z",
        reason: REASON,
      });
      assertEquals(outcome, "stamped");
      const parsed = JSON.parse(
        await Deno.readTextFile(join(runDir, "excluded.json")),
      ) as { at: string; reason: string; run_id: string };
      assertEquals(parsed.run_id, RUN_ID);
      assertEquals(parsed.reason, REASON);
    });

    await t.step("removes it on include", async () => {
      assertEquals(await stampBatchRunDir(dir, RUN_ID, null), "cleared");
      await assertRejects(
        () => Deno.stat(join(runDir, "excluded.json")),
        Deno.errors.NotFound,
      );
    });

    await t.step("is a no-op when the run dir does not exist", async () => {
      assertEquals(
        await stampBatchRunDir(dir, "no-such-run", { at: "t", reason: "r" }),
        "absent",
      );
      assertEquals(await stampBatchRunDir(dir, "no-such-run", null), "absent");
    });
  });
});

Deno.test("postRunExclusion posts a signed version-1 envelope", async (t) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({ ok: true, excluded: true, changed: true }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;

  await t.step(
    "signs the canonical payload and hits the admin route",
    async () => {
      const res = await postRunExclusion(
        { url: "https://example.test/", adminKeyId: 3 },
        PRIVATE_KEY,
        { runId: RUN_ID, reason: REASON, exclude: true },
        { fetchFn },
      );
      assertEquals(res.status, 200);
      assertEquals(res.ok, true);

      assertEquals(calls.length, 1);
      const call = calls[0]!;
      // Trailing slash on the configured URL must not double up.
      assertEquals(call.url, "https://example.test/api/v1/admin/runs/exclude");
      const body = call.body as {
        version: number;
        payload: Record<string, unknown>;
        signature: { alg: string; key_id: number; value: string };
      };
      assertEquals(body.version, 1);
      assertEquals(body.payload, {
        run_id: RUN_ID,
        reason: REASON,
        exclude: true,
      });
      assertEquals(body.signature.alg, "Ed25519");
      assertEquals(body.signature.key_id, 3);
      assert(body.signature.value.length > 0);
      // The signed message is canonical(payload), matching what
      // verifySignedRequest recomputes server-side.
      assert(
        canonicalJSON(body.payload).includes(`"run_id":"${RUN_ID}"`),
        "payload must canonicalize with the run id",
      );
    },
  );

  await t.step("sends an empty reason on include", async () => {
    calls.length = 0;
    await postRunExclusion(
      { url: "https://example.test", adminKeyId: 3 },
      PRIVATE_KEY,
      { runId: RUN_ID, reason: "", exclude: false },
      { fetchFn },
    );
    assertEquals(calls[0]!.body["payload"], {
      run_id: RUN_ID,
      reason: "",
      exclude: false,
    });
  });
});

Deno.test("postRunExclusion surfaces a server refusal instead of throwing", async () => {
  const fetchFn = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error: "run x not found", code: "run_not_found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    )) as typeof fetch;

  const res = await postRunExclusion(
    { url: "https://example.test", adminKeyId: 3 },
    PRIVATE_KEY,
    { runId: "x", reason: "r", exclude: true },
    { fetchFn },
  );
  assertEquals(res.status, 404);
  assertEquals(res.ok, false);
  assertEquals(res.code, "run_not_found");
});
