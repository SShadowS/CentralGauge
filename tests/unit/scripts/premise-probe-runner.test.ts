// tests/unit/scripts/premise-probe-runner.test.ts
//
// SAFETY: nothing here touches a container. The prepare and verify steps are
// injected fakes; only argument handling and call order are exercised.
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  ALLOCATED_CONTAINERS,
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

Deno.test("parseRunnerArgs: defaults to Cronus281", () => {
  assertEquals(parseRunnerArgs(base).container, "Cronus281");
});

Deno.test("parseRunnerArgs: an allocated container is accepted", () => {
  for (const c of ALLOCATED_CONTAINERS) {
    assertEquals(parseRunnerArgs([...base, "--container", c]).container, c);
  }
});

Deno.test("parseRunnerArgs: a container outside the allocation is refused", () => {
  assertThrows(
    () => parseRunnerArgs([...base, "--container", "Cronus28"]),
    Error,
    "Cronus28 is not allocated",
  );
});

Deno.test("parseRunnerArgs: --any-container allows an unallocated container", () => {
  assertEquals(
    parseRunnerArgs([...base, "--container", "Cronus284", "--any-container"])
      .container,
    "Cronus284",
  );
});

Deno.test("parseRunnerArgs: missing required arguments are refused", () => {
  assertThrows(() => parseRunnerArgs(["--solution", "p"]), Error, "Required");
});

Deno.test("parseRunnerArgs: --codeunit must be a number", () => {
  assertThrows(
    () => parseRunnerArgs([...base.slice(0, 4), "--codeunit", "x"]),
    Error,
    "codeunit",
  );
});

Deno.test("runPremiseProbe: registers credentials for the target container before verify", async () => {
  const calls: string[] = [];
  const res = await runPremiseProbe(
    parseRunnerArgs([...base, "--container", "Cronus282"]),
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
  await assertRejects(
    () =>
      runPremiseProbe(parseRunnerArgs(base), {
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
