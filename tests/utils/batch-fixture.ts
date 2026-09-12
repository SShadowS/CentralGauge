import { copy } from "@std/fs";
import { join } from "@std/path";
import { cleanupTempDir, createTempDir } from "./test-helpers.ts";

const FIXTURE = join(
  import.meta.dirname!,
  "..",
  "fixtures",
  "batch-runs",
  "pre-upstream",
);

/**
 * Copy the pre-upstream fixture run into a temp directory shaped like
 * `<output>/batch/<runId>/` so code under test can treat it as a real run.
 */
export async function copyPreUpstreamFixture(): Promise<{
  output: string;
  runId: string;
  dir: string;
  resultsFile: string;
  cleanup: () => Promise<void>;
}> {
  const output = await createTempDir("pre-upstream");
  const state = JSON.parse(
    await Deno.readTextFile(join(FIXTURE, "state.json")),
  ) as { runId: string };
  const dir = join(output, "batch", state.runId);
  await copy(FIXTURE, dir, { overwrite: true });
  const resultsFile = join(output, `benchmark-results-${state.runId}.json`);
  await Deno.copyFile(join(FIXTURE, "benchmark-results.json"), resultsFile);
  await Deno.remove(join(dir, "benchmark-results.json"));
  await Deno.remove(join(dir, "README.md"));
  return {
    output,
    runId: state.runId,
    dir,
    resultsFile,
    cleanup: () => cleanupTempDir(output),
  };
}
