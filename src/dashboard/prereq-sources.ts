/**
 * Loads a workbench draft's `prereq/` AL sources from disk, following its
 * chained dependencies.
 *
 * `bindResponseToPrereqs` (`src/al/prereq-binder.ts`, via
 * `buildPrereqIndex`) needs raw AL source text for every prereq object a
 * model may legitimately reference — not just the draft's own `prereq/`
 * directory, but any prereq that directory itself depends on (see
 * CLAUDE.md's "Chained Prereq Dependencies"). This module is the disk half:
 * it finds and reads that AL. Everything it loads becomes the definition of
 * "what a model may reference without inventing it"; anything it misses
 * becomes a false accusation against a model that referenced it correctly.
 *
 * Chained dependency ids are resolved by scanning `dependenciesRoot`'s
 * immediate subdirectories for an `app.json` whose `id` matches
 * case-insensitively — the same by-id convention `mcp/al-tools-server.ts`'s
 * `findPrereqAppById` already uses to resolve committed prereq chains for
 * compilation. **An unresolvable dependency id is normal, not an error**:
 * of the 68 prereqs committed under `tests/al/dependencies/` at the time
 * this module was written, exactly two declare `dependencies`, and one of
 * them (`CG-AL-X047`) names platform/base-app ids that have no local
 * directory and never will. Skip silently rather than logging or throwing.
 *
 * A missing `prereq/`, a missing or unparseable `app.json`, and an
 * unreadable `.al` file all yield `[]` rather than throwing: an author
 * mid-edit is an ordinary state, and this feeds a read-only rail.
 *
 * @module dashboard/prereq-sources
 */

import { join } from "@std/path";

export interface PrereqSources {
  /** Raw AL text of the draft's own prereq/ plus every chained dependency. */
  sources: string[];
  /** Filenames actually read, in load order, for the static-listing fallback. */
  files: string[];
}

interface DependencyRef {
  id?: string;
}

interface AppManifest {
  id?: string;
  dependencies?: DependencyRef[];
}

/**
 * Parses `<dir>/app.json`. `undefined` for a missing directory, a missing
 * file, an unreadable file, or JSON that doesn't parse to an object.
 */
async function readAppManifest(dir: string): Promise<AppManifest | undefined> {
  try {
    const raw = await Deno.readTextFile(join(dir, "app.json"));
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as AppManifest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads every `*.al` file directly under `dir`, sorted by filename for
 * deterministic load order. `{ sources: [], files: [] }` when `dir` is
 * missing or unreadable; an individual file that fails to read is skipped
 * rather than failing the whole load.
 */
async function readAlSources(
  dir: string,
): Promise<{ sources: string[]; files: string[] }> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.toLowerCase().endsWith(".al")) continue;
      names.push(entry.name);
    }
  } catch {
    return { sources: [], files: [] };
  }
  names.sort();

  const sources: string[] = [];
  const files: string[] = [];
  for (const name of names) {
    try {
      sources.push(await Deno.readTextFile(join(dir, name)));
      files.push(name);
    } catch {
      // Unreadable mid-scan (e.g. a file removed between listing and read):
      // skip it, not the whole directory.
    }
  }
  return { sources, files };
}

/**
 * Scans `dependenciesRoot`'s immediate subdirectories for an `app.json`
 * whose `id` matches `wantIdLower` case-insensitively. `undefined` when no
 * subdirectory matches, including when `dependenciesRoot` itself is
 * missing — the normal case for a base-app/platform dependency id that was
 * never meant to resolve locally.
 */
async function findDependencyDir(
  dependenciesRoot: string,
  wantIdLower: string,
): Promise<string | undefined> {
  const subdirNames: string[] = [];
  try {
    for await (const entry of Deno.readDir(dependenciesRoot)) {
      if (entry.isDirectory) subdirNames.push(entry.name);
    }
  } catch {
    return undefined;
  }

  for (const name of subdirNames) {
    const dir = join(dependenciesRoot, name);
    const manifest = await readAppManifest(dir);
    if (
      typeof manifest?.id === "string" &&
      manifest.id.toLowerCase() === wantIdLower
    ) {
      return dir;
    }
  }
  return undefined;
}

/**
 * Loads `dir`'s own `.al` sources, then follows its `app.json`
 * `dependencies` recursively. `visited` is mutated in place and keys on
 * lowercased app id, so a dependency cycle (A depends on B, B depends on A)
 * terminates instead of recursing forever.
 */
async function loadDirSources(
  dir: string,
  dependenciesRoot: string,
  visited: Set<string>,
): Promise<PrereqSources> {
  const own = await readAlSources(dir);
  const sources = [...own.sources];
  const files = [...own.files];

  const manifest = await readAppManifest(dir);
  if (typeof manifest?.id === "string") {
    visited.add(manifest.id.toLowerCase());
  }

  const deps = Array.isArray(manifest?.dependencies)
    ? manifest.dependencies
    : [];
  for (const dep of deps) {
    const depId = dep && typeof dep === "object" ? dep.id : undefined;
    if (typeof depId !== "string" || depId.length === 0) continue;

    const depIdLower = depId.toLowerCase();
    if (visited.has(depIdLower)) continue;
    visited.add(depIdLower);

    const depDir = await findDependencyDir(dependenciesRoot, depIdLower);
    if (!depDir) continue; // Not the repo's a1b2c3d4-* convention — skip silently.

    const nested = await loadDirSources(depDir, dependenciesRoot, visited);
    sources.push(...nested.sources);
    files.push(...nested.files);
  }

  return { sources, files };
}

/**
 * Loads the AL sources a draft's `prereq/` app is allowed to reference: its
 * own `.al` files plus every chained dependency reachable through
 * `app.json`'s `dependencies` array, resolved against `dependenciesRoot`
 * (normally `tests/al/dependencies/`).
 */
export async function loadPrereqSources(
  draftDir: string,
  dependenciesRoot: string,
): Promise<PrereqSources> {
  return await loadDirSources(
    join(draftDir, "prereq"),
    dependenciesRoot,
    new Set(),
  );
}
