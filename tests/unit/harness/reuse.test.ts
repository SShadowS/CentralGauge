/**
 * M11-06 end to end: reuseCheck on a frozen workspace, judged by FakeBc.
 * The fake cannot run AL, so each case says how each oracle test reaches a
 * target: which target it calls, whether it uses the result, and whether a
 * [TryFunction] swallows the target's error. A probed target is recognized
 * by its body tag (`// body <codeunit>`) being gone from the deployed source.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { BcLane } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import {
  REUSE_MARKER,
  reuseCheck,
  TaskMeasuresSchema,
} from "../../../src/harness/measures.ts";
import type { JudgmentRecord } from "../../../src/harness/records.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import { FakeBc, result } from "./fake-bc.ts";
import { IDS, makeRefappRepo, write } from "./refapp-fixture.ts";

const PRICE = "Rental/src/Price.Codeunit.al";
const ALT = "Rental/src/PriceAlt.Codeunit.al";
const priceCu = (head = "CalcSurcharge(Amount: Decimal): Decimal") =>
  `codeunit 70210 "CGR Price Mgt"
{
    procedure ${head}
    begin
        exit(Amount * 0.1); // body 70210
    end;
}
`;
const altCu = `codeunit 70212 "CGR Price Alt"
{
    procedure CalcSurchargeAlt(Amount: Decimal): Decimal
    begin
        exit(Amount / 10); // body 70212
    end;
}
`;
const TARGET = {
  codeunit: 70210,
  procedure: "CalcSurcharge",
  signature: "(Amount: Decimal): Decimal",
  file: PRICE,
  perturb: "exit(-1);",
};
const ALT_TARGET = {
  codeunit: 70212,
  procedure: "CalcSurchargeAlt",
  signature: "(Amount: Decimal): Decimal",
  file: ALT,
  perturb: "exit(-1);",
};

/** How one oracle test reaches a target; null: duplicated logic, no call. */
type Path = { target: number; uses: boolean; caught?: boolean } | null;

function bc(paths: Record<string, Path>): FakeBc {
  return new FakeBc((cu, deployed) => {
    if (cu !== 85000) return result({});
    const src = [...deployed.values()].map((a) => a.source).join("\n");
    const out: Record<string, true | string> = {};
    for (const [proc, p] of Object.entries(paths)) {
      const probed = p !== null && !src.includes(`// body ${p.target}`);
      if (probed && src.includes(REUSE_MARKER) && !p.caught) {
        out[proc] = `Error: ${REUSE_MARKER}`;
      } else if (probed && src.includes("exit(-1);") && p.uses) {
        out[proc] = "Assert.AreEqual failed. Expected:<10>";
      } else out[proc] = true;
    }
    return result(out);
  });
}

async function setup(
  files: Record<string, string>,
  procs: string[],
  targets: unknown[],
) {
  const repo = await makeRefappRepo();
  const dir = join(repo.tasksDir, "HX-001");
  await write(
    dir,
    "oracle/src/Oracle.Test.al",
    `codeunit 85000 "HX-001 Oracle"\n{\n    Subtype = Test;\n${
      procs.map((p) =>
        `\n    [Test]\n    procedure ${p}()\n    begin\n    end;\n`
      )
        .join("")
    }}\n`,
  );
  const task = await loadTask(dir);
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: join(await Deno.realPath(await Deno.makeTempDir()), "stage"),
  });
  const ws = await Deno.realPath(await Deno.makeTempDir());
  await safeCopyTree(staged.pristine, ws);
  await applyOverlay(join(task.dir, "correct"), ws);
  for (const [rel, text] of Object.entries(files)) await write(ws, rel, text);
  const results = await Deno.realPath(await Deno.makeTempDir());
  const frozen = await freezeWorkspace({
    resultsRoot: results,
    privateRoot: await Deno.realPath(await Deno.makeTempDir()),
    workspace: ws,
    secrets: [],
  });
  const judgment = (pass: boolean) =>
    ({
      scorers: [{
        name: "fail_to_pass",
        passed: pass,
        tests: procs.map((procedure) => ({
          codeunit: 85000,
          procedure,
          target: "candidate",
          outcome: pass ? "pass" : "fail",
          failure: pass ? null : "assertion",
        })),
      }],
    }) as unknown as JudgmentRecord;
  return async (fake: FakeBc, pass = true) =>
    await reuseCheck(new BcLane(fake, ["C1"]), {
      task,
      measures: TaskMeasuresSchema.parse({
        v: 1,
        reuse: { targets, tests: [{ codeunit: 85000, procedures: procs }] },
      }),
      judgment: judgment(pass),
      judge: {
        workspaceHash: frozen.workspace_hash,
        oracleHash: await oracleHash(task),
        pristine: staged.pristine,
        symbolIds: new Set([IDS.assert]),
        lock: { store: repo.symbolStore, packages: repo.symbols },
        deploy: { ledgerRoot: join(results, "bc-ledger") },
      },
      artifact: join(results, frozen.stored_path),
      workDir: await Deno.realPath(await Deno.makeTempDir()),
    });
}

const one = () => setup({ [PRICE]: priceCu() }, ["FixWorks"], [TARGET]);
const both = (procs = ["FixWorks"]) =>
  setup(
    { [PRICE]: priceCu(), [ALT]: altCu },
    procs,
    [TARGET, ALT_TARGET],
  );

Deno.test("reuseCheck: a call whose result is used is executed and effective", async () => {
  const run = await one();
  assertEquals(await run(bc({ FixWorks: { target: 70210, uses: true } })), {
    status: "ok",
    value: { executed: true, effective: true, via: "70210/CalcSurcharge" },
  });
});

Deno.test("reuseCheck: a token call whose result is ignored is executed, not effective", async () => {
  const run = await one();
  assertEquals(await run(bc({ FixWorks: { target: 70210, uses: false } })), {
    status: "ok",
    value: { executed: true, effective: false, via: "70210/CalcSurcharge" },
  });
});

Deno.test("reuseCheck: duplicated logic (no call) is neither executed nor effective", async () => {
  const run = await one();
  assertEquals(await run(bc({ FixWorks: null })), {
    status: "ok",
    value: { executed: false, effective: false, via: null },
  });
});

Deno.test("reuseCheck: a target the agent renamed, with no alternative, is missing", async () => {
  const run = await setup(
    { [PRICE]: priceCu("CalcSurchargeNew(Amount: Decimal): Decimal") },
    ["FixWorks"],
    [TARGET],
  );
  assertEquals(await run(bc({ FixWorks: { target: 70210, uses: true } })), {
    status: "missing",
    reason: "no reuse target located in the final workspace",
  });
});

Deno.test("reuseCheck: first target re-signed, the accepted alternative is used", async () => {
  const run = await setup(
    {
      [PRICE]: priceCu(
        "CalcSurcharge(Amount: Decimal; Weekend: Boolean): Decimal",
      ),
      [ALT]: altCu,
    },
    ["FixWorks"],
    [TARGET, ALT_TARGET],
  );
  assertEquals(await run(bc({ FixWorks: { target: 70212, uses: true } })), {
    status: "ok",
    value: { executed: true, effective: true, via: "70212/CalcSurchargeAlt" },
  });
});

Deno.test("reuseCheck: a probe that does not build is missing, never reused: false", async () => {
  // FakeBc fails any compile whose source carries COMPILE_ERROR.
  const run = await setup({ [PRICE]: priceCu() }, ["FixWorks"], [{
    ...TARGET,
    perturb: "COMPILE_ERROR",
  }]);
  const r = await run(bc({ FixWorks: { target: 70210, uses: true } }));
  assertEquals(r.status, "missing");
  assertStringIncludes(
    r.status === "missing" ? r.reason : "",
    "probe did not build",
  );
  assertEquals(
    r.status === "missing" && r.reason.startsWith("probe did not build"),
    true,
  );
});

Deno.test("reuseCheck: a reuse test that failed in the real judgment is not evaluable", async () => {
  const run = await one();
  const r = await run(bc({ FixWorks: { target: 70210, uses: true } }), false);
  assertEquals(r.status, "missing");
  assertEquals(
    r.status === "missing" && r.reason.startsWith("not evaluable"),
    true,
  );
});

Deno.test("reuseCheck: two reuse tests through different accepted targets", async () => {
  const run = await both(["FixWorks", "SecondWorks"]);
  assertEquals(
    await run(bc({
      FixWorks: { target: 70210, uses: true },
      SecondWorks: { target: 70212, uses: true },
    })),
    {
      status: "ok",
      value: {
        executed: true,
        effective: true,
        via: "70210/CalcSurcharge+70212/CalcSurchargeAlt",
      },
    },
  );
});

Deno.test("reuseCheck: a caught call whose result is used reads as executed through the perturbation", async () => {
  const run = await one();
  assertEquals(
    await run(bc({ FixWorks: { target: 70210, uses: true, caught: true } })),
    {
      status: "ok",
      value: { executed: true, effective: true, via: "70210/CalcSurcharge" },
    },
  );
});

Deno.test("reuseCheck: a caught call whose result is ignored is the stated lower bound", async () => {
  const run = await one();
  assertEquals(
    await run(bc({ FixWorks: { target: 70210, uses: false, caught: true } })),
    { status: "ok", value: { executed: false, effective: false, via: null } },
  );
});
