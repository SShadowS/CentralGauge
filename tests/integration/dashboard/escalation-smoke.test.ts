/**
 * Real-container smoke test for the dashboard's escalation path.
 *
 * WHY THIS EXISTS. Every other test of this pipeline injects a fake
 * verifier, which is correct for testing the state machine and is why the
 * suite stayed green through two defects that made the feature unusable
 * against real hardware: the container's transcript was discarded, so a
 * publish failure read as "prepareCandidateApp failed" and nothing more,
 * and escalation never ran the credential/harness preflight the bench runs,
 * so every publish it attempted was unauthorized. Nothing validated that
 * the machine was wired to the world. This does.
 *
 * OPT-IN ONLY. It publishes AL apps to a real Business Central container,
 * so it never runs unless `CENTRALGAUGE_SMOKE_CONTAINER` is explicitly set.
 * It is deliberately NOT enough to be on Windows with a container up:
 *
 *   CENTRALGAUGE_SMOKE_CONTAINER=Cronus28 \
 *     deno test --allow-all tests/integration/dashboard/escalation-smoke.test.ts
 *
 * `deno task test:unit` never collects it (that task targets `tests/unit/`),
 * and `deno task test` collects but skips it while the variable is unset.
 *
 * SELF-CONTAINED. It builds its own draft in a temp directory rather than
 * depending on anything under `scratch/`, which authors edit and delete.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { verifyResponse } from "../../../src/dashboard/verify-run.ts";
import {
  handleAlVerify,
  prepareContainerForVerification,
} from "../../../mcp/al-tools-server.ts";
import { isBenchRunning } from "../../../src/utils/bench-lock.ts";
import { ConfigManager } from "../../../src/config/config.ts";
import { resolveContainerCredentials } from "../../../cli/commands/workbench-command.ts";

const CONTAINER = Deno.env.get("CENTRALGAUGE_SMOKE_CONTAINER");
const TASK_ID = "CG-SMOKE-001";
const TEST_CODEUNIT_ID = 89999;

/** Doubles its input. The oracle below checks exactly that. */
const GOOD_CANDIDATE = `codeunit 70999 "CG Smoke Probe"
{
    procedure Echo(Value: Integer): Integer
    begin
        exit(Value * 2);
    end;
}
`;

/** Same shape, wrong arithmetic: compiles, publishes, fails the oracle. */
const WRONG_CANDIDATE = `codeunit 70999 "CG Smoke Probe"
{
    procedure Echo(Value: Integer): Integer
    begin
        exit(Value * 3);
    end;
}
`;

const ORACLE = `codeunit ${TEST_CODEUNIT_ID} "CG Smoke Probe Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestEcho()
    var
        Probe: Codeunit "CG Smoke Probe";
    begin
        Assert.AreEqual(10, Probe.Echo(5), 'Echo should double its input');
    end;
}
`;

/** Builds a throwaway draft laid out the way `stageResponse` expects. */
async function makeDraft(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "cg-smoke-draft-" });
  await Deno.mkdir(join(dir, "correct"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "task.yml"),
    [
      `id: ${TASK_ID}`,
      "description: >-",
      "  Smoke fixture. Not a benchmark task.",
      "expected:",
      `  testCodeunitId: ${TEST_CODEUNIT_ID}`,
      "",
    ].join("\n"),
  );
  // The oracle MUST be `correct/<taskId>.Test.al`; `stageResponse` refuses
  // the draft otherwise. It must NOT be `correct/<taskId>.al`, which
  // `classifyOracleFiles` refuses because it would overwrite the candidate.
  await Deno.writeTextFile(join(dir, "correct", `${TASK_ID}.Test.al`), ORACLE);
  return dir;
}

Deno.test({
  name: "escalation smoke: stage, compile, publish and run the oracle",
  ignore: CONTAINER === undefined,
  fn: async (t) => {
    const container = CONTAINER!;

    // Refuse rather than corrupt: publishing to a container a bench is
    // using destroys that run's BC NST PowerShell session, which is the
    // whole reason the dashboard gates on this marker.
    assertEquals(
      isBenchRunning(),
      false,
      "a bench is running; this test publishes to the same container and " +
        "would corrupt it. Wait for the bench to finish.",
    );

    await t.step("preflight prepares credentials and the harness", async () => {
      // Throws if the container is unreachable or the harness cannot be
      // published. Both are infrastructure failures and should fail the
      // test loudly rather than surface later as a confusing verdict.
      //
      // The second argument comes from `.centralgauge.yml`, the same source
      // the CLI and the bench read. It is REQUIRED: it was optional for one
      // revision, and the first run of this very test omitted it and
      // reproduced the `Status Code Unauthorized` that the preflight exists
      // to prevent, because the provider silently falls back to
      // `admin`/`admin`.
      const config = await ConfigManager.loadConfig();
      await prepareContainerForVerification(
        container,
        resolveContainerCredentials(config),
      );
    });

    await t.step(
      "a correct candidate passes, with tests that RAN",
      async () => {
        const draftDir = await makeDraft();
        try {
          const outcome = await verifyResponse({
            draftDir,
            taskId: TASK_ID,
            code: GOOD_CANDIDATE,
            containerName: container,
            verify: handleAlVerify,
          });

          assertEquals(
            outcome.state,
            "passed_first_try",
            `expected a pass, got ${JSON.stringify(outcome)}`,
          );
          if (outcome.state !== "passed_first_try") {
            throw new Error("unreachable");
          }
          // THE assertion this file exists for. A pipeline that never reached
          // the container can produce plenty of states; only a real run
          // produces a positive test count.
          assert(
            outcome.total > 0,
            "no test actually executed, so nothing about the container was proven",
          );
          assertEquals(outcome.passed, outcome.total);
        } finally {
          await Deno.remove(draftDir, { recursive: true });
        }
      },
    );

    await t.step(
      "a wrong candidate fails the oracle, not the harness",
      async () => {
        const draftDir = await makeDraft();
        try {
          const outcome = await verifyResponse({
            draftDir,
            taskId: TASK_ID,
            code: WRONG_CANDIDATE,
            containerName: container,
            verify: handleAlVerify,
          });

          // `failed_both` and not `didnt_compile`, `publish_defect` or
          // `errored`: the wrong candidate is valid AL that publishes
          // cleanly, so anything else means the pipeline broke rather than
          // the oracle catching the defect.
          assertEquals(
            outcome.state,
            "failed_both",
            `expected an oracle failure, got ${JSON.stringify(outcome)}`,
          );
          if (outcome.state !== "failed_both") throw new Error("unreachable");
          assert(
            outcome.total > 0,
            "a failure with no tests run is an infrastructure failure wearing " +
              "a test result's clothes, which is what this pipeline must never do",
          );
          assert(
            outcome.failures.length > 0,
            "expected a named assertion failure",
          );
        } finally {
          await Deno.remove(draftDir, { recursive: true });
        }
      },
    );
  },
});
