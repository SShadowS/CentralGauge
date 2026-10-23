/**
 * H-38 8.4 gate contexts (scripts/harness/onprem-gate.ts). An oracle is
 * scanned as Test text over its compile context: the pristine with correct/
 * applied (Test paths excluded, as verdict.ts builds the reference), so the
 * interfaces the solution declares are known. Judging is unchanged.
 */

import { join } from "@std/path";
import type { OnPremIndex } from "../../src/harness/onprem-symbols.ts";
import { safeCopyTree } from "../../src/harness/fsutil.ts";
import { listTree } from "../../src/harness/hash.ts";
import { applyOverlay } from "../../src/harness/staging.ts";
import {
  TEST_APP,
  testPolicyViolations,
  workspaceInterfaces,
} from "../../src/harness/verdict-workspace.ts";

/** The .al files of `dir` (relative, `/`-separated) under an optional top folder. */
export async function alFiles(
  dir: string,
  under?: string,
): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const e of await listTree(dir, "task")) {
    if (!e.path.toLowerCase().endsWith(".al")) continue;
    if (under && !e.path.startsWith(`${under}/`)) continue;
    const rel = under ? e.path.slice(under.length + 1) : e.path;
    out.push([rel, await Deno.readTextFile(join(dir, ...e.path.split("/")))]);
  }
  return out;
}

const isTestPath = (rel: string) =>
  rel === TEST_APP || rel.startsWith(`${TEST_APP}/`);

/** An oracle's compile context at `out`: `pristine` with the task's correct/ applied. */
export async function oracleContext(
  taskDir: string,
  pristine: string,
  out: string,
): Promise<string> {
  await safeCopyTree(pristine, out);
  await applyOverlay(join(taskDir, "correct"), out, { exclude: isTestPath });
  return out;
}

/** The onprem_ref violations of the .al text under `oracleDir`, scanned over `contextDir`. */
export async function oracleHits(
  oracleDir: string,
  contextDir: string,
  index: OnPremIndex,
): Promise<string[]> {
  const ifaces = new Set([
    ...await workspaceInterfaces(contextDir),
    ...await workspaceInterfaces(oracleDir),
  ]);
  return testPolicyViolations(await alFiles(oracleDir), index, ifaces)
    .filter((v) => v.startsWith("onprem_ref: "));
}
