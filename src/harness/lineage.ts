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
/** A regex source anchored at both ends that compiles. */
/**
 * orch r004 barrier L1: where infra/harness-reset/fs-digest.ps1 keeps the NST
 * hold's files ($NstFreezeDir). L4 ruling item 3: outside every fs root.
 */
export const NST_HOLD_DIR = "C:\\ProgramData\\cg-harness";

/** A root equal to, inside, or containing NST_HOLD_DIR. */
export function overlapsHoldDir(root: string): boolean {
  const n = (p: string) =>
    p.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
  const r = n(root);
  const h = n(NST_HOLD_DIR);
  return r === h || r.startsWith(`${h}\\`) || h.startsWith(`${r}\\`);
}

const AnchoredRegex = z.string().refine((s) => {
  if (!s.startsWith("^") || !s.endsWith("$")) return false;
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
}, "an anchored (^...$) regex that compiles");

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
  /**
   * H-35 S3 (design-r5 Sol HIGH): the content root over every table's
   * complete values and LOBs (content-root.ps1), verified after every
   * restore. `path`: the per-table `table|hash` lines (sha256-verified like
   * the inventory); `exclude`: the measured volatile tables, each with its
   * reason. Absent: admission refuses the lineage.
   */
  content_root: z.strictObject({
    path: z.string().min(1),
    sha256: Sha,
    root: Sha,
    exclude: z.array(z.strictObject({
      pattern: z.string().min(1),
      reason: z.string().min(1),
    })),
  }).optional(),
  /**
   * H-35 run 004 #4 (r5 3, nst_config): the canonical NST config digest
   * (reset-lib.ps1 Get-NstConfigDigest: every <add key value> but the
   * hostname-bearing `exclude_keys`, sorted, key=value lines), compared live
   * at admission and after every restore. Absent: admission refuses.
   */
  nst_config: z.strictObject({
    digest_version: z.literal(1),
    path: z.string().min(1),
    exclude_keys: z.array(z.string().min(1)),
    sha256: Sha,
    keys: z.number().int().positive(),
  }).optional(),
  /**
   * H-35 S3 L4 (decisions/2026-10-20-h-35-l4-scope.md): the declared roots W
   * (resolved on the image), the NST identity measurement, each exclusion
   * with its disposition, the baseline-create discovery survey, and the
   * fsDigest version. All of it enters env_fp. Absent: L4 not configured,
   * and admission refuses the lineage.
   */
  fs: z.strictObject({
    digest_version: z.number().int().positive(),
    // run 005 self-check: plain absolute drive paths only (no \\?\, no . or
    // .. segments, and (orch r005 LOW) no component ending in a period or a
    // space, which Windows strips: cg-harness. is cg-harness), so the
    // overlap check below compares canonical spellings
    roots: z.array(
      z.string().regex(
        /^[A-Za-z]:\\(?:[^\\/:*?"<>|]*[^\\/:*?"<>|. ](?:\\|$))*$/,
        "an fs root must be a plain absolute drive path",
      ),
    ).min(1).refine(
      (rs) => !rs.some(overlapsHoldDir),
      `an fs root overlaps ${NST_HOLD_DIR} (the NST hold's files must stay outside W)`,
    ),
    identity: z.array(z.string()),
    exclude: z.array(z.union([
      z.strictObject({
        pattern: z.string().min(1),
        /** Cleared and verified by the reset, or outside L4's stated scope. */
        disposition: z.enum(["reset_cleared", "out_of_scope"]),
        reason: z.string().min(1),
      }),
      /**
       * Decision addendum 3: an NST cache folder where only NEW files of the
       * measured shape (`files`, below `base`; starting with `magic` hex when
       * set) and new or time-only-changed `dirs` are tolerated.
       */
      z.strictObject({
        disposition: z.literal("platform_cache"),
        base: z.string().min(1),
        files: AnchoredRegex,
        dirs: AnchoredRegex,
        magic: z.string().regex(/^(?:[0-9a-f]{2}){1,2}$/).optional(),
        /** Addendum 6: a tolerated file's name is its content sha256. */
        name_is_sha256: z.literal(true).optional(),
        /** Addendum 6: only an existing folder's last-write time may move. */
        dir_time_only: z.literal(true).optional(),
        /** Addendum 7: an existing file may change in place. */
        in_place: z.literal(true).optional(),
        reason: z.string().min(1),
      }),
    ])),
    survey: z.strictObject({ path: z.string().min(1), sha256: Sha }),
  }).optional(),
  /**
   * H-35 S3 L2b (design-r5 2.2, 3): the NST's outbound firewall rule, or
   * why the image cannot enforce one. Enters env_fp; admission refuses an
   * unenforced lineage unless the run declares it.
   */
  egress: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("enforced"), rule_sha256: Sha }),
    z.strictObject({
      mode: z.literal("unenforced"),
      reason: z.string().min(1),
    }),
  ]).optional(),
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
  const sidecars = [["inventory", l.inventory]] as [
    string,
    { path: string; sha256: string },
  ][];
  if (l.content_root) sidecars.push(["content root", l.content_root]);
  for (const [what, s] of sidecars) {
    const file = join(dirname(path), s.path);
    const bytes = await Deno.readFile(file).catch(() => null);
    if (!bytes) return refuse(`${what} ${file} is unreadable`);
    if (await sha256Hex(bytes) !== s.sha256) {
      return refuse(`${what} ${file} does not hash to ${s.sha256}`);
    }
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
