export const FORMATS = [
  "build-from-spec",
  "runtime-trap",
  "diagnose-single",
  "diagnose-composite",
] as const;
export type FormatSlug = typeof FORMATS[number];

export const FAMILIES = ["mechanism", "invariant", "surface", "environment"] as const;
export type FamilySlug = typeof FAMILIES[number];

export const KNOWN_COHORTS = ["ado-trap-2026", "reasoning-100"] as const;
export const KNOWN_TEMPLATES = [
  "code-gen.md",
  "diagnose.md",
  "diagnose-objects.md",
  "diagnose-contract.md",
] as const;
export const DIAGNOSE_TEMPLATES = ["diagnose.md", "diagnose-objects.md", "diagnose-contract.md"] as const;
export const COMPOSITE_TEMPLATES = ["diagnose-objects.md", "diagnose-contract.md"] as const;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RETIRED_SLUGS = new Set([
  "diagnose", "composite", "multi-defect", "minimal-symptom", "calculations",
]);
export const isRetiredSlug = (s: string): boolean =>
  RETIRED_SLUGS.has(s) || /^defect-sites-\d+$/.test(s);

export const MECHANISM_VOCAB = [
  "tryfunction-write-rollback", "commit-scope", "error-flow",
  "filter-key-semantics", "filter-group-state", "temporary-record",
  "xrec-trigger-state", "event-binding", "event-order", "validation-trigger",
  "decimal-precision", "culture-format-roundtrip", "serialization-encoding",
  "company-scope", "permission-check", "flowfield-sift", "sql-cost-scaling",
  "single-instance-state", "recordref-reflection", "upgrade-datatransfer",
  "record-locking-concurrency",
] as const;
export const INVARIANT_VOCAB = [
  "largest-remainder-allocation", "reversal-conservation", "exact-total",
  "inclusive-boundary", "idempotent-rebuild", "company-isolation",
  "roundtrip-fidelity", "bounded-sql-cost",
] as const;
export const ENVIRONMENT_VOCAB = ["multi-company", "culture-sensitive", "test-permissions"] as const;

export interface CatalogGroup { slug: FormatSlug; name: string; description: string }
export interface CatalogFamily { slug: FamilySlug; name: string; description: string }
export interface CatalogTag {
  slug: string; family: FamilySlug; name: string; description: string;
  hidden_by_default?: boolean;
}
export interface CatalogAlias { from: string; to: string; note?: string }
export interface CatalogOverride { task: string; group: FormatSlug; rule: string; reason: string }
export interface SingleTaskEntry {
  group: Exclude<FormatSlug, "diagnose-composite">;
  facets: string[];
  min_bc_version: number;
}
export interface CompositeTaskEntry {
  group: "diagnose-composite";
  donors: string[];
  derived_facets: string[];
  local_facets: string[];
  min_bc_version: number;
}
export type TaskEntry = SingleTaskEntry | CompositeTaskEntry;
export interface CatalogV2 {
  schema_version: 2;
  groups: CatalogGroup[];
  families: CatalogFamily[];
  tags: CatalogTag[];
  aliases: CatalogAlias[];
  overrides: CatalogOverride[];
  tasks: Record<string, TaskEntry>;
}

export type FacetOrigin = "direct" | "derived" | "local";
export interface NormalizedTask {
  group: FormatSlug;
  facets: { slug: string; origin: FacetOrigin }[]; // sorted by slug
  donors: string[];                                 // ordinal order, [] for singles
  min_bc_version: number;
}
export interface NormalizedCatalog {
  schema_version: 2;
  task_set_hash: string;
  groups: CatalogGroup[];    // sorted by slug
  families: CatalogFamily[]; // sorted by slug
  tags: CatalogTag[];        // sorted by slug, hidden_by_default always present
  tasks: Record<string, NormalizedTask>; // keys sorted
}

export function isComposite(e: TaskEntry): e is CompositeTaskEntry {
  return e.group === "diagnose-composite";
}

/** Canonical JSON: keys sorted at every depth, no whitespace, NFC strings. */
export function canonicalJson(value: unknown): string {
  const ser = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(v);
    }
    if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
    if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (o[k] === undefined) throw new Error(`canonicalJson: undefined at "${k}"`);
        parts.push(JSON.stringify(k) + ":" + ser(o[k]));
      }
      return "{" + parts.join(",") + "}";
    }
    throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  };
  return ser(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function catalogDigest(n: NormalizedCatalog): Promise<string> {
  return sha256Hex(canonicalJson(n));
}
