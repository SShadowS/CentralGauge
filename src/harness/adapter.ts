/**
 * Harness adapter contract (D9; spec 1a sections 4 and 5). Frozen here so
 * M2/M3 adapters add producers, not interface changes.
 */

import type { Catalog } from "../ingest/catalog/read.ts";
import type { HarnessConfig } from "./config.ts";
import type { ResolvedManifest } from "./manifest.ts";
import type { PricingBook } from "./pricing.ts";
import type { ExecutionRecord, Telemetry, Termination } from "./records.ts";
import type { QualifyManifest } from "./qualify.ts";
import type { LoadedTask } from "./task.ts";

export interface ParseInput {
  /** Quarantined raw log (redaction happens on publication). */
  rawLog: string;
  exitCode: number | null;
  manifest: ResolvedManifest;
  /** Fixed at run start; the snapshot goes into telemetry. */
  pricing: PricingBook;
  /** Where the normalized trace.jsonl is written (quarantine). */
  traceOut: string;
}

export interface ParsedRun {
  telemetry: Telemetry;
  observed: ExecutionRecord["observed"];
  /** Requested components this harness cannot confirm as loaded. */
  unobservable: string[];
  didWork: boolean;
  termination: Termination | null;
  usageResetAt: string | null;
  imageSupport: boolean | null;
  traceEvents: number;
}

export interface MountSpec {
  src: string;
  dst: string;
}

export interface HarnessAdapter {
  harness: string;
  declared: readonly (keyof Telemetry)[];
  secretFiles: readonly string[];
  /** Carries provider credentials: the egress rules apply. */
  credentialBearing: boolean;
  /** The entrypoint enforces the manifest's effective max_budget_usd (round 2 item 10). */
  enforcesBudget: boolean;
  nativeSettings(
    config: HarnessConfig,
    catalog: Catalog,
  ): Record<string, unknown>;
  providerRoutes(config: HarnessConfig): Record<string, string>;
  extraMounts(
    settings: Record<string, unknown>,
    taskSourceDir: string,
    repoRoot: string,
  ): Promise<MountSpec[]>;
  parse(input: ParseInput): Promise<ParsedRun>;
  /**
   * Files or folders the runner copies into C:\config (relative `dst`)
   * before the start; resolved before anything is reserved or run, so a
   * throw refuses the arm (M1-35: the mock's variant folder).
   */
  configCopies?(ctx: {
    settings: Record<string, unknown>;
    task: LoadedTask;
    repoRoot: string;
    qualify: QualifyManifest | null;
  }): { src: string; dst: string }[];
}

/** Declared fields that came back null or empty (they go to validity.incomplete_telemetry). */
export function incompleteTelemetry(
  declared: readonly (keyof Telemetry)[],
  t: Telemetry,
): (keyof Telemetry)[] {
  return declared.filter((k) => {
    const v = t[k];
    return v === null || v === undefined ||
      (Array.isArray(v) && v.length === 0);
  });
}

export function requestedComponents(m: ResolvedManifest): string[] {
  return [
    ...(["instructions", "skills", "agents", "hooks"] as const).filter((k) =>
      m[k] !== null
    ),
    ...m.plugins.map((p) => `plugin:${p.path}`),
    ...m.mcp.map((s) => `mcp:${s.name}`),
    ...m.lsp.map((s) => `lsp:${s.name}`),
    ...m.toolchain.map((t) => `toolchain:${t}`),
  ];
}

export function observedMismatch(
  m: ResolvedManifest,
  o: ExecutionRecord["observed"],
  unobservable: string[],
): { mismatch: string | null; unverified: string[] } {
  if (o.harness_version !== null && o.harness_version !== m.harness_version) {
    return {
      mismatch:
        `harness version ${o.harness_version} ran, ${m.harness_version} was requested`,
      unverified: [],
    };
  }
  const requested = requestedComponents(m);
  const loaded = o.loaded_components ?? [];
  const unverified = requested.filter((c) =>
    !loaded.includes(c) && unobservable.includes(c)
  );
  const missing = requested.filter((c) =>
    !loaded.includes(c) && !unobservable.includes(c)
  );
  return {
    mismatch: missing.length > 0
      ? `requested components did not load: ${missing.join(", ")}`
      : null,
    unverified,
  };
}
