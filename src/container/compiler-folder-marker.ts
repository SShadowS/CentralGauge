/**
 * Marker file proving a compiler folder is safe to adopt.
 *
 * `New-BcCompilerFolder` deletes and rebuilds the folder on every call
 * (`New-BcCompilerFolder.ps1:64-68`), which is the cost adoption removes. The
 * marker plus a concrete file check is what makes skipping that call safe.
 */

export const MARKER_FILENAME = ".centralgauge-marker.json";

/**
 * Bump to invalidate every marker on every machine at once — use this when the
 * expected-entry list below changes, rather than waiting for an artifact URL
 * to change.
 */
export const LAYOUT_VERSION = 1;

export interface FolderMarker {
  layoutVersion: number;
  artifactUrl: string;
  cacheKey: string;
  bchVersion: string;
  containerName: string;
  createdAt: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Entries BCH populates that must all be present for the folder to be usable.
 * `dir` entries are checked for existence as directories; `file` entries as
 * files. `symbols` is special-cased: it must contain at least one `.app`.
 */
const EXPECTED: Array<{ path: string; kind: "dir" | "file" }> = [
  { path: "compiler/extension/bin", kind: "dir" },
  { path: "symbols", kind: "dir" },
  { path: "symbols/cache_AppInfo.json", kind: "file" },
  { path: "manifest.json", kind: "file" },
  { path: "dlls", kind: "dir" },
  { path: "dlls/Test Assemblies", kind: "dir" },
];

/** Atomic write: temp file then rename, so a torn marker can never validate. */
export async function writeMarker(
  folder: string,
  marker: FolderMarker,
): Promise<void> {
  const target = `${folder}/${MARKER_FILENAME}`;
  const tmp = `${target}.tmp-${Deno.pid}`;
  await Deno.writeTextFile(tmp, JSON.stringify(marker, null, 2));
  try {
    await Deno.rename(tmp, target);
  } catch (error) {
    await Deno.remove(tmp).catch(() => {});
    throw error;
  }
}

/**
 * Decide whether an existing compiler folder can be adopted.
 *
 * Every failure returns a reason rather than throwing: adoption is an
 * optimization, and the caller falls back to a rebuild on any `ok: false`.
 */
export async function validateFolder(
  folder: string,
  expected: { artifactUrl: string; bchVersion: string },
): Promise<ValidationResult> {
  let marker: FolderMarker;
  try {
    const parsed: unknown = JSON.parse(
      await Deno.readTextFile(`${folder}/${MARKER_FILENAME}`),
    );
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      return { ok: false, reason: "marker not an object" };
    }
    marker = parsed as FolderMarker;
  } catch {
    return { ok: false, reason: "marker missing or unreadable" };
  }

  if (marker.layoutVersion !== LAYOUT_VERSION) {
    return {
      ok: false,
      reason: `layout version ${marker.layoutVersion} != ${LAYOUT_VERSION}`,
    };
  }
  if (marker.artifactUrl !== expected.artifactUrl) {
    return { ok: false, reason: "artifact URL changed" };
  }
  if (marker.bchVersion !== expected.bchVersion) {
    return {
      ok: false,
      reason: `BCH version ${marker.bchVersion} != ${expected.bchVersion}`,
    };
  }

  for (const entry of EXPECTED) {
    try {
      const stat = await Deno.stat(`${folder}/${entry.path}`);
      if (entry.kind === "dir" && !stat.isDirectory) {
        return { ok: false, reason: `${entry.path} is not a directory` };
      }
      if (entry.kind === "file" && !stat.isFile) {
        return { ok: false, reason: `${entry.path} is not a file` };
      }
    } catch {
      return { ok: false, reason: `missing ${entry.path}` };
    }
  }

  // symbols/ must actually carry symbol packages, not just exist.
  let sawApp = false;
  try {
    for await (const e of Deno.readDir(`${folder}/symbols`)) {
      if (e.isFile && e.name.toLowerCase().endsWith(".app")) {
        sawApp = true;
        break;
      }
    }
  } catch {
    return { ok: false, reason: "symbols unreadable" };
  }
  if (!sawApp) return { ok: false, reason: "symbols contains no .app" };

  return { ok: true };
}
