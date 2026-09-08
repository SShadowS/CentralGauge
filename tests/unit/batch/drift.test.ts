// tests/unit/batch/drift.test.ts
//
// D13 drift checks (spec 4.6) against a REAL checkout copy: `checkDrift`
// calls `computeTaskSetHash`/`harnessFingerprint` on `opts.cwd`, and both
// throw/behave differently against a synthetic tree that doesn't carry the
// files they expect. So this test builds an actual temp git checkout
// carrying just enough of the repo (one task, `templates/`, and every
// `HARNESS_INPUTS` file) for both functions to run for real, then edits one
// input at a time and confirms `checkDrift` names exactly that input.
import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { checkDrift, freezeInputs } from "../../../src/batch/drift.ts";
import type { ContainerEnvironmentSet } from "../../../src/batch/state.ts";
import { writeJsonAtomic } from "../../../src/batch/state.ts";
import { RUN_FILES } from "../../../src/batch/paths.ts";
import {
  expandInputs,
  HARNESS_INPUTS,
} from "../../../src/utils/harness-fingerprint.ts";
import { createMockTaskManifest } from "../../utils/test-helpers.ts";
import { frozenInputs } from "../../utils/batch-fixtures.ts";
import type { TaskManifest } from "../../../src/tasks/interfaces.ts";

const TASK_ID = "CG-AL-E001";
const TASK_YAML_REL = "tasks/easy/CG-AL-E001-basic-table.yml";

const gitAvailable = (() => {
  try {
    const { Command } = Deno;
    const cmd = new Command("git", { args: ["--version"] });
    return cmd.outputSync().success;
  } catch {
    return false;
  }
})();

async function run(cmd: string[], cwd: string): Promise<void> {
  const out = await new Deno.Command(cmd[0]!, {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `${cmd.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
}

async function copyFile(src: string, dst: string): Promise<void> {
  await ensureDir(dirname(dst));
  await Deno.copyFile(src, dst);
}

const ENV_A: ContainerEnvironmentSet = {
  testRunner: "soap",
  containers: [{
    name: "Cronus28",
    bcArtifact: "https://example.test/artifact-a",
    imageDigest: "sha256:aaaa",
  }],
};
const ENV_B: ContainerEnvironmentSet = {
  testRunner: "soap",
  containers: [{
    name: "Cronus28",
    bcArtifact: "https://example.test/artifact-b",
    imageDigest: "sha256:bbbb",
  }],
};

/**
 * A temp git checkout carrying exactly what `checkDrift`/`freezeInputs`
 * need to run for real: one task YAML, all of `templates/`, and every
 * `HARNESS_INPUTS` file (directories expanded), committed so `gitFacts`
 * reports a clean tree.
 */
async function setupCheckout(): Promise<
  { root: string; manifests: Map<string, TaskManifest> }
> {
  const repoRoot = Deno.cwd();
  const root = await Deno.makeTempDir({ prefix: "cg-batch-drift-" });

  await copyFile(join(repoRoot, TASK_YAML_REL), join(root, TASK_YAML_REL));

  for await (const entry of Deno.readDir(join(repoRoot, "templates"))) {
    if (!entry.isFile) continue;
    await copyFile(
      join(repoRoot, "templates", entry.name),
      join(root, "templates", entry.name),
    );
  }

  const harnessFiles = await expandInputs(HARNESS_INPUTS, repoRoot);
  for (const rel of harnessFiles) {
    await copyFile(join(repoRoot, rel), join(root, rel));
  }

  await run(["git", "init"], root);
  await run(["git", "config", "user.email", "drift-test@example.test"], root);
  await run(["git", "config", "user.name", "Drift Test"], root);
  await run(["git", "add", "-A"], root);
  await run(["git", "commit", "-m", "initial checkout"], root);

  const manifests = new Map<string, TaskManifest>([
    [
      TASK_ID,
      createMockTaskManifest({
        id: TASK_ID,
        prompt_template: "code-gen.md",
      }),
    ],
  ]);
  return { root, manifests };
}

/** Verifies `harnessFingerprint`/`computeTaskSetHash` actually run against
 * this environment before trusting the rest of the file's assertions. */
Deno.test({
  name: "checkDrift and freezeInputs agree on a clean real checkout",
  ignore: !gitAvailable,
  fn: async () => {
    const { root, manifests } = await setupCheckout();
    try {
      const promptInputsPath = join(root, RUN_FILES.promptInputs);
      await writeJsonAtomic(promptInputsPath, frozenInputs());

      const frozen = await freezeInputs(
        root,
        "templates",
        [TASK_ID],
        manifests,
        promptInputsPath,
        ENV_A,
      );
      assertEquals(Object.keys(frozen.templateDigests), ["code-gen.md"]);

      const state = {
        schemaVersion: 1 as const,
        runId: "run-drift-1",
        createdAt: new Date().toISOString(),
        model: {
          slug: "anthropic/claude-haiku-4-5",
          provider: "anthropic" as const,
          apiModelId: "claude-haiku-4-5",
        },
        frozen,
        phase: "attempt-1-submitted" as const,
        wave: 1 as const,
        batches: [],
        activeBatchIds: [],
        tasks: {},
        ingest: true,
      };

      const clean = await checkDrift(root, state, {
        cwd: root,
        templateDir: "templates",
      });
      assertEquals(clean.changed, []);
      assert(clean.ok);

      // Edit the task YAML: taskSetHash moves.
      const yamlPath = join(root, TASK_YAML_REL);
      const originalYaml = await Deno.readTextFile(yamlPath);
      await Deno.writeTextFile(
        yamlPath,
        originalYaml.replace("Product Category", "Product Category Edited"),
      );
      try {
        const afterYamlEdit = await checkDrift(root, state, {
          cwd: root,
          templateDir: "templates",
        });
        assert(!afterYamlEdit.ok);
        assert(
          afterYamlEdit.changed.some((c) => c.input === "taskSetHash"),
          `expected taskSetHash in ${JSON.stringify(afterYamlEdit.changed)}`,
        );
      } finally {
        await Deno.writeTextFile(yamlPath, originalYaml);
      }

      // Edit templates/code-gen.md: only that template's digest moves.
      const templatePath = join(root, "templates", "code-gen.md");
      const originalTemplate = await Deno.readTextFile(templatePath);
      await Deno.writeTextFile(
        templatePath,
        originalTemplate + "\n<!-- drift test edit -->\n",
      );
      try {
        const afterTemplateEdit = await checkDrift(root, state, {
          cwd: root,
          templateDir: "templates",
        });
        assert(!afterTemplateEdit.ok);
        assert(
          afterTemplateEdit.changed.some((c) =>
            c.input === "templateDigests.code-gen.md"
          ),
          `expected templateDigests.code-gen.md in ${
            JSON.stringify(afterTemplateEdit.changed)
          }`,
        );
      } finally {
        await Deno.writeTextFile(templatePath, originalTemplate);
      }

      // Edit prompt-inputs.json: promptInputsDigest moves.
      const originalPromptInputs = await Deno.readTextFile(promptInputsPath);
      await writeJsonAtomic(
        promptInputsPath,
        frozenInputs({ apiModelId: "claude-haiku-4-5-edited" }),
      );
      try {
        const afterPromptInputsEdit = await checkDrift(root, state, {
          cwd: root,
          templateDir: "templates",
        });
        assert(!afterPromptInputsEdit.ok);
        assert(
          afterPromptInputsEdit.changed.some((c) =>
            c.input === "promptInputsDigest"
          ),
          `expected promptInputsDigest in ${
            JSON.stringify(afterPromptInputsEdit.changed)
          }`,
        );
      } finally {
        await Deno.writeTextFile(promptInputsPath, originalPromptInputs);
      }

      // A different wave-1 environment: only "environment" moves, and only
      // when an environment is actually passed in.
      const withoutEnvCheck = await checkDrift(root, state, {
        cwd: root,
        templateDir: "templates",
      });
      assertEquals(withoutEnvCheck.changed, []);

      const withDifferentEnv = await checkDrift(root, state, {
        cwd: root,
        templateDir: "templates",
        environment: ENV_B,
      });
      assert(!withDifferentEnv.ok);
      assert(
        withDifferentEnv.changed.some((c) => c.input === "environment"),
        `expected environment in ${JSON.stringify(withDifferentEnv.changed)}`,
      );

      const withSameEnv = await checkDrift(root, state, {
        cwd: root,
        templateDir: "templates",
        environment: ENV_A,
      });
      assertEquals(withSameEnv.changed, []);

      // Sanity: every copied harness file really did land where
      // `expandInputs` expects it, proving the "real checkout" premise
      // rather than a lucky pass from a missing-file short-circuit.
      const expanded = await expandInputs(HARNESS_INPUTS, root);
      assert(expanded.length > 0);
      for (const rel of expanded) {
        const info = await Deno.stat(join(root, rel));
        assert(info.isFile, `expected ${rel} to exist under the checkout`);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
Deno.test({
  name: "a custom templateDir is what freezeInputs and checkDrift digest",
  ignore: !gitAvailable,
  fn: async () => {
    const { root, manifests } = await setupCheckout();
    try {
      // The same template, moved to where `benchmark.templateDir` points.
      const customDir = "prompts/custom";
      await ensureDir(join(root, customDir));
      await Deno.copyFile(
        join(root, "templates", "code-gen.md"),
        join(root, customDir, "code-gen.md"),
      );

      const promptInputsPath = join(root, RUN_FILES.promptInputs);
      await writeJsonAtomic(
        promptInputsPath,
        frozenInputs({ templateDir: customDir }),
      );

      const frozen = await freezeInputs(
        root,
        customDir,
        [TASK_ID],
        manifests,
        promptInputsPath,
        ENV_A,
      );
      const state = {
        schemaVersion: 1 as const,
        runId: "run-drift-custom",
        createdAt: new Date().toISOString(),
        model: {
          slug: "anthropic/claude-haiku-4-5",
          provider: "anthropic" as const,
          apiModelId: "claude-haiku-4-5",
        },
        frozen,
        phase: "attempt-1-submitted" as const,
        wave: 1 as const,
        batches: [],
        activeBatchIds: [],
        tasks: {},
        ingest: true,
      };

      const clean = await checkDrift(root, state, {
        cwd: root,
        templateDir: customDir,
      });
      assertEquals(clean.changed, []);

      // Editing the template the run actually renders from is drift.
      const customTemplate = join(root, customDir, "code-gen.md");
      const original = await Deno.readTextFile(customTemplate);
      await Deno.writeTextFile(
        customTemplate,
        original + "\n<!-- custom dir edit -->\n",
      );
      const drifted = await checkDrift(root, state, {
        cwd: root,
        templateDir: customDir,
      });
      assert(!drifted.ok);
      assert(
        drifted.changed.some((c) => c.input === "templateDigests.code-gen.md"),
        `expected templateDigests.code-gen.md in ${
          JSON.stringify(drifted.changed)
        }`,
      );

      // Editing the default `templates/` copy is not: nothing renders it.
      await Deno.writeTextFile(customTemplate, original);
      const defaultTemplate = join(root, "templates", "code-gen.md");
      const defaultOriginal = await Deno.readTextFile(defaultTemplate);
      try {
        await Deno.writeTextFile(
          defaultTemplate,
          defaultOriginal + "\n<!-- default dir edit -->\n",
        );
        const unaffected = await checkDrift(root, state, {
          cwd: root,
          templateDir: customDir,
        });
        assertEquals(
          unaffected.changed.filter((c) =>
            c.input.startsWith("templateDigests.")
          ),
          [],
        );
      } finally {
        await Deno.writeTextFile(defaultTemplate, defaultOriginal);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
