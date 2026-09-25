/**
 * A throwaway git repo with a three-app refapp (Core, Rental -> Core, Test ->
 * both + Library Assert), one bugfix task HX-001 with overlay, oracle,
 * correct/ and naive/a, a symbol store and a symbols lock. Needs git on PATH.
 */

import { join } from "@std/path";
import { hashFile } from "../../../src/harness/hash.ts";
import type { SymbolPackage } from "../../../src/harness/identity.ts";
import { writeSymbolsLock } from "../../../src/harness/symbols.ts";

export const IDS = {
  core: "c6a1e000-0000-4000-8000-000000000001",
  rental: "c6a1e000-0000-4000-8000-000000000003",
  test: "c6a1e000-0000-4000-8000-000000000007",
  oracle: "c6a1e000-0000-4000-8000-0000000000f1",
  assert: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
};

export async function write(root: string, rel: string, text: string) {
  const p = join(root, ...rel.split("/"));
  await Deno.mkdir(join(p, ".."), { recursive: true });
  await Deno.writeTextFile(p, text);
}

export async function git(root: string, ...args: string[]) {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
}

export function appJson(
  id: string,
  name: string,
  range: [number, number],
  deps: { id: string; name: string }[],
): string {
  return JSON.stringify(
    {
      id,
      name,
      publisher: "CentralGauge",
      version: "1.0.0.0",
      platform: "28.0.0.0",
      application: "28.0.0.0",
      idRanges: [{ from: range[0], to: range[1] }],
      runtime: "17.0",
      dependencies: deps.map((d) => ({
        id: d.id,
        name: d.name,
        publisher: d.id === IDS.assert ? "Microsoft" : "CentralGauge",
        version: "1.0.0.0",
      })),
    },
    null,
    2,
  );
}

const rental = (body: string) =>
  `codeunit 70200 "CGR Rental"\n{\n    procedure Price(): Integer\n    begin\n        ${body}\n    end;\n}\n`;

export const TASK_YML = `id: HX-001
refapp_version: refapp-v1
kind: bugfix
prompt: prompt.md
attachments: [shots/screen.png]
source: refapp
scorers: [build, pass_to_pass, fail_to_pass]
pass_to_pass:
  - { codeunit: 80010, procedures: [ShippedPasses] }
fail_to_pass:
  depends_on: [Rental]
  tests:
    - { codeunit: 85000, procedures: [FixWorks] }
limits: { timeout_min: 20 }
`;

export interface RefappRepo {
  root: string;
  tasksDir: string;
  symbolStore: string;
  symbols: SymbolPackage[];
}

export async function makeRefappRepo(): Promise<RefappRepo> {
  const root = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "cg-refapp-" }),
  );
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "t@example.com");
  await git(root, "config", "user.name", "t");
  const r = "harness-tasks/refapp";
  await write(
    root,
    `${r}/Core/app.json`,
    appJson(IDS.core, "CGR Core", [70000, 70099], []),
  );
  await write(
    root,
    `${r}/Core/src/Core.Codeunit.al`,
    `codeunit 70000 "CGR Core"\n{\n}\n`,
  );
  await write(root, `${r}/Core/Core.app`, "tracked build output");
  await write(
    root,
    `${r}/Rental/app.json`,
    appJson(IDS.rental, "CGR Rental", [70200, 70299], [{
      id: IDS.core,
      name: "CGR Core",
    }]),
  );
  await write(root, `${r}/Rental/src/Rental.Codeunit.al`, rental("exit(10);"));
  await write(
    root,
    `${r}/Rental/src/Old.Codeunit.al`,
    `codeunit 70201 "CGR Old"\n{\n}\n`,
  );
  await write(
    root,
    `${r}/Test/app.json`,
    appJson(IDS.test, "CGR Test", [80000, 84999], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    root,
    `${r}/Test/src/Shipped.Test.al`,
    `codeunit 80010 "CGR Shipped Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure ShippedPasses()\n    begin\n    end;\n}\n`,
  );
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "refapp");
  await git(root, "tag", "refapp-v1");

  const t = "harness-tasks/tasks/HX-001";
  await write(root, `${t}/task.yml`, TASK_YML);
  await write(root, `${t}/prompt.md`, "Rental price is wrong.");
  await write(root, `${t}/shots/screen.png`, "png");
  await write(
    root,
    `${t}/overlay/Rental/src/Rental.Codeunit.al`,
    rental("exit(11); // BUG"),
  );
  await write(
    root,
    `${t}/overlay/.delete`,
    "# removed feature\nRental/src/Old.Codeunit.al\n",
  );
  await write(
    root,
    `${t}/oracle/app.json`,
    appJson(IDS.oracle, "CGR Oracle HX-001", [85000, 85099], [
      { id: IDS.core, name: "CGR Core" },
      { id: IDS.rental, name: "CGR Rental" },
      { id: IDS.assert, name: "Library Assert" },
    ]),
  );
  await write(
    root,
    `${t}/oracle/src/Oracle.Test.al`,
    `codeunit 85000 "HX-001 Oracle"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure FixWorks()\n    begin\n    end;\n}\n`,
  );
  await write(
    root,
    `${t}/correct/Rental/src/Rental.Codeunit.al`,
    rental("exit(10); // FIXED"),
  );
  await write(
    root,
    `${t}/naive/a/Rental/src/Rental.Codeunit.al`,
    rental("exit(12); // NAIVE"),
  );

  const symbolStore = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "cg-symstore-" }),
  );
  const file = "Microsoft_Library Assert_28.0.0.0.app";
  const tmp = join(symbolStore, file);
  await Deno.writeTextFile(tmp, "assert-symbols");
  const sha256 = await hashFile(symbolStore, tmp);
  await Deno.rename(tmp, join(symbolStore, `${sha256}.app`));
  const symbols: SymbolPackage[] = [{
    app_id: IDS.assert,
    name: "Library Assert",
    publisher: "Microsoft",
    version: "28.0.0.0",
    file,
    sha256,
  }];
  await writeSymbolsLock(root, { v: 1, packages: symbols });
  return {
    root,
    tasksDir: join(root, "harness-tasks", "tasks"),
    symbolStore,
    symbols,
  };
}
