// Pure module: no runtime imports, no Deno or Node globals beyond Web Crypto
// and TextEncoder. Imported by the Deno pipeline, the CLI and the Worker.

export const FORMATS = [
  "build-from-spec",
  "runtime-trap",
  "diagnose-single",
  "diagnose-composite",
] as const;
export type FormatSlug = (typeof FORMATS)[number];

export const FAMILIES = [
  "mechanism",
  "invariant",
  "surface",
  "environment",
] as const;
export type FamilySlug = (typeof FAMILIES)[number];

export const KNOWN_COHORTS = ["ado-trap-2026", "reasoning-100"] as const;
export const KNOWN_TEMPLATES = [
  "code-gen.md",
  "diagnose.md",
  "diagnose-objects.md",
  "diagnose-contract.md",
] as const;
export const DIAGNOSE_TEMPLATES = [
  "diagnose.md",
  "diagnose-objects.md",
  "diagnose-contract.md",
] as const;
export const COMPOSITE_TEMPLATES = [
  "diagnose-objects.md",
  "diagnose-contract.md",
] as const;

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const RETIRED_SLUGS = new Set([
  "diagnose",
  "composite",
  "multi-defect",
  "minimal-symptom",
  "calculations",
]);
export const isRetiredSlug = (s: string): boolean =>
  RETIRED_SLUGS.has(s) || /^defect-sites-\d+$/.test(s);

export const MECHANISM_VOCAB = [
  "tryfunction-write-rollback",
  "commit-scope",
  "error-flow",
  "filter-key-semantics",
  "filter-group-state",
  "temporary-record",
  "xrec-trigger-state",
  "event-binding",
  "event-order",
  "validation-trigger",
  "decimal-precision",
  "culture-format-roundtrip",
  "serialization-encoding",
  "company-scope",
  "permission-check",
  "flowfield-sift",
  "sql-cost-scaling",
  "single-instance-state",
  "recordref-reflection",
  "upgrade-datatransfer",
  "record-locking-concurrency",
] as const;
export const INVARIANT_VOCAB = [
  "largest-remainder-allocation",
  "reversal-conservation",
  "exact-total",
  "inclusive-boundary",
  "idempotent-rebuild",
  "company-isolation",
  "roundtrip-fidelity",
  "bounded-sql-cost",
] as const;
export const ENVIRONMENT_VOCAB = [
  "multi-company",
  "culture-sensitive",
  "test-permissions",
] as const;

export interface CatalogGroup {
  slug: FormatSlug;
  name: string;
  description: string;
}
export interface CatalogFamily {
  slug: FamilySlug;
  name: string;
  description: string;
}
export interface CatalogTag {
  slug: string;
  family: FamilySlug;
  name: string;
  description: string;
  hidden_by_default?: boolean;
}
export interface CatalogAlias {
  from: string;
  to: string;
  note?: string;
}
export interface CatalogOverride {
  task: string;
  group: FormatSlug;
  rule: string;
  reason: string;
}
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
  donors: string[]; // ordinal order, [] for singles
  min_bc_version: number;
}
export interface NormalizedCatalog {
  schema_version: 2;
  task_set_hash: string;
  groups: CatalogGroup[]; // sorted by slug
  families: CatalogFamily[]; // sorted by slug
  tags: CatalogTag[]; // sorted by slug, hidden_by_default always present
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
      if (!Number.isFinite(v))
        throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(v);
    }
    if (typeof v === "string") return JSON.stringify(v.normalize("NFC"));
    if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (o[k] === undefined)
          throw new Error(`canonicalJson: undefined at "${k}"`);
        parts.push(JSON.stringify(k) + ":" + ser(o[k]));
      }
      return "{" + parts.join(",") + "}";
    }
    throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  };
  return ser(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function catalogDigest(n: NormalizedCatalog): Promise<string> {
  return sha256Hex(canonicalJson(n));
}

export interface ValidationIssue {
  code: string;
  where: string;
  message: string;
}

const VALID_GROUPS = new Set<string>(FORMATS);
const VALID_FAMILIES = new Set<string>(FAMILIES);

/**
 * Read a would-be array field for validation: absent -> `[]` (some other
 * check reports the absence where relevant), present-but-not-an-array ->
 * `[]` plus a `not_an_array` issue, present-and-array -> itself unchanged.
 * Callers never see anything but an array, so a malformed top-level
 * collection can never reach a `for...of` and throw inside `validateCatalog`
 * itself.
 */
function asArray<T>(
  value: unknown,
  where: string,
  issue: (code: string, where: string, message: string) => void,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issue("not_an_array", where, `${where} must be an array`);
    return [];
  }
  return value as T[];
}

export function validateCatalog(c: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const issue = (code: string, where: string, message: string) =>
    out.push({ code, where, message });
  if (!c || typeof c !== "object")
    return [
      { code: "not_object", where: "$", message: "catalog is not an object" },
    ];
  const cat = c as Partial<CatalogV2>;
  if (cat.schema_version !== 2)
    issue("bad_schema_version", "schema_version", "expected 2");
  const groups = asArray<CatalogGroup>(cat.groups, "groups", issue);
  const families = asArray<CatalogFamily>(cat.families, "families", issue);
  const tags = asArray<CatalogTag>(cat.tags, "tags", issue);
  const aliases = asArray<CatalogAlias>(cat.aliases, "aliases", issue);
  const overrides = asArray<CatalogOverride>(cat.overrides, "overrides", issue);
  const tasks = cat.tasks ?? {};

  const groupSlugs = new Set<string>();
  for (const g of groups) {
    if (!VALID_GROUPS.has(g.slug))
      issue("unknown_group", `groups.${g.slug}`, "not a format slug");
    if (groupSlugs.has(g.slug))
      issue("duplicate_slug", `groups.${g.slug}`, "duplicate");
    groupSlugs.add(g.slug);
    if (!g.name || !g.description)
      issue(
        "missing_description",
        `groups.${g.slug}`,
        "name and description required",
      );
  }
  const familySlugs = new Set<string>();
  for (const f of families) {
    if (!VALID_FAMILIES.has(f.slug))
      issue("unknown_family", `families.${f.slug}`, "not a family slug");
    if (familySlugs.has(f.slug))
      issue("duplicate_slug", `families.${f.slug}`, "duplicate");
    familySlugs.add(f.slug);
    if (!f.name || !f.description)
      issue(
        "missing_description",
        `families.${f.slug}`,
        "name and description required",
      );
  }
  const tagFamily = new Map<string, FamilySlug>();
  for (const t of tags) {
    if (!SLUG_RE.test(t.slug))
      issue("bad_slug", `tags.${t.slug}`, "slug syntax");
    if (isRetiredSlug(t.slug))
      issue(
        "retired_slug",
        `tags.${t.slug}`,
        "retired from the facet namespace",
      );
    if (!familySlugs.has(t.family))
      issue(
        "unknown_family",
        `tags.${t.slug}`,
        `family ${t.family} not declared`,
      );
    if (tagFamily.has(t.slug))
      issue("duplicate_slug", `tags.${t.slug}`, "duplicate");
    tagFamily.set(t.slug, t.family);
    if (!t.name || !t.description)
      issue(
        "missing_description",
        `tags.${t.slug}`,
        "name and description required",
      );
  }
  for (const a of aliases) {
    if (!tagFamily.has(a.to))
      issue(
        "alias_target_missing",
        `aliases.${a.from}`,
        `${a.to} is not a tag`,
      );
  }
  for (const o of overrides) {
    if (!tasks[o.task])
      issue("override_unknown_task", `overrides.${o.task}`, "no such task");
    if (!VALID_GROUPS.has(o.group))
      issue(
        "unknown_group",
        `overrides.${o.task}`,
        `group ${o.group} not a format slug`,
      );
    if (!o.rule || !o.reason)
      issue(
        "override_unjustified",
        `overrides.${o.task}`,
        "rule and reason required",
      );
  }
  for (const [id, e] of Object.entries(tasks)) {
    const where = `tasks.${id}`;
    if (!groupSlugs.has(e.group))
      issue("unknown_group", where, `group ${e.group} not declared`);
    if (
      typeof e.min_bc_version !== "number" ||
      !Number.isInteger(e.min_bc_version)
    ) {
      issue(
        "missing_min_bc_version",
        where,
        "min_bc_version must be an integer",
      );
    }
    if (isComposite(e)) {
      if ("facets" in e)
        issue(
          "wrong_entry_form",
          where,
          "composites use derived_facets and local_facets",
        );
      // Guard every facet-shaped field before a later `.map`/iteration can
      // throw on it: absent -> missing_* (a composite must declare the
      // field, even as an empty array for derived_facets/local_facets),
      // present-but-wrong-type -> not_an_array. Either way the rest of this
      // branch works from a guaranteed-array local, never the raw field.
      const donorsRaw = (e as CompositeTaskEntry).donors;
      if (donorsRaw === undefined) {
        issue("missing_donors", where, "composite requires a donors array");
      } else if (!Array.isArray(donorsRaw)) {
        issue("not_an_array", where, "donors must be an array");
      }
      const donors = Array.isArray(donorsRaw) ? donorsRaw : [];
      const derivedRaw = (e as CompositeTaskEntry).derived_facets;
      if (derivedRaw === undefined) {
        issue(
          "missing_facets",
          where,
          "composite requires a derived_facets array",
        );
      } else if (!Array.isArray(derivedRaw)) {
        issue("not_an_array", where, "derived_facets must be an array");
      }
      const derivedFacets = Array.isArray(derivedRaw) ? derivedRaw : [];
      const localRaw = (e as CompositeTaskEntry).local_facets;
      if (localRaw === undefined) {
        issue(
          "missing_facets",
          where,
          "composite requires a local_facets array",
        );
      } else if (!Array.isArray(localRaw)) {
        issue("not_an_array", where, "local_facets must be an array");
      }
      const localFacets = Array.isArray(localRaw) ? localRaw : [];
      if (donors.length === 0)
        issue("composite_without_donors", where, "composite needs donors");
      if (donors.length < 4 || donors.length > 8)
        issue(
          "donor_count",
          where,
          `expected 4..8 donors, got ${donors.length}`,
        );
      if (new Set(donors).size !== donors.length)
        issue("duplicate_donor", where, "donors must be distinct");
      if (donors.includes(id))
        issue("self_donor", where, "a task cannot donate to itself");
      const derived = new Set<string>();
      let maxVersion = -Infinity;
      for (const d of donors) {
        const donor = tasks[d];
        if (!donor) {
          issue("unresolved_donor", where, `${d} not in catalog`);
          continue;
        }
        if (donor.group !== "diagnose-single")
          issue("donor_not_single", where, `${d} is ${donor.group}`);
        for (const f of (donor as SingleTaskEntry).facets ?? []) derived.add(f);
        maxVersion = Math.max(maxVersion, donor.min_bc_version);
      }
      const want = [...derived].sort();
      const got = [...derivedFacets].sort();
      if (JSON.stringify(want) !== JSON.stringify(got))
        issue(
          "derived_mismatch",
          where,
          `derived_facets must equal the donor union ${JSON.stringify(want)}`,
        );
      for (const f of localFacets) {
        if (derived.has(f))
          issue("local_overlap", where, `${f} is already derived`);
      }
      if (Number.isFinite(maxVersion) && e.min_bc_version !== maxVersion) {
        issue("version_not_max", where, `min_bc_version must be ${maxVersion}`);
      }
      const allFacets = [...derivedFacets, ...localFacets];
      const facetSet = new Set<string>();
      for (const f of allFacets) {
        if (facetSet.has(f))
          issue("duplicate_facet", where, `${f} appears multiple times`);
        facetSet.add(f);
        if (!tagFamily.has(f))
          issue("unknown_facet", where, `${f} is not a tag`);
      }
    } else {
      const hasDonors =
        "donors" in e &&
        Array.isArray((e as unknown as CompositeTaskEntry).donors) &&
        (e as unknown as CompositeTaskEntry).donors.length > 0;
      if (hasDonors)
        issue("donors_on_single", where, "only composites carry donors");
      if ("derived_facets" in e || "local_facets" in e)
        issue("wrong_entry_form", where, "singles use facets");
      const facetsRaw = (e as SingleTaskEntry).facets;
      if (facetsRaw === undefined) {
        issue("missing_facets", where, "single tasks require a facets array");
      } else if (!Array.isArray(facetsRaw)) {
        issue("not_an_array", where, "facets must be an array");
      }
      const facets = Array.isArray(facetsRaw) ? facetsRaw : [];
      const facetSet = new Set<string>();
      for (const f of facets) {
        if (facetSet.has(f))
          issue("duplicate_facet", where, `${f} appears multiple times`);
        facetSet.add(f);
        if (!tagFamily.has(f))
          issue("unknown_facet", where, `${f} is not a tag`);
      }
    }
  }
  return out;
}

export function normalizeCatalog(
  c: CatalogV2,
  taskSetHash: string,
): NormalizedCatalog {
  const bySlug = <T extends { slug: string }>(xs: T[]) =>
    [...xs].sort((a, b) => a.slug.localeCompare(b.slug));
  const tasks: Record<string, NormalizedTask> = {};
  for (const id of Object.keys(c.tasks).sort()) {
    const e = c.tasks[id]!;
    const facets: { slug: string; origin: FacetOrigin }[] = isComposite(e)
      ? [
          ...e.derived_facets.map((slug) => ({
            slug,
            origin: "derived" as const,
          })),
          ...e.local_facets.map((slug) => ({ slug, origin: "local" as const })),
        ]
      : e.facets.map((slug) => ({ slug, origin: "direct" as const }));
    facets.sort((a, b) => a.slug.localeCompare(b.slug));
    tasks[id] = {
      group: e.group,
      facets,
      donors: isComposite(e) ? [...e.donors] : [],
      min_bc_version: e.min_bc_version,
    };
  }
  return {
    schema_version: 2,
    task_set_hash: taskSetHash,
    groups: bySlug(c.groups).map((g) => ({
      slug: g.slug,
      name: g.name,
      description: g.description,
    })),
    families: bySlug(c.families).map((f) => ({
      slug: f.slug,
      name: f.name,
      description: f.description,
    })),
    tags: bySlug(c.tags).map((t) => ({
      slug: t.slug,
      family: t.family,
      name: t.name,
      description: t.description,
      hidden_by_default: t.hidden_by_default === true,
    })),
    tasks,
  };
}
