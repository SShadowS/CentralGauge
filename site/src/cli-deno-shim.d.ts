/**
 * Type-only shim for the Deno CLI half of this monorepo.
 *
 * ## Why this exists
 *
 * Site code imports a handful of shared types from `../src/lifecycle/*`. Those
 * imports are `import type` the whole way down, so nothing here is bundled or
 * executed on Workers — but TypeScript still typechecks every file it reaches,
 * and those files are Deno programs. From `site/` their module graph does not
 * resolve: `Deno` is undeclared, `@std/*` is a JSR specifier with no node
 * resolution, and `zod` resolves from the repo root where there is no
 * node_modules. That produced 41 of the 42 errors that had `npm run check`
 * failing, and with it the entire Site CI pipeline, since `check` runs first.
 *
 * ## Why a shim rather than a fix in `../src`
 *
 * Those files are correct Deno; they are only "wrong" when judged by the site's
 * tsconfig, which has no business compiling them. The right long-term fix is for
 * the site to stop importing CLI source at all — route the shared types through
 * a runtime-neutral module both halves can consume. That is a real refactor of
 * shared code, so this narrow declaration unblocks CI without pretending to be
 * that change.
 *
 * ## Scope
 *
 * Deliberately minimal: only the symbols the reachable files actually use, typed
 * rather than `any`, so this cannot quietly absorb unrelated breakage. If a new
 * `Deno.*` call appears here, that is a signal worth reading — Worker-reachable
 * code should not be growing new Deno dependencies.
 */

declare namespace Deno {
  const args: string[];
  const build: { os: string; arch: string };
  const cwd: () => string;
  const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
  };
  const stdout: {
    write(p: Uint8Array): Promise<number>;
    isTerminal(): boolean;
  };
  const stderr: {
    write(p: Uint8Array): Promise<number>;
    isTerminal(): boolean;
  };
  const version: { deno: string; v8: string; typescript: string };
  function readTextFile(path: string | URL): Promise<string>;
  function writeTextFile(
    path: string | URL,
    data: string,
    options?: { append?: boolean; create?: boolean },
  ): Promise<void>;
  function copyFile(from: string | URL, to: string | URL): Promise<void>;
  function rename(from: string | URL, to: string | URL): Promise<void>;
  function mkdir(
    path: string | URL,
    options?: { recursive?: boolean },
  ): Promise<void>;
  function stat(path: string | URL): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    size: number;
    mtime: Date | null;
  }>;
  function readDir(
    path: string | URL,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
}

declare module "@std/path" {
  export function dirname(path: string): string;
}

declare module "@std/fs" {
  export function ensureDir(dir: string): Promise<void>;
  export function exists(path: string): Promise<boolean>;
}

declare module "@std/fmt/colors" {
  // Imported as a namespace (`import * as colors`), so the shape matters more
  // than the exact roster. Every export is the same string-to-string shape.
  const styles: Record<string, (str: string) => string>;
  export = styles;
}
