import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadTaskSet } from "../../../src/harness/task.ts";

/** The `harness-tasks/refapp` tree id at `rev` in the repo at `cwd`. */
async function refappTree(rev: string, cwd = "."): Promise<string> {
  const r = await new Deno.Command("git", {
    args: ["rev-parse", `${rev}:harness-tasks/refapp`],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) {
    throw new Error(
      `git rev-parse ${rev}:harness-tasks/refapp: ${
        new TextDecoder().decode(r.stderr)
      }`,
    );
  }
  return new TextDecoder().decode(r.stdout).trim();
}

/**
 * Ids whose pin is not frozen. Frozen means `refapp-v2`, or exactly
 * `refapp-v2-rc1` when its refapp tree equals refapp-v2's (ruling
 * decisions\2026-11-14-parallel-work-r2.md, M8-20 deviation). No other tag.
 */
async function unfrozenPins(
  ids: string[],
  pinOf: (id: string) => string | undefined,
  cwd = ".",
): Promise<string[]> {
  const rc1Same = (await refappTree("refapp-v2-rc1", cwd)) ===
    (await refappTree("refapp-v2", cwd));
  return ids.filter((id) => {
    const pin = pinOf(id);
    return !(pin === "refapp-v2" || (pin === "refapp-v2-rc1" && rc1Same));
  });
}

interface Sel {
  status: string;
  selection: { selected: string[]; shortfalls: string[]; deviations: string[] };
}

/**
 * The selection passes if select reported ok, or if it is exactly the
 * owner-approved too_few set: N=39, intermediate 23 of 24 with HX-159 borrowed
 * (decisions\2026-11-14-n39-selection.md, M8-20 ruling; M8-20 deviation).
 * Any other shortfall or deviation fails.
 */
function selectionApproved(sel: Sel): boolean {
  if (sel.status === "ok") return true;
  const s = sel.selection;
  return sel.status === "too_few" &&
    JSON.stringify(s.shortfalls) ===
      JSON.stringify(["stratum intermediate: 23 of 24"]) &&
    JSON.stringify(s.deviations) ===
      JSON.stringify(["HX-159 (hard) fills the intermediate stratum"]) &&
    s.selected.length === 39;
}

Deno.test("v2 task set: frozen selection and held-out tasks pin refapp-v2", async () => {
  const sel = JSON.parse(
    await Deno.readTextFile("harness-tasks/v2/selection.json"),
  );
  assertEquals(selectionApproved(sel), true);
  const ids: string[] = [...sel.selection.selected, ...sel.held_out].sort();
  // M8-20 ruling (decisions\2026-11-14-n39-selection.md): 39 selected + 4 held out.
  assertEquals(ids.length, sel.selection.selected.length + sel.held_out.length);
  assertEquals(ids.length, 43);
  const set = new Map(
    (await loadTaskSet("harness-tasks/tasks")).map((t) => [t.task.id, t.task]),
  );
  // Added check (ruling): refapp-v2-rc1 holds the same refapp tree as refapp-v2.
  assertEquals(
    await refappTree("refapp-v2-rc1"),
    await refappTree("refapp-v2"),
  );
  assertEquals(
    await unfrozenPins(ids, (id) => set.get(id)?.refapp_version),
    [],
  );
});

Deno.test("v2 task set: only ok or the exact owner-approved too_few selection passes", () => {
  const approved = {
    status: "too_few",
    selection: {
      selected: Array.from({ length: 39 }, (_, i) => `HX-${i}`),
      shortfalls: ["stratum intermediate: 23 of 24"],
      deviations: ["HX-159 (hard) fills the intermediate stratum"],
    },
  };
  const s = approved.selection;
  assertEquals(selectionApproved({ status: "ok", selection: s }), true);
  assertEquals(selectionApproved(approved), true);
  for (
    const selection of [
      { ...s, shortfalls: ["stratum intermediate: 22 of 23"] },
      { ...s, shortfalls: [...s.shortfalls, "kind refactor: 1 of 2"] },
      { ...s, shortfalls: [] },
      { ...s, deviations: [] },
      { ...s, deviations: ["HX-160 (hard) fills the intermediate stratum"] },
      { ...s, selected: s.selected.slice(1) },
    ]
  ) {
    assertEquals(selectionApproved({ status: "too_few", selection }), false);
  }
  assertEquals(selectionApproved({ ...approved, status: "other" }), false);
});

Deno.test("v2 task set: a pin is frozen only at refapp-v2 or a same-tree refapp-v2-rc1", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-taskset-v2-" });
  const git = async (...args: string[]) => {
    const r = await new Deno.Command("git", {
      args: [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      cwd: dir,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
  };
  const write = async (text: string) => {
    await Deno.mkdir(join(dir, "harness-tasks", "refapp"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "harness-tasks", "refapp", "a.al"),
      text,
    );
    await git("add", "-A");
    await git("commit", "-q", "-m", text);
  };
  try {
    await git("init", "-q");
    await write("one");
    await git("tag", "-a", "refapp-v2-rc1", "-m", "rc1");
    await git("tag", "-a", "refapp-v2-rc2", "-m", "rc2");
    await git("tag", "-a", "refapp-v2", "-m", "v2");
    const pins: Record<string, string> = {
      "HX-001": "refapp-v2",
      "HX-002": "refapp-v2-rc1",
      "HX-003": "refapp-v2-rc2",
    };
    const pinOf = (id: string) => pins[id];
    const ids = [...Object.keys(pins), "HX-004"];
    // Same tree: rc1 passes; rc2 (same tree, other name) and no pin fail.
    assertEquals(await unfrozenPins(ids, pinOf, dir), ["HX-003", "HX-004"]);
    // refapp-v2 moves to a different tree: rc1 now fails too.
    await write("two");
    await git("tag", "-f", "-a", "refapp-v2", "-m", "v2 moved");
    assertEquals(await unfrozenPins(ids, pinOf, dir), [
      "HX-002",
      "HX-003",
      "HX-004",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
