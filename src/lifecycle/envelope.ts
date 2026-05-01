import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { canonicalJSON } from "../ingest/canonical.ts";
import type { LifecycleEnvelope, ToolVersions } from "./types.ts";

/**
 * Collect tool versions for the reproducibility envelope. Each subprocess
 * call is wrapped — when a tool isn't installed (e.g. claude-code on a CI
 * runner that only does bench), the version is left undefined, NOT an error.
 */
export async function collectToolVersions(): Promise<ToolVersions> {
  const [deno, wrangler, claudeCode, bcCompiler] = await Promise.all([
    runVersion(["deno", "--version"], /deno (\d+\.\d+\.\d+)/),
    runVersion(["npx", "wrangler", "--version"], /(\d+\.\d+\.\d+)/),
    runVersion(["claude", "--version"], /(\d+\.\d+\.\d+)/),
    runVersion(["alc", "--version"], /(\d+\.\d+(\.\d+)?)/),
  ]);
  const out: ToolVersions = {};
  if (deno !== undefined) out.deno = deno;
  if (wrangler !== undefined) out.wrangler = wrangler;
  if (claudeCode !== undefined) out.claude_code = claudeCode;
  if (bcCompiler !== undefined) out.bc_compiler = bcCompiler;
  return out;
}

async function runVersion(
  argv: string[],
  rx: RegExp,
): Promise<string | undefined> {
  try {
    const cmd = new Deno.Command(argv[0]!, {
      args: argv.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    const out = await cmd.output();
    if (out.code !== 0) return undefined;
    const text = new TextDecoder().decode(out.stdout) +
      new TextDecoder().decode(out.stderr);
    const m = text.match(rx);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export interface CollectEnvelopeOptions {
  machineId?: string;
  settings?: Record<string, unknown>;
  /** Pass an explicit git_sha (e.g. from CI env) to skip the subprocess call. */
  gitSha?: string;
}

export async function collectEnvelope(
  opts: CollectEnvelopeOptions = {},
): Promise<LifecycleEnvelope> {
  const env: LifecycleEnvelope = {};
  const gitSha = opts.gitSha ?? await readGitSha();
  if (gitSha !== undefined) env.git_sha = gitSha;
  if (opts.machineId) env.machine_id = opts.machineId;
  if (opts.settings) {
    env.settings_hash = await computeSettingsHash(opts.settings);
  }
  return env;
}

async function readGitSha(): Promise<string | undefined> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["rev-parse", "--short", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const out = await cmd.output();
    if (out.code !== 0) return undefined;
    return new TextDecoder().decode(out.stdout).trim();
  } catch {
    return undefined;
  }
}

/**
 * Stable hash of settings (temperature, max_attempts, etc.) so the orchestrator
 * can detect "settings changed since last bench" without comparing dozens of
 * fields.
 */
export async function computeSettingsHash(
  settings: Record<string, unknown>,
): Promise<string> {
  const canon = canonicalJSON(settings);
  const bytes = new TextEncoder().encode(canon);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest)).slice(0, 16);
}
