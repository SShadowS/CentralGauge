#!/usr/bin/env -S deno run -A
/**
 * Premise-probe runner (the premise-probe skill). Compiles, publishes and runs
 * one probe test codeunit through `handleAlVerify` with an explicit
 * `testCodeunitId`, so the SOAP harness filters by codeunit and returns the
 * full per-test failure text (the probe reads its `RESULTS-` lines from it).
 *
 * Credentials are registered for the TARGET container before verifying
 * (`prepareContainerForVerification`): the MCP module only sets them for its
 * own default container, and any other container falls back to admin/admin
 * and fails publish with `Status Code Unauthorized`.
 *
 * Usage:
 *   deno run -A scripts/premise-probe-runner.ts --solution <dir> --testFile <path> --codeunit <id>
 *     [--container Cronus281] [--any-container] [--prereq <dir>]
 */
import { parseArgs } from "@std/cli/parse-args";
import { resolve } from "@std/path";
import type { VerifyResult } from "../mcp/al-tools-server.ts";
import { EnvLoader } from "../src/utils/env-loader.ts";
import { resolveContainerCredentials } from "./trap-probe.ts";

/** Containers allocated to this project (owner, 2026-09-25); Cronus28 belongs to LethAL. */
export const ALLOCATED_CONTAINERS = ["Cronus281", "Cronus282", "Cronus283"];

export interface RunnerArgs {
  solution: string;
  testFile: string;
  codeunit: number;
  container: string;
  prereq?: string;
}

export function parseRunnerArgs(args: string[]): RunnerArgs {
  const a = parseArgs(args, {
    string: ["solution", "testFile", "codeunit", "container", "prereq"],
    boolean: ["any-container"],
    default: { container: "Cronus281" },
  });
  if (!a.solution || !a.testFile || !a.codeunit) {
    throw new Error(
      "Required: --solution <dir> --testFile <path> --codeunit <id>",
    );
  }
  const codeunit = Number(a.codeunit);
  if (!Number.isInteger(codeunit) || codeunit < 0) {
    throw new Error(`--codeunit must be a codeunit id, got ${a.codeunit}`);
  }
  if (!a["any-container"] && !ALLOCATED_CONTAINERS.includes(a.container)) {
    throw new Error(
      `${a.container} is not allocated to this project (${
        ALLOCATED_CONTAINERS.join(", ")
      }); pass --any-container to use it anyway`,
    );
  }
  return {
    solution: resolve(a.solution),
    testFile: resolve(a.testFile),
    codeunit,
    container: a.container,
    ...(a.prereq ? { prereq: resolve(a.prereq) } : {}),
  };
}

type Credentials = { username: string; password: string };

export interface RunnerDeps {
  credentials: Credentials;
  prepare: (container: string, credentials: Credentials) => Promise<void>;
  verify: (params: {
    projectDir: string;
    testFile: string;
    containerName: string;
    testCodeunitId: number;
    prereqDir?: string;
  }) => Promise<VerifyResult>;
}

export async function runPremiseProbe(
  args: RunnerArgs,
  deps: RunnerDeps,
): Promise<VerifyResult> {
  await deps.prepare(args.container, deps.credentials);
  return await deps.verify({
    projectDir: args.solution,
    testFile: args.testFile,
    containerName: args.container,
    testCodeunitId: args.codeunit,
    ...(args.prereq ? { prereqDir: args.prereq } : {}),
  });
}

async function main() {
  let args: RunnerArgs;
  try {
    args = parseRunnerArgs(Deno.args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(2);
  }
  await EnvLoader.loadEnvironment();
  const credentials = resolveContainerCredentials(Deno.env);
  // Dynamic import: the module reads the credential env vars when it loads.
  const { handleAlVerify, prepareContainerForVerification } = await import(
    "../mcp/al-tools-server.ts"
  );
  const res = await runPremiseProbe(args, {
    credentials,
    prepare: prepareContainerForVerification,
    verify: handleAlVerify,
  });

  console.log(`[probe] container=${args.container} success=${res.success}`);
  console.log(`[probe] message: ${res.message}`);
  const raw = (res as { rawOutput?: string }).rawOutput;
  if (raw) console.log("[probe] rawOutput:\n" + raw);
  if (res.totalTests !== undefined) {
    console.log(
      `[probe] tests: ${res.passed ?? 0}/${res.totalTests} passed` +
        (res.failed ? `, ${res.failed} failed` : ""),
    );
  }
  if (res.compileErrors?.length) {
    console.log(`[probe] compile errors:`);
    for (const e of res.compileErrors) console.log(`  ${e}`);
  }
  if (res.failures?.length) {
    console.log(`[probe] test failures (full detail):`);
    for (const f of res.failures) console.log(`  ---\n  ${f}`);
  }
  Deno.exit(0);
}

if (import.meta.main) {
  await main();
}
