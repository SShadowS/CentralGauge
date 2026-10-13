// tests/unit/scripts/premise-probe-runner.test.ts
//
// SAFETY: nothing here touches a container. The prepare and verify steps are
// injected fakes; only argument handling and call order are exercised.
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  parseRunnerArgs,
  runPremiseProbe,
} from "../../../scripts/premise-probe-runner.ts";

const base = [
  "--solution",
  "p/correct",
  "--testFile",
  "p/correct/P.Test.al",
  "--codeunit",
  "84901",
];

/** M8-01f: a coord root whose allocation gives the campaign `containers`. */
async function coordRoot(containers: string[]): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(root, "coord.json"),
    JSON.stringify({ campaign: "harness-bench-2026-10" }),
  );
  await Deno.writeTextFile(
    join(root, "allocation.json"),
    JSON.stringify({
      "harness-bench-2026-10": containers,
      lethal: ["Cronus28", "Cronus284"],
    }),
  );
  return root;
}
const ALLOCATED = ["Cronus281", "Cronus282", "Cronus283", "Cronus285"];

Deno.test("parseRunnerArgs: defaults to Cronus281", async () => {
  const root = await coordRoot(ALLOCATED);
  assertEquals((await parseRunnerArgs(base, root)).container, "Cronus281");
});

Deno.test("parseRunnerArgs (M8-01f): every container allocation.json gives the campaign is accepted, Cronus285 included", async () => {
  const root = await coordRoot(ALLOCATED);
  for (const c of ALLOCATED) {
    assertEquals(
      (await parseRunnerArgs([...base, "--container", c], root)).container,
      c,
    );
  }
});

Deno.test("parseRunnerArgs: a container outside the allocation is refused", async () => {
  const root = await coordRoot(ALLOCATED);
  await assertRejects(
    () => parseRunnerArgs([...base, "--container", "Cronus28"], root),
    Error,
    "Cronus28 is not allocated",
  );
});

Deno.test("parseRunnerArgs (M8-01f): the allocation is read, not hardcoded (a container dropped from it is refused)", async () => {
  const root = await coordRoot(["Cronus282"]);
  await assertRejects(
    () => parseRunnerArgs([...base, "--container", "Cronus281"], root),
    Error,
    "Cronus281 is not allocated",
  );
});

Deno.test("parseRunnerArgs: --any-container allows an unallocated container", async () => {
  const root = await coordRoot(ALLOCATED);
  assertEquals(
    (await parseRunnerArgs(
      [...base, "--container", "Cronus284", "--any-container"],
      root,
    )).container,
    "Cronus284",
  );
});

Deno.test("parseRunnerArgs: missing required arguments are refused", async () => {
  await assertRejects(
    () => parseRunnerArgs(["--solution", "p"]),
    Error,
    "Required",
  );
});

Deno.test("parseRunnerArgs: --codeunit must be a number", async () => {
  await assertRejects(
    () => parseRunnerArgs([...base.slice(0, 4), "--codeunit", "x"]),
    Error,
    "codeunit",
  );
});

Deno.test("runPremiseProbe: registers credentials for the target container before verify", async () => {
  const calls: string[] = [];
  const res = await runPremiseProbe(
    await parseRunnerArgs(
      [...base, "--container", "Cronus282"],
      await coordRoot(ALLOCATED),
    ),
    {
      credentials: { username: "u", password: "p" },
      prepare: (c, creds) => {
        calls.push(`prepare ${c} ${creds.username}`);
        return Promise.resolve();
      },
      verify: (params) => {
        calls.push(`verify ${params.containerName} ${params.testCodeunitId}`);
        return Promise.resolve({ success: true, message: "ok" });
      },
    },
  );
  assertEquals(calls, ["prepare Cronus282 u", "verify Cronus282 84901"]);
  assertEquals(res.success, true);
});

Deno.test("runPremiseProbe: a failed prepare never reaches verify", async () => {
  let verified = false;
  const args = await parseRunnerArgs(base, await coordRoot(ALLOCATED));
  await assertRejects(
    () =>
      runPremiseProbe(args, {
        credentials: { username: "u", password: "p" },
        prepare: () => Promise.reject(new Error("401")),
        verify: () => {
          verified = true;
          return Promise.resolve({ success: true, message: "ok" });
        },
      }),
    Error,
    "401",
  );
  assertEquals(verified, false);
});
