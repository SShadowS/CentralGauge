/**
 * Symbols lock (Part 1 contract `{ v: 1, packages }`) and the host symbol
 * store. Packages are stored by content digest, so the lock is the only
 * source of truth for which .app files a staged `.alpackages` holds.
 */

import { basename, join } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { hashFile } from "./hash.ts";
import {
  type SymbolPackage,
  SYMBOLS_LOCK_PATH,
  SymbolsLockSchema,
} from "./identity.ts";
import { exists } from "./fsutil.ts";

export interface PackageManifest {
  id: string;
  name: string;
  publisher: string;
  version: string;
}
export type ManifestReader = (appPath: string) => Promise<PackageManifest>;

// Key names verified against a real compiler cache in M1-26.
const AltoolManifest = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().min(1),
});

/** Read an .app manifest with `altool GetPackageManifest` (host process). */
export function altoolReader(altool: string): ManifestReader {
  return async (appPath) => {
    const out = await new Deno.Command(altool, {
      args: ["GetPackageManifest", appPath],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(out.stdout);
    if (!out.success) {
      const err = new TextDecoder().decode(out.stderr).trim();
      throw new ValidationError(
        `altool GetPackageManifest failed for ${appPath}: ${err}`,
        [appPath],
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError(`altool output is not JSON for ${appPath}`, [
        text.slice(0, 200),
      ]);
    }
    const m = AltoolManifest.safeParse(raw);
    if (!m.success) {
      throw new ValidationError(
        `unexpected altool manifest shape for ${appPath}`,
        m.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    return { ...m.data, id: m.data.id.toLowerCase() };
  };
}

/** altool next to a BCH compiler-cache symbols folder (layout of bc-platform-version.ts). */
export function defaultAltool(symbolsDir: string): string {
  return join(
    symbolsDir,
    "..",
    "compiler",
    "extension",
    "bin",
    "win32",
    "altool.exe",
  );
}

/** Hash every .app in fromDir, copy it into the store as <sha256>.app, build the lock. */
export async function buildSymbolsLock(
  fromDir: string,
  store: string,
  read: ManifestReader,
  /** Apps to lock; the rest are neither stored nor locked. */
  include: (m: PackageManifest, file: string) => boolean = () => true,
): Promise<{ v: 1; packages: SymbolPackage[] }> {
  await Deno.mkdir(store, { recursive: true });
  const names: string[] = [];
  for await (const e of Deno.readDir(fromDir)) {
    if (e.isFile && e.name.toLowerCase().endsWith(".app")) names.push(e.name);
  }
  if (names.length === 0) {
    throw new ValidationError(`no .app files in ${fromDir}`, [fromDir]);
  }
  const packages: SymbolPackage[] = [];
  for (const name of names.sort()) {
    const path = join(fromDir, name);
    const m = await read(path);
    if (!include(m, name)) continue;
    const sha256 = await hashFile(fromDir, path);
    const stored = join(store, `${sha256}.app`);
    if (!await exists(stored)) await Deno.copyFile(path, stored);
    packages.push({
      app_id: m.id.toLowerCase(),
      name: m.name,
      publisher: m.publisher,
      version: m.version,
      file: basename(name),
      sha256,
    });
  }
  packages.sort((a, b) => a.app_id.localeCompare(b.app_id));
  const parsed = SymbolsLockSchema.safeParse({ v: 1, packages });
  if (!parsed.success) {
    throw new ValidationError(
      "symbols lock does not validate",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return { v: 1, packages: parsed.data.packages };
}

export interface ExcludedApp {
  file: string;
  name: string;
  publisher: string;
}

/**
 * The lock the harness uses: Microsoft apps only (the platform System app
 * included when its publisher is Microsoft). Every other app in the folder
 * (e.g. CentralGauge prereqs in a compiler cache) is reported, not locked.
 */
export async function lockMicrosoftSymbols(
  fromDir: string,
  store: string,
  read: ManifestReader,
): Promise<
  { lock: { v: 1; packages: SymbolPackage[] }; excluded: ExcludedApp[] }
> {
  const excluded: ExcludedApp[] = [];
  let kept = 0;
  const include = (m: PackageManifest, file: string) => {
    if (m.publisher === "Microsoft") {
      kept++;
      return true;
    }
    excluded.push({ file, name: m.name, publisher: m.publisher });
    return false;
  };
  // An empty lock would fail the schema with a generic message; say why.
  const lock = await buildSymbolsLock(fromDir, store, read, include).catch(
    (err) => {
      if (kept === 0) {
        throw new ValidationError(`no Microsoft apps in ${fromDir}`, [fromDir]);
      }
      throw err;
    },
  );
  return { lock, excluded };
}

export async function writeSymbolsLock(
  repoRoot: string,
  lock: { v: 1; packages: SymbolPackage[] },
): Promise<void> {
  const path = join(repoRoot, SYMBOLS_LOCK_PATH);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(
    path,
    JSON.stringify(SymbolsLockSchema.parse(lock), null, 2) + "\n",
  );
}

/**
 * Copy locked packages from the store into dst. The COPY is hashed and
 * compared with the lock, every time: what the compiler sees is what was
 * verified, whatever happens to the store between stagings.
 */
export async function restoreSymbols(
  store: string,
  packages: SymbolPackage[],
  dst: string,
): Promise<void> {
  await Deno.mkdir(dst, { recursive: true });
  for (const p of packages) {
    const src = join(store, `${p.sha256}.app`);
    const copy = join(dst, p.file);
    if (!await exists(src)) {
      throw new ValidationError(
        `symbol store entry ${src} is missing (${p.file})`,
        [p.file],
      );
    }
    await Deno.copyFile(src, copy);
    if (await hashFile(dst, copy) !== p.sha256) {
      await Deno.remove(copy).catch(() => {});
      throw new ValidationError(
        `symbol store entry ${src} does not match the lock (${p.file})`,
        [p.file],
      );
    }
  }
}
