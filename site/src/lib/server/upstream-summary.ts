/**
 * One place to turn `results`' five upstream columns (migration 0023) into the
 * wire shapes both run-detail routes serve. The v1 and v2 routes read the same
 * columns from different queries, so the mapping lives here rather than twice.
 */
import type {
  AttemptUpstream,
  RunUpstreamSummary,
  UpstreamVerification,
} from "$lib/shared/api-types";

export interface UpstreamRow {
  requested_upstream: string | null;
  served_upstream: string | null;
  served_upstream_model: string | null;
  upstream_identity_source: string | null;
  upstream_verification: string | null;
}

export function attemptUpstream(r: UpstreamRow): AttemptUpstream {
  return {
    requested: r.requested_upstream ?? null,
    served: r.served_upstream ?? null,
    served_model: r.served_upstream_model ?? null,
    identity_source: (r.upstream_identity_source ??
      null) as AttemptUpstream["identity_source"],
    verification: (r.upstream_verification ?? null) as
      | UpstreamVerification
      | null,
  };
}

/**
 * The run's own pin, read out of `runs.invocation_json`. A malformed or absent
 * record is not an error here: it simply means the run was ingested without a
 * pin, which is exactly what `null` says.
 */
export function pinFromInvocationJson(
  json: string | null | undefined,
): string | null {
  if (!json) return null;
  try {
    const v = (JSON.parse(json) as { upstream_pin?: unknown }).upstream_pin;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Roll one run's result rows up into its upstream summary. A row with a NULL
 * `upstream_verification` counts under `unrecorded`: it predates capture, and
 * calling that `not_applicable` would claim knowledge we do not have.
 */
export function summariseUpstream(
  rows: UpstreamRow[],
  pin: string | null,
  excludedCode: string | null,
): RunUpstreamSummary {
  const served = new Set<string>();
  const servedModel = new Set<string>();
  const verification: RunUpstreamSummary["verification"] = {};
  for (const r of rows) {
    if (r.served_upstream) served.add(r.served_upstream);
    if (r.served_upstream_model) servedModel.add(r.served_upstream_model);
    const k = (r.upstream_verification ??
      "unrecorded") as keyof RunUpstreamSummary["verification"];
    verification[k] = (verification[k] ?? 0) + 1;
  }
  return {
    pin,
    served: [...served].sort(),
    served_model: [...servedModel].sort(),
    verification,
    excluded_code: excludedCode,
  };
}
