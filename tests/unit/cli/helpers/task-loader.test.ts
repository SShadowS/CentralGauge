/**
 * Tests for `cli/helpers/task-loader.ts` (CLI4).
 *
 * A glob pattern that matches zero task files previously returned an empty
 * manifest array with just a logged warning; the bench command's caller
 * then silently `return`ed and the process exited 0, so a misconfigured
 * `--tasks` pattern looked identical to a clean run. Both loader functions
 * now throw `ValidationError` at the choke point so the failure propagates
 * as a non-zero exit.
 *
 * @module tests/unit/cli/helpers/task-loader
 */

import { assertRejects } from "@std/assert";
import {
  loadTaskManifests,
  loadTaskManifestsWithHashes,
} from "../../../../cli/helpers/task-loader.ts";
import { ValidationError } from "../../../../src/errors.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

Deno.test("task-loader zero-match glob", async (t) => {
  await t.step(
    "CLI4: loadTaskManifests throws ValidationError on a no-match glob",
    async () => {
      const outputDir = await createTempDir("task-loader-empty");
      try {
        await assertRejects(
          () =>
            loadTaskManifests(
              [`${outputDir}/__no_such_dir__/*.yml`],
              outputDir,
              false,
            ),
          ValidationError,
          "No task manifests found",
        );
      } finally {
        await cleanupTempDir(outputDir);
      }
    },
  );

  await t.step(
    "CLI4: loadTaskManifestsWithHashes throws ValidationError on a no-match glob",
    async () => {
      const outputDir = await createTempDir("task-loader-hashes-empty");
      try {
        await assertRejects(
          () =>
            loadTaskManifestsWithHashes(
              [`${outputDir}/__no_such_dir__/*.yml`],
              outputDir,
              false,
            ),
          ValidationError,
          "No task manifests found",
        );
      } finally {
        await cleanupTempDir(outputDir);
      }
    },
  );

  await t.step(
    "loadTaskManifests still resolves normally when patterns match real tasks",
    async () => {
      const outputDir = await createTempDir("task-loader-real");
      try {
        const manifests = await loadTaskManifests(
          ["tasks/easy/*.yml"],
          outputDir,
          false,
        );
        // Real repo task files, asserts the happy path is untouched by the
        // throw-on-empty change.
        if (manifests.length === 0) {
          throw new Error(
            "expected at least one real task under tasks/easy/*.yml",
          );
        }
      } finally {
        await cleanupTempDir(outputDir);
      }
    },
  );
});
