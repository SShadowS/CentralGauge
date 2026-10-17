import { dirname, join } from "@std/path";
import { BUILD_ORDER } from "../../../scripts/harness/gate-core.ts";
import { oracleBandOf } from "../../../scripts/harness/gate-stage.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

/** Unit-test temp root under the launch contract's authorized output root. */
export const TEST_TMP = join(
  Deno.env.get("CG_GATE_TMP") ?? "H:\\Temp3\\harness-spike\\M4\\tmp",
  "unit",
);
export async function tmp(): Promise<string> {
  await Deno.mkdir(TEST_TMP, { recursive: true });
  return await testTempDir({ dir: TEST_TMP });
}

export async function write(
  root: string,
  rel: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
  await Deno.writeTextFile(join(root, rel), text);
}

const TEST_CU = (id: number, proc: string) =>
  `codeunit ${id} "T${id}"\n{\n    Subtype = Test;\n    TestPermissions = Disabled;\n\n    [Test]\n    procedure ${proc}()\n    begin\n    end;\n}\n`;
export { TEST_CU };

/** A refapp with all seven modules (stageWorkspace refuses an incomplete one). */
export async function writeRefapp(refapp: string): Promise<void> {
  let n = 0;
  for (const m of BUILD_ORDER) {
    n++;
    // As the real refapp (H-05: the gate reads them for its CGR data clean).
    const from = m === "Test" ? 80000 : 70000 + 100 * (n - 1);
    await write(
      refapp,
      `${m}/app.json`,
      JSON.stringify({
        id: `c6a1e000-0000-4000-8000-00000000000${n}`,
        name: `CGR ${m}`,
        publisher: "CentralGauge",
        version: "1.0.0.0",
        idRanges: [{ from, to: m === "Test" ? 84999 : from + 99 }],
      }),
    );
  }
  await write(refapp, "Core/src/A.al", 'codeunit 70000 "A"\n{\n}\n');
  await write(refapp, "Test/src/V.al", TEST_CU(80010, "Visible"));
}

/** Repo layout harness-tasks/{refapp,tasks/<id>} with a clean bugfix task. */
export async function writeTask(
  root: string,
  id: string,
  promptText: string,
): Promise<string> {
  await writeRefapp(join(root, "harness-tasks/refapp"));
  const dir = join(root, "harness-tasks/tasks", id);
  // Each task owns its oracle band (gate-stage oracleBandOf).
  const [band, bandTo] = oracleBandOf(Number(id.slice(3)))!;
  await write(
    dir,
    "task.yml",
    `id: ${id}
refapp_version: refapp-v1-rc1
kind: bugfix
prompt: prompt.md
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [Visible] }
fail_to_pass:
  depends_on: [Core]
  tests:
    - { codeunit: ${band}, procedures: [Hidden] }
`,
  );
  await write(dir, "prompt.md", promptText);
  await write(
    dir,
    "oracle/app.json",
    JSON.stringify({
      id: `c6a1e000-0000-4000-8001-000000000${id.slice(3)}`,
      name: `CGR Oracle ${id}`,
      publisher: "CentralGauge",
      version: "1.0.0.0",
      idRanges: [{ from: band, to: bandTo }],
      dependencies: [
        { id: "c6a1e000-0000-4000-8000-000000000001", name: "CGR Core" },
        { id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14", name: "Library Assert" },
      ],
    }),
  );
  await write(dir, "oracle/src/O.al", TEST_CU(band, "Hidden"));
  for (const l of ["overlay", "correct", "naive/x", "naive/y"]) {
    await write(
      dir,
      `${l}/Core/src/A.al`,
      'codeunit 70000 "A"\n{\n    // ' + l + "\n}\n",
    );
  }
  return dir;
}
