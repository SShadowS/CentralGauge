// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/score-calls.ts <calls.jsonl> <labels.csv>
// Scores classify-rules.ts output against hand labels (index,category; index = 0-based
// line of calls.jsonl). Prints coverage and accuracy per harness (from the log file
// name prefix) and the calls the rules left unclassified.
const [callsPath, labelsPath] = Deno.args;
if (!callsPath || !labelsPath) throw new Error("usage: see header");

interface Call {
  file: string;
  tool: string;
  command?: string;
  category: string | null;
}
const calls: Call[] = (await Deno.readTextFile(callsPath)).split("\n")
  .filter((l) => l.trim()).map((l) => JSON.parse(l));
const labels = new Map<number, string>();
for (const line of (await Deno.readTextFile(labelsPath)).split("\n").slice(1)) {
  const [i, c] = line.trim().split(",");
  if (i && c) labels.set(Number(i), c);
}
if (labels.size !== calls.length) {
  throw new Error(`${labels.size} labels for ${calls.length} calls`);
}

const harnessOf = (file: string) =>
  (file.split(/[\\/]/).pop() ?? "").split("-")[0] ?? "?";
const groups = new Map<string, number[]>([["all", []]]);
calls.forEach((c, i) => {
  const h = harnessOf(c.file);
  if (!groups.has(h)) groups.set(h, []);
  groups.get(h)?.push(i);
  groups.get("all")?.push(i);
});

for (const [h, idx] of groups) {
  const ruled = idx.filter((i) => calls[i]?.category);
  const right = ruled.filter((i) => calls[i]?.category === labels.get(i));
  console.log(
    `${h}: coverage ${ruled.length}/${idx.length}, accuracy ${right.length}/${ruled.length}`,
  );
  for (const i of ruled.filter((i) => !right.includes(i))) {
    console.log(
      `  wrong ${i}: rule ${calls[i]?.category}, label ${labels.get(i)}`,
    );
  }
  if (h === "all") continue;
  for (const i of idx.filter((i) => !calls[i]?.category)) {
    const c = calls[i];
    console.log(
      `  unclassified ${i}: ${c?.tool} ${c?.command ?? ""} (label ${
        labels.get(i)
      })`,
    );
  }
}
