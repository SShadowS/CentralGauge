/**
 * Generate the elevated firewall scripts ops run in M1-34 (M1-33). This
 * script only writes files; it never runs PowerShell or touches the host.
 * Usage:
 *   deno run --allow-all scripts/harness/egress-scripts.ts apply --invocation <id> --dir <dir> --interface-index <n> --interface-alias <alias> --out <apply.ps1>
 *   deno run --allow-all scripts/harness/egress-scripts.ts revert --dir <dir> --out <revert.ps1>
 * The interface index and alias are the adapter that owns 172.30.60.1
 * (`harness egress verify` prints problems naming it). The same inputs always
 * give the same script. Files are written with a UTF-8 BOM (Windows
 * PowerShell 5.1 reads BOM-less files as ANSI).
 */

import { parseArgs } from "@std/cli/parse-args";
import {
  applyScript,
  firewallPlan,
  revertScript,
} from "../../src/harness/egress.ts";

const a = parseArgs(Deno.args, {
  string: ["invocation", "dir", "interface-index", "interface-alias", "out"],
});
try {
  const [verb] = a._;
  if (!a.dir || !a.out) throw new Error("--dir and --out are required");
  let text: string;
  if (verb === "apply") {
    const index = Number(a["interface-index"]);
    if (!a.invocation || !a["interface-alias"]) {
      throw new Error("apply needs --invocation and --interface-alias");
    }
    text = applyScript(firewallPlan(index), {
      invocation: a.invocation,
      dir: a.dir,
      interfaceAlias: a["interface-alias"],
    });
  } else if (verb === "revert") {
    text = revertScript(a.dir);
  } else {
    throw new Error(`unknown verb ${verb ?? "(none)"}: apply or revert`);
  }
  await Deno.writeTextFile(a.out, "﻿" + text, { createNew: true });
  console.log(`[OK] wrote ${a.out}`);
} catch (err) {
  console.error(`[FAIL] ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
}
