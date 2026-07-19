/**
 * Faithful-replay task-set hash resolution.
 *
 * `ingestRun` must record a run under the task_set hash it was BENCHED
 * against — persisted in the results file's `ingest` key — not whatever the
 * working tree hashes to at (re)play time. `resolveIngestTaskSetHash`
 * encodes that decision: use the persisted hash when present; only recompute
 * from the working tree (with a loud warning) for legacy files that lack it.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import {
  computeTaskSetHash,
  resolveIngestTaskSetHash,
} from "../../../src/ingest/mod.ts";

async function makeTaskTree(body: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-tsh-" });
  await Deno.mkdir(join(dir, "tasks"), { recursive: true });
  await Deno.writeTextFile(join(dir, "tasks", "t.yml"), body);
  return dir;
}

Deno.test("resolveIngestTaskSetHash: persisted hash wins even when the tree hashes differently", async () => {
  const dir = await makeTaskTree("id: CG-AL-E001\n");
  try {
    const treeHash = await computeTaskSetHash(dir);
    const persisted = "f".repeat(64);
    // Precondition: the working tree genuinely hashes to something else.
    assertNotEquals(treeHash, persisted);

    const resolved = await resolveIngestTaskSetHash(persisted, dir);
    assertEquals(
      resolved,
      persisted,
      "must use the persisted bench-time hash, not the current tree's",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveIngestTaskSetHash: legacy (no persisted) recomputes from tree + warns", async () => {
  const dir = await makeTaskTree("id: CG-AL-E002\n");
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const resolved = await resolveIngestTaskSetHash(undefined, dir);
    assertEquals(resolved, await computeTaskSetHash(dir));
    assert(
      warnings.some((w) => /task_set_hash/i.test(w) && /WARN/i.test(w)),
      `expected a loud task_set_hash warning, got: ${JSON.stringify(warnings)}`,
    );
  } finally {
    console.warn = origWarn;
    await Deno.remove(dir, { recursive: true });
  }
});
