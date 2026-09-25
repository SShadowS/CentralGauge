/**
 * Candidate-scoped app sync (spec 1a section 7 item 5; findings section 8).
 * Candidates run at their pristine version; prerequisites at a bumped
 * version; a per-container ledger holds each installed app's full content
 * stamp, so only a matching stamp keeps a prerequisite.
 */

import { join } from "@std/path";
import {
  BENCHMARK_APP_ID_RANGE,
  HARNESS_ORACLE_RANGE,
  HARNESS_TEST_APP_RANGE,
} from "../constants.ts";
import type {
  HarnessInstalledApp,
  HarnessSyncResult,
} from "../container/types.ts";
import { ValidationError } from "../errors.ts";
import { hashJson, hashTree } from "./hash.ts";
import { dependentsClosure, readAppJson, type StagedApp } from "./staging.ts";

export const CG_PUBLISHER = "CentralGauge";
export const HARNESS_APP_NAME = "CG Test Harness";
/** The bench's shared candidate id (compile-queue.ts); its objects share the refapp band. */
export const BENCH_CANDIDATE_APP_ID = "00000000-cafe-0000-0000-be4c00decade";

export type AppRole = "prereq" | "candidate";

export interface WantedApp {
  id: string;
  name: string;
  publisher: string;
  version: string;
  /** Full 64-hex content stamp (source tree plus dependency stamps). */
  stamp: string;
  file: string;
  role: AppRole;
  depends: string[];
}

export interface SyncPlan {
  remove: string[];
  publish: WantedApp[];
}

/** Per installed app id; `name` (written by the harness) feeds the trusted allowlist. */
export type Ledger = Record<
  string,
  { version: string; stamp: string; name?: string }
>;

/** Above the pristine version so dependency minima hold; build part stays below 65535 for build < 35000. */
export function prereqVersion(base: string, stamp: string): string {
  const [ma, mi, bu] = base.split(".").map(Number);
  if (
    [ma, mi, bu].some((x) => x === undefined || !Number.isInteger(x)) ||
    bu! > 35000
  ) {
    throw new ValidationError(
      `cannot derive a prerequisite version from ${base}`,
      [base],
    );
  }
  const s1 = parseInt(stamp.slice(0, 8), 16) % 30000;
  const s2 = parseInt(stamp.slice(8, 16), 16) % 30000;
  return `${ma}.${mi}.${bu! + 1 + s1}.${s2}`;
}

/** Content stamps; `buildId` = hash of the symbols lock and the container's compiler identity. */
export async function appStamps(
  dir: string,
  apps: StagedApp[],
  buildId: string,
): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();
  for (const a of apps) {
    stamps.set(
      a.folder,
      await hashJson({
        app: a.id,
        build: buildId,
        tree: await hashTree(join(dir, a.folder), "task"),
        deps: a.depends.map((d) => stamps.get(d) ?? null),
      }),
    );
  }
  return stamps;
}

export function candidateFolders(
  apps: StagedApp[],
  changed: string[],
): string[] {
  const set = dependentsClosure(apps, [...changed, "Test"]);
  return apps.filter((a) => set.has(a.folder)).map((a) => a.folder);
}

export function planAppSync(
  installed: HarnessInstalledApp[],
  wanted: WantedApp[],
  ledger: Ledger,
  owned: ReadonlySet<string>,
): SyncPlan {
  const wantedIds = new Set(wanted.map((w) => w.id));
  const byId = new Map<string, HarnessInstalledApp[]>();
  for (const i of installed) {
    if (i.publisher === CG_PUBLISHER) {
      byId.set(i.id, [...(byId.get(i.id) ?? []), i]);
    }
  }
  const kept = new Set<string>();
  for (const w of wanted) {
    const have = byId.get(w.id) ?? [];
    const exact = w.role === "prereq" && have.length === 1 &&
      have[0]!.installed &&
      have[0]!.version === w.version && ledger[w.id]?.stamp === w.stamp &&
      ledger[w.id]?.version === w.version;
    if (exact && w.depends.every((d) => !wantedIds.has(d) || kept.has(d))) {
      kept.add(w.id);
    }
  }
  const ownedLeftovers = [...byId.keys()].filter((id) =>
    owned.has(id) && !wantedIds.has(id)
  ).sort();
  const ours = [...wanted].reverse().map((w) => w.id).filter((id) =>
    !kept.has(id)
  );
  return {
    remove: [...ownedLeftovers, ...ours],
    publish: wanted.filter((w) => !kept.has(w.id)),
  };
}

const ledgerPath = (ledgerRoot: string, container: string) =>
  join(ledgerRoot, `${container}.json`);

export async function loadLedger(
  ledgerRoot: string,
  container: string,
): Promise<Ledger> {
  try {
    return JSON.parse(
      await Deno.readTextFile(ledgerPath(ledgerRoot, container)),
    ) as Ledger;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

export async function saveLedger(
  ledgerRoot: string,
  container: string,
  ledger: Ledger,
): Promise<void> {
  const p = ledgerPath(ledgerRoot, container);
  await Deno.mkdir(join(p, ".."), { recursive: true });
  const tmp = `${p}.tmp-${crypto.randomUUID()}`;
  await Deno.writeTextFile(tmp, JSON.stringify(ledger, null, 2));
  await Deno.rename(tmp, p);
}

/** The ledger without the given ids; saved before any container mutation. */
export function invalidate(ledger: Ledger, ids: Iterable<string>): Ledger {
  const next: Ledger = { ...ledger };
  for (const id of ids) delete next[id];
  return next;
}

/** The ledger after a sync: removed ids drop out, successfully published ids enter. */
export function applySync(
  ledger: Ledger,
  plan: SyncPlan,
  sync: HarnessSyncResult,
): Ledger {
  const next: Ledger = { ...ledger };
  for (const id of plan.remove) delete next[id];
  for (const p of sync.published) {
    if (sync.failed?.index === p.index) continue;
    const w = plan.publish[p.index];
    if (w) next[w.id] = { version: w.version, stamp: w.stamp, name: w.name };
  }
  return next;
}

const HARNESS_BANDS = [
  BENCHMARK_APP_ID_RANGE,
  HARNESS_TEST_APP_RANGE,
  HARNESS_ORACLE_RANGE,
];

const exactName = (name: string) =>
  `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;

/**
 * The trusted removal allowlist, from ONE source: app id (lower case) to an
 * anchored regex its installed name must match. Ids come only from staged
 * harness app.json files (each root and its immediate subfolders; publisher
 * CentralGauge, every idRange inside a harness band) and from ledger entries
 * the harness wrote itself (with a name). Never from agent input. The bench
 * candidate id is the one explicit extra: an owned leftover whose name
 * carries the bench task id and attempt.
 */
export async function trustedHarnessAppIds(
  roots: string[],
  ledger: Ledger,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const consider = async (appJsonPath: string) => {
    let a;
    try {
      a = await readAppJson(appJsonPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    }
    const inBands = a.idRanges.length > 0 &&
      a.idRanges.every((r) =>
        HARNESS_BANDS.some((b) => r.from >= b.start && r.to <= b.end)
      );
    if (a.publisher === CG_PUBLISHER && inBands) {
      out.set(a.id.toLowerCase(), exactName(a.name));
    }
  };
  for (const root of roots) {
    await consider(join(root, "app.json"));
    for await (const e of Deno.readDir(root)) {
      if (e.isDirectory && !e.name.startsWith(".")) {
        await consider(join(root, e.name, "app.json"));
      }
    }
  }
  for (const [id, entry] of Object.entries(ledger)) {
    if (entry.name && !out.has(id.toLowerCase())) {
      out.set(id.toLowerCase(), exactName(entry.name));
    }
  }
  out.set(BENCH_CANDIDATE_APP_ID, "^CentralGauge_[A-Za-z0-9-]+_\\d+$");
  return out;
}
