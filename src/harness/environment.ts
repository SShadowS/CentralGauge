/**
 * H-35 S3.4 (design-r4 5, r5 3.2; ruling 2026-10-19 (c)): judging
 * environments. A container is admitted for judging only when its instance
 * manifest (written by `harness baseline create`, after a reset to the
 * lineage) names the run's lineage and its env_fp still equals the live one;
 * a run's containers share one env_fp. `harness env check` prints the same
 * block and exits non-zero otherwise.
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { z } from "zod";
import type { HarnessBc } from "./bc-lane.ts";
import type { ResetMechanism } from "./reset.ts";
import { hashJson } from "./hash.ts";
import { ResetFailedError } from "./reset.ts";

/** env_fp v1 (ruling (a)): the one formula deployments and admission share. */
export function envFpOf(o: {
  compat: Readonly<Record<string, unknown>>;
  mechanism: string;
  lockDigest: string;
  compiler: string;
}): Promise<string> {
  return hashJson({
    compat: o.compat,
    mechanism: o.mechanism,
    symbols_lock: o.lockDigest,
    compiler: o.compiler,
  });
}

const InstanceManifestSchema = z.strictObject({
  v: z.literal(1),
  container: z.string().min(1),
  lineage_id: z.string().min(1),
  env_fp: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.string(),
  /** The reset that made the instance (phase timings, mechanism). */
  reset: z.strictObject({
    mechanism: z.string(),
    policy_version: z.number().int(),
    phases_ms: z.record(z.string(), z.number()),
  }),
});
export type InstanceManifest = z.infer<typeof InstanceManifestSchema>;

/** results/harness/baselines/<container>.json */
export const instanceManifestPath = (resultsRoot: string, container: string) =>
  join(resultsRoot, "baselines", `${container}.json`);

/** The container's instance manifest; null when absent or not valid. */
export async function readInstanceManifest(
  resultsRoot: string,
  container: string,
): Promise<InstanceManifest | null> {
  try {
    return InstanceManifestSchema.parse(
      JSON.parse(
        await Deno.readTextFile(instanceManifestPath(resultsRoot, container)),
      ),
    );
  } catch {
    return null;
  }
}

interface EnvInputs {
  resultsRoot: string;
  lineageId: string;
  lockDigest: string;
}

const liveEnvFp = async (
  bc: HarnessBc,
  m: ResetMechanism,
  container: string,
  lockDigest: string,
): Promise<string> => {
  if (!m.compat) {
    throw new Error(
      `harness bug: reset mechanism ${m.id} has no lineage (no env_fp)`,
    );
  }
  return await envFpOf({
    compat: m.compat,
    mechanism: m.id,
    lockDigest,
    compiler: await bc.harnessCompilerIdentity(container),
  });
};

/**
 * `harness baseline create` (lane-ops, under a lease): reset the container
 * to the lineage, then write its instance manifest. A failed reset writes
 * none (and throws).
 */
export async function createBaseline(
  bc: HarnessBc,
  m: ResetMechanism,
  container: string,
  o: EnvInputs,
): Promise<InstanceManifest> {
  const r = await m.reset(container);
  if (!r.ok) throw new ResetFailedError(r);
  const manifest: InstanceManifest = {
    v: 1,
    container,
    lineage_id: o.lineageId,
    env_fp: await liveEnvFp(bc, m, container, o.lockDigest),
    created_at: new Date().toISOString(),
    reset: {
      mechanism: r.mechanism,
      policy_version: r.policy_version,
      phases_ms: r.phases_ms,
    },
  };
  const path = instanceManifestPath(o.resultsRoot, container);
  await Deno.mkdir(join(o.resultsRoot, "baselines"), { recursive: true });
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(manifest, null, 2));
  await Deno.rename(tmp, path);
  return manifest;
}

export interface EnvCheck {
  lineage_id: string;
  admissible: boolean;
  rows: {
    container: string;
    env_fp: string;
    manifest_env_fp: string | null;
    created_at: string | null;
    why: string | null;
  }[];
}

/** Every container's live env_fp against its manifest and the lineage. */
export async function checkEnvironments(
  bc: HarnessBc,
  m: ResetMechanism,
  containers: readonly string[],
  o: EnvInputs,
): Promise<EnvCheck> {
  const rows: EnvCheck["rows"] = [];
  for (const c of containers) {
    const env_fp = await liveEnvFp(bc, m, c, o.lockDigest);
    const man = await readInstanceManifest(o.resultsRoot, c);
    const why = !man
      ? "no instance manifest"
      : man.container !== c
      ? `manifest is of ${man.container}`
      : man.lineage_id !== o.lineageId
      ? `manifest names lineage ${man.lineage_id}`
      : man.env_fp !== env_fp
      ? `env_fp ${env_fp.slice(0, 12)} differs from the manifest's ${
        man.env_fp.slice(0, 12)
      }`
      : null;
    rows.push({
      container: c,
      env_fp,
      manifest_env_fp: man?.env_fp ?? null,
      created_at: man?.created_at ?? null,
      why,
    });
  }
  const shared = new Set(rows.map((r) => r.env_fp)).size <= 1;
  return {
    lineage_id: o.lineageId,
    admissible: rows.length > 0 && shared && rows.every((r) => !r.why),
    rows,
  };
}

/** The block `harness env check`, run and rejudge print before starting. */
export function renderEnvCheck(c: EnvCheck): string {
  const out = [`environment: lineage ${c.lineage_id}`];
  for (const r of c.rows) {
    out.push(
      `  ${
        r.why ? colors.red("[FAIL]") : colors.green("[OK]")
      } ${r.container} env_fp ${r.env_fp.slice(0, 12)}${
        r.created_at ? ` (baseline ${r.created_at})` : ""
      }${r.why ? `: ${r.why}` : ""}`,
    );
  }
  if (new Set(c.rows.map((r) => r.env_fp)).size > 1) {
    out.push(
      `  ${colors.red("[FAIL]")} the containers do not share one env_fp`,
    );
  }
  return out.join("\n");
}
