// merge-taxonomy.ts — final taxonomy: rule-based GROUP + content-derived FACETS
// (from the enrich-task-tags workflow). Drops the ubiquitous 'codeunit' facet,
// adds the 3 genuinely-new niche facets the workflow flagged.
// Usage: deno run --allow-read --allow-write scripts/merge-taxonomy.ts
import { parse } from "jsr:@std/yaml";
import { walk } from "jsr:@std/fs/walk";

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

const enriched: Record<string, string[]> = JSON.parse(await Deno.readTextFile(".claude/skills/refresh-task-taxonomy/pipeline/enriched-tags.json"));
// drop ubiquitous non-discriminating facet
const DROP_FACET = new Set(["codeunit"]);
// genuinely-new niche facets the workflow flagged (gap → task)
const ADD: Record<string, string[]> = {
  "CG-AL-H018": ["fluent-api"],
  "CG-AL-H013": ["continue-keyword"],
  "CG-AL-H033": ["conditional-visibility"],
  "CG-AL-M004": ["conditional-visibility"],
};

// re-derive group from each task's slug+raw-tags (same approved rules)
const group: Record<string, string> = {};
for await (const e of walk("tasks", { exts: [".yml"], includeDirs: false })) {
  const doc = parse(await Deno.readTextFile(e.path)) as { id?: string; metadata?: { tags?: string[] } };
  if (!doc.id) continue;
  const slug = e.name.replace(/\.yml$/, "").replace(/CG-AL-[A-Z]\d+-?/, "");
  const hay = `${slug} ${(doc.metadata?.tags ?? []).join(" ")}`.toLowerCase();
  group[doc.id] = GROUP_OVERRIDE[doc.id] ?? GROUP_RULES.find(([, re]) => re.test(hay))![0];
}

const ids = Object.keys(enriched).sort();
const taskFacets: Record<string, string[]> = {};
for (const id of ids) {
  const set = new Set(enriched[id].filter((f) => !DROP_FACET.has(f)));
  for (const a of ADD[id] ?? []) set.add(a);
  taskFacets[id] = [...set].sort();
}

// facet vocab + which groups each appears in
const facetGroups = new Map<string, Set<string>>();
const facetFreq = new Map<string, number>();
for (const id of ids) for (const f of taskFacets[id]) {
  facetFreq.set(f, (facetFreq.get(f) ?? 0) + 1);
  (facetGroups.get(f) ?? facetGroups.set(f, new Set()).get(f)!).add(group[id]);
}

let out = "# Task taxonomy — authoritative for the SITE only (UI + analysis).\n";
out += "# NOT part of the task_set hash: editing this file + re-syncing never\n";
out += "# invalidates a benchmark or forces a re-bench.\n";
out += "# groups: mutually exclusive (one per task). tags: cross-cutting facets\n";
out += "# (0..N), content-derived. Both are filterable.\n\n";
out += "groups:\n";
for (const [slug, name, desc] of GROUPS) out += `  - slug: ${slug}\n    name: ${name}\n    description: ${desc}\n`;
out += "\ntags:\n";
for (const [f, gs] of [...facetGroups.entries()].sort()) {
  out += `  - slug: ${f}\n    groups: [${[...gs].sort().join(", ")}]\n`;
}
out += "\ntasks:\n";
for (const id of ids) out += `  ${id}: { group: ${group[id]}, tags: [${taskFacets[id].join(", ")}] }\n`;
await Deno.writeTextFile("site/catalog/task-categories.yml", out);

console.log(`tasks=${ids.length}  facets=${facetFreq.size}`);
const empty = ids.filter((id) => taskFacets[id].length === 0);
console.log(`avg facets/task = ${(ids.reduce((s, id) => s + taskFacets[id].length, 0) / ids.length).toFixed(1)}; tasks with 0 facets: ${empty.length} ${empty.join(" ")}`);
console.log("\nfacet frequency:");
for (const [f, n] of [...facetFreq.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}  ${f}`);
