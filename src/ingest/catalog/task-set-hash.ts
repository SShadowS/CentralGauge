import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";

/**
 * Compute a deterministic content hash over all *.yml files under `tasksDir`.
 *
 * Walks files, sorts by relative path (POSIX-normalised separators), then
 * concatenates "<relpath>\0<content>\0" per file and SHA-256 the result.
 * Non-yml files are ignored so docs or scratch files cannot change the hash.
 */
export async function computeTaskSetHash(tasksDir: string): Promise<string> {
  const entries: Array<{ rel: string; bytes: Uint8Array }> = [];
  for await (
    const e of walk(tasksDir, { exts: [".yml"], includeDirs: false })
  ) {
    const rel = e.path.slice(tasksDir.length + 1).replaceAll("\\", "/");
    entries.push({ rel, bytes: await Deno.readFile(e.path) });
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const { rel, bytes } of entries) {
    chunks.push(enc.encode(rel));
    chunks.push(new Uint8Array([0]));
    chunks.push(bytes);
    chunks.push(new Uint8Array([0]));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const concat = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    concat.set(c, o);
    o += c.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", concat);
  return encodeHex(new Uint8Array(digest));
}
