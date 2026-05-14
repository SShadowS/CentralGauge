import { describe, it } from "@std/testing/bdd";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { assert } from "@std/assert";
import { loadTaskManifest } from "../../../src/tasks/loader.ts";
import { isDomain } from "../../../src/tasks/domains.ts";

const TASKS_DIR = fromFileUrl(new URL("../../../tasks", import.meta.url));

describe("corpus manifest validation", () => {
  it("every task manifest in tasks/ declares valid domains", async () => {
    let count = 0;
    const failures: string[] = [];
    for await (
      const entry of walk(TASKS_DIR, { exts: [".yml"], includeDirs: false })
    ) {
      count++;
      try {
        const manifest = await loadTaskManifest(entry.path);
        if (!Array.isArray(manifest.domains) || manifest.domains.length === 0) {
          failures.push(`${entry.path}: missing or empty 'domains'`);
          continue;
        }
        for (const d of manifest.domains) {
          if (!isDomain(d)) {
            failures.push(`${entry.path}: invalid domain '${d}'`);
          }
        }
      } catch (e) {
        failures.push(
          `${entry.path}: failed to load - ${
            e instanceof Error ? e.message : e
          }`,
        );
      }
    }
    assert(count > 0, "expected to find task manifests under tasks/");
    assert(
      failures.length === 0,
      `${failures.length} task file(s) failed domain validation:\n${
        failures.join("\n")
      }`,
    );
  });
});
