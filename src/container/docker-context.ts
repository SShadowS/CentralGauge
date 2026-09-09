// src/container/docker-context.ts
//
// Single source of truth for the Docker CLI context every Windows-container
// call runs under.
//
// Background (2026-09-09): Docker Desktop's active context is global machine
// state, and it flips - a Desktop restart, an update, or someone switching to
// Linux containers. Our BC containers only exist under `desktop-windows`, so a
// flipped context makes `docker inspect Cronus28` and BCH's `Test-BcContainer`
// both report the container as absent. The bench then fails with
// `Container "Cronus28" is not running` for a container that is up and
// healthy, which is a misleading message pointing at the wrong problem. The
// same flip is what `.claude/skills/composite-batch` warns about as a
// "Failed to create compiler folder" error.
//
// Rather than depend on machine state, every Windows-container subprocess we
// spawn gets `DOCKER_CONTEXT` set explicitly. Escape hatches:
//
//   CENTRALGAUGE_DOCKER_CONTEXT=<name>  -> pin that context instead
//   CENTRALGAUGE_DOCKER_CONTEXT=        -> pin nothing, inherit the machine's
//
// Pinning is skipped when the context does not exist on this machine, so a
// Windows host running plain Docker without Desktop is unaffected.

/** The Docker Desktop context that hosts Windows containers. */
export const WINDOWS_DOCKER_CONTEXT = "desktop-windows";

/** Env var an operator can use to pin a different context, or none. */
export const DOCKER_CONTEXT_ENV = "CENTRALGAUGE_DOCKER_CONTEXT";

export interface DockerContextDecision {
  /** The context to pin, or `undefined` to inherit whatever the machine has. */
  context: string | undefined;
  /** Why, for logging and tests. */
  reason:
    | "operator_override"
    | "operator_opt_out"
    | "not_windows"
    | "context_available"
    | "context_missing"
    | "context_list_failed";
}

export interface DockerContextInputs {
  /** `Deno.build.os`. */
  os: string;
  /**
   * Raw value of {@link DOCKER_CONTEXT_ENV}. `undefined` means the variable is
   * not set at all; `""` means it is set and empty, which is the opt-out.
   */
  envOverride: string | undefined;
  /**
   * Context names from `docker context ls`, or `undefined` when the list could
   * not be read (docker missing, daemon down, command failed).
   */
  availableContexts: string[] | undefined;
}

/**
 * Decide which Docker context to pin. Pure, so the policy is testable without
 * Docker installed.
 */
export function decideDockerContext(
  inputs: DockerContextInputs,
): DockerContextDecision {
  if (inputs.envOverride !== undefined) {
    const trimmed = inputs.envOverride.trim();
    return trimmed === ""
      ? { context: undefined, reason: "operator_opt_out" }
      : { context: trimmed, reason: "operator_override" };
  }
  if (inputs.os !== "windows") {
    return { context: undefined, reason: "not_windows" };
  }
  if (inputs.availableContexts === undefined) {
    return { context: undefined, reason: "context_list_failed" };
  }
  return inputs.availableContexts.includes(WINDOWS_DOCKER_CONTEXT)
    ? { context: WINDOWS_DOCKER_CONTEXT, reason: "context_available" }
    : { context: undefined, reason: "context_missing" };
}

/** Parse `docker context ls --format {{.Name}}` output into names. */
export function parseContextList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listContexts(): string[] | undefined {
  try {
    const { code, stdout } = new Deno.Command("docker", {
      args: ["context", "ls", "--format", "{{.Name}}"],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (code !== 0) return undefined;
    return parseContextList(new TextDecoder().decode(stdout));
  } catch {
    return undefined;
  }
}

let cached: DockerContextDecision | undefined;
let listerOverride: (() => string[] | undefined) | undefined;

/**
 * Resolve the context once per process and cache it. The `docker context ls`
 * probe is synchronous so callers that spawn processes from sync code (the
 * warm pwsh session factory) can use it too; it runs at most once.
 */
export function resolveDockerContext(): DockerContextDecision {
  if (cached) return cached;
  const raw = Deno.env.get(DOCKER_CONTEXT_ENV);
  // Only probe Docker when the answer can depend on it.
  const needsList = raw === undefined && Deno.build.os === "windows";
  cached = decideDockerContext({
    os: Deno.build.os,
    envOverride: raw,
    availableContexts: needsList
      ? (listerOverride ?? listContexts)()
      : undefined,
  });
  return cached;
}

/**
 * Env fragment to merge into a `Deno.Command` that talks to Docker or runs a
 * bccontainerhelper script. Empty when nothing should be pinned.
 *
 * `Deno.Command`'s `env` merges into the inherited environment, so this
 * overrides an inherited `DOCKER_CONTEXT` without clearing anything else.
 */
export function dockerContextEnv(): Record<string, string> {
  const { context } = resolveDockerContext();
  return context ? { DOCKER_CONTEXT: context } : {};
}

/** Test seam: supply the context list and clear the cache. */
export function __setContextListerForTests(
  fn: (() => string[] | undefined) | undefined,
): void {
  listerOverride = fn;
  cached = undefined;
}
