import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { parse } from "@std/yaml";
import { claudeCodeHarnessNative } from "../../../src/harness/adapters/claude-code.ts";
import { loadTask } from "../../../src/harness/task.ts";

/** Spec v2 section 4: the realistic bundle, linted for shape and for leakage. */
const BUNDLE = "harness/bundles/realistic";
const RULES = [
  "al-conventions.md",
  "breaking-changes.md",
  "code-navigation.md",
  "testing.md",
];
const SKILLS = ["al-compile", "al-reuse-lookup", "al-symbols", "al-test"];
const AGENTS = ["al-reviewer", "al-test-writer", "library-function-finder"];

async function files(dir: string): Promise<{ rel: string; text: string }[]> {
  const out: { rel: string; text: string }[] = [];
  for await (const e of walk(dir, { includeDirs: false })) {
    out.push({
      rel: relative(dir, e.path).replaceAll("\\", "/"),
      text: await Deno.readTextFile(e.path),
    });
  }
  return out.sort((a, b) => a.rel < b.rel ? -1 : 1);
}
function frontMatter(text: string): Record<string, unknown> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const fm = parse(m[1]!);
  return fm !== null && typeof fm === "object"
    ? fm as Record<string, unknown>
    : {};
}

Deno.test("realistic bundle: exact layout", async () => {
  assertEquals((await files(`${BUNDLE}/instructions`)).map((f) => f.rel), [
    "CLAUDE.md",
    ...RULES.map((r) => `rules/${r}`),
  ]);
  assertEquals(
    (await files(`${BUNDLE}/skills`)).map((f) => f.rel),
    SKILLS.map((s) => `${s}/SKILL.md`),
  );
  assertEquals(
    (await files(`${BUNDLE}/agents`)).map((f) => f.rel),
    AGENTS.map((a) => `${a}.md`),
  );
});

Deno.test("realistic bundle: skill and agent names equal their folder or file; agents inherit the model; rules carry no frontmatter", async () => {
  for (const s of SKILLS) {
    const fm = frontMatter(
      await Deno.readTextFile(join(BUNDLE, "skills", s, "SKILL.md")),
    )!;
    assertEquals(fm["name"], s);
    assert(
      typeof fm["description"] === "string" && fm["description"].trim() !== "",
      `${s}: description`,
    );
  }
  const disallowed: string[] = claudeCodeHarnessNative().disallowed_tools;
  for (const a of AGENTS) {
    const fm = frontMatter(
      await Deno.readTextFile(join(BUNDLE, "agents", `${a}.md`)),
    )!;
    assertEquals(fm["name"], a);
    assert(
      typeof fm["description"] === "string" && fm["description"].trim() !== "",
      `${a}: description`,
    );
    // Spec v2 gate 3: the subagent model is pinned by run.ps1, never by the bundle.
    assertEquals(fm["model"], "inherit", `${a}: model`);
    const tools = typeof fm["tools"] === "string"
      ? fm["tools"].split(",").map((t) => t.trim())
      : [];
    for (const t of tools) {
      assert(!disallowed.includes(t), `${a} grants disallowed tool ${t}`);
    }
  }
  for (const r of RULES) {
    assertEquals(
      frontMatter(
        await Deno.readTextFile(join(BUNDLE, "instructions", "rules", r)),
      ),
      null,
      `${r}: always loaded, no paths`,
    );
  }
});

/** Pattern, why it may not appear. Spec v2 section 4: no customer data, internal hosts, credentials or source tooling. */
const FORBIDDEN: [RegExp, string][] = [
  [/—/, "em dash"],
  [/HX-?\d/i, "task id"],
  [/\bCGR\b/, "refapp prefix"],
  [/\b(?:70|8\d)\d{3}\b/, "refapp or test object id"],
  [
    /\b(?:vehicles?|leas(?:e|es|ing)|rentals?|outbox|damages?|fleets?)\b/i,
    "refapp domain noun",
  ],
  [
    /\b(?:oracle|mutant|hidden tests?|reference solution|naive variant)\b/i,
    "benchmark internals",
  ],
  [/https?:\/\//i, "URL"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "IP address"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "GUID"],
  [
    /continia|document (?:output|capture)|delivery network|zendesk|azure devops|lethal|DO\.Support/i,
    "source company or its tooling",
  ],
  [
    /cronus\d*|sshadows|password|passwd|api[_ -]?key|bearer|oauth/i,
    "host or credential",
  ],
  [/\b[\w-]+\.(?:local|corp|internal|lan)\b/i, "internal host"],
];

Deno.test("realistic bundle: no task, refapp, benchmark, host, credential or source-company text", async () => {
  for (const f of await files(BUNDLE)) {
    for (const [re, why] of FORBIDDEN) {
      assert(!re.test(f.text), `${f.rel}: ${why} (${re})`);
    }
  }
});

const OBJECT =
  /^\s*(?:codeunit|table|page|report|query|xmlport|enum|interface|permissionset|tableextension|pageextension|enumextension|reportextension)\s+(?:\d+\s+)?(?:"([^"]+)"|(\w+))/gim;
const PROC = /\bprocedure\s+(?:"([^"]+)"|(\w+))\s*\(/gi;
/** BC platform trigger and test-pattern names a team setup may say; none is specific to a task or the refapp. */
const GENERIC = new Set([
  "initialize",
  "onrun",
  "onvalidate",
  "oninsert",
  "onmodify",
  "ondelete",
  "onrename",
]);

/**
 * Every object and procedure name in the refapp and in every task's files,
 * plus every oracle procedure named in a task.yml, read through the task
 * schema (quoted names and block lists included).
 */
async function leakIdentifiers(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const add = (name: string, where: string) => {
    const k = name.trim().toLowerCase();
    if (k.length >= 6 && !GENERIC.has(k) && !out.has(k)) out.set(k, where);
  };
  for await (
    const e of walk("harness-tasks", { includeDirs: false, exts: [".al"] })
  ) {
    const text = await Deno.readTextFile(e.path);
    for (const re of [OBJECT, PROC]) {
      for (const m of text.matchAll(re)) add((m[1] ?? m[2])!, e.path);
    }
  }
  for await (
    const e of walk("harness-tasks", {
      includeDirs: false,
      match: [/task\.yml$/],
    })
  ) {
    const { task } = await loadTask(dirname(e.path));
    for (
      const g of [...task.pass_to_pass, ...(task.fail_to_pass?.tests ?? [])]
    ) {
      for (const p of g.procedures) add(p, e.path);
    }
  }
  return out;
}

Deno.test("realistic bundle: names no object, procedure or oracle check of the refapp or any task", async () => {
  const ids = await leakIdentifiers();
  assert(ids.size > 50, `identifier harvest looks broken: ${ids.size}`);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const f of await files(BUNDLE)) {
    const text = f.text.toLowerCase();
    for (const [k, where] of ids) {
      assert(
        !new RegExp(`(^|[^a-z0-9_])${esc(k)}($|[^a-z0-9_])`).test(text),
        `${f.rel} names "${k}" from ${where}`,
      );
    }
  }
});

Deno.test("realistic bundle: every LSP mention is capability-conditional, and CLAUDE.md states the condition", async () => {
  const all = await files(BUNDLE);
  for (const f of all) {
    for (const line of f.text.split(/\r?\n/)) {
      if (/\bLSP\b|language server/i.test(line)) {
        assert(
          /if an LSP tool is available/i.test(line),
          `${f.rel}: unconditional LSP mention: ${line}`,
        );
      }
    }
  }
  const claude = all.find((f) => f.rel === "instructions/CLAUDE.md");
  assert(claude, "instructions/CLAUDE.md present");
  assert(claude.text.includes("If an LSP tool is available"));
});

Deno.test("realistic bundle: memory imports resolve only to audited rules inside the bundle", async () => {
  const rules = new Set(RULES.map((r) => `rules/${r}`));
  for (const f of await files(`${BUNDLE}/instructions`)) {
    for (const m of f.text.matchAll(/(^|\s)@([^\s`]+)/g)) {
      assert(
        rules.has(m[2]!),
        `${f.rel}: import @${m[2]} is not a bundle rule file`,
      );
    }
  }
});

Deno.test("al-compile skill states cg-al's usage line exactly", async () => {
  const ps1 = await Deno.readTextFile("harness/images/base/cg-al.ps1");
  const usage = ps1.match(/^# Usage: (.+)$/m)?.[1]?.trim();
  assert(usage, "cg-al.ps1 has a Usage line");
  assert(
    (await Deno.readTextFile(join(BUNDLE, "skills", "al-compile", "SKILL.md")))
      .includes(usage),
  );
});
