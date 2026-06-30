#!/usr/bin/env -S deno run -A
// Discrimination-probe driver. Runs a task's oracle against a provided AL
// solution directory and asserts the pass/fail outcome.
// Usage: deno run -A scripts/trap-probe.ts --task CG-AL-X002 --solution <dir> --expect pass|fail [--container Cronus28]
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import * as colors from "@std/fmt/colors";
import { handleAlVerifyTask } from "../mcp/al-tools-server.ts";

// Exact return shape of handleAlVerifyTask / handleAlVerify, copied from
// `interface VerifyResult` in mcp/al-tools-server.ts (~line 913). Note:
// `message` is required (not optional) and test counts are flat optional
// fields (`totalTests`/`passed`/`failed`), not a nested `testResults` object.
type VerifyResult = {
  success: boolean;
  message: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  failures?: string[];
  compileErrors?: string[];
};

const a = parseArgs(Deno.args, {
  string: ["task", "solution", "expect", "container"],
  default: { container: "Cronus28" },
});

if (!a.task || !a.solution || !a.expect) {
  console.error("Required: --task <id> --solution <dir> --expect pass|fail");
  Deno.exit(2);
}
if (a.expect !== "pass" && a.expect !== "fail") {
  console.error(`--expect must be 'pass' or 'fail', got '${a.expect}'`);
  Deno.exit(2);
}

// Resolve to an absolute path before crossing into handleAlVerifyTask: the
// compile pool runs scripts in a pwsh subprocess whose working directory is
// NOT this Deno process's cwd (it resolves relative to the AL compiler's own
// bin directory), so a relative --solution silently produces
// "AL1001: Source file ... could not be found" inside the container's
// compile step. Resolving here keeps the CLI ergonomic (relative paths still
// work from the invoker's shell) while the handler always sees an absolute
// path.
const solutionDir = resolve(a.solution);

const res: VerifyResult = await handleAlVerifyTask({
  projectDir: solutionDir,
  taskId: a.task,
  containerName: a.container,
});

const passed = res.success === true;
const actual = passed ? "pass" : "fail";
console.log(`[trap-probe] ${a.task}: actual=${actual} expected=${a.expect}`);
if (res.message) console.log(`[trap-probe] message: ${res.message}`);
if (res.totalTests !== undefined) {
  console.log(
    `[trap-probe] tests: ${res.passed ?? 0}/${res.totalTests} passed` +
      (res.failed ? `, ${res.failed} failed` : ""),
  );
}
if (res.compileErrors?.length) {
  console.log(`[trap-probe] compile errors:`);
  for (const e of res.compileErrors) console.log(`  ${e}`);
}
if (res.failures?.length) {
  console.log(`[trap-probe] test failures:`);
  for (const f of res.failures) console.log(`  ${f}`);
}

if (actual !== a.expect) {
  console.error(
    colors.red(`[trap-probe] MISMATCH — discrimination NOT satisfied`),
  );
  Deno.exit(1);
}
console.log(colors.green(`[trap-probe] OK`));
// Explicit exit: BcContainerProvider keeps pooled pwsh child-process handles
// (compile session pool, per-container session slot) open for reuse across
// calls within a long-lived host (MCP server, bench run). A one-shot CLI
// invocation has no such host, so those open handles keep the event loop
// alive and the process would otherwise hang indefinitely after printing OK
// instead of returning control to the caller (verified: a successful run
// left a `deno.exe` process alive for 10+ minutes until force-killed).
Deno.exit(0);
