/**
 * Harness config (spec 1a section 4) and experiment (section 6) schemas and
 * loaders. Paths inside a config are relative to the harness/ root.
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError, ValidationError } from "../errors.ts";
import { readCatalog } from "../ingest/catalog/read.ts";
import type { HarnessTask } from "./task.ts";
import { readYaml } from "./yaml.ts";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase slug");
/** Relative to harness/, never absolute and never climbing out of it. */
const relPath = z.string().min(1).refine(
  (p) => !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes(".."),
  "must be a relative path inside harness/",
);
const bundlePath = relPath.nullable().default(null);

/** A list whose entries must be unique (a repeat would change the hash, not the arm). */
function uniqueList<T extends z.ZodType<string>>(item: T) {
  return z.array(item).refine(
    (xs) => new Set(xs).size === xs.length,
    "duplicate entry",
  );
}

export const ComponentsSchema = z.strictObject({
  instructions: bundlePath,
  skills: bundlePath,
  agents: bundlePath,
  hooks: bundlePath,
  plugins: uniqueList(relPath).default([]),
  mcp: uniqueList(slug).default([]),
  lsp: uniqueList(slug).default([]),
  toolchain: uniqueList(
    z.string().regex(/^[a-z0-9-]+@[\w.-]+$/, "name@version"),
  ).default([]),
});

export const LimitsSchema = z.strictObject({
  timeout_min: z.number().int().positive(),
  max_budget_usd: z.number().positive(),
});

export const HarnessConfigSchema = z.strictObject({
  id: slug,
  harness: slug,
  harness_version: z.string().min(1),
  models: z.record(
    z.string().min(1),
    z.string().regex(/^[a-z0-9-]+\/\S+$/, "provider/model"),
  ).refine((m) => Object.keys(m).length > 0, "at least one model"),
  settings: z.record(z.string(), z.unknown()).default({}),
  components: ComponentsSchema.default(ComponentsSchema.parse({})),
  limits: LimitsSchema,
});
export type HarnessConfig = z.output<typeof HarnessConfigSchema>;
export type Limits = z.output<typeof LimitsSchema>;

/** Names an experiment may list under `vary` (spec 1a section 6, D15). */
export const VARY_KEYS = [
  "harness",
  "harness_version",
  "models",
  "settings",
  "limits",
  "instructions",
  "skills",
  "agents",
  "hooks",
  "plugins",
  "mcp",
  "lsp",
  "toolchain",
] as const;
export type VaryKey = (typeof VARY_KEYS)[number];

export const PRIMARY_METRICS = ["cost_per_solved_task", "pass_rate"] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const ExperimentSchema = z.strictObject({
  id: slug,
  hypothesis: z.string().trim().min(1),
  primary_metric: z.enum(PRIMARY_METRICS),
  baseline: slug,
  variants: z.array(slug).min(1),
  vary: z.array(z.enum(VARY_KEYS)).min(1),
  tasks: z.string().min(1),
  repeats: z.number().int().positive().default(3),
}).superRefine((e, ctx) => {
  const arms = [e.baseline, ...e.variants];
  if (new Set(arms).size !== arms.length) {
    ctx.addIssue({
      code: "custom",
      message: "baseline and variants must be distinct",
      path: ["variants"],
    });
  }
  const dup = e.vary.filter((k, i) => e.vary.indexOf(k) !== i);
  if (dup.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `duplicate key ${[...new Set(dup)].join(", ")}`,
      path: ["vary"],
    });
  }
});
export type Experiment = z.output<typeof ExperimentSchema>;

function assertIdMatchesFile(id: string, expected: string, path: string) {
  if (id !== expected) {
    throw new ValidationError(`${path}: id ${id} does not match file name`, [
      `id ${id} != ${expected}`,
    ]);
  }
}

/** Load harness/configs/<id>.yml and check that bundle paths exist. */
export async function loadConfig(
  harnessRoot: string,
  id: string,
): Promise<HarnessConfig> {
  const path = join(harnessRoot, "configs", `${id}.yml`);
  const config = await readYaml(path, HarnessConfigSchema);
  assertIdMatchesFile(config.id, id, path);
  const c = config.components;
  const paths = [c.instructions, c.skills, c.agents, c.hooks, ...c.plugins]
    .filter((p): p is string => p !== null);
  const missing: string[] = [];
  for (const p of paths) {
    try {
      await Deno.stat(join(harnessRoot, p));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      missing.push(p);
    }
  }
  if (missing.length > 0) {
    throw new ConfigurationError(
      `${path}: component path(s) not found: ${missing.join(", ")}`,
      path,
    );
  }
  return config;
}

export interface LoadedExperiment {
  experiment: Experiment;
  /** Baseline first, then variants in declared order. */
  configs: HarnessConfig[];
}

/** Load harness/experiments/<id>.yml plus every config it names. */
export async function loadExperiment(
  harnessRoot: string,
  id: string,
): Promise<LoadedExperiment> {
  const path = join(harnessRoot, "experiments", `${id}.yml`);
  const experiment = await readYaml(path, ExperimentSchema);
  assertIdMatchesFile(experiment.id, id, path);
  const configs: HarnessConfig[] = [];
  for (const arm of [experiment.baseline, ...experiment.variants]) {
    configs.push(await loadConfig(harnessRoot, arm));
  }
  return { experiment, configs };
}

/**
 * Every model id must be a catalog slug (CLAUDE.md: ids come from the
 * catalog). Reuses the ingest catalog reader; a missing catalog means every
 * id is unknown, which fails loudly.
 */
export async function checkModelsInCatalog(
  configs: HarnessConfig[],
  catalogDir: string,
): Promise<void> {
  const file = join(catalogDir, "models.yml");
  let models;
  try {
    ({ models } = await readCatalog(catalogDir));
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new ConfigurationError(`${file}: ${msg}`, file);
  }
  // readCatalog maps a missing or non-list file to []; never let that pass
  // as "every id unknown" without saying why.
  if (models.length === 0) {
    throw new ConfigurationError(
      `${file}: catalog missing, empty or not a list`,
      file,
    );
  }
  const known = new Set(models.map((m) => m.slug));
  const unknown = configs.flatMap((c) =>
    Object.entries(c.models)
      .filter(([, id]) => !known.has(id))
      .map(([slot, id]) => `${c.id}.models.${slot}: ${id}`)
  );
  if (unknown.length > 0) {
    throw new ConfigurationError(
      `Model ids not in ${file}:\n  ${unknown.join("\n  ")}`,
      catalogDir,
    );
  }
}

/**
 * Task limits may only tighten config limits (spec 1a section 4). Ownership:
 * config limits are part of the arm template (campaign arm manifest); the
 * result of this function goes into each execution's manifest (M1-05
 * `forTask`), so a task override never changes arm identity.
 */
export function effectiveLimits(
  config: Limits,
  task: HarnessTask["limits"],
): Limits {
  return {
    timeout_min: Math.min(config.timeout_min, task.timeout_min ?? Infinity),
    max_budget_usd: Math.min(
      config.max_budget_usd,
      task.max_budget_usd ?? Infinity,
    ),
  };
}
