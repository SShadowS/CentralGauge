// classify-categories.ts — first-pass re-categorization of all tasks into a
// rebalanced taxonomy, from each task YAML's tags/slug. Deterministic rules,
// first match wins (priority order matters). Output: proposed mapping + counts.
//
// Usage: deno run --allow-read scripts/classify-categories.ts
import { parse } from "jsr:@std/yaml";
import { walk } from "jsr:@std/fs/walk";

// Ordered rules — first regex (against "slug + tags") that matches wins.
const RULES: [string, RegExp][] = [
  ["reflection-datatransfer", /recordref|fieldref|keyref|datatransfer|setautocalcfields|field-metadata|setloadfields|upgrade-tag|upgradetag/],
  ["integration-serialization", /\bjson|xmlport|\bxml\b|http|httpclient|secrettext|secretstr|base64|tempblob|external-api|\buri\b|ssrf|writewithsecrets/],
  ["interfaces-events", /interface|event-subscriber|event-publisher|integration-event|eventsubscriber|externalbusinessevent|business-event/],
  ["error-transactions", /errorinfo|tryfunction|transaction|rollback|commitbehavior|collectible-errors|\bpermissions?\b|privacy-notice|consent|atomic|defer/],
  ["queries-performance", /\bquery|sift|aggregation|\bcache|singleinstance|single-instance|locktimeout/],
  ["records-runtime", /xrec|temporary-table|filter-group|filtergroup|marked-only|record-mark|truncate|onnewrecord|onaftermodify|belowxrec/],
  ["pages-ui", /\bpage|pageextension|page-extension|pagecustomization|report|systempart|listpart|testpart|dataset|visibility|conditional-layout|onaftergetrecord/],
  ["data-modeling", /\btable|\benum|flowfield|calcformula|extendeddatatype|biginteger|masktype|\bkeys?\b|table-extension|tableextension|allowincustomizations/],
  ["business-logic", /.*/], // default
];

type Row = { id: string; slug: string; tags: string; cat: string };
const rows: Row[] = [];

for await (const e of walk("tasks", { exts: [".yml"], includeDirs: false })) {
  const text = await Deno.readTextFile(e.path);
  const doc = parse(text) as { id?: string; metadata?: { tags?: string[] } };
  if (!doc.id) continue;
  const slug = e.name.replace(/\.yml$/, "").replace(/CG-AL-[A-Z]\d+-?/, "");
  const tags = (doc.metadata?.tags ?? []).join(" ");
  const hay = `${slug} ${tags}`.toLowerCase();
  const cat = RULES.find(([, re]) => re.test(hay))?.[0] ?? "business-logic";
  rows.push({ id: doc.id, slug, tags, cat });
}

rows.sort((a, b) => a.id.localeCompare(b.id));

// counts
const counts = new Map<string, number>();
for (const r of rows) counts.set(r.cat, (counts.get(r.cat) ?? 0) + 1);
console.log("# Proposed category counts (target: each >= 8)\n");
for (const [c, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(3)}  ${c}`);
}
console.log(`\n  total: ${rows.length}\n`);

// grouped listing
console.log("# Proposed mapping (review these)\n");
for (const [c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`\n## ${c} (${counts.get(c)})`);
  for (const r of rows.filter((x) => x.cat === c)) {
    console.log(`  ${r.id.padEnd(11)} ${r.slug.padEnd(34)} [${r.tags}]`);
  }
}

// machine-readable YAML for the eventual catalog file
console.log("\n# ---- YAML (tasks: map) ----");
for (const r of rows) console.log(`  ${r.id}: ${r.cat}`);
