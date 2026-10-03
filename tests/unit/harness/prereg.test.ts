import { assert, assertEquals, assertRejects } from "@std/assert";
import { copy } from "@std/fs/copy";
import { join } from "@std/path";
import { stringify } from "@std/yaml";
import { ExperimentSchema } from "../../../src/harness/config.ts";
import { sha256Hex } from "../../../src/harness/hash.ts";
import {
  familyProblems,
  loadStageAAnchor,
  loadStageBAnchor,
  parseStageADecision,
  parseStageBDecision,
  preregProblems,
  PreregSchema,
  protocolSha,
  stageAOf,
} from "../../../src/harness/prereg.ts";

const H = (c: string) => c.repeat(64);
const PROTOCOL = {
  arms: [
    "cc-v2-plain",
    "cc-v2-plain-lsp",
    "cc-v2-realistic",
    "cc-v2-realistic-lsp",
  ],
  contrasts: [
    {
      id: "C1",
      name: "LSP effect without the realistic setup",
      baseline: "cc-v2-plain",
      variant: "cc-v2-plain-lsp",
    },
    {
      id: "C2",
      name: "LSP effect with the realistic setup",
      baseline: "cc-v2-realistic",
      variant: "cc-v2-realistic-lsp",
    },
    {
      id: "C3",
      name: "realistic effect without LSP",
      baseline: "cc-v2-plain",
      variant: "cc-v2-realistic",
    },
  ],
  interaction: {
    name: "i",
    status: "exploratory",
    plain: "cc-v2-plain",
    lsp: "cc-v2-plain-lsp",
    realistic: "cc-v2-realistic",
    realistic_lsp: "cc-v2-realistic-lsp",
  },
};
export const STAGE_A = {
  v: 1,
  experiment: "cc-v2-factorial",
  protocol: PROTOCOL,
  approval: "OWNER-APPROVED: stage A (2026-10-21T12:00:00Z)",
  population:
    "Frozen v2 task set: BC/AL tasks of the stated kinds and coupling styles on refapp-v2, selected by the screening pilot.",
  primary_metric: "cost_per_solved_task",
  confirmatory: true,
  family: ["C1", "C2", "C3"],
  alpha: 0.05,
  test: {
    sides: "two",
    p_value: "percentile_bootstrap_plus_one",
    adjustment: "holm",
    direction: "sign_of_delta",
  },
  intervals: {
    reported: "per_contrast_unadjusted",
    beside: "bonferroni_same_draws",
  },
  bootstrap: { unit: "task", resamples: 10000, seed: 20261021, level: 0.95 },
  zero_solve: { rule: "suppress_any_undefined" },
  missing_pairs: "per_contrast_matched",
  held_out: {
    count: 4,
    rule:
      "M8 pickHeldOut at harness-v2-screen-start: first-ranked set per kind with 2 large tasks and every required coupling style",
    seal: "harness-v2-screen-start",
    tasks: ["HX-050", "HX-051", "HX-052", "HX-053"],
    in_family: false,
  },
  measures: {
    fingerprint: H("f"),
    unknown_symbol_codes: ["AL0118", "AL0132", "AL0185"],
    ruleset_sha256: H("d"),
    canary_codes: ["AA0137"],
    workflow_execution: "used_execution",
    effort_execution: "every_attempt",
  },
  exploratory_metrics: ["pass_rate", "tokens_out"],
  simulation: {
    script_sha256: H("1"),
    args: {
      sims: 1000,
      resamples: 1000,
      confirm_sims: 500,
      confirm_resamples: 10000,
      seed: 20261003,
      pool_factor: 2,
      rule_b_share: 0.99,
    },
  },
  design_rule:
    "smallest tasks x repeats meeting power, error-control, suppression and coverage gates under the frozen rule (M11-13 chooseDesign), confirmed at 10000 resamples",
  stage_a: null,
  experiment_hash: null,
  selection: null,
  design: null,
  power_simulation: null,
  compiler_identity: null,
  stage_b_approval: null,
  amendments: [],
};
const stageB = async (o: Record<string, unknown> = {}) => {
  const a = PreregSchema.parse(STAGE_A);
  return PreregSchema.parse({
    ...STAGE_A,
    stage_a: { sha256: await protocolSha(a) },
    experiment_hash: H("e"),
    selection: {
      path: "harness-tasks/v2/selection.json",
      sha256: H("5"),
      selected: ["HX-007", "HX-008"],
      held_out: ["HX-050", "HX-051", "HX-052", "HX-053"],
    },
    design: { tasks: 2, repeats: 5 },
    power_simulation: {
      inputs: [{ path: "x.json", sha256: H("2") }],
      output: {
        path: "harness/preregistration/cc-v2-factorial.sim-b.json",
        sha256: H("3"),
      },
    },
    compiler_identity: "artifact|bccontainerhelper 6.1.14",
    stage_b_approval: "OWNER-APPROVED: stage B (2026-10-29T12:00:00Z)",
    ...o,
  });
};
const EXP = ExperimentSchema.parse({
  id: "cc-v2-factorial",
  hypothesis: "h",
  primary_metric: "cost_per_solved_task",
  baseline: "cc-v2-plain",
  variants: ["cc-v2-plain-lsp", "cc-v2-realistic", "cc-v2-realistic-lsp"],
  vary: ["lsp"],
  tasks: "harness-tasks/tasks/*",
  repeats: 5,
  contrasts: PROTOCOL.contrasts,
  interaction: PROTOCOL.interaction,
  preregistration: "preregistration/cc-v2-factorial.yml",
});
const APPROVED = await protocolSha(PreregSchema.parse(STAGE_A));
const ctx = (o: object = {}) => ({
  experiment: EXP,
  experimentHash: H("e"),
  taskIds: ["HX-007", "HX-008", "HX-050", "HX-051", "HX-052", "HX-053"],
  selection: {
    sha256: H("5"),
    json: {
      status: "ok",
      held_out: ["HX-050", "HX-051", "HX-052", "HX-053"],
      selection: { n: 2, selected: ["HX-007", "HX-008"] },
    },
  },
  simulation: {
    sha256: H("3"),
    json: {
      script_sha256: H("1"),
      args: STAGE_A.simulation.args,
      zero_solve: { rule: "suppress_any_undefined" },
      decision: { design: { tasks: 2, repeats: 5 } },
    },
  },
  // Read from the decision file and the tag (outside the document): what the owner approved.
  anchor: {
    approved_protocol_sha256: APPROVED,
    tag_protocol_sha256: APPROVED,
    tag_moved: false,
  },
  // Read from the stage-B decision file and harness-v2-prereg-b (round 3 finding 1).
  stageB: {
    approved_sha256: H("b"),
    file_sha256: H("b"),
    tag_file_sha256: H("b"),
    tag_moved: false,
    approved_amendments: [] as string[],
  },
  ...o,
});
const SB = ctx().stageB;

Deno.test("stage A has no stage-B values; its identity is its own projection", async () => {
  const a = PreregSchema.parse(STAGE_A);
  assertEquals(await protocolSha(stageAOf(a)), await protocolSha(a));
  assertEquals(
    PreregSchema.safeParse({ ...STAGE_A, approval: "ok" }).success,
    false,
  );
  assertEquals(PreregSchema.safeParse({ ...STAGE_A, extra: 1 }).success, false);
});

Deno.test("preregProblems: a clean stage B passes; stage A is not campaign-ready", async () => {
  assertEquals(await preregProblems(await stageB(), ctx()), []);
  assert(
    (await preregProblems(PreregSchema.parse(STAGE_A), ctx())).includes(
      "stage B is not frozen: stage_a",
    ),
  );
});

Deno.test("preregProblems: ancestry, design, selection, task set and simulation are each checked", async () => {
  const has = async (
    b: Promise<Parameters<typeof preregProblems>[0]>,
    c: object,
    msg: string,
  ) =>
    assert(
      (await preregProblems(await b, ctx(c))).some((p) => p.includes(msg)),
      msg,
    );
  await has(stageB({ alpha: 0.1 }), {}, "does not descend from stage A");
  await has(stageB({ design: { tasks: 3, repeats: 5 } }), {}, "design tasks 3");
  await has(stageB(), { taskIds: ["HX-007", "HX-008"] }, "campaign task set");
  await has(stageB(), { experimentHash: H("x") }, "experiment_hash");
  await has(stageB(), {
    simulation: {
      ...ctx().simulation,
      json: {
        ...ctx().simulation.json,
        zero_solve: { rule: "min_defined_share", share: 0.99 },
      },
    },
  }, "zero-solve rule");
  await has(stageB(), {
    simulation: {
      ...ctx().simulation,
      json: { ...ctx().simulation.json, decision: { design: null } },
    },
  }, "simulation decision");
  await has(
    stageB(),
    { selection: { ...ctx().selection, sha256: H("z") } },
    "selection",
  );
});

Deno.test("anchor: editing the document AND its stage_a.sha256 after approval is refused (round 2 finding 1)", async () => {
  // Self-consistent forgery: alpha changed and stage_a recomputed from the edited document.
  const edited = PreregSchema.parse({ ...STAGE_A, alpha: 0.1 });
  const forged = await stageB({
    alpha: 0.1,
    stage_a: { sha256: await protocolSha(edited) },
  });
  const p = await preregProblems(forged, ctx());
  assert(
    !p.some((x) => x.includes("projection hash differs")),
    "the forgery is internally consistent",
  );
  assert(
    p.some((x) => x.includes("differs from the approved stage A")),
    p.join("\n"),
  );
  // The tag moved to an edited commit: the decision file still names the old tag object.
  assert(
    (await preregProblems(
      await stageB(),
      ctx({
        anchor: {
          approved_protocol_sha256: APPROVED,
          tag_protocol_sha256: APPROVED,
          tag_moved: true,
        },
      }),
    ))
      .some((x) => x.includes("harness-v2-prereg-a no longer resolves")),
  );
  // The file committed at the tag differs from the approved hash.
  assert(
    (await preregProblems(
      await stageB(),
      ctx({
        anchor: {
          approved_protocol_sha256: APPROVED,
          tag_protocol_sha256: H("9"),
          tag_moved: false,
        },
      }),
    ))
      .some((x) => x.includes("stage A at harness-v2-prereg-a")),
  );
  // Held-out ids must be the ones stage A recorded.
  assert(
    (await preregProblems(
      await stageB({
        selection: {
          path: "harness-tasks/v2/selection.json",
          sha256: H("5"),
          selected: ["HX-007", "HX-008"],
          held_out: ["HX-050", "HX-051", "HX-052", "HX-054"],
        },
      }),
      ctx(),
    ))
      .some((x) => x.includes("held-out tasks")),
  );
});

Deno.test("parseStageADecision: the decision file's anchor lines", () => {
  const d = parseStageADecision(
    `# stage A\nprotocol_sha256: ${H("a")}\nfile_sha256: ${
      H("b")
    }\ntag: harness-v2-prereg-a\ntag_object: ${
      "c".repeat(40)
    }\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  assertEquals(d, {
    protocol_sha256: H("a"),
    tag: "harness-v2-prereg-a",
    tag_object: "c".repeat(40),
  });
  assertEquals(parseStageADecision(`protocol_sha256: ${H("a")}\n`), null);
});

Deno.test("verifyPrereg I/O: the anchor comes from the tag and the decision file, not the working file", async () => {
  // Temp git repo: commit stage A, tag it, write the decision; then edit the working file and its stage_a.
  const repo = await Deno.makeTempDir();
  const git = (...args: string[]) =>
    new Deno.Command("git", {
      args,
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
  await git("init", "-q");
  await git("config", "user.email", "t@example.invalid");
  await git("config", "user.name", "t");
  await Deno.mkdir(join(repo, "harness", "preregistration"), {
    recursive: true,
  });
  const rel = "preregistration/cc-v2-factorial.yml";
  await Deno.writeTextFile(join(repo, "harness", rel), stringify(STAGE_A));
  await git("add", ".");
  await git("commit", "-q", "-m", "stage A");
  await git(
    "tag",
    "-a",
    "harness-v2-prereg-a",
    "-m",
    `protocol_sha256: ${APPROVED}`,
  );
  const tagObject = new TextDecoder().decode(
    (await git("rev-parse", "harness-v2-prereg-a")).stdout,
  ).trim();
  const decision = join(repo, "decision.md");
  await Deno.writeTextFile(
    decision,
    `protocol_sha256: ${APPROVED}\nfile_sha256: ${
      H("f")
    }\ntag: harness-v2-prereg-a\ntag_object: ${tagObject}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  const clean = await loadStageAAnchor(
    repo,
    join(repo, "harness"),
    rel,
    decision,
  );
  assertEquals(clean.anchor, {
    approved_protocol_sha256: APPROVED,
    tag_protocol_sha256: APPROVED,
    tag_moved: false,
  });
  // Editing the working file changes nothing the anchor reads.
  await Deno.writeTextFile(
    join(repo, "harness", rel),
    stringify({ ...STAGE_A, alpha: 0.1 }),
  );
  assertEquals(
    (await loadStageAAnchor(repo, join(repo, "harness"), rel, decision)).anchor,
    clean.anchor,
  );
  // Moving the tag is detected against the decision file.
  await git("commit", "-q", "-am", "edit");
  await git("tag", "-f", "-a", "harness-v2-prereg-a", "-m", "moved");
  assertEquals(
    (await loadStageAAnchor(repo, join(repo, "harness"), rel, decision)).anchor
      .tag_moved,
    true,
  );
  await Deno.remove(repo, { recursive: true });
});

const DROP_C3 = {
  key: "family",
  from: ["C1", "C2", "C3"],
  to: ["C1", "C2"],
  reason: "C3 unpowered",
  approval: "OWNER-APPROVED: drop C3 (2026-10-29T12:00:00Z)",
} as const;
const NO_DESIGN = {
  ...ctx().simulation,
  json: { ...ctx().simulation.json, decision: { design: null } },
};
const DESIGN_AM = {
  key: "design",
  from: null,
  to: { tasks: 2, repeats: 5 },
  reason: "no design met the rule",
  approval: "OWNER-APPROVED: design 2x5 (2026-10-29T12:00:00Z)",
} as const;

Deno.test("amendments: an externally approved family amendment keeps ancestry and is disclosed", async () => {
  const b = await stageB({ family: ["C1", "C2"], amendments: [DROP_C3] });
  assertEquals(
    await preregProblems(
      b,
      ctx({ stageB: { ...SB, approved_amendments: ["family"] } }),
    ),
    [],
  );
});

Deno.test("amendments: forged amendments with a valid stage-A anchor are refused (round 3 finding 1)", async () => {
  // Family drop whose only approval is the text inside the editable document.
  const drop = await preregProblems(
    await stageB({ family: ["C1", "C2"], amendments: [DROP_C3] }),
    ctx(),
  );
  assert(
    drop.some((x) =>
      x.includes("amendment of family is not externally approved")
    ),
    drop.join("\n"),
  );
  // Design amendment used to waive the simulation/design agreement.
  const design = await preregProblems(
    await stageB({ amendments: [DESIGN_AM] }),
    ctx({ simulation: NO_DESIGN }),
  );
  assert(
    design.some((x) =>
      x.includes("amendment of design is not externally approved")
    ),
    design.join("\n"),
  );
  assert(
    design.some((x) =>
      x.includes("design differs from the simulation decision")
    ),
    "no waiver without external approval",
  );
  // The same design amendment, externally approved: the waiver applies.
  assertEquals(
    await preregProblems(
      await stageB({ amendments: [DESIGN_AM] }),
      ctx({
        simulation: NO_DESIGN,
        stageB: { ...SB, approved_amendments: ["design"] },
      }),
    ),
    [],
  );
});

Deno.test("stage-B anchor: no approval, edited bytes or a moved tag refuse campaign creation", async () => {
  const b = await stageB();
  const p = async (stage: object | null) =>
    (await preregProblems(b, ctx({ stageB: stage }))).join("\n");
  assert((await p(null)).includes("stage B is not externally approved"));
  assert(
    (await p({ ...SB, file_sha256: H("x") })).includes(
      "differs from the externally approved stage-B bytes",
    ),
  );
  assert(
    (await p({ ...SB, tag_file_sha256: H("x") })).includes(
      "stage B at harness-v2-prereg-b",
    ),
  );
  assert(
    (await p({ ...SB, tag_moved: true })).includes(
      "harness-v2-prereg-b no longer resolves",
    ),
  );
});

Deno.test("parseStageBDecision: bytes hash, tag and approved amendment keys", () => {
  const d = parseStageBDecision(
    `stage_b_sha256: ${H("b")}\ntag: harness-v2-prereg-b\ntag_object: ${
      "c".repeat(40)
    }\namendment: family\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  assertEquals(d, {
    stage_b_sha256: H("b"),
    tag: "harness-v2-prereg-b",
    tag_object: "c".repeat(40),
    amendments: ["family"],
  });
  assertEquals(parseStageBDecision(`stage_b_sha256: ${H("b")}\n`), null);
});

Deno.test("familyProblems: order, membership and interaction status must match the protocol", async () => {
  const b = await stageB();
  assertEquals(familyProblems(b, EXP), []);
  assert(familyProblems({ ...b, family: ["C2", "C1", "C3"] }, EXP).length > 0);
  assert(
    familyProblems({ ...b, family: ["C1", "C2", "C3", "interaction"] }, EXP)
      .length > 0,
  );
  const confirm = ExperimentSchema.parse({
    ...EXP,
    interaction: { ...PROTOCOL.interaction, status: "confirmatory" },
  });
  assert(
    familyProblems(b, confirm).some((p) => p.includes("interaction status")),
  );
});

// Appendix section 8: M11-10 reads selection.n, so a selection JSON whose n is
// not the selected count does not match the pre-registration.
Deno.test("preregProblems: selection.n must equal the pre-registered selected count", async () => {
  const sel = ctx().selection;
  const p = await preregProblems(
    await stageB(),
    ctx({
      selection: {
        ...sel,
        json: { ...sel.json, selection: { ...sel.json.selection, n: 3 } },
      },
    }),
  );
  assert(
    p.some((x) => x.includes("selection.n 3 differs from 2 selected tasks")),
    p.join("\n"),
  );
});

/**
 * A temp git repo with STAGE_A committed (LF, no autocrlf) and tagged both
 * harness-v2-prereg-a and harness-v2-prereg-b, with both decision files.
 */
async function anchorRepo() {
  const repo = await Deno.makeTempDir();
  const git = async (...args: string[]) => {
    const out = await new Deno.Command("git", {
      args,
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
    return new TextDecoder().decode(out.stdout).trim();
  };
  await git("init", "-q");
  await git("config", "user.email", "t@example.invalid");
  await git("config", "user.name", "t");
  await git("config", "core.autocrlf", "false");
  await Deno.mkdir(join(repo, "harness", "preregistration"), {
    recursive: true,
  });
  const rel = "preregistration/cc-v2-factorial.yml";
  const text = stringify(STAGE_A);
  await Deno.writeTextFile(join(repo, "harness", rel), text);
  await git("add", ".");
  await git("commit", "-q", "-m", "stage A");
  const bSha = await sha256Hex(new TextEncoder().encode(text));
  await git(
    "tag",
    "-a",
    "harness-v2-prereg-a",
    "-m",
    `protocol_sha256: ${APPROVED}`,
  );
  await git(
    "tag",
    "-a",
    "harness-v2-prereg-b",
    "-m",
    `stage_b_sha256: ${bSha}`,
  );
  const decisionA = join(repo, "decision-a.md");
  await Deno.writeTextFile(
    decisionA,
    `protocol_sha256: ${APPROVED}\nfile_sha256: ${
      H("f")
    }\ntag: harness-v2-prereg-a\ntag_object: ${await git(
      "rev-parse",
      "harness-v2-prereg-a",
    )}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
  );
  const decisionB = join(repo, "decision-b.md");
  await Deno.writeTextFile(
    decisionB,
    `stage_b_sha256: ${bSha}\ntag: harness-v2-prereg-b\ntag_object: ${await git(
      "rev-parse",
      "harness-v2-prereg-b",
    )}\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`,
  );
  return {
    repo,
    git,
    rel,
    text,
    bSha,
    decisionA,
    decisionB,
    harness: join(repo, "harness"),
  };
}

Deno.test("anchors read refs/tags only: a stray non-tag ref with the tag's short name is never read", async () => {
  const r = await anchorRepo();
  const cleanA = await loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA);
  const cleanB = await loadStageBAnchor(r.repo, r.harness, r.rel, r.decisionB);
  // An edited commit under refs/<short name>, which git's short-name lookup prefers over refs/tags/<short name>.
  await Deno.writeTextFile(
    join(r.harness, r.rel),
    stringify({ ...STAGE_A, alpha: 0.1 }),
  );
  await r.git("commit", "-q", "-am", "edit");
  await r.git("update-ref", "refs/harness-v2-prereg-a", "HEAD");
  await r.git("update-ref", "refs/harness-v2-prereg-b", "HEAD");
  assertEquals(
    (await loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA)).anchor,
    cleanA.anchor,
  );
  const b =
    (await loadStageBAnchor(r.repo, r.harness, r.rel, r.decisionB)).anchor;
  assertEquals([b.tag_file_sha256, b.tag_moved], [
    cleanB.anchor.tag_file_sha256,
    false,
  ]);
  assertEquals(b.tag_file_sha256, r.bSha);
  await Deno.remove(r.repo, { recursive: true });
});

Deno.test("stage-B anchor: a CRLF working copy matches the LF bytes approved at the tag", async () => {
  const r = await anchorRepo();
  await Deno.writeTextFile(
    join(r.harness, r.rel),
    r.text.replaceAll("\n", "\r\n"),
  );
  const { anchor } = await loadStageBAnchor(
    r.repo,
    r.harness,
    r.rel,
    r.decisionB,
  );
  assertEquals(anchor, {
    approved_sha256: r.bSha,
    file_sha256: r.bSha,
    tag_file_sha256: r.bSha,
    tag_moved: false,
    approved_amendments: [],
  });
  assertEquals(
    (await preregProblems(await stageB(), ctx({ stageB: anchor }))).filter((
      x,
    ) => x.includes("stage-B") || x.includes("stage B")),
    [],
  );
  await Deno.remove(r.repo, { recursive: true });
});

// M11-10 run 002 hardening (review findings 1-4).
const decisionA = (
  tagObject: string,
  o: { file?: boolean; approval?: string } = {},
) =>
  `protocol_sha256: ${APPROVED}\n${
    o.file === false ? "" : `file_sha256: ${H("f")}\n`
  }tag: harness-v2-prereg-a\ntag_object: ${tagObject}\n${
    o.approval ?? "OWNER-APPROVED: stage A (2026-10-24T12:00:00Z)"
  }\n`;

Deno.test("git isolation: GIT_DIR pointing at another repo cannot satisfy or forge the anchor", async () => {
  const r = await anchorRepo();
  const f = await anchorRepo();
  // The forged repo carries the same tag name on a different commit and tag object.
  await Deno.writeTextFile(
    join(f.harness, f.rel),
    stringify({ ...STAGE_A, alpha: 0.1 }),
  );
  await f.git("commit", "-q", "-am", "edit");
  await f.git("tag", "-f", "-a", "harness-v2-prereg-a", "-m", "forged");
  const forgedObject = await f.git("rev-parse", "harness-v2-prereg-a");
  const forgedDecision = join(r.repo, "forged-decision.md");
  await Deno.writeTextFile(forgedDecision, decisionA(forgedObject));
  const prev = Deno.env.get("GIT_DIR");
  Deno.env.set("GIT_DIR", join(f.repo, ".git"));
  try {
    const a = await loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA);
    assertEquals(a.anchor, {
      approved_protocol_sha256: APPROVED,
      tag_protocol_sha256: APPROVED,
      tag_moved: false,
    });
    const forged = await loadStageAAnchor(
      r.repo,
      r.harness,
      r.rel,
      forgedDecision,
    );
    assertEquals(forged.anchor.tag_moved, true);
    const b = await loadStageBAnchor(r.repo, r.harness, r.rel, r.decisionB);
    assertEquals([b.anchor.tag_moved, b.anchor.tag_file_sha256], [
      false,
      r.bSha,
    ]);
  } finally {
    if (prev === undefined) Deno.env.delete("GIT_DIR");
    else Deno.env.set("GIT_DIR", prev);
    await Deno.remove(r.repo, { recursive: true });
    await Deno.remove(f.repo, { recursive: true });
  }
});

Deno.test("anchors require annotated tags whose annotation hash equals the decision", async () => {
  for (
    const [tag, key, decision, hash] of [
      ["harness-v2-prereg-a", "protocol_sha256", "decisionA", APPROVED],
      ["harness-v2-prereg-b", "stage_b_sha256", "decisionB", "b".repeat(64)],
    ] as const
  ) {
    const r = await anchorRepo();
    const load = () =>
      tag.endsWith("-a")
        ? loadStageAAnchor(r.repo, r.harness, r.rel, r[decision])
        : loadStageBAnchor(r.repo, r.harness, r.rel, r[decision]);
    const redecide = async (obj: string) => {
      const t = await Deno.readTextFile(r[decision]);
      await Deno.writeTextFile(
        r[decision],
        t.replace(/^tag_object: .*$/m, `tag_object: ${obj}`),
      );
    };
    // Lightweight tag on HEAD, decision records the commit id.
    await r.git("tag", "-d", tag);
    await r.git("tag", tag);
    await redecide(await r.git("rev-parse", tag));
    await assertRejects(load, Error, "not an annotated tag");
    // Annotated, but the annotation names another hash.
    await r.git("tag", "-f", "-a", tag, "-m", `${key}: ${H("9")}`);
    await redecide(await r.git("rev-parse", tag));
    await assertRejects(load, Error, "annotation");
    // Annotated with the decision's own hash passes.
    await r.git(
      "tag",
      "-f",
      "-a",
      tag,
      "-m",
      `${key}: ${tag.endsWith("-a") ? hash : r.bSha}`,
    );
    await redecide(await r.git("rev-parse", tag));
    assertEquals((await load()).anchor.tag_moved, false);
    await Deno.remove(r.repo, { recursive: true });
  }
});

Deno.test("decision parsers: a bare or malformed approval line and a missing file_sha256 are refused", () => {
  const obj = "c".repeat(40);
  const ok = decisionA(obj);
  assert(parseStageADecision(ok) !== null);
  for (
    const approval of [
      "OWNER-APPROVED:",
      "OWNER-APPROVED: stage A",
      "OWNER-APPROVED: stage A (not-a-time)",
    ]
  ) assertEquals(parseStageADecision(decisionA(obj, { approval })), null);
  assertEquals(parseStageADecision(decisionA(obj, { file: false })), null);
  assertEquals(
    parseStageADecision(ok.replace(/^tag_object: .*\n/m, "")),
    null,
  );
  const b = (approval: string) =>
    `stage_b_sha256: ${
      H("b")
    }\ntag: harness-v2-prereg-b\ntag_object: ${obj}\n${approval}\n`;
  assert(
    parseStageBDecision(b("OWNER-APPROVED: stage B (2026-11-06T12:00:00Z)")) !==
      null,
  );
  for (
    const approval of ["OWNER-APPROVED:", "OWNER-APPROVED: x (nope)"]
  ) assertEquals(parseStageBDecision(b(approval)), null);
});

Deno.test("semantic comparisons ignore object key order but not content", async () => {
  const sim = ctx().simulation;
  const args = Object.fromEntries(
    Object.entries(STAGE_A.simulation.args).reverse(),
  );
  const reordered = {
    ...sim,
    json: {
      ...sim.json,
      args,
      zero_solve: { rule: "suppress_any_undefined" },
      decision: { design: { repeats: 5, tasks: 2 } },
    },
  };
  const key = (p: string[]) =>
    p.filter((x) => x.includes("simulation") || x.includes("design"));
  assertEquals(
    key(await preregProblems(await stageB(), ctx({ simulation: reordered }))),
    [],
  );
  const changed = {
    ...reordered,
    json: { ...reordered.json, args: { ...args, sims: 1 } },
  };
  assert(
    key(await preregProblems(await stageB(), ctx({ simulation: changed })))
      .some((x) => x.includes("frozen script and arguments")),
  );
});

Deno.test("git isolation: GIT_COMMON_DIR and config redirects cannot move the object store or refs", async () => {
  const r = await anchorRepo();
  const f = await anchorRepo();
  await Deno.writeTextFile(
    join(f.harness, f.rel),
    stringify({ ...STAGE_A, alpha: 0.1 }),
  );
  await f.git("commit", "-q", "-am", "edit");
  // A forged annotated tag whose annotation names the approved hash but whose commit holds another file.
  await f.git(
    "tag",
    "-f",
    "-a",
    "harness-v2-prereg-a",
    "-m",
    `protocol_sha256: ${APPROVED}`,
  );
  const real = await r.git("rev-parse", "refs/tags/harness-v2-prereg-a");
  const forged = await f.git("rev-parse", "refs/tags/harness-v2-prereg-a");
  // git does not verify a loose object's hash on read: a common dir that is a copy of the
  // real .git, plus the forged objects, serves the forged tag under the real tag's id.
  const common = `${r.repo}-common`;
  await copy(join(f.repo, ".git"), common);
  await copy(join(r.repo, ".git", "refs"), join(common, "refs"), {
    overwrite: true,
  });
  const loose = (root: string, id: string) =>
    join(root, "objects", id.slice(0, 2), id.slice(2));
  const forgedBytes = await Deno.readFile(loose(join(f.repo, ".git"), forged));
  await Deno.mkdir(join(common, "objects", real.slice(0, 2)), {
    recursive: true,
  });
  try {
    await Deno.remove(loose(common, real));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  await Deno.writeFile(loose(common, real), forgedBytes);
  const names = ["GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_GRAFT_FILE"];
  const prev = names.map((n) => Deno.env.get(n));
  Deno.env.set("GIT_COMMON_DIR", common);
  Deno.env.set("GIT_NAMESPACE", "forged");
  Deno.env.set("GIT_GRAFT_FILE", join(f.repo, "grafts"));
  try {
    const a = await loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA);
    assertEquals(a.anchor, {
      approved_protocol_sha256: APPROVED,
      tag_protocol_sha256: APPROVED,
      tag_moved: false,
    });
  } finally {
    names.forEach((n, i) => {
      const v = prev[i];
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    });
    await Deno.remove(r.repo, { recursive: true });
    await Deno.remove(f.repo, { recursive: true });
    await Deno.remove(common, { recursive: true });
  }
});

Deno.test("annotation must hold exactly one hash line", async () => {
  const r = await anchorRepo();
  await r.git(
    "tag",
    "-f",
    "-a",
    "harness-v2-prereg-a",
    "-m",
    `protocol_sha256: ${APPROVED}\nprotocol_sha256: ${APPROVED}`,
  );
  const t = await Deno.readTextFile(r.decisionA);
  await Deno.writeTextFile(
    r.decisionA,
    t.replace(
      /^tag_object: .*$/m,
      `tag_object: ${await r.git("rev-parse", "harness-v2-prereg-a")}`,
    ),
  );
  await assertRejects(
    () => loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA),
    Error,
    "exactly one",
  );
  await Deno.remove(r.repo, { recursive: true });
});

Deno.test("decision parsers: keys cannot span lines or repeat", () => {
  const obj = "c".repeat(40);
  const ok = decisionA(obj);
  assert(parseStageADecision(ok) !== null);
  assertEquals(
    parseStageADecision(
      ok.replace(
        `protocol_sha256: ${APPROVED}`,
        `protocol_sha256:\n${APPROVED}`,
      ),
    ),
    null,
  );
  assertEquals(
    parseStageADecision(`${ok}tag_object: ${"d".repeat(40)}\n`),
    null,
  );
  assertEquals(
    parseStageADecision(`${ok}protocol_sha256: ${H("e")}\n`),
    null,
  );
  const b = `stage_b_sha256: ${
    H("b")
  }\ntag: harness-v2-prereg-b\ntag_object: ${obj}\nOWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n`;
  assert(parseStageBDecision(b) !== null);
  assertEquals(
    parseStageBDecision(b.replace("stage_b_sha256: ", "stage_b_sha256:\n")),
    null,
  );
  assertEquals(parseStageBDecision(`${b}tag: harness-v2-prereg-b\n`), null);
});

// M11-10b: global git config and lazy fetch, stage-specific approvals, annotation uniqueness.
Deno.test("git isolation: a promisor ext:: helper from the user's global config never runs", async () => {
  const r = await anchorRepo();
  const home = await Deno.makeTempDir();
  const fwd = (p: string) => p.replaceAll("\\", "/");
  const marker = join(home, "marker");
  const helper = join(home, "helper.sh");
  await Deno.writeTextFile(helper, `#!/bin/sh\necho ran > "${fwd(marker)}"\n`);
  const gc = join(home, ".gitconfig");
  // Only the global config allows ext::, so a read of that file is what would let the helper run.
  await Deno.writeTextFile(gc, '[protocol "ext"]\n\tallow = always\n');
  await r.git("config", "core.repositoryformatversion", "1");
  await r.git("config", "extensions.partialClone", "origin");
  await r.git("config", "remote.origin.promisor", "true");
  await r.git("config", "remote.origin.url", `ext::sh ${fwd(helper)} %S`);
  // The tag object goes missing locally, so reading it triggers a lazy fetch from the promisor.
  const tagObj = await r.git("rev-parse", "harness-v2-prereg-a");
  const loose = join(
    r.repo,
    ".git",
    "objects",
    tagObj.slice(0, 2),
    tagObj.slice(2),
  );
  await Deno.chmod(loose, 0o666).catch(() => {});
  await Deno.remove(loose);
  const names = ["HOME", "USERPROFILE", "GIT_CONFIG_GLOBAL"];
  const prev = names.map((n) => Deno.env.get(n));
  Deno.env.set("HOME", home);
  Deno.env.set("USERPROFILE", home);
  Deno.env.set("GIT_CONFIG_GLOBAL", gc);
  try {
    await assertRejects(
      () => loadStageAAnchor(r.repo, r.harness, r.rel, r.decisionA),
      Error,
      "annotated tag",
    );
    let ran = true;
    try {
      await Deno.stat(marker);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      ran = false;
    }
    assertEquals(ran, false, "the ext:: helper ran");
  } finally {
    names.forEach((n, i) => {
      const v = prev[i];
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    });
    await Deno.remove(r.repo, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("decision parsers: an approval line naming the other stage is refused", () => {
  const obj = "c".repeat(40);
  const wrongB = "OWNER-APPROVED: stage B (2026-10-24T12:00:00Z)";
  const wrongA = "OWNER-APPROVED: stage A (2026-11-06T12:00:00Z)";
  const a = (approval: string) => decisionA(obj, { approval });
  const b = (approval: string) =>
    `stage_b_sha256: ${
      H("b")
    }\ntag: harness-v2-prereg-b\ntag_object: ${obj}\n${approval}\n`;
  assert(
    parseStageADecision(a("OWNER-APPROVED: stage A (2026-10-24T12:00:00Z)")) !==
      null,
  );
  assertEquals(parseStageADecision(a(wrongB)), null);
  assertEquals(
    parseStageADecision(
      a(`OWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n${wrongB}`),
    ),
    null,
  );
  assert(
    parseStageBDecision(b("OWNER-APPROVED: stage B (2026-11-06T12:00:00Z)")) !==
      null,
  );
  assertEquals(parseStageBDecision(b(wrongA)), null);
  assertEquals(
    parseStageBDecision(
      b(`OWNER-APPROVED: stage B (2026-11-06T12:00:00Z)\n${wrongA}`),
    ),
    null,
  );
});

Deno.test("annotation uniqueness: a correct hash line plus a malformed duplicate is refused", async () => {
  const r = await anchorRepo();
  for (
    const [tag, key, ok, decision, load] of [
      [
        "harness-v2-prereg-a",
        "protocol_sha256",
        APPROVED,
        r.decisionA,
        loadStageAAnchor,
      ],
      [
        "harness-v2-prereg-b",
        "stage_b_sha256",
        r.bSha,
        r.decisionB,
        loadStageBAnchor,
      ],
    ] as const
  ) {
    await r.git(
      "tag",
      "-f",
      "-a",
      tag,
      "-m",
      `${key}: ${ok}\n${key}: not-a-hash`,
    );
    const t = await Deno.readTextFile(decision);
    await Deno.writeTextFile(
      decision,
      t.replace(
        /^tag_object: .*$/m,
        `tag_object: ${await r.git("rev-parse", tag)}`,
      ),
    );
    await assertRejects(
      () => load(r.repo, r.harness, r.rel, decision),
      Error,
      "exactly one",
    );
  }
  await Deno.remove(r.repo, { recursive: true });
});
