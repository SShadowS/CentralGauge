import { assert, assertEquals } from "@std/assert";
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
    `protocol_sha256: ${APPROVED}\ntag: harness-v2-prereg-a\ntag_object: ${tagObject}\nOWNER-APPROVED: stage A (2026-10-24T12:00:00Z)\n`,
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
    `protocol_sha256: ${APPROVED}\ntag: harness-v2-prereg-a\ntag_object: ${await git(
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
