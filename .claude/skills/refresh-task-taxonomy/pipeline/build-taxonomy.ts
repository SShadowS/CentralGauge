// build-taxonomy.ts — generate the authoritative 2-level taxonomy:
// 9 mutually-exclusive GROUPS + a curated, cross-cutting FACET-TAG vocabulary,
// with each task assigned { group, tags }. Canonicalized from the tasks'
// existing metadata.tags (faithful to author intent) + the approved group map.
//
// Output: site/catalog/task-categories.yml  (UI-only; NOT in the task hash)
// Usage: deno run --allow-read --allow-write scripts/build-taxonomy.ts
import { parse } from "jsr:@std/yaml";
import { walk } from "jsr:@std/fs/walk";

// ---- GROUPS (mutually exclusive; one per task) ----
const GROUPS: [string, string, string][] = [
  ["data-modeling", "Data Modeling", "Tables, enums, fields, table extensions, keys, and FlowFields."],
  ["pages-ui", "Pages, Reports & UI", "Pages, page extensions, customizations, system parts, and reports."],
  ["business-logic", "Codeunits & Business Logic", "Procedures, calculations, string/text ops, and control flow."],
  ["interfaces-events", "Interfaces & Events", "Interfaces, event publishers/subscribers, integration events."],
  ["error-transactions", "Errors & Transactions", "ErrorInfo, try-functions, commit/rollback, permissions, collectible errors."],
  ["integration-serialization", "Integration & Serialization", "JSON, XML, HTTP/web services, SecretText, base64."],
  ["reflection-datatransfer", "Reflection & Data Transfer", "RecordRef/FieldRef, DataTransfer, upgrade tags."],
  ["records-runtime", "Records & Runtime", "xRec, temporary tables, record marks, filter groups."],
  ["queries-performance", "Queries & Performance", "Query objects, SIFT, caching, single-instance."],
];

// Group rules (first match wins) — approved, with the 5 manual overrides.
const GROUP_RULES: [string, RegExp][] = [
  ["reflection-datatransfer", /recordref|fieldref|keyref|datatransfer|setautocalcfields|field-metadata|setloadfields|upgrade-tag|upgradetag/],
  ["integration-serialization", /\bjson|xmlport|\bxml\b|http|httpclient|secrettext|secretstr|base64|tempblob|external-api|\buri\b|ssrf|writewithsecrets/],
  ["interfaces-events", /interface|event-subscriber|event-publisher|integration-event|eventsubscriber|externalbusinessevent|business-event/],
  ["error-transactions", /errorinfo|tryfunction|transaction|rollback|commitbehavior|collectible-errors|\bpermissions?\b|privacy-notice|consent|atomic|defer/],
  ["queries-performance", /\bquery|sift|aggregation|\bcache|singleinstance|single-instance|locktimeout/],
  ["records-runtime", /xrec|temporary-table|filter-group|filtergroup|marked-only|record-mark|truncate|onnewrecord|onaftermodify|belowxrec/],
  ["pages-ui", /\bpage|pageextension|page-extension|pagecustomization|report|systempart|listpart|testpart|dataset|visibility|conditional-layout|onaftergetrecord/],
  ["data-modeling", /\btable|\benum|flowfield|calcformula|extendeddatatype|biginteger|masktype|\bkeys?\b|table-extension|tableextension|allowincustomizations/],
  ["business-logic", /.*/],
];
const GROUP_OVERRIDE: Record<string, string> = {
  "CG-AL-E052": "business-logic", "CG-AL-H005": "records-runtime",
  "CG-AL-H027": "records-runtime", "CG-AL-M045": "records-runtime",
  "CG-AL-H034": "error-transactions",
};

// ---- FACET TAG canonicalization ----
// DROP: ubiquitous/non-discriminating or codecop-rule noise.
const DROP = new Set([
  "codeunit", "procedure", "fields", "record", "captions", "data-classification",
  "test", "testtype", "requiredtestisolation", "aa0248", "al0896", "debugging",
  "session", "type-conversion", "set-based", "task", "no-write",
  "page-local-var", "readonly-trigger", "host-validation", "system-application",
  "error-behavior", "batch-validation", "filter-preservation", "protected-scope",
  "record-filter", "intersect", "set-based-update", "instance-passing",
  "codeunit-self-reference", "obsolete", "deprecation", "idempotent", "format",
  "session-scope", "fifo-eviction", "bounded-cache", "primary-key", "composite-key",
  "instream-outstream", "textencoding", "unicode", "typed-getters", "fieldtype",
  "fieldclass", "calcfield", "relation", "table-relation", "field-metadata",
  "dynamic-visibility", "conditional-layout", "group", "setup", "visible", "enabled",
  "data", "useservercertificatevalidation",
  "adddestinationfilter", "writewithsecretsto", "jsonobject", "onprerendering",
  "targetformat", "reportformat", "masktype", "allowincustomizations", "extendeddatatype",
  "biginteger", "rename", "belowxrec", "onnewrecord", "marked-only", "external-api",
  "httpheaders", "secretstr", "set-based",
]);
// CANON: raw tag -> canonical facet slug (synonym merges + roll-ups).
const CANON: Record<string, string> = {
  "tableextension": "table-extension", "table-extension": "table-extension",
  "pageextension": "page-extension", "page-extension": "page-extension",
  "pagecustomization": "page-customization", "customization": "page-customization", "editable": "page-customization",
  "systempart": "system-part", "summary": "system-part", "listpart": "system-part", "testpart": "system-part",
  "calcformula": "flowfield", "flowfield": "flowfield", "setautocalcfields": "flowfield",
  "eventsubscriber": "event-subscriber", "event-subscriber": "event-subscriber",
  "event-publisher": "event-publisher", "integration-event": "event-publisher",
  "externalbusinessevent": "business-event",
  "errorinfo": "error-info", "error-handling": "error-info",
  "tryfunction": "try-function",
  "transaction": "transaction", "rollback": "transaction", "commitbehavior": "transaction", "batch": "transaction",
  "collectible-errors": "collectible-errors",
  "permissions": "permissions",
  "privacy-notice": "privacy-consent", "consent": "privacy-consent",
  "json": "json",
  "xml": "xml", "xmlport": "xml",
  "http": "http", "httpclient": "http",
  "secrettext": "secrettext",
  "base64": "serialization", "tempblob": "serialization",
  "security": "security", "ssrf": "security", "uri": "security",
  "recordref": "recordref", "setloadfields": "recordref",
  "fieldref": "fieldref", "keyref": "fieldref", "blob": "fieldref", "media": "fieldref",
  "datatransfer": "datatransfer", "install": "datatransfer",
  "upgrade-tag": "upgrade-tag", "upgrade": "upgrade-tag",
  "xrec": "xrec",
  "trigger": "triggers", "triggers": "triggers",
  "onvalidate": "validation", "validation": "validation",
  "temporary-table": "temporary-table",
  "record-mark": "record-mark",
  "filter-group": "filter-group", "filter": "filter-group",
  "this-keyword": "this-keyword",
  "query": "query", "query-object": "query", "aggregation": "query", "sift": "query",
  "singleinstance": "single-instance", "single-instance": "single-instance",
  "locktimeoutduration": "locktimeout", "database": "locktimeout",
  "collections": "collections", "list": "collections", "generics": "collections",
  "table": "table", "enum": "enum", "keys": "keys",
  "page": "page", "report": "report", "dataset": "report", "api-page": "page",
  "interface": "interface",
  "guid": "guid", "totext": "text-conversion", "namespace": "namespace", "fqn": "namespace",
  "calculations": "calculations", "numeric-precision": "calculations", "rounding": "calculations",
  "string-operations": "text-conversion", "fluent-api": "fluent-api", "bulk-operations": "bulk-operations",
  "v15": "v15", "v16": "v16", "v17": "v17",
  "onaftergetrecord": "page-trigger",
};
const canon = (t: string): string | null => {
  const k = t.toLowerCase();
  if (DROP.has(k)) return null;
  return CANON[k] ?? null; // unmapped, non-dropped -> drop (keeps vocab controlled)
};

type Task = { id: string; group: string; tags: string[] };
const tasks: Task[] = [];
for await (const e of walk("tasks", { exts: [".yml"], includeDirs: false })) {
  const doc = parse(await Deno.readTextFile(e.path)) as { id?: string; metadata?: { tags?: string[] } };
  if (!doc.id) continue;
  const slug = e.name.replace(/\.yml$/, "").replace(/CG-AL-[A-Z]\d+-?/, "");
  const raw = doc.metadata?.tags ?? [];
  const hay = `${slug} ${raw.join(" ")}`.toLowerCase();
  const group = GROUP_OVERRIDE[doc.id] ?? GROUP_RULES.find(([, re]) => re.test(hay))![0];
  const facets = [...new Set(raw.map(canon).filter((x): x is string => !!x))].sort();
  tasks.push({ id: doc.id, group, tags: facets });
}
tasks.sort((a, b) => a.id.localeCompare(b.id));

// facet vocab (with which groups they actually appear in)
const facetGroups = new Map<string, Set<string>>();
const facetCount = new Map<string, number>();
for (const t of tasks) for (const f of t.tags) {
  facetCount.set(f, (facetCount.get(f) ?? 0) + 1);
  (facetGroups.get(f) ?? facetGroups.set(f, new Set()).get(f)!).add(t.group);
}

// ---- emit YAML ----
let out = "# Task taxonomy — authoritative for the SITE only (UI + analysis).\n";
out += "# NOT part of the task_set hash: editing this file + re-syncing never\n";
out += "# invalidates a benchmark or forces a re-bench. groups are mutually\n";
out += "# exclusive (one per task); tags are cross-cutting facets (0..N).\n\n";
out += "groups:\n";
for (const [slug, name, desc] of GROUPS) out += `  - slug: ${slug}\n    name: ${name}\n    description: ${desc}\n`;
out += "\ntags:\n";
for (const [f, gs] of [...facetGroups.entries()].sort()) {
  out += `  - slug: ${f}\n    groups: [${[...gs].sort().join(", ")}]\n`;
}
out += "\ntasks:\n";
for (const t of tasks) out += `  ${t.id}: { group: ${t.group}, tags: [${t.tags.join(", ")}] }\n`;
await Deno.writeTextFile("site/catalog/task-categories.yml", out);

// ---- report ----
const gc = new Map<string, number>();
for (const t of tasks) gc.set(t.group, (gc.get(t.group) ?? 0) + 1);
console.log("GROUPS:");
for (const [g, n] of [...gc.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}  ${g}`);
console.log(`\nFACET TAGS (${facetCount.size}):`);
for (const [f, n] of [...facetCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}  ${f.padEnd(18)} groups=${[...(facetGroups.get(f) ?? [])].length}`);
}
const noTags = tasks.filter((t) => t.tags.length === 0);
console.log(`\ntasks with 0 facet tags: ${noTags.length}  ${noTags.map((t) => t.id).join(" ")}`);
