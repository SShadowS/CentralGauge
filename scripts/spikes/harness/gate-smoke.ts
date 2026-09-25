// SPIKE (throwaway): harness bench M4-01c smoke evidence
// Usage: deno run --allow-all scripts/spikes/harness/gate-smoke.ts <container>
// Runs ONE baseline variant of a synthetic bugfix task (the real refapp + a one-test
// oracle) through the real containerBc + runVariant, prints the RunResult and summary.
import { join } from "@std/path";
import { copy } from "@std/fs";
import { summarize } from "../../harness/gate-core.ts";
import { containerBc, runVariant } from "../../harness/gate-task.ts";
import { loadTask } from "../../../src/harness/task.ts";

const container = Deno.args[0];
if (!container) throw new Error("usage: gate-smoke.ts <container>");
const TMP = join(
  Deno.env.get("CG_GATE_TMP") ?? "H:\\Temp3\\harness-spike\\M4\\tmp",
  "smoke",
);
await Deno.mkdir(TMP, { recursive: true });
const root = await Deno.makeTempDir({ dir: TMP });
const refappDir = join(root, "harness-tasks", "refapp");
await copy(join(Deno.cwd(), "harness-tasks", "refapp"), refappDir);
const taskDir = join(root, "harness-tasks", "tasks", "HX-001");
await Deno.mkdir(join(taskDir, "oracle", "src"), { recursive: true });
await Deno.writeTextFile(
  join(taskDir, "task.yml"),
  `id: HX-001
refapp_version: refapp-v1-rc1
kind: bugfix
prompt: prompt.md
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80000, procedures: [CheckOutMarksVehicleCheckedOut, CheckOutTwiceFails, HeavyDutyStrategyFromFleetExtension, LeaseRateUsesCoreInternal, PayloadCarriesVehicleNo] }
fail_to_pass:
  depends_on: [Core, Leasing]
  tests:
    - { codeunit: 85000, procedures: [SmokeLeaseRate] }
`,
);
await Deno.writeTextFile(join(taskDir, "prompt.md"), "# Smoke\n");
await Deno.writeTextFile(
  join(taskDir, "oracle", "app.json"),
  JSON.stringify(
    {
      id: "c6a1e000-0000-4000-8001-000000000001",
      name: "CGR Oracle HX-001",
      publisher: "CentralGauge",
      version: "1.0.0.0",
      platform: "28.0.0.0",
      application: "28.0.0.0",
      idRanges: [{ from: 85000, to: 85099 }],
      runtime: "17.0",
      target: "OnPrem",
      features: ["NoImplicitWith"],
      dependencies: [
        {
          id: "c6a1e000-0000-4000-8000-000000000001",
          name: "CGR Core",
          publisher: "CentralGauge",
          version: "1.0.0.0",
        },
        {
          id: "c6a1e000-0000-4000-8000-000000000004",
          name: "CGR Leasing",
          publisher: "CentralGauge",
          version: "1.0.0.0",
        },
        {
          id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
          name: "Library Assert",
          publisher: "Microsoft",
          version: "28.0.0.0",
        },
      ],
    },
    null,
    2,
  ),
);
await Deno.writeTextFile(
  join(taskDir, "oracle", "src", "SmokeOracle.Codeunit.al"),
  `codeunit 85000 "CGR Smoke Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure SmokeLeaseRate()
    var
        Assert: Codeunit "Library Assert";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        Assert.AreEqual(112, LeaseMgt.MonthlyRate(100, 12), 'lease rate');
    end;
}
`,
);

const loaded = await loadTask(taskDir);
const source = {
  commit: "0".repeat(40),
  root,
  refappDir,
  refappTree: "0".repeat(40),
  taskDir,
  taskTree: "0".repeat(40),
};
const bc = await containerBc(container, {
  username: Deno.env.get("CG_GATE_BC_USER") ?? "sshadows",
  password: Deno.env.get("CG_GATE_BC_PASSWORD") ?? "1234",
});
if (!bc) throw new Error(`${container} not healthy/visible`);
const t0 = Date.now();
try {
  const run = await runVariant(
    bc,
    loaded.task,
    source,
    { kind: "baseline" },
    1,
    TMP,
  );
  console.log(
    JSON.stringify(
      { wallMs: Date.now() - t0, run, summary: summarize(loaded.task, run) },
      null,
      2,
    ),
  );
} finally {
  await bc.prenuke().catch((e) => console.error(`prenuke: ${e}`));
  await bc.dispose();
  await Deno.remove(root, { recursive: true });
}
