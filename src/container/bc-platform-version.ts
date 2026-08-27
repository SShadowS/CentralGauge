/**
 * Resolve the BC platform, application and AL runtime versions from the
 * CONTAINER, rather than from a constant.
 *
 * `src/constants.ts` carries `BC_PLATFORM_VERSION` / `BC_APPLICATION_VERSION` /
 * `BC_RUNTIME_VERSION`, and every `app.json` this repo generates used to take
 * them from there. That is wrong in a specific and quiet way: the numbers
 * describe whichever BC version the containers happened to be on when someone
 * last edited the file. Point the bench at a BC29 container and it keeps
 * emitting `platform 28.0.0.0, runtime 17.0` - an app.json the container would
 * accept only by accident, and one that forbids every API added since.
 *
 * The policy is "newest platform and runtime the supplied containers support",
 * so the version has to be read from the container.
 *
 * Two sources, in order of authority:
 *
 * 1. **The container's own Microsoft symbol packages.** BCH's compiler cache
 *    for a container holds `Microsoft_*.app` symbol files downloaded from that
 *    container's artifact, and each one's manifest states `platform` and
 *    `runtime` outright. That is the exact pair the container's own compiler
 *    was built against, so there is no arithmetic and no version table to
 *    maintain - a BC29 container reports `29.0.0.0` / `18.0` by itself. Read
 *    with the altool that ships in the SAME cache, so the reader always matches
 *    what it is reading.
 *
 * 2. **The artifact URL.** `docker inspect` exposes `artifactUrl`, whose path
 *    carries the full build (`.../sandbox/28.4.53241.53758/dk`). The major
 *    component gives `platform`/`application` as `<major>.0.0.0`. This works on
 *    a cold machine with no compiler cache yet, but it CANNOT give the runtime -
 *    the BC-major-to-runtime relationship is a Microsoft mapping, not something
 *    derivable from the URL, and hardcoding `major - 11` here would just be the
 *    old constant with extra steps.
 *
 * When neither source answers, the constants are returned and `source` says so.
 * Callers that care (anything writing an app.json for a real compile) should
 * surface that, because it means the manifest is a guess.
 */

import { join } from "@std/path";

import {
  BC_APPLICATION_VERSION,
  BC_PLATFORM_VERSION,
  BC_RUNTIME_VERSION,
} from "../constants.ts";
import { compilerCacheKey } from "./compiler-cache-key.ts";
import { inspectContainer } from "./docker-inspect.ts";

/** Where BCH keeps its artifact-URL-keyed compiler caches. */
const COMPILER_CACHE_ROOT = "C:\\ProgramData\\BcContainerHelper";

export interface PlatformVersions {
  /** `platform` for a generated app.json, e.g. "28.0.0.0". */
  platform: string;
  /** `application` for a generated app.json. Same value as platform. */
  application: string;
  /** `runtime` for a generated app.json, e.g. "17.0". */
  runtime: string;
  /**
   * How much of this was actually measured.
   *
   * - `symbols` - platform AND runtime read from the container's own symbol
   *   package manifest. Fully derived.
   * - `artifact-url` - platform derived from the container's artifact URL, but
   *   the runtime fell back to the constant.
   * - `fallback` - nothing could be read; every field is the constant.
   */
  source: "symbols" | "artifact-url" | "fallback";
  /** What was read, for the log line and the gate record. */
  evidence?: string;
}

/** Cache per container so a bench run inspects each one once. */
const cache = new Map<string, PlatformVersions>();

/** Pull `<major>` out of `.../sandbox/28.4.53241.53758/dk`. */
export function majorFromArtifactUrl(url: string): string | undefined {
  // Take the first path segment that looks like a 2+-part dotted version.
  for (const segment of url.split("?")[0]!.split("/")) {
    const m = segment.match(/^(\d+)\.\d+(?:\.\d+){0,2}$/);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}

/**
 * Read `platform` and `runtime` out of an app package manifest.
 *
 * Exported for its unit test: the parse is the part that silently rots if
 * altool's output shape changes, and a wrong runtime here produces AL0666 at
 * compile time with nothing pointing back at this function.
 */
export function parseManifestVersions(
  raw: string,
): { platform?: string; runtime?: string } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const platform = typeof parsed["platform"] === "string"
      ? parsed["platform"]
      : undefined;
    const runtime = typeof parsed["runtime"] === "string"
      ? parsed["runtime"]
      : undefined;
    return {
      ...(platform === undefined ? {} : { platform }),
      ...(runtime === undefined ? {} : { runtime }),
    };
  } catch {
    return {};
  }
}

async function firstMicrosoftSymbol(
  symbolsDir: string,
): Promise<string | undefined> {
  try {
    for await (const entry of Deno.readDir(symbolsDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith("Microsoft_")) continue;
      if (!entry.name.endsWith(".app")) continue;
      return join(symbolsDir, entry.name);
    }
  } catch {
    // no cache yet
  }
  return undefined;
}

async function readFromSymbols(
  cacheDir: string,
): Promise<
  { platform: string; runtime: string; evidence: string } | undefined
> {
  const symbol = await firstMicrosoftSymbol(join(cacheDir, "symbols"));
  if (symbol === undefined) return undefined;

  // Use the altool from the SAME cache, so the reader matches what it reads.
  const altool = join(
    cacheDir,
    "compiler",
    "extension",
    "bin",
    "win32",
    "altool.exe",
  );
  try {
    if (!(await Deno.stat(altool)).isFile) return undefined;
  } catch {
    return undefined;
  }

  try {
    const out = await new Deno.Command(altool, {
      args: ["GetPackageManifest", symbol],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!out.success) return undefined;
    const { platform, runtime } = parseManifestVersions(
      new TextDecoder().decode(out.stdout),
    );
    if (platform === undefined || runtime === undefined) return undefined;
    return {
      platform,
      runtime,
      evidence: `${symbol.split(/[/\\]/).pop()} via ${
        altool.split(/[/\\]/).slice(-1)[0]
      }`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve the versions a generated `app.json` should declare for
 * `containerName`. Never throws; the worst outcome is `source: "fallback"`.
 */
export async function resolvePlatformVersions(
  containerName: string,
): Promise<PlatformVersions> {
  const hit = cache.get(containerName);
  if (hit !== undefined) return hit;

  const fallback: PlatformVersions = {
    platform: BC_PLATFORM_VERSION,
    application: BC_APPLICATION_VERSION,
    runtime: BC_RUNTIME_VERSION,
    source: "fallback",
    evidence: "no artifactUrl on the container; using src/constants.ts",
  };

  const inspection = await inspectContainer(containerName);
  const artifactUrl = inspection?.artifactUrl;
  if (artifactUrl === undefined || artifactUrl === "") {
    cache.set(containerName, fallback);
    return fallback;
  }

  const key = await compilerCacheKey(artifactUrl);
  const cacheDir = join(COMPILER_CACHE_ROOT, `compiler-cache-${key}`);
  const fromSymbols = await readFromSymbols(cacheDir);
  if (fromSymbols !== undefined) {
    const resolved: PlatformVersions = {
      platform: fromSymbols.platform,
      application: fromSymbols.platform,
      runtime: fromSymbols.runtime,
      source: "symbols",
      evidence: fromSymbols.evidence,
    };
    cache.set(containerName, resolved);
    return resolved;
  }

  const major = majorFromArtifactUrl(artifactUrl);
  if (major !== undefined) {
    const resolved: PlatformVersions = {
      platform: `${major}.0.0.0`,
      application: `${major}.0.0.0`,
      // Deliberately NOT derived. See the module comment: the major-to-runtime
      // relationship is Microsoft's, and guessing it here would reintroduce the
      // hardcode this module exists to remove.
      runtime: BC_RUNTIME_VERSION,
      source: "artifact-url",
      evidence:
        `artifactUrl major ${major}; no compiler cache at ${cacheDir}, so the ` +
        `runtime is still the constant ${BC_RUNTIME_VERSION}`,
    };
    cache.set(containerName, resolved);
    return resolved;
  }

  cache.set(containerName, fallback);
  return fallback;
}

/** Drop the memoized answers. For tests, and after a container is rebuilt. */
export function clearPlatformVersionCache(): void {
  cache.clear();
}
