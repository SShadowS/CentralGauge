import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  aggregate,
  assignSides,
  buildPacket,
  cohenKappa,
  extractRubric,
  fillTemplate,
  GUESS_SUFFIX,
  type JudgeClient,
  judgePackets,
  type JudgeResult,
  loadPairs,
  manifestTerms,
  parseGuess,
  parseVerdict,
  redactSide,
  resolveCommand,
  writePackets,
} from "../../../scripts/harness/judge-pairs.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

Deno.test("redactSide: terms match whole words only, never inside a word", () => {
  const side = [
    "+++ b/Core/src/X.Codeunit.al",
    "+    // despite the pi skill, picks up the arm-x value",
  ].join("\n");
  const r = redactSide(side, ["arm-x"], ["pi", "skill"]);
  assertEquals(
    r.text.split("\n")[1],
    "+    // despite the [redacted] [redacted], picks up the [redacted] value",
  );
  assertEquals(r.count, 3);
});

const DIMS = [
  "correctness_risk",
  "conventions",
  "minimality",
  "test_value",
  "readability",
] as const;

const verdictJson = (
  v: "A" | "B" | "tie",
  over: Record<string, unknown> = {},
) =>
  JSON.stringify({
    ...Object.fromEntries(DIMS.map((d) => [d, {
      verdict: v,
      reason: "because",
      cite: v === "tie" ? "none" : "A:School/src/Fee.al:3",
    }])),
    ...over,
  });

const TEMPLATE =
  "R\n{{RUBRIC}}\nT\n{{TASK_PROMPT}}\nA\n{{SIDE_A}}\nB\n{{SIDE_B}}\nEND";
const RUBRIC_FILE =
  "head\n<!-- judge:start -->\nRUBRIC BODY\n<!-- judge:end -->\ntail";

async function write(root: string, rel: string, text: string) {
  const p = join(root, ...rel.split("/"));
  await Deno.mkdir(join(p, ".."), { recursive: true });
  await Deno.writeTextFile(p, text);
}

async function fixture() {
  const root = await testTempDir();
  const start = join(root, "start");
  const base = join(root, "base");
  const vari = join(root, "var");
  for (const d of [start, base, vari]) {
    await write(d, "School/src/Fee.al", "codeunit 50100 Fee\n{\n}\n");
    await write(d, "Test/src/FeeTest.al", "codeunit 50101 FeeTest\n{\n}\n");
  }
  await write(
    base,
    "School/src/Fee.al",
    "codeunit 50100 Fee\n{\n    // plain solution\n}\n",
  );
  await write(
    vari,
    "School/src/Fee.al",
    "codeunit 50100 Fee\r\n{\r\n    // by Claude, via the realistic-skill and ArmRealistic\r\n\tvar x: Integer;   \r\n}\r\n",
  );
  await write(
    vari,
    "Test/src/FeeTest.al",
    "codeunit 50101 FeeTest\n{\n    // anthropic subagent helper-agent\n}\n",
  );
  await write(vari, "CLAUDE.md", "ARMLEAK instructions");
  await write(vari, ".claude/skills/x.al", "ARMLEAK");
  await write(vari, "Scratch/notes.al", "ARMLEAK scratch");
  return { root, start, base, vari };
}

const manifests = [{
  config_id: "cfg-realistic",
  skills: { path: "skills", files: [{ path: "realistic-skill/SKILL.md" }] },
  agents: { path: "agents", files: [{ path: "helper-agent.md" }] },
  hooks: null,
  plugins: [],
  mcp: [{ name: "al-tools" }],
}];

Deno.test("blinding: arm, skill, tool names and out-of-app files never reach the packet; key is separate", async () => {
  const f = await fixture();
  const mt = manifestTerms(["plainarm", "ArmRealistic"], manifests);
  const p = await buildPacket({
    seed: "s",
    task: "HX-001",
    repeat: 1,
    baseline: "plainarm",
    variant: "ArmRealistic",
    taskPrompt: "Do the thing.",
    startDir: f.start,
    baseFinal: f.base,
    varFinal: f.vari,
    template: TEMPLATE,
    rubric: "RUBRIC BODY",
    terms: mt.terms,
    arms: mt.arms,
  });
  for (const t of [p.text, p.swappedText]) {
    assert(
      !/claude|anthropic|subagent|realistic|plainarm|helper-agent|ARMLEAK|Scratch|al-tools/i
        .test(t),
      t,
    );
    assert(t.includes("School/src/Fee.al"));
    assert(t.includes("[redacted]"));
    assert(!t.includes("\r"));
    assert(!t.includes("\t"));
    // production before test
    assert(
      t.indexOf("School/src/Fee.al") < t.indexOf("Test/src/FeeTest.al") ||
        !t.includes("FeeTest"),
    );
    assert(t.includes("--- a/School/src/Fee.al"));
    assert(t.includes("+++ b/School/src/Fee.al"));
  }
  const out = await testTempDir();
  await writePackets(out, [p]);
  const names: string[] = [];
  for await (const e of Deno.readDir(join(out, "packets"))) names.push(e.name);
  assertEquals(names, [`${p.id}.md`]);
  const key = JSON.parse(await Deno.readTextFile(join(out, "key", "key.json")));
  assertEquals(Object.keys(key[p.id]).sort(), ["A", "B", "a_role"]);
  assertEquals([key[p.id].A, key[p.id].B].sort(), ["ArmRealistic", "plainarm"]);
  assertEquals(
    await Deno.readTextFile(join(out, "packets", `${p.id}.md`)),
    p.text,
  );
});

Deno.test("both sides share one formatter: a CRLF/tab-only difference yields no diff", async () => {
  const root = await testTempDir();
  await write(root, "s/School/a.al", "x\n\tfoo  \n");
  await write(root, "b/School/a.al", "x\r\n    foo\r\n");
  await write(root, "v/School/a.al", "x\n    foo\n");
  const p = await buildPacket({
    seed: "s",
    task: "T",
    repeat: 1,
    baseline: "a",
    variant: "b",
    taskPrompt: "p",
    startDir: join(root, "s"),
    baseFinal: join(root, "b"),
    varFinal: join(root, "v"),
    template: TEMPLATE,
    rubric: "R",
    terms: [],
    arms: [],
  });
  assert(!p.text.includes("@@"));
});

Deno.test("assignSides: deterministic per seed and key; not constant", async () => {
  const a = await assignSides("s", "T", 1, "b", "v");
  assertEquals(a, await assignSides("s", "T", 1, "b", "v"));
  const seen = new Set<boolean>();
  for (let r = 1; r < 30; r++) {
    seen.add(await assignSides("s", "T", r, "b", "v"));
  }
  assertEquals(seen.size, 2);
});

Deno.test("fillTemplate and extractRubric fail closed", () => {
  assertEquals(extractRubric(RUBRIC_FILE), "RUBRIC BODY");
  assertThrows(() => extractRubric("no markers"));
  assertThrows(() => extractRubric("<!-- judge:end -->\n<!-- judge:start -->"));
  assertEquals(
    fillTemplate(TEMPLATE, "RB", "TP", "SA", "SB"),
    "R\nRB\nT\nTP\nA\nSA\nB\nSB\nEND",
  );
  assertThrows(() => fillTemplate("{{RUBRIC}} {{SIDE_A}}", "r", "t", "a", "b"));
});

Deno.test("parseVerdict: strict", () => {
  const ok = parseVerdict(verdictJson("A"));
  assertEquals(ok.readability.verdict, "A");
  assertEquals(
    parseVerdict(`  ${verdictJson("tie")}\n`).minimality.cite,
    "none",
  );
  assertThrows(() => parseVerdict("```json\n" + verdictJson("A") + "\n```"));
  assertThrows(() => parseVerdict("here: " + verdictJson("A")));
  assertThrows(() => parseVerdict(verdictJson("A", { extra: 1 })));
  assertThrows(() =>
    parseVerdict(
      verdictJson("A", {
        conventions: { verdict: "A", reason: "r", cite: "oops" },
      }),
    )
  );
  assertThrows(() =>
    parseVerdict(
      verdictJson("A", {
        conventions: { verdict: "tie", reason: "r", cite: "A:x.al:1" },
      }),
    )
  );
  assertThrows(() =>
    parseVerdict(
      verdictJson("A", {
        conventions: { verdict: "A", reason: "", cite: "none" },
      }),
    )
  );
  assertThrows(() =>
    parseVerdict(
      verdictJson("A", {
        conventions: { verdict: "C", reason: "r", cite: "none" },
      }),
    )
  );
  assertThrows(() =>
    parseVerdict(
      verdictJson("A", {
        conventions: { verdict: "A", reason: "r", cite: "none", x: 1 },
      }),
    )
  );
  parseVerdict(
    verdictJson("A", {
      conventions: {
        verdict: "B",
        reason: "r",
        cite: "B:School/src/Fee.al:-12",
      },
    }),
  );
  parseVerdict(
    verdictJson("A", {
      conventions: { verdict: "B", reason: "r", cite: "B:School/src/Fee.al" },
    }),
  );
  assertEquals(parseGuess('{"guess":"B"}'), "B");
  assertThrows(() => parseGuess('{"guess":"C"}'));
  assertThrows(() => parseGuess('```{"guess":"A"}```'));
});

Deno.test("cohenKappa: textbook 2x2 table (po 0.7, pe 0.5, kappa 0.4)", () => {
  // yes/yes 20, yes/no 5, no/yes 10, no/no 15 => po .7, pe .5, kappa .4
  const pairs: [string, string][] = [
    ...Array(20).fill(["variant", "variant"]),
    ...Array(5).fill(["variant", "baseline"]),
    ...Array(10).fill(["baseline", "variant"]),
    ...Array(15).fill(["baseline", "baseline"]),
  ];
  assert(Math.abs(cohenKappa(pairs)! - 0.4) < 1e-9);
  // 3 categories: po = 6/10, pe = (4*3+3*4+3*3)/100 = .33, kappa = .27/.67
  const t: [string, string][] = [
    ...Array(3).fill(["variant", "variant"]),
    ...Array(2).fill(["baseline", "baseline"]),
    ...Array(1).fill(["tie", "tie"]),
    ["variant", "tie"],
    ["baseline", "variant"],
    ["tie", "baseline"],
    ["tie", "variant"],
  ];
  // rows: variant 4, baseline 3, tie 3 ; cols: variant 5, baseline 3, tie 2
  const pe = (4 * 5 + 3 * 3 + 3 * 2) / 100;
  assert(Math.abs(cohenKappa(t)! - (0.6 - pe) / (1 - pe)) < 1e-9);
  assertEquals(cohenKappa([]), null);
});

const ok = (v: "A" | "B" | "tie"): JudgeResult => ({
  status: "ok",
  verdicts: parseVerdict(verdictJson(v)),
  attempts: 1,
});
const failed: JudgeResult = { status: "failed", error: "garbage", attempts: 3 };

Deno.test("aggregate: flip -> tie, agreement kept, failed -> missing, majority across judges", () => {
  // a_role baseline: A is baseline. orig A => baseline; swapped (sides exchanged) B => baseline.
  const meta = [{
    id: "p1",
    task: "T",
    repeat: 1,
    key: { A: "base", B: "var", a_role: "baseline" as const },
  }, {
    id: "p2",
    task: "T",
    repeat: 2,
    key: { A: "var", B: "base", a_role: "variant" as const },
  }];
  const cells = {
    j1: {
      p1: {
        orig: ok("A"),
        swapped: ok("B"),
        guess: { status: "ok" as const, guess: "B" as const, attempts: 1 },
      },
      p2: { orig: ok("A"), swapped: ok("A") },
    },
    j2: {
      p1: { orig: ok("A"), swapped: failed },
      p2: { orig: ok("B"), swapped: ok("A") },
    },
    j3: {
      p1: { orig: ok("A"), swapped: ok("B") },
      p2: { orig: ok("A"), swapped: ok("B") },
    },
  };
  const { pairs, summary } = aggregate(meta, cells, ["j1", "j2", "j3"], []);
  const p1 = pairs[0]!.dimensions.readability!;
  assertEquals(p1.judges["j1"]!, {
    orig: "baseline",
    swapped: "baseline",
    combined: "baseline",
  });
  assertEquals(p1.judges["j2"]!.combined, "missing");
  assertEquals(p1.judges["j3"]!, {
    orig: "baseline",
    swapped: "baseline",
    combined: "baseline",
  });
  assertEquals(p1.across, "baseline");
  const p2 = pairs[1]!.dimensions.readability!;
  // j1: orig A (A=var) variant, swapped A -> flipped sides -> B side = var? swapped A is orig's B = baseline
  assertEquals(p2.judges["j1"]!, {
    orig: "variant",
    swapped: "baseline",
    combined: "tie",
  });
  assertEquals(p2.judges["j2"]!, {
    orig: "baseline",
    swapped: "baseline",
    combined: "baseline",
  });
  assertEquals(p2.judges["j3"]!, {
    orig: "variant",
    swapped: "variant",
    combined: "variant",
  });
  assertEquals(p2.across, "tie"); // tie, baseline, variant: no majority
  const s = summary.dimensions.readability!;
  assertEquals(s.counts, { variant: 0, baseline: 1, tie: 1, missing: 0 });
  assertEquals(s.swap_consistency["j1"], 0.5);
  assertEquals(s.swap_consistency["j2"], 1); // one cell valid (p2), consistent
  assertEquals(summary.guess_accuracy["j1"], { correct: 1, answered: 1 });
  // truth: variant side in p1 is B; j1 guessed B
});

Deno.test("aggregate: guess truth is the variant side", () => {
  const meta = [{
    id: "p",
    task: "T",
    repeat: 1,
    key: { A: "v", B: "b", a_role: "variant" as const },
  }];
  const g = (guess: "A" | "B") => ({
    status: "ok" as const,
    guess,
    attempts: 1,
  });
  const { summary } = aggregate(
    meta,
    { j: { p: { orig: ok("A"), swapped: ok("B"), guess: g("A") } } },
    ["j"],
    [],
  );
  assertEquals(summary.guess_accuracy["j"], { correct: 1, answered: 1 });
});

// ---- runner ----

function packetStub(id: string) {
  return {
    id,
    sha: id.padEnd(64, "0"),
    text: `packet ${id}`,
    swappedText: `swapped ${id}`,
    task: "T",
    repeat: 1,
    key: { A: "b", B: "v", a_role: "baseline" as const },
    redactions: { baseline: 0, variant: 0 },
  };
}
const JUDGES = [{
  id: "j",
  provider: "p",
  model: "m/x:1",
  thinking: "high",
  usd_per_mtok_in: 2,
  usd_per_mtok_out: 10,
}];

Deno.test("judgePackets: cache hit spends zero calls on rerun; guess calls included", async () => {
  const out = await testTempDir();
  let calls = 0;
  const client: JudgeClient = (req) => {
    calls++;
    return Promise.resolve(
      req.prompt.endsWith(GUESS_SUFFIX) ? '{"guess":"B"}' : verdictJson("A"),
    );
  };
  const args = {
    packets: [packetStub("aa")],
    judges: JUDGES,
    out,
    template: TEMPLATE,
    rubric: "R",
    client,
  };
  const r1 = await judgePackets(args);
  assertEquals(calls, 3); // orig, swapped, guess
  assertEquals(r1.cells["j"]!["aa"]!.orig!.status, "ok");
  calls = 0;
  const r2 = await judgePackets(args);
  assertEquals(calls, 0);
  assertEquals(r2.cells["j"]!["aa"]!.swapped!.status, "ok");
});

Deno.test("judgePackets: schema mismatch or unreadable cache throws", async () => {
  const out = await testTempDir();
  const client: JudgeClient = (req) =>
    Promise.resolve(
      req.prompt.endsWith(GUESS_SUFFIX) ? '{"guess":"A"}' : verdictJson("A"),
    );
  const args = {
    packets: [packetStub("bb")],
    judges: JUDGES,
    out,
    template: TEMPLATE,
    rubric: "R",
    client,
  };
  await judgePackets(args);
  const dir = join(out, "cache");
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) files.push(e.name);
  assertEquals(files.length, 3);
  assert(files.every((n) => !n.includes("/") && !n.includes(":")));
  await Deno.writeTextFile(join(dir, files[0]!), JSON.stringify({ schema: 2 }));
  await assertRejects(() => judgePackets(args));
  await Deno.writeTextFile(join(dir, files[0]!), "{not json");
  await assertRejects(() => judgePackets(args));
});

Deno.test("judgePackets: garbage 3x records a failure (not cached); success on retry 2", async () => {
  const out = await testTempDir();
  let n = 0;
  const bad: JudgeClient = () => (n++, Promise.resolve("nope"));
  const r = await judgePackets({
    packets: [packetStub("cc")],
    judges: JUDGES,
    out,
    template: TEMPLATE,
    rubric: "R",
    client: bad,
  });
  assertEquals(n, 9); // 3 attempts x (orig, swapped, guess)
  const o = r.cells["j"]!["cc"]!.orig!;
  assertEquals(o.status, "failed");
  assertEquals(o.status === "failed" && o.attempts, 3);
  const cacheDir = join(out, "cache");
  const cached = await Deno.stat(cacheDir).then(() => true, () => false);
  if (cached) {
    for await (const _ of Deno.readDir(cacheDir)) {
      throw new Error("failure cached");
    }
  }

  const out2 = await testTempDir();
  let k = 0;
  const flaky: JudgeClient = (req) => {
    if (req.prompt.endsWith(GUESS_SUFFIX)) {
      return Promise.resolve('{"guess":"A"}');
    }
    k++;
    return Promise.resolve(k < 3 ? "garbage" : verdictJson("B"));
  };
  const r2 = await judgePackets({
    packets: [packetStub("dd")],
    judges: JUDGES,
    out: out2,
    template: TEMPLATE,
    rubric: "R",
    client: flaky,
  });
  const o2 = r2.cells["j"]!["dd"]!.orig!;
  assertEquals(o2.status, "ok");
  assertEquals(o2.status === "ok" && o2.attempts, 3);
});

Deno.test("judgePackets: dry run makes no client call and reports calls and cost", async () => {
  const out = await testTempDir();
  const client: JudgeClient = () => {
    throw new Error("called");
  };
  const r = await judgePackets({
    packets: [packetStub("ee"), packetStub("ff")],
    judges: JUDGES,
    out,
    template: TEMPLATE,
    rubric: "R",
    client,
    dryRun: true,
  });
  assertEquals(r.estimate.packets, 2);
  assertEquals(r.estimate.calls, 2 * 2 * 1 + 2 * 1);
  assert(r.estimate.usd > 0);
  assertEquals(Object.keys(r.cells).length, 0);
});

Deno.test("redaction: arm names everywhere; tooling words only inside AL comments; short manifest names dropped", async () => {
  const root = await testTempDir();
  const start = join(root, "s");
  await write(start, "School/src/X.Codeunit.al", "codeunit 50100 X\n{\n}\n");
  const base = join(root, "b");
  await write(base, "School/src/X.Codeunit.al", "codeunit 50100 X\n{\n}\n");
  const vari = join(root, "v");
  await write(
    vari,
    "School/src/X.Codeunit.al",
    [
      "codeunit 50100 X",
      "{",
      "    var Skill: Record Skill;",
      "    Cursor: Integer;",
      "    Pi: Integer;",
      "    // AL rule: uses the testing skill",
      "    /* multi",
      "       line skill */",
      "    x := 'a // skill b';",
      "    plainarm := 1;",
      "}",
      "",
    ].join("\n"),
  );
  await write(vari, "School/src/plainarm.Table.al", "table 50101 T\n{\n}\n");
  const mt = manifestTerms(["plainarm"], [{
    config_id: "cfg-x",
    lsp: [{ name: "al" }],
  }]);
  assert(!mt.terms.includes("al"));
  assert(mt.arms.includes("cfg-x"));
  const p = await buildPacket({
    seed: "s",
    task: "T",
    repeat: 1,
    baseline: "plainarm",
    variant: "v",
    taskPrompt: "p",
    startDir: start,
    baseFinal: base,
    varFinal: vari,
    template: TEMPLATE,
    rubric: "R",
    terms: mt.terms,
    arms: mt.arms,
  });
  const t = p.text;
  assert(t.includes("School/src/X.Codeunit.al"), t);
  assert(
    t.includes("+var Skill: Record Skill;") ||
      t.includes("+    var Skill: Record Skill;"),
    t,
  );
  assert(t.includes("Cursor: Integer;"));
  assert(t.includes("Pi: Integer;"));
  assert(t.includes("// AL rule: uses the testing [redacted]"), t);
  assert(t.includes("line [redacted] */"), t);
  assert(t.includes("'a // skill b'"), "a // inside a string is code");
  assert(t.includes("[redacted] := 1;"), t);
  assert(t.includes("School/src/[redacted].Table.al"), t);
  assert(!/plainarm/i.test(t));
  assertEquals(p.redactions.baseline, 0);
  assert(p.redactions.variant >= 4);
  assert(!t.includes("redactions"));
});

Deno.test("packet ids: identical diffs of two pairs stay distinct in files and key", async () => {
  const f = await fixture();
  const mk = (repeat: number) =>
    buildPacket({
      seed: "s",
      task: "HX-001",
      repeat,
      baseline: "a",
      variant: "b",
      taskPrompt: "p",
      startDir: f.start,
      baseFinal: f.base,
      varFinal: f.base,
      template: TEMPLATE,
      rubric: "R",
      terms: [],
      arms: [],
    });
  const [p1, p2] = [await mk(1), await mk(2)];
  assertEquals(p1.sha === p2.sha || p1.text !== p2.text, true);
  assert(p1.id !== p2.id);
  const out = await testTempDir();
  await writePackets(out, [p1, p2]);
  const key = JSON.parse(await Deno.readTextFile(join(out, "key", "key.json")));
  assertEquals(Object.keys(key).length, 2);
  const names: string[] = [];
  for await (const e of Deno.readDir(join(out, "packets"))) names.push(e.name);
  assertEquals(names.length, 2);
});

Deno.test("aggregate: redaction counts per role and the one-sided share", () => {
  const m = (id: string, b: number, v: number) => ({
    id,
    task: "T",
    repeat: 1,
    key: { A: "b", B: "v", a_role: "baseline" as const },
    redactions: { baseline: b, variant: v },
  });
  const { pairs, summary } = aggregate(
    [m("p1", 0, 2), m("p2", 1, 1), m("p3", 0, 0), m("p4", 3, 0)],
    {},
    [],
    [],
  );
  assertEquals(pairs[0]!.redactions, { baseline: 0, variant: 2 });
  assertEquals(summary.redaction_one_sided_share, 0.5);
});

Deno.test("judgePackets: judges sharing a model but not thinking get separate cache files and calls", async () => {
  const out = await testTempDir();
  let calls = 0;
  const client: JudgeClient = (req) => {
    calls++;
    return Promise.resolve(
      req.prompt.endsWith(GUESS_SUFFIX) ? '{"guess":"A"}' : verdictJson("A"),
    );
  };
  const judges = [
    { ...JUDGES[0]!, id: "j1", thinking: "high" },
    { ...JUDGES[0]!, id: "j2", thinking: "low" },
  ];
  await judgePackets({
    packets: [packetStub("gg")],
    judges,
    out,
    template: TEMPLATE,
    rubric: "R",
    client,
  });
  assertEquals(calls, 6);
  let files = 0;
  for await (const _ of Deno.readDir(join(out, "cache"))) files++;
  assertEquals(files, 6);
});

Deno.test("judgePackets: a cached payload that fails the schema throws", async () => {
  const out = await testTempDir();
  const client: JudgeClient = (req) =>
    Promise.resolve(
      req.prompt.endsWith(GUESS_SUFFIX) ? '{"guess":"A"}' : verdictJson("A"),
    );
  const args = {
    packets: [packetStub("hh")],
    judges: JUDGES,
    out,
    template: TEMPLATE,
    rubric: "R",
    client,
  };
  await judgePackets(args);
  const dir = join(out, "cache");
  const orig = [...Deno.readDirSync(dir)].find((e) =>
    e.name.endsWith("-orig.json")
  )!;
  const v = JSON.parse(verdictJson("A"));
  delete v.readability;
  await Deno.writeTextFile(
    join(dir, orig.name),
    JSON.stringify({ schema: 1, status: "ok", verdicts: v, attempts: 1 }),
  );
  await assertRejects(() => judgePackets(args));
});

Deno.test("resolveCommand: Windows extensionless names resolve through PATH to .exe, then .cmd", async () => {
  const dir = await testTempDir();
  await Deno.writeTextFile(join(dir, "pi.cmd"), "");
  assertEquals(resolveCommand("pi", "windows", dir), join(dir, "pi.cmd"));
  await Deno.writeTextFile(join(dir, "pi.exe"), "");
  assertEquals(resolveCommand("pi", "windows", dir), join(dir, "pi.exe"));
  assertEquals(resolveCommand("pi", "linux", dir), "pi");
  assertEquals(resolveCommand("pi.cmd", "windows", dir), "pi.cmd");
  assertEquals(resolveCommand("nope", "windows", dir), "nope");
});

async function campaignFixture(execs: Record<string, unknown>[]) {
  const root = await testTempDir();
  await write(
    root,
    "campaigns/c1.json",
    JSON.stringify({
      experiment: { baseline: "plain", variants: ["real"] },
      task_set: { tasks: [{ id: "HX-001", refapp_commit: "abc" }] },
    }),
  );
  let n = 0;
  for (const e of execs) {
    await write(
      root,
      `executions/c1/e${n++}.json`,
      JSON.stringify({ attempt: 1, repeat: 1, task_id: "HX-001", ...e }),
    );
  }
  return root;
}

Deno.test("loadPairs: --pair needs exactly one colon; an orphan variant execution is reported as skipped", async () => {
  const results = await campaignFixture([
    { arm: "plain", workspace_hash: "h1", manifest: {} },
    { arm: "real", workspace_hash: "h2", manifest: {} },
    { arm: "real", repeat: 2, workspace_hash: "h3", manifest: {} },
  ]);
  for (const bad of ["plain", "plain:real:x", ":real", "plain:"]) {
    await assertRejects(() =>
      loadPairs({ results, campaign: "c1", pair: [bad], task: [] })
    );
  }
  const r = await loadPairs({ results, campaign: "c1", pair: [], task: [] });
  assertEquals(r.pairs.length, 1);
  assertEquals(r.skipped, [{
    task: "HX-001",
    repeat: 2,
    arm: "real",
    reason: "no baseline partner",
  }]);
});
