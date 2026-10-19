/**
 * H-35 S3 (owner rulings 2026-10-19 "Base state"; design-r5 3): a reset
 * lineage, the provenance of the golden set every judge deployment restores.
 * lane-ops writes it (infra/harness-reset/lineages/); the harness only reads
 * it, checks its stored inventory's sha256 before any reset, and passes the
 * file to the reset script.
 */

import { dirname, join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";
import { sha256Hex } from "./hash.ts";

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const LineageSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  reset_policy_version: z.number().int().positive(),
  provision_version: z.string().min(1),
  artifactUrl: z.string().url(),
  manifest_sha256: Sha,
  official_bak_sha256: Sha,
  license_sha256: Sha,
  nst_config_sha256: Sha,
  golden_sha256: Sha,
  golden_fingerprint: Sha,
  golden_path_template: z.string().includes("{container}"),
  runner: z.strictObject({
    app_id: z.string().uuid(),
    app_sha256: Sha,
    package_id: z.string().uuid(),
    version: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  }),
  /** The stored inventory the reset's postconditions compare against. */
  inventory: z.strictObject({ path: z.string().min(1), sha256: Sha }),
  /** The local test container's web-service user (the runner no-op call). */
  soap_user: z.string().min(1),
  soap_password: z.string().min(1),
});
export type Lineage = z.infer<typeof LineageSchema>;

/**
 * Reads and validates a lineage file; its stored inventory (relative to
 * the file) must hash to the recorded sha256. Any problem is a
 * configuration error: judging never starts on an unproven lineage.
 */
export async function loadLineage(path: string): Promise<Lineage> {
  const refuse = (why: string): never => {
    throw new ConfigurationError(`reset lineage ${path}: ${why}`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    return refuse(`unreadable (${err instanceof Error ? err.message : err})`);
  }
  const parsed = LineageSchema.safeParse(raw);
  if (!parsed.success) {
    return refuse(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }
  const l = parsed.data;
  const inv = join(dirname(path), l.inventory.path);
  const bytes = await Deno.readFile(inv).catch(() => null);
  if (!bytes) return refuse(`inventory ${inv} is unreadable`);
  if (await sha256Hex(bytes) !== l.inventory.sha256) {
    return refuse(`inventory ${inv} does not hash to ${l.inventory.sha256}`);
  }
  return l;
}

/**
 * H-35 S3.3: the lineage's part of the environment fingerprint: every
 * identity field, never the web-service credentials or the host path
 * template (neither changes what a judgment runs against).
 */
export function lineageCompat(l: Lineage): Record<string, unknown> {
  const {
    soap_user: _user,
    soap_password: _password,
    golden_path_template: _path,
    ...identity
  } = l;
  return identity;
}
