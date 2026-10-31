import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type PublishSetupDeps,
  type PublishSetupOptions,
  runPromoteSetupSet,
  runPublishSetup,
} from "../../../../cli/commands/harness-publish-setup.ts";
import { CentralGaugeError } from "../../../../src/errors.ts";
import {
  buildSetupPublishPayload,
  PublishRefused,
} from "../../../../src/harness/publish-setup.ts";

const OPTS: PublishSetupOptions = {
  arm: "plain",
  setupId: "my-setup",
  judging: "campaign",
  resultsDir: "r",
  root: ".",
  apply: false,
  resamples: 10,
  seed: 1,
};

// deno-lint-ignore no-explicit-any
const anyv = (v: unknown): any => v;

function mk(over: Partial<PublishSetupDeps> = {}) {
  const out: string[] = [];
  const errs: string[] = [];
  const calls = { publish: 0, promote: 0, payload: undefined as unknown };
  const deps: PublishSetupDeps = {
    report: () => Promise.resolve(anyv({ campaign: { id: "camp1" } })),
    records: () => Promise.resolve(anyv({})),
    build: buildSetupPublishPayload,
    loadConfig: () => Promise.resolve(anyv({ adminKeyPath: "k" })),
    readKey: () => Promise.resolve(new Uint8Array(32)),
    publish: (_c, _k, p) => {
      calls.publish++;
      calls.payload = p;
      return Promise.resolve({
        run_id: p.run.id,
        setup_id: p.setup.id,
        task_set_hash: p.task_set.hash,
      });
    },
    promote: (_c, _k, h) => {
      calls.promote++;
      return Promise.resolve({ hash: h, promoted_at: "now" });
    },
    log: (l) => out.push(l),
    err: (l) => errs.push(l),
    ...over,
  };
  return { deps, out, errs, calls };
}

Deno.test("publish-setup: refused build prints [FAIL] and exits 1", async () => {
  const { deps, errs, calls } = mk({
    report: () =>
      Promise.resolve(anyv({
        campaign: { id: "c" },
        partial: { reasons: ["provisional"] },
        arms: [],
      })),
  });
  const code = await runPublishSetup("exp", { ...OPTS, apply: true }, deps);
  assertEquals(code, 1);
  assertStringIncludes(errs.join("\n"), "[FAIL]");
  assertStringIncludes(errs.join("\n"), "partial");
  assertEquals(calls.publish, 0);
  assert(new PublishRefused("x") instanceof CentralGaugeError);
});

Deno.test("publish-setup --apply without admin key fails before the report and the post", async () => {
  let reported = false;
  const { deps, errs, calls } = mk({
    loadConfig: () => Promise.reject(new Error("admin_key_path missing")),
    report: () => {
      reported = true;
      return Promise.resolve(anyv({}));
    },
  });
  const code = await runPublishSetup("exp", { ...OPTS, apply: true }, deps);
  assertEquals(code, 1);
  assertEquals(reported, false);
  assertEquals(calls.publish, 0);
  assertStringIncludes(errs.join("\n"), "admin_key_path missing");
});

Deno.test("publish-setup: 409 already_published is a [FAIL] with a hint", async () => {
  const { deps, errs } = mk({
    publish: () =>
      Promise.reject(
        new CentralGaugeError("conflict", "already_published"),
      ),
  });
  const code = await runWithPayload(deps, true);
  assertEquals(code, 1);
  assertStringIncludes(errs.join("\n"), "[FAIL]");
  assertStringIncludes(errs.join("\n"), "may already be on the site");
});

Deno.test("publish-setup: dry run prints the summary and sends nothing; apply posts run.id campaign:arm", async () => {
  const dry = mk();
  assertEquals(await runWithPayload(dry.deps, false), 0);
  const text = dry.out.join("\n");
  assertStringIncludes(text, "my-setup");
  assertStringIncludes(text, "0.75");
  assertEquals(dry.calls.publish, 0);

  const live = mk();
  assertEquals(await runWithPayload(live.deps, true), 0);
  assertEquals(live.calls.publish, 1);
  assertEquals(
    (live.calls.payload as { run: { id: string } }).run.id,
    "camp1:plain",
  );
});

Deno.test("promote-setup-set: dry run does not post; apply does", async () => {
  const dry = mk();
  assertEquals(await runPromoteSetupSet("abc", { apply: false }, dry.deps), 0);
  assertEquals(dry.calls.promote, 0);
  assertStringIncludes(dry.out.join("\n"), "abc");

  const live = mk();
  assertEquals(await runPromoteSetupSet("abc", { apply: true }, live.deps), 0);
  assertEquals(live.calls.promote, 1);
});

/**
 * Drive runPublishSetup past the builder with a real, minimal on-disk
 * campaign fixture would duplicate publish-setup.test.ts, so the builder is
 * swapped through the `build` seam.
 */
function validPayload() {
  return {
    setup: {
      id: "my-setup",
      agent_tool: "claude-code",
      base_model: "m",
      description: "A setup",
      visibility: null,
      roles: [],
      ingredients: {},
    },
    submission_id: null,
    task_set: {
      hash: "a".repeat(64),
      display_name: "HX set aaaaaaaa",
      tasks: [{ task_id: "t1", description_sha: "b".repeat(64) }],
    },
    run: {
      id: "camp1:plain",
      tool_version: "1",
      score: 0.75,
      cost_per_solved_usd: null,
      price_note: "Price not available.",
      excluded_cells: 0,
      repeats: 1,
      cells: [{
        task_id: "t1",
        repeat: 1,
        outcome: "pass",
        cost_usd: null,
        duration_ms: null,
      }],
    },
  };
}

function runWithPayload(
  deps: PublishSetupDeps,
  apply: boolean,
  payload: unknown = validPayload(),
) {
  return runPublishSetup("exp", { ...OPTS, apply }, {
    ...deps,
    build: () => Promise.resolve(anyv(payload)),
  });
}

Deno.test("publish-setup: an invalid payload fails in dry run and before posting", async () => {
  for (const apply of [false, true]) {
    const { deps, errs, calls } = mk();
    const bad = validPayload();
    bad.run.score = 2;
    const code = await runWithPayload(deps, apply, bad);
    assertEquals(code, 1);
    assertStringIncludes(errs.join("\n"), "[FAIL]");
    assertStringIncludes(errs.join("\n"), "run.score");
    assertEquals(calls.publish, 0);
  }
});
