// category-strength.ts — per-model strength profile by task category.
//
// Reads a /api/v1/matrix?set=current JSON (tasks×models cells with
// passed/attempted) and computes, per (model, category), the attempt-level
// pass rate. Then surfaces, per category, the leader; and per model, the
// categories where it stands out most vs the field average.
//
// Usage: deno run --allow-read scripts/category-strength.ts /tmp/matrix.json [minTasks=8]
type Cell = { passed: number; attempted: number };
type Matrix = {
  tasks: { id: string; category_slug: string | null }[];
  models: { slug: string; display_name: string }[];
  cells: Cell[][];
};

const path = Deno.args[0] ?? "/tmp/matrix.json";
const MIN_TASKS = Number(Deno.args[1] ?? 8);
const m: Matrix = JSON.parse(await Deno.readTextFile(path));

// category -> task indices
const catTasks = new Map<string, number[]>();
m.tasks.forEach((t, i) => {
  const c = t.category_slug ?? "(uncat)";
  (catTasks.get(c) ?? catTasks.set(c, []).get(c)!).push(i);
});
const cats = [...catTasks.entries()]
  .filter(([, idxs]) => idxs.length >= MIN_TASKS)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([c]) => c);

// rate[modelIdx][cat] = sumPassed/sumAttempted over the category's tasks
function rate(mi: number, cat: string): number | null {
  let p = 0, a = 0;
  for (const ti of catTasks.get(cat)!) {
    p += m.cells[ti][mi].passed;
    a += m.cells[ti][mi].attempted;
  }
  return a > 0 ? p / a : null;
}

const pct = (x: number | null) => (x == null ? "  -  " : (x * 100).toFixed(0).padStart(3) + "%");

// ---- table: category (rows) x model (cols) ----
console.log("# Per-category attempt-level pass rate (set=current)\n");
const shortName = (s: string) => s.replace("anthropic/", "").replace("openai/", "").replace("gemini/", "").replace("claude-", "");
const header = ["category".padEnd(20) + "n", ...m.models.map((mm) => shortName(mm.slug).padStart(10))].join(" ");
console.log(header);
for (const c of cats) {
  const n = catTasks.get(c)!.length;
  const row = [`${c.padEnd(20)}${String(n).padEnd(1)}`,
    ...m.models.map((_, mi) => pct(rate(mi, c)).padStart(10))].join(" ");
  console.log(row);
}

// ---- per category: leader ----
console.log("\n# Category leaders (who's best at each)\n");
for (const c of cats) {
  const ranked = m.models
    .map((mm, mi) => ({ slug: shortName(mm.slug), r: rate(mi, c) }))
    .filter((x) => x.r != null)
    .sort((a, b) => (b.r! - a.r!));
  const lead = ranked[0], second = ranked[1];
  const margin = lead.r! - second.r!;
  console.log(`${c.padEnd(20)} (${catTasks.get(c)!.length} tasks)  →  ${lead.slug} ${pct(lead.r)}  ` +
    `(next: ${second.slug} ${pct(second.r)}, +${(margin * 100).toFixed(0)}pt)`);
}

// ---- per model: comparative strengths (rate - field mean for that category) ----
console.log("\n# Per-model comparative strengths (category rate minus field mean)\n");
const fieldMean = new Map<string, number>();
for (const c of cats) {
  const rs = m.models.map((_, mi) => rate(mi, c)).filter((x): x is number => x != null);
  fieldMean.set(c, rs.reduce((s, x) => s + x, 0) / rs.length);
}
for (let mi = 0; mi < m.models.length; mi++) {
  const rels = cats
    .map((c) => ({ c, d: (rate(mi, c) ?? 0) - fieldMean.get(c)!, r: rate(mi, c) }))
    .sort((a, b) => b.d - a.d);
  const top = rels.slice(0, 3).map((x) => `${x.c} (${pct(x.r)}, ${x.d >= 0 ? "+" : ""}${(x.d * 100).toFixed(0)}pt)`);
  const worst = rels[rels.length - 1];
  console.log(`${shortName(m.models[mi].slug).padEnd(16)} strong: ${top.join(" · ")}`);
  console.log(`${"".padEnd(16)} weak:   ${worst.c} (${pct(worst.r)}, ${(worst.d * 100).toFixed(0)}pt)`);
}
