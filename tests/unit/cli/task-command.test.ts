/**
 * Unit tests for `centralgauge task new`.
 *
 * SAFETY: every fixture lives under `Deno.makeTempDir()`; `roots` is always
 * passed explicitly to `runTaskNew` so nothing here reads or writes the
 * real `tasks/`, `tests/al/` or `scratch/` trees.
 *
 * Cliffy's own argument parsing is not exercised here — only that
 * `registerTaskCommand` attaches the expected subcommand + options.
 * `runTaskNew` (the actual logic) is tested directly, per the framework
 * boundary called out in the workbench plan.
 *
 * @module tests/unit/cli/task-command
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";

import type { IdRoots } from "../../../src/workbench/ids.ts";
import type {
  ProbeRunner,
  ProbeVerdict,
} from "../../../src/workbench/probe.ts";
import {
  probeExitCode,
  registerTaskCommand,
  runTaskNew,
  runTaskProbe,
  runTaskPromote,
} from "../../../cli/commands/task-command.ts";
import { scaffoldDraft } from "../../../src/workbench/scaffold.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Deno.test("task registers a new subcommand under the task parent", () => {
  const cli = new Command();
  registerTaskCommand(cli);
  const parent = cli.getCommand("task");
  assertEquals(parent?.getName(), "task");

  const sub = parent?.getCommand("new");
  assertEquals(sub?.getName(), "new");
});

Deno.test("task new exposes --slug, --id, --with-prereq options", () => {
  const cli = new Command();
  registerTaskCommand(cli);
  const sub = cli.getCommand("task")?.getCommand("new");
  const names = (sub?.getOptions() ?? []).map((o) => o.name);

  assertEquals(names.includes("slug"), true);
  assertEquals(names.includes("id"), true);
  assertEquals(names.includes("with-prereq"), true);
});

Deno.test("task registers a probe subcommand under the task parent", () => {
  const cli = new Command();
  registerTaskCommand(cli);
  const sub = cli.getCommand("task")?.getCommand("probe");
  assertEquals(sub?.getName(), "probe");

  const names = (sub?.getOptions() ?? []).map((o) => o.name);
  assertEquals(names.includes("container"), true);
});

Deno.test("task registers a promote subcommand under the task parent", () => {
  const cli = new Command();
  registerTaskCommand(cli);
  const sub = cli.getCommand("task")?.getCommand("promote");
  assertEquals(sub?.getName(), "promote");

  const names = (sub?.getOptions() ?? []).map((o) => o.name);
  assertEquals(names.includes("difficulty"), true);
  assertEquals(names.includes("slug"), true);
  assertEquals(names.includes("force"), true);
});

// ---------------------------------------------------------------------------
// runTaskNew
// ---------------------------------------------------------------------------

async function withCapturedLog<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (msg: string) => {
    logs.push(msg);
  };
  try {
    const value = await fn();
    return { value, logs };
  } finally {
    console.log = original;
  }
}

Deno.test("runTaskNew", async (t) => {
  let base: string;
  let roots: IdRoots;

  async function setup() {
    base = await createTempDir("task-command-test");
    roots = {
      tasksDir: join(base, "tasks"),
      testsDir: join(base, "tests", "al"),
      scratchDir: join(base, "scratch"),
    };
  }
  async function teardown() {
    await cleanupTempDir(base);
  }

  await t.step("returns the created DraftMeta", async () => {
    await setup();
    try {
      const meta = await runTaskNew({ slug: "day-close", roots });
      assertEquals(meta.id, "CG-AL-X001");
      assertEquals(meta.slug, "day-close");
      assertEquals(meta.withPrereq, false);
      assertEquals(
        await exists(join(roots.scratchDir, meta.id, "task.yml")),
        true,
      );
    } finally {
      await teardown();
    }
  });

  await t.step(
    "prints the created draft id, codeunit, path and next command",
    async () => {
      await setup();
      try {
        const { value: meta, logs } = await withCapturedLog(() =>
          runTaskNew({ slug: "day-close", roots })
        );
        const joined = logs.join("\n");

        assertStringIncludes(joined, "CG-AL-X001");
        assertStringIncludes(joined, "80001");
        assertStringIncludes(joined, "scratch/CG-AL-X001");
        assertStringIncludes(joined, "centralgauge task probe CG-AL-X001");
        assertEquals(meta.id, "CG-AL-X001");
      } finally {
        await teardown();
      }
    },
  );

  await t.step("--with-prereq is forwarded to scaffoldDraft", async () => {
    await setup();
    try {
      const meta = await runTaskNew({
        slug: "day-close",
        withPrereq: true,
        roots,
      });
      assertEquals(meta.withPrereq, true);
      // Scratch-local, not the committed tests/al/ tree - see C1 in
      // src/workbench/scaffold.ts.
      assertEquals(
        await exists(
          join(roots.scratchDir, meta.id, "prereq", "app.json"),
        ),
        true,
      );
      assertEquals(
        await exists(
          join(roots.testsDir, "dependencies", meta.id, "app.json"),
        ),
        false,
      );
    } finally {
      await teardown();
    }
  });

  await t.step(
    "an explicit --id is used instead of the next free one",
    async () => {
      await setup();
      try {
        const meta = await runTaskNew({
          slug: "poisoned-rescue",
          id: "CG-AL-X053",
          roots,
        });
        assertEquals(meta.id, "CG-AL-X053");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "rejects a malformed --id before touching the filesystem (scaffoldDraft's own check)",
    async () => {
      await setup();
      try {
        await assertRejects(
          () => runTaskNew({ slug: "day-close", id: "not-an-id", roots }),
          Error,
          "must match CG-AL-X",
        );
        assertEquals(await exists(roots.scratchDir), false);
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "rejects an E/M/H id: this workbench only collision-tracks the X-series",
    async () => {
      await setup();
      try {
        // Regression check for the hole a wider --id regex would reopen:
        // an E/M/H id must not silently produce an untracked draft.
        await assertRejects(
          () => runTaskNew({ slug: "day-close", id: "CG-AL-E001", roots }),
          Error,
          "must match CG-AL-X",
        );
        assertEquals(await exists(roots.scratchDir), false);
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "propagates scaffoldDraft's rejection on an invalid slug",
    async () => {
      await setup();
      try {
        await assertRejects(
          () => runTaskNew({ slug: "Not_Kebab", roots }),
          Error,
        );
      } finally {
        await teardown();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// runTaskProbe / probeExitCode
// ---------------------------------------------------------------------------

/**
 * Maps exit codes onto the recorded call for a `--solution` dir whose path
 * contains "correct" or "naive" — mirrors the stub in
 * `tests/unit/workbench/probe.test.ts`. Never spawns a real process.
 */
function stubProbeRunner(
  codes: { correct: number; naive: number },
): ProbeRunner {
  return (args: string[]): Promise<number> => {
    const solutionIdx = args.indexOf("--solution");
    const solutionDir = args[solutionIdx + 1] ?? "";
    return Promise.resolve(
      solutionDir.includes("naive") ? codes.naive : codes.correct,
    );
  };
}

Deno.test("runTaskProbe", async (t) => {
  let base: string;
  let scratchDir: string;
  const id = "CG-AL-X001";

  async function setup() {
    base = await createTempDir("task-command-probe-test");
    scratchDir = join(base, "scratch");
    await ensureDir(join(scratchDir, id, "correct"));
    await ensureDir(join(scratchDir, id, "naive"));
    // The draft's own oracle, inside correct/ (Task 5). probeDraft passes it
    // to trap-probe as --test-file (an unpromoted draft has nothing under
    // tests/al/ to resolve by id) and refuses outright when it is missing.
    await Deno.writeTextFile(
      join(scratchDir, id, "correct", `${id}.Test.al`),
      `codeunit 80001 "${id} Test"\n{\n    Subtype = Test;\n}\n`,
    );
  }
  async function teardown() {
    await cleanupTempDir(base);
  }

  await t.step(
    "returns a discriminating verdict and prints [OK]",
    async () => {
      await setup();
      try {
        const { value: verdict, logs } = await withCapturedLog(() =>
          runTaskProbe({
            id,
            scratchDir,
            runner: stubProbeRunner({ correct: 0, naive: 0 }),
          })
        );
        assertEquals(verdict.discriminates, true);
        assertEquals(probeExitCode(verdict), 0);
        assertStringIncludes(logs.join("\n"), "[OK]");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "reports naive/ passed when it does not discriminate that way",
    async () => {
      await setup();
      try {
        const { value: verdict, logs } = await withCapturedLog(() =>
          runTaskProbe({
            id,
            scratchDir,
            runner: stubProbeRunner({ correct: 0, naive: 1 }),
          })
        );
        assertEquals(verdict.discriminates, false);
        assertEquals(probeExitCode(verdict), 1);
        assertStringIncludes(logs.join("\n"), "naive/ passed");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "reports correct/ did not pass when it does not discriminate that way",
    async () => {
      await setup();
      try {
        const { value: verdict, logs } = await withCapturedLog(() =>
          runTaskProbe({
            id,
            scratchDir,
            runner: stubProbeRunner({ correct: 1, naive: 0 }),
          })
        );
        assertEquals(verdict.discriminates, false);
        assertEquals(probeExitCode(verdict), 1);
        assertStringIncludes(logs.join("\n"), "correct/ did not pass");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "reports inconclusive distinctly from a hard failure",
    async () => {
      await setup();
      try {
        const { value: verdict, logs } = await withCapturedLog(() =>
          runTaskProbe({
            id,
            scratchDir,
            runner: stubProbeRunner({ correct: 3, naive: 0 }),
          })
        );
        assertEquals(verdict.correct, "inconclusive");
        assertEquals(probeExitCode(verdict), 3);
        assertStringIncludes(logs.join("\n"), "INCONCLUSIVE");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "reports a compile-earned naive fail distinctly, and does NOT also " +
      "print the generic naive-passed message",
    async () => {
      await setup();
      try {
        const { value: verdict, logs } = await withCapturedLog(() =>
          runTaskProbe({
            id,
            scratchDir,
            runner: stubProbeRunner({ correct: 0, naive: 4 }),
          })
        );
        assertEquals(verdict.naive, "compile_fail");
        assertEquals(probeExitCode(verdict), 5);

        const joined = logs.join("\n");
        // The compile-fail-specific message names the likely causes and
        // points at the override.
        assertStringIncludes(joined, "failed to COMPILE");
        assertStringIncludes(joined, "--allow-compile-fail");
        // The early return in runTaskProbe is what stops the generic
        // "naive/ passed" message from ALSO firing - this is the assertion
        // that pins that ordering down, not just the message's own content.
        assertEquals(joined.includes("naive/ passed"), false);
      } finally {
        await teardown();
      }
    },
  );

  await t.step("forwards an explicit container to probeDraft", async () => {
    await setup();
    try {
      const calls: string[][] = [];
      const runner: ProbeRunner = (args) => {
        calls.push(args);
        return Promise.resolve(0);
      };
      await runTaskProbe({ id, scratchDir, container: "Cronus281", runner });

      for (const call of calls) {
        assertEquals(call[call.indexOf("--container") + 1], "Cronus281");
      }
    } finally {
      await teardown();
    }
  });

  await t.step(
    "propagates probeDraft's rejection when correct/ is missing",
    async () => {
      await setup();
      try {
        await Deno.remove(join(scratchDir, id, "correct"), {
          recursive: true,
        });
        await assertRejects(
          () =>
            runTaskProbe({
              id,
              scratchDir,
              runner: stubProbeRunner({ correct: 0, naive: 0 }),
            }),
          Error,
          "correct/",
        );
      } finally {
        await teardown();
      }
    },
  );
});

Deno.test("probeExitCode", () => {
  assertEquals(
    probeExitCode(
      { correct: "pass", naive: "fail", discriminates: true, at: "x" },
    ),
    0,
  );
  assertEquals(
    probeExitCode(
      { correct: "pass", naive: "pass", discriminates: false, at: "x" },
    ),
    1,
  );
  assertEquals(
    probeExitCode(
      { correct: "fail", naive: "fail", discriminates: false, at: "x" },
    ),
    1,
  );
  assertEquals(
    probeExitCode(
      {
        correct: "inconclusive",
        naive: "fail",
        discriminates: false,
        at: "x",
      },
    ),
    3,
  );
  assertEquals(
    probeExitCode(
      {
        correct: "pass",
        naive: "inconclusive",
        discriminates: false,
        at: "x",
      },
    ),
    3,
  );
});

Deno.test("probeExitCode: compile-failure verdict returns 5", () => {
  assertEquals(
    probeExitCode({
      correct: "pass",
      naive: "compile_fail",
      discriminates: false,
      at: new Date().toISOString(),
    }),
    5,
  );
});

// ---------------------------------------------------------------------------
// runTaskPromote
// ---------------------------------------------------------------------------

function writeCachedVerdict(
  scratchDir: string,
  id: string,
  verdict: ProbeVerdict,
): Promise<void> {
  return Deno.writeTextFile(
    join(scratchDir, id, ".probe.json"),
    JSON.stringify(verdict, null, 2) + "\n",
  );
}

/**
 * A verdict that clears the gate outright. `at` is a minute into the
 * future, not a fixed literal: `promoteDraft`'s staleness guard refuses a
 * verdict older than the draft's own files, so a hardcoded timestamp would
 * eventually (or immediately, depending on when the suite runs) read as
 * stale against files scaffoldDraft just wrote "now".
 */
function passingVerdict(): ProbeVerdict {
  return {
    correct: "pass",
    naive: "fail",
    discriminates: true,
    at: new Date(Date.now() + 60_000).toISOString(),
  };
}

Deno.test("runTaskPromote", async (t) => {
  let base: string;
  let roots: IdRoots;

  async function setup() {
    base = await createTempDir("task-command-promote-test");
    roots = {
      tasksDir: join(base, "tasks"),
      testsDir: join(base, "tests", "al"),
      scratchDir: join(base, "scratch"),
    };
  }
  async function teardown() {
    await cleanupTempDir(base);
  }

  await t.step(
    "reads the .probe.json a prior `task probe` cached and promotes without --force",
    async () => {
      await setup();
      try {
        const meta = await scaffoldDraft({ slug: "day-close", roots });
        await writeCachedVerdict(roots.scratchDir, meta.id, passingVerdict());

        const { value: result, logs } = await withCapturedLog(() =>
          runTaskPromote({ id: meta.id, difficulty: "hard", roots })
        );

        assertEquals(result.movedTask, `tasks/hard/${meta.id}-day-close.yml`);
        assertEquals(result.movedTest, `tests/al/hard/${meta.id}.Test.al`);
        assertEquals(result.forced, false);
        const joined = logs.join("\n");
        assertStringIncludes(joined, "[OK]");
        assertStringIncludes(joined, result.movedTask);
        assertStringIncludes(joined, result.movedTest);
        assertStringIncludes(joined, "task_sets hash changed");
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "without a cached verdict and without --force, propagates promoteDraft's refusal naming `task probe`",
    async () => {
      await setup();
      try {
        const meta = await scaffoldDraft({ slug: "day-close", roots });

        await assertRejects(
          () => runTaskPromote({ id: meta.id, difficulty: "hard", roots }),
          Error,
          "task probe",
        );
      } finally {
        await teardown();
      }
    },
  );

  await t.step(
    "--force promotes with no cached verdict and prints [FORCED]",
    async () => {
      await setup();
      try {
        const meta = await scaffoldDraft({ slug: "day-close", roots });

        const { value: result, logs } = await withCapturedLog(() =>
          runTaskPromote({
            id: meta.id,
            difficulty: "hard",
            roots,
            force: true,
          })
        );

        assertEquals(result.forced, true);
        assertStringIncludes(logs.join("\n"), "[FORCED]");
      } finally {
        await teardown();
      }
    },
  );

  await t.step("--slug overrides the .meta.json slug", async () => {
    await setup();
    try {
      const meta = await scaffoldDraft({ slug: "day-close", roots });
      await writeCachedVerdict(roots.scratchDir, meta.id, passingVerdict());

      const result = await runTaskPromote({
        id: meta.id,
        difficulty: "hard",
        slug: "renamed-slug",
        roots,
      });

      assertEquals(result.movedTask, `tasks/hard/${meta.id}-renamed-slug.yml`);
    } finally {
      await teardown();
    }
  });
});
