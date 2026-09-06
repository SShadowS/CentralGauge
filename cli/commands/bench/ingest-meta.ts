/**
 * Persisted ingest identity for benchmark result files (T3).
 *
 * The results file is the single source of truth for run identity: the
 * parallel executor mints ONE run UUID per variant immediately before
 * `saveResultsJson` and persists it (plus the pricing version) under the
 * top-level `ingest` key. Both the immediate ingest (bench-command) and
 * replay (ingest-command) read the SAME key, so a transient-failure replay
 * reuses the original run_id and the server's idempotency answers "exists"
 * instead of double-counting the run — and a late replay keeps the
 * pricing_version the run was actually benched under.
 *
 * The same key also carries the run-level environment capture (taxonomy v2,
 * Important-2 fix): `environment`/`invocations` are built ONCE, at bench
 * time, by the parallel executor, and persisted here for the SAME reason as
 * `task_set_hash` above — a replay must describe the machine the run
 * actually executed on, not the machine replaying it days or weeks later.
 * `ingest-command.ts`'s replay path reads these fields instead of rebuilding
 * them; when a results file predates this capture, both are simply absent
 * and the replay's ingest payload omits the environment/invocation facts
 * entirely rather than guessing them from the replaying machine.
 *
 * @module cli/commands/bench/ingest-meta
 */

import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";

export interface IngestMeta {
  /**
   * `1` = legacy files predating the persisted task-set hash.
   * `2` = carries `task_set_hash` (see below).
   * `3` = also carries `environment`/`invocations` (see below), where each
   * invocation is a legacy untyped snapshot.
   * `4` = `invocations` entries are the typed `InvocationRecord` (D4, Task
   * 11) — the capture is always typed now, so new saves are schema 4
   * whenever the run-level capture succeeded. The parser below reads every
   * field independently of the declared number, same as it already does
   * for `task_set_hash` on a schema-1 file.
   */
  schema: 1 | 2 | 3 | 4;
  /** UTC YYYY-MM-DD, minted at save time. */
  pricing_version: string;
  /** variantId -> run UUID, minted ONCE per bench run. */
  run_ids: Record<string, string>;
  /**
   * The task_set content hash computed at BENCH time (schema 2+). Persisted
   * so a replay records the run under the hash it was actually benched
   * against, NOT whatever the working tree hashes to at replay time — the
   * latter drifts after any `tasks/**` or `tests/al/**` edit (or a CRLF
   * normalization on merge), silently misattributing the run to a different
   * leaderboard row. Absent on legacy schema-1 files → ingest recomputes
   * from the current tree with a loud warning.
   */
  task_set_hash?: string;
  /**
   * The run-level environment manifest, built ONCE at bench time (schema 3+).
   * Absent on a results file saved before this capture existed, or when the
   * bench-time build failed (best-effort, same contract as
   * `buildEnvironmentManifest` itself) — either way, absence means "omit
   * from the replay ingest payload", never "rebuild from this machine".
   */
  environment?: EnvironmentManifest;
  /**
   * Redacted LLM invocation snapshot per variant, keyed by `variantId`
   * (schema 3+). Same absence semantics as `environment` above.
   */
  invocations?: Record<string, Record<string, unknown>>;
}

/** Today's pricing version stamp (UTC date). */
export function todayPricingVersion(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Mint the per-variant run identity for one results file.
 *
 * Pass the bench-time `taskSetHash` to stamp a schema-2+ meta that persists
 * it for faithful replay. Omit it (or pass `undefined`, e.g. when hashing
 * failed at save time) to fall back to a schema-1 meta — run identity is
 * still persisted; ingest just recomputes the hash from the working tree +
 * warns.
 *
 * Pass `capture` (built once per run by the caller, best-effort — see
 * `buildEnvironmentManifest`) to additionally stamp schema 3 and persist the
 * environment manifest + per-variant invocation snapshots. Omit it (build
 * failed, or the caller predates this capture) to leave both absent — a
 * replay of this file will omit the environment/invocation facts from its
 * ingest payload rather than rebuild them from the replaying machine.
 */
export function buildIngestMeta(
  variants: ReadonlyArray<{ variantId: string }>,
  taskSetHash?: string,
  capture?: {
    environment: EnvironmentManifest;
    invocations: Record<string, Record<string, unknown>>;
  },
): IngestMeta {
  const meta: IngestMeta = {
    schema: capture ? 4 : (taskSetHash ? 2 : 1),
    pricing_version: todayPricingVersion(),
    run_ids: Object.fromEntries(
      variants.map((v) => [v.variantId, crypto.randomUUID()]),
    ),
  };
  if (taskSetHash) meta.task_set_hash = taskSetHash;
  if (capture) {
    meta.environment = capture.environment;
    meta.invocations = capture.invocations;
  }
  return meta;
}

/**
 * Read the persisted `ingest` key from a parsed results file. Returns
 * undefined for legacy files (no key) or malformed meta — callers warn
 * loudly and fall back to minting (which creates a NEW run server-side).
 */
export function parseIngestMeta(parsed: unknown): IngestMeta | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const ingest = (parsed as Record<string, unknown>)["ingest"];
  if (!ingest || typeof ingest !== "object") return undefined;
  const m = ingest as Record<string, unknown>;
  const schema = m["schema"];
  if (schema !== 1 && schema !== 2 && schema !== 3 && schema !== 4) {
    return undefined;
  }
  if (typeof m["pricing_version"] !== "string") return undefined;
  const runIds = m["run_ids"];
  if (!runIds || typeof runIds !== "object" || Array.isArray(runIds)) {
    return undefined;
  }
  for (const v of Object.values(runIds as Record<string, unknown>)) {
    if (typeof v !== "string") return undefined;
  }
  const meta: IngestMeta = {
    schema,
    pricing_version: m["pricing_version"],
    run_ids: runIds as Record<string, string>,
  };
  // task_set_hash is read whenever present + well-formed, regardless of the
  // declared schema — a schema-1 file never carries it (legacy), and a
  // schema-2 file missing it degrades gracefully to recompute+warn rather
  // than losing the (still-valid) run identity.
  if (typeof m["task_set_hash"] === "string") {
    meta.task_set_hash = m["task_set_hash"];
  }
  // environment/invocations: read whenever present + well-formed, same
  // forgiving-by-field-presence policy as task_set_hash above. Deliberately
  // shallow validation (an object, not null, not an array) — this is a
  // locally-produced file, not an untrusted network payload, and the full
  // EnvironmentManifest shape is already enforced at build time by
  // buildEnvironmentManifest's return type.
  const environment = m["environment"];
  if (
    environment && typeof environment === "object" &&
    !Array.isArray(environment)
  ) {
    meta.environment = environment as EnvironmentManifest;
  }
  const invocations = m["invocations"];
  if (
    invocations && typeof invocations === "object" &&
    !Array.isArray(invocations)
  ) {
    const entries = Object.entries(invocations as Record<string, unknown>);
    if (
      entries.every(([, v]) => v && typeof v === "object" && !Array.isArray(v))
    ) {
      meta.invocations = Object.fromEntries(
        entries as [string, Record<string, unknown>][],
      );
    }
  }
  return meta;
}

/**
 * T5 startup gate: the leaderboard schema supports max 2 attempts
 * (D1 CHECK attempt IN (1,2)). Returns the error message when the
 * combination is invalid; undefined when fine. `--attempts 3+` stays
 * allowed for local-only runs via --no-ingest.
 */
export function validateAttemptsForIngest(
  attempts: number,
  ingestEnabled: boolean,
): string | undefined {
  if (!ingestEnabled || attempts <= 2) return undefined;
  return `--attempts ${attempts} is not supported with ingest enabled — the leaderboard schema supports max 2 attempts. Re-run with --attempts 2, or add --no-ingest for a local-only run.`;
}
