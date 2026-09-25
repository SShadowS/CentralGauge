import { assert, assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import {
  resolveManifest,
  type RuntimeFacts,
} from "../../../src/harness/manifest.ts";

const ROOT = "harness";
const SKILLS = "bundles/al-skills/skills";
const FACTS: RuntimeFacts = {
  native_settings: {},
  image: { digest: "sha256:img", base_digest: "sha256:base" },
  backend_version: "cg-al-backend@1",
  servers: {},
  provider_routes: { main: "anthropic" },
};

async function skillFiles(): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for await (const e of Deno.readDir(join(ROOT, SKILLS))) {
    if (!e.isDirectory) continue;
    out.push({
      name: e.name,
      text: await Deno.readTextFile(join(ROOT, SKILLS, e.name, "SKILL.md")),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Front matter parsed as YAML, as the harness loads it (a bare `: ` in a value fails). */
function frontMatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const fm = m ? parse(m[1]!) : null;
  return fm !== null && typeof fm === "object"
    ? fm as Record<string, unknown>
    : {};
}

Deno.test("skills bundle: 3 to 5 skills, front matter name equals folder, non-empty description", async () => {
  const skills = await skillFiles();
  assert(skills.length >= 3 && skills.length <= 5, `${skills.length} skills`);
  for (const s of skills) {
    const fm = frontMatter(s.text);
    assertEquals(fm["name"], s.name, `${s.name}: front matter name`);
    assert(
      typeof fm["description"] === "string" && fm["description"].trim() !== "",
      `${s.name}: description`,
    );
  }
  assert(
    skills.some((s) => s.name === "al-build-loop"),
    "al-build-loop (named by the arm-skill stub scenario)",
  );
});

Deno.test("skills bundle: no task identifiers, hidden-test words, hidden-test ids or em dashes", async () => {
  for (const s of await skillFiles()) {
    for (const bad of ["HX-0", "oracle", "mutant", "reference", "—"]) {
      assert(
        !s.text.toLowerCase().includes(bad.toLowerCase()),
        `${s.name} contains ${JSON.stringify(bad)}`,
      );
    }
    // Task names, the refapp prefix and id range, hidden-test ids, refapp domain nouns.
    for (
      const re of [
        /HX-?\d/i,
        /\bCGR\b/,
        /\b70\d{3}\b/,
        /\b8[5-9]\d{3}\b/,
        /vehicle|lease|leasing|rental|outbox|damage|fleet/i,
      ]
    ) {
      assert(!re.test(s.text), `${s.name} matches ${re}`);
    }
  }
});

Deno.test("skills bundle: loads through resolveManifest as a skills component, hash stable", async () => {
  const config = HarnessConfigSchema.parse({
    id: "skills-arm",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    components: { skills: SKILLS },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const a = await resolveManifest(ROOT, config, FACTS);
  const b = await resolveManifest(ROOT, config, FACTS);
  assert(a.skills !== null, "skills component resolved");
  assertEquals(a.skills?.hash, b.skills?.hash);
  const names = new Set(a.skills!.files.map((f) => f.path.split("/")[0]));
  assertEquals([...names].sort(), (await skillFiles()).map((s) => s.name));

  // The hash follows content: one changed byte in a copy changes it.
  const tmp = await Deno.makeTempDir();
  try {
    await copy(join(ROOT, "bundles"), join(tmp, "bundles"), {
      overwrite: true,
    });
    const f = join(tmp, SKILLS, "al-build-loop", "SKILL.md");
    await Deno.writeTextFile(f, (await Deno.readTextFile(f)) + "x");
    const c = await resolveManifest(tmp, config, FACTS);
    assert(c.skills?.hash !== a.skills?.hash, "hash changes with content");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("al-build-loop: usage line and exit codes match cg-al.ps1", async () => {
  const ps1 = await Deno.readTextFile(join(ROOT, "images/base/cg-al.ps1"));
  const skill = await Deno.readTextFile(
    join(ROOT, SKILLS, "al-build-loop", "SKILL.md"),
  );
  const usage = ps1.match(/^# Usage: (.+)$/m)?.[1]?.trim();
  assert(usage, "cg-al.ps1 has a Usage line");
  assert(skill.includes(usage), `skill states the usage: ${usage}`);
  const version = ps1.match(/--version'\) \{ Write-Output '([^']+)'; exit 0/)
    ?.[1];
  assert(version, "cg-al.ps1 answers --version locally");
  assert(skill.includes(`\`${version}\``), `skill states ${version}`);
  const codes = (text: string, re: RegExp) =>
    [...new Set([...text.matchAll(re)].map((m) => Number(m[1])))].sort((
      a,
      b,
    ) => a - b);
  assertEquals(
    codes(skill, /^\| (\d+) +\|/gm),
    codes(ps1, /\bexit (\d+)\b/g),
  );
});
