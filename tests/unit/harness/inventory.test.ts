import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { tempDir } from "./temp-dirs.ts";

/**
 * Spec v2 section 4 / gate 1: the pre-start component inventory, run with
 * Windows PowerShell 5.1 (the image's shell) against a temp sandbox layout.
 */
const SCRIPT = fromFileUrl(
  new URL(
    "../../../harness/images/claude-code/cg-inventory.ps1",
    import.meta.url,
  ),
);
const NOT_WINDOWS = Deno.build.os !== "windows";

/** Path relative to the sandbox root -> file content, or null for an empty folder. */
type Layout = Record<string, string | null>;
interface Inventory {
  type: string;
  v: number;
  ok: boolean;
  installed: string[];
  problems: string[];
}

/** A fully installed realistic arm: every staged file has its installed copy. */
const FULL: Layout = {
  "config/bundle/instructions/CLAUDE.md": "team\n",
  "config/bundle/instructions/rules/al.md": "rule\n",
  "config/bundle/skills/al-compile/SKILL.md": "skill\n",
  "config/bundle/agents/al-reviewer.md": "agent\n",
  "home/.claude/CLAUDE.md": "team\n",
  "home/.claude/rules/al.md": "rule\n",
  "home/.claude/skills/al-compile/SKILL.md": "skill\n",
  "home/.claude/agents/al-reviewer.md": "agent\n",
  "ws/Core/app.json": "{}",
};

/** `prepare` runs after the layout is written, for links and case-sensitive folders. */
async function inventory(
  layout: Layout,
  prepare?: (root: string) => Promise<void>,
): Promise<{ code: number; rec: Inventory; root: string }> {
  const root = await Deno.realPath(await tempDir({ prefix: "cg-inv-" }));
  for (const d of ["config", "home", "ws"]) {
    await Deno.mkdir(join(root, d), { recursive: true });
  }
  for (const [p, text] of Object.entries(layout)) {
    const f = join(root, ...p.split("/"));
    if (text === null) {
      await Deno.mkdir(f, { recursive: true });
      continue;
    }
    await Deno.mkdir(dirname(f), { recursive: true });
    await Deno.writeTextFile(f, text);
  }
  await prepare?.(root);
  const out = await new Deno.Command("powershell", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
      "-ConfigDir",
      join(root, "config"),
      "-HomeDir",
      join(root, "home"),
      "-Workspace",
      join(root, "ws"),
      "-Ancestors",
      root,
      "-ManagedDir",
      join(root, "managed"),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).split(/\r?\n/).filter(
    Boolean,
  );
  assertEquals(
    lines.length,
    1,
    `exactly one JSON line; stdout ${lines.join(" | ")}; stderr ${
      new TextDecoder().decode(out.stderr)
    }`,
  );
  return { code: out.code, rec: JSON.parse(lines[0]!) as Inventory, root };
}

const without = (l: Layout, ...keys: string[]): Layout =>
  Object.fromEntries(Object.entries(l).filter(([k]) => !keys.includes(k)));

const refused = (r: { code: number; rec: Inventory }, want: string) => {
  assertEquals([r.code, r.rec.ok], [5, false], JSON.stringify(r.rec));
  assert(
    r.rec.problems.some((p) => p.includes(want)),
    `a problem containing ${JSON.stringify(want)}: ${
      JSON.stringify(r.rec.problems)
    }`,
  );
};

Deno.test({
  name: "cg-inventory: a fully installed arm is ok and lists every component",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory(FULL);
    assertEquals(r.code, 0);
    assertEquals(r.rec, {
      type: "cg_inventory",
      v: 1,
      ok: true,
      installed: ["agents", "instructions", "skills"],
      problems: [],
    });
  },
});

Deno.test({
  name:
    "cg-inventory: an arm with no bundle and an empty user scope is ok with nothing installed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory({ "ws/Core/app.json": "{}" });
    assertEquals([r.code, r.rec.ok, r.rec.installed, r.rec.problems], [
      0,
      true,
      [],
      [],
    ]);
  },
});

// Positive half per component is the FULL case; negative halves below.
const PER_COMPONENT: [string, string][] = [
  ["instructions", "CLAUDE.md"],
  ["instructions", "rules/al.md"],
  ["skills", "skills/al-compile/SKILL.md"],
  ["agents", "agents/al-reviewer.md"],
];
const stagedKey = (comp: string, dest: string) =>
  `config/bundle/${comp}/${
    comp === "instructions" ? dest : dest.slice(comp.length + 1)
  }`;

Deno.test({
  name:
    "cg-inventory: a staged-but-absent component is refused and not listed as installed",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      const r = await inventory(without(FULL, `home/.claude/${dest}`));
      refused(r, `${comp}: ${dest} is staged but not installed`);
      assert(!r.rec.installed.includes(comp), `${comp} not installed`);
    }
  },
});

Deno.test({
  name:
    "cg-inventory: an installed-but-undeclared file is refused, per component and for hooks settings",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      refused(
        await inventory(without(FULL, stagedKey(comp, dest))),
        `undeclared file in the user scope: .claude/${dest}`,
      );
    }
    refused(
      await inventory({
        ...FULL,
        "home/.claude/settings.json": '{"hooks":{}}',
      }),
      "undeclared file in the user scope: .claude/settings.json",
    );
  },
});

Deno.test({
  name:
    "cg-inventory: an installed copy that differs from the staged one is refused",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      refused(
        await inventory({ ...FULL, [`home/.claude/${dest}`]: "tampered\n" }),
        `${comp}: ${dest} differs from the staged copy`,
      );
    }
  },
});

Deno.test({
  name:
    "cg-inventory: hooks and plugins have no installer, an unknown instructions file is not installable, an empty component is refused",
  ignore: NOT_WINDOWS,
  async fn() {
    refused(
      await inventory({ ...FULL, "config/bundle/hooks/settings.json": "{}" }),
      "hooks is staged but this image cannot install it",
    );
    refused(
      await inventory({ ...FULL, "config/bundle/plugins/0/plugin.json": "{}" }),
      "plugins is staged but this image cannot install it",
    );
    refused(
      await inventory({ ...FULL, "config/bundle/instructions/notes.txt": "x" }),
      "instructions: notes.txt is staged but not installable",
    );
    const empty = await inventory({
      ...without(
        FULL,
        "config/bundle/agents/al-reviewer.md",
        "home/.claude/agents/al-reviewer.md",
      ),
      "config/bundle/agents": null,
    });
    refused(empty, "agents is staged but empty");
    assert(!empty.rec.installed.includes("agents"));
  },
});

Deno.test({
  name:
    "cg-inventory: project, nested, ancestor, user-config and managed scopes must be empty",
  ignore: NOT_WINDOWS,
  async fn() {
    for (
      const p of [
        "ws/CLAUDE.md",
        "ws/CLAUDE.local.md",
        "ws/AGENTS.md",
        "ws/.mcp.json",
        "ws/.claude/rules/x.md",
        "ws/Core/src/CLAUDE.md",
        "CLAUDE.md",
        ".claude/agents/x.md",
      ]
    ) {
      const r = await inventory({ ...FULL, [p]: "x" });
      refused(r, "undeclared project-scope entry");
      assertStringIncludes(
        r.rec.problems.join("\n"),
        p.split("/").at(-1)! === "x.md" ? ".claude" : p.split("/").at(-1)!,
      );
    }
    refused(
      await inventory({ ...FULL, "home/.claude.json": "{}" }),
      "undeclared user config present",
    );
    refused(
      await inventory({ ...FULL, "managed/managed-settings.json": "{}" }),
      "managed Claude Code settings present",
    );
  },
});

Deno.test({
  name: "cg-inventory: an AGENTS.md parity copy is staged but never installed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory({
      ...FULL,
      "config/bundle/instructions/AGENTS.md": "team\n",
    });
    assertEquals([r.code, r.rec.ok], [0, true]);
  },
});

// M9-02 review run 002: reparse points and case collisions under a scanned root.

/** A directory junction (no admin or developer mode needed). */
async function junction(link: string, target: string): Promise<void> {
  const out = await new Deno.Command("cmd", {
    args: ["/c", "mklink", "/J", link, target],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(
    out.success,
    `mklink /J ${link}: ${new TextDecoder().decode(out.stderr)}`,
  );
}

/** Whether this host lets the test process create a file symlink, and a case-sensitive folder. */
async function hostCan(): Promise<
  { symlink: boolean; caseSensitive: boolean }
> {
  if (NOT_WINDOWS) return { symlink: false, caseSensitive: false };
  const d = await tempDir({ prefix: "cg-inv-probe-" });
  await Deno.writeTextFile(join(d, "t"), "t");
  let symlink = true;
  try {
    await Deno.symlink(join(d, "t"), join(d, "l"), { type: "file" });
  } catch {
    symlink = false;
  }
  await Deno.mkdir(join(d, "cs"));
  const fs = await new Deno.Command("fsutil", {
    args: ["file", "setCaseSensitiveInfo", join(d, "cs"), "enable"],
    stdout: "null",
    stderr: "null",
  }).output();
  return { symlink, caseSensitive: fs.success };
}
const CAN = await hostCan();

/** No problem may name a path below the link: the scan never followed it. */
const notFollowed = (r: { rec: Inventory }, link: string) => {
  for (const p of r.rec.problems) {
    assert(
      !p.includes(`${link}/`) && !p.includes(`${link}\\`),
      `followed the link: ${p}`,
    );
  }
};

Deno.test({
  name:
    "cg-inventory: a junction under .claude/rules is refused and never followed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory(
      { ...FULL, "elsewhere/al.md": "rule\n" },
      (root) =>
        junction(
          join(root, "home", ".claude", "rules", "linked"),
          join(root, "elsewhere"),
        ),
    );
    refused(r, "reparse point under a scanned root: ");
    assertStringIncludes(
      r.rec.problems.join("\n"),
      join(".claude", "rules", "linked"),
    );
    notFollowed(r, "linked");
  },
});

Deno.test({
  name:
    "cg-inventory (M9-02 run 003): a junctioned bundle folder is refused even when it points at a matching staged tree",
  ignore: NOT_WINDOWS,
  async fn() {
    // The staged files live outside config/; config/bundle is a junction to them, so a
    // scan that followed it would see a complete, matching install and report ok.
    const staged = Object.fromEntries(
      Object.entries(FULL).map((
        [k, v],
      ) => [k.replace(/^config\/bundle\//, "staged/"), v]),
    );
    const r = await inventory(
      staged,
      (root) => junction(join(root, "config", "bundle"), join(root, "staged")),
    );
    refused(r, "reparse point under a scanned root: ");
    assertStringIncludes(
      r.rec.problems.join("\n"),
      join("config", "bundle"),
    );
    assertEquals(r.rec.installed, [], "nothing installed through the link");
  },
});

Deno.test({
  name:
    "cg-inventory: a junction in the workspace is refused and never followed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory(
      { ...FULL, "elsewhere/CLAUDE.md": "x" },
      (root) =>
        junction(join(root, "ws", "Core", "linked"), join(root, "elsewhere")),
    );
    refused(r, "reparse point under a scanned root: ");
    assertStringIncludes(
      r.rec.problems.join("\n"),
      join("ws", "Core", "linked"),
    );
    notFollowed(r, "linked");
  },
});

Deno.test({
  name: "cg-inventory: a file symlink in the workspace is refused",
  // Creating a symlink needs admin or Windows developer mode; the junction cases above
  // cover the same refusal on hosts without it.
  ignore: NOT_WINDOWS || !CAN.symlink,
  async fn() {
    const r = await inventory(
      { ...FULL, "elsewhere/x.al": "x" },
      (root) =>
        Deno.symlink(
          join(root, "elsewhere", "x.al"),
          join(root, "ws", "Core", "link.al"),
          {
            type: "file",
          },
        ),
    );
    refused(r, "reparse point under a scanned root: ");
    assertStringIncludes(
      r.rec.problems.join("\n"),
      join("ws", "Core", "link.al"),
    );
  },
});

Deno.test({
  name:
    "cg-inventory: two names that differ only in case are refused even when both copies match",
  // Needs per-directory case sensitivity (fsutil setCaseSensitiveInfo); refused by some hosts.
  ignore: NOT_WINDOWS || !CAN.caseSensitive,
  async fn() {
    const r = await inventory(FULL, async (root) => {
      for (
        const side of ["config/bundle/instructions/rules", "home/.claude/rules"]
      ) {
        const d = join(root, ...side.split("/"));
        const tmp = `${d}-cs`;
        await Deno.mkdir(tmp);
        const fs = await new Deno.Command("fsutil", {
          args: ["file", "setCaseSensitiveInfo", tmp, "enable"],
          stdout: "null",
          stderr: "null",
        }).output();
        assert(fs.success, `fsutil setCaseSensitiveInfo ${tmp}`);
        await Deno.writeTextFile(join(tmp, "al.md"), "rule\n");
        await Deno.writeTextFile(join(tmp, "AL.md"), "rule\n");
        await Deno.remove(d, { recursive: true });
        await Deno.rename(tmp, d);
      }
    });
    refused(r, "names differ only in case under a scanned root: ");
  },
});
