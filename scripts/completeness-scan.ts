/**
 * Scan every benchmark attempt for completeness violations against the
 * starter, and split legitimate removals from unpunished loss using the
 * reference solution.
 *
 * The compiler only reports a dropped member when something still references
 * it (AL0132). A member nothing references vanishes silently, compiles clean,
 * and can pass the oracle - "none of them confirms what the edit preserves"
 * (arXiv 2604.05100). This measures that.
 *
 * The reference solution is the discriminator: if the reference ALSO drops
 * the member, the model's drop is a legitimate part of the fix, not a loss.
 */
import { checkCompleteness } from "../src/tasks/object-overlay.ts";
import {
  loadStarterCode,
  starterDirForTask,
} from "../src/tasks/starter-code.ts";

const ROOT = "U:/Git/CentralGauge";
const starters = new Map<string, string | undefined>();
const refs = new Map<string, Set<string> | undefined>();

async function starter(id: string) {
  if (!starters.has(id)) {
    starters.set(id, await loadStarterCode(starterDirForTask(ROOT, id)));
  }
  return starters.get(id);
}

/** Members the REFERENCE solution also drops - legitimate removal, not loss. */
async function referenceDrops(id: string, st: string) {
  if (!refs.has(id)) {
    let src = "";
    try {
      for await (const e of Deno.readDir(`${ROOT}/reference/solutions/${id}`)) {
        if (e.isFile && e.name.toLowerCase().endsWith(".al")) {
          src += await Deno.readTextFile(
            `${ROOT}/reference/solutions/${id}/${e.name}`,
          );
          src += "\n";
        }
      }
    } catch { /* no reference solution for this task */ }
    refs.set(
      id,
      src
        ? new Set(
          checkCompleteness(st, src).droppedMembers.map((d) =>
            `${d.object}|${d.member}`
          ),
        )
        : undefined,
    );
  }
  return refs.get(id);
}

interface Row {
  model: string;
  task: string;
  passed: boolean;
  objs: number;
  mems: number;
  shrunk: number;
  /** Dropped members not also dropped by the reference; null = no reference. */
  unexplained: string[] | null;
}

const rows: Row[] = [];
for (const f of Deno.args) {
  const doc = JSON.parse(await Deno.readTextFile(f));
  for (const r of doc.results) {
    const st = await starter(r.taskId);
    if (!st) continue;
    const legit = await referenceDrops(r.taskId, st);
    for (const a of (r.attempts ?? [])) {
      const code = a.extractedCode ?? "";
      if (!code) continue; // provider failure: no output is not an omission
      const c = checkCompleteness(st, code);
      const keys = c.droppedMembers.map((d) => `${d.object}|${d.member}`);
      rows.push({
        model: r.context?.llmModel ?? "?",
        task: r.taskId,
        passed: a.compilationResult?.success === true &&
          a.testResult?.success === true,
        objs: c.droppedObjects.length,
        mems: keys.length,
        shrunk: c.shrunkObjects.length,
        unexplained: legit === undefined
          ? null
          : keys.filter((k) => !legit.has(k)),
      });
    }
  }
}

const n = rows.length;
const any = (r: Row) => r.objs > 0 || r.mems > 0;
const pct = (a: number, b: number) =>
  b > 0 ? `${(a / b * 100).toFixed(1)}%` : "n/a";

console.log(`attempts scanned: ${n}`);
console.log(
  `  dropped >=1 object : ${rows.filter((r) => r.objs > 0).length} (${
    pct(rows.filter((r) => r.objs > 0).length, n)
  })`,
);
console.log(
  `  dropped >=1 member : ${rows.filter((r) => r.mems > 0).length} (${
    pct(rows.filter((r) => r.mems > 0).length, n)
  })`,
);
console.log(
  `  shrunk an object   : ${rows.filter((r) => r.shrunk > 0).length}`,
);

const pass = rows.filter((r) => r.passed);
const fail = rows.filter((r) => !r.passed);
console.log(`\nBY OUTCOME`);
console.log(
  `  PASSING: ${pass.length}, ${pass.filter(any).length} (${
    pct(pass.filter(any).length, pass.length)
  }) dropped something`,
);
console.log(
  `  FAILING: ${fail.length}, ${fail.filter(any).length} (${
    pct(fail.filter(any).length, fail.length)
  }) dropped something`,
);

console.log(`\nPER MODEL (attempts dropping >=1 object or member)`);
const byModel = new Map<string, Row[]>();
for (const r of rows) {
  if (!byModel.has(r.model)) byModel.set(r.model, []);
  byModel.get(r.model)!.push(r);
}
for (
  const [m, rs] of [...byModel].sort((a, b) =>
    b[1].filter(any).length / b[1].length - a[1].filter(any).length /
      a[1].length
  )
) {
  console.log(
    `  ${m.padEnd(32)} ${rs.filter(any).length}/${rs.length} = ${
      pct(rs.filter(any).length, rs.length)
    }`,
  );
}

// The measurement that matters: a passing attempt that dropped a member the
// REFERENCE keeps. Compiled, tests green, and the app lost something.
const scored = pass.filter((r) => r.unexplained !== null);
const unexp = scored.filter((r) => r.unexplained!.length > 0);
const explained = scored.filter((r) =>
  r.mems > 0 && r.unexplained!.length === 0
);
console.log(`\nPASSING attempts that dropped a member, vs the REFERENCE`);
console.log(
  `  comparable (a reference solution exists): ${scored.length} of ${pass.length}`,
);
console.log(
  `  drop MATCHES the reference (legitimate): ${explained.length}`,
);
console.log(
  `  drop NOT in the reference (UNPUNISHED LOSS): ${unexp.length} (${
    pct(unexp.length, scored.length)
  } of comparable)`,
);
const silent = new Map<string, number>();
for (const r of unexp) {
  for (const m of r.unexplained!) silent.set(m, (silent.get(m) ?? 0) + 1);
}
for (const [k, v] of [...silent].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`   x${v}  ${k}`);
}
if (silent.size === 0) {
  console.log(
    "   (none - every drop on a passing attempt matches the reference)",
  );
}
