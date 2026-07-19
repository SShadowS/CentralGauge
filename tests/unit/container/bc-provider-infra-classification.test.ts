/**
 * Cluster-4 infra-classification guards on BcContainerProvider (C1, C2, C3).
 *
 * Pure unit — NO real container, NO pwsh spawn:
 *  - C1 stubs the SOAP HTTP call via `globalThis.fetch` and the candidate
 *    publish step on the provider instance.
 *  - C2 exercises the pure `decideSoapFailureAction` function.
 *  - C3 stubs `getOrCreateCompilerFolder` on the provider instance.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { ALProject } from "../../../src/container/types.ts";
import {
  BcContainerProvider,
  decideSoapFailureAction,
} from "../../../src/container/bc-container-provider.ts";
import { ContainerError } from "../../../src/errors.ts";
import { classifyInfraError } from "../../../src/health/classify.ts";

// ---------------------------------------------------------------------------
// C1 — SOAP zero-tests guard
// ---------------------------------------------------------------------------

/** Minimal non-TestPage AL test codeunit so SOAP routing selects the harness. */
const NON_TESTPAGE_TEST_CODEUNIT = `codeunit 80100 "CG Zero Tests"
{
    Subtype = Test;

    [Test]
    procedure DoesNothing()
    begin
    end;
}
`;

/** Build a SOAP 200 response whose harness JSON reports ZERO tests run. */
function zeroTestsSoapResponse(): string {
  const harnessJson = JSON.stringify({
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 12,
    codeunits: [],
  });
  // JSON has no `<` or `&`, so no XML escaping is required for the payload.
  return `<Soap:Envelope xmlns:Soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<Soap:Body><RunTests_Result><return_value>${harnessJson}</return_value>` +
    `</RunTests_Result></Soap:Body></Soap:Envelope>`;
}

Deno.test("C1: SOAP zero-tests after successful publish throws ContainerError(test) matching the zero_tests signature", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-zero-tests-" });
  const originalFetch = globalThis.fetch;
  const originalSoapKnob = Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER");
  try {
    Deno.env.delete("CENTRALGAUGE_SOAP_TEST_RUNNER"); // default = SOAP path ON

    const testFile = join(tempDir, "CGZeroTests.Test.al");
    await Deno.writeTextFile(testFile, NON_TESTPAGE_TEST_CODEUNIT);

    const project: ALProject = {
      path: tempDir,
      appJson: {
        id: "11111111-2222-3333-4444-555555555555",
        name: "CG Zero Tests App",
        publisher: "CentralGauge",
        version: "1.0.0.0",
      },
      sourceFiles: [],
      testFiles: [testFile],
    };

    const provider = new BcContainerProvider();
    // Stub the combined cleanup+publish step — publish SUCCEEDS.
    (provider as unknown as {
      prepareCandidateApp: (c: string, p: string) => Promise<void>;
    }).prepareCandidateApp = () => Promise.resolve();

    // Stub the harness HTTP call — SOAP responds 200 with zero tests run.
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(zeroTestsSoapResponse(), {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        }),
      );

    const err = await assertRejects(
      () =>
        provider.runTests(
          "TestContainer",
          project,
          join(tempDir, "candidate.app"),
          80100,
        ),
      ContainerError,
    );
    // Message must EXACTLY match what the zero_tests health signature expects.
    assertEquals(
      err.message,
      "Zero tests detected after successful publish (infra)",
    );
    assertEquals(err.operation, "test");

    // The health classifier must fingerprint it as the zero_tests signature
    // (GH #13) so the inline infra-retry reroutes instead of scoring.
    const cls = classifyInfraError(err);
    assertEquals(cls.signature?.id, "zero_tests");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSoapKnob !== undefined) {
      Deno.env.set("CENTRALGAUGE_SOAP_TEST_RUNNER", originalSoapKnob);
    }
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// C2 — infra precedence in decideSoapFailureAction (four-branch contract)
// ---------------------------------------------------------------------------

Deno.test("C2: decideSoapFailureAction four-branch precedence", async (t) => {
  await t.step(
    "publish output with infra-only signature → reroute_infra",
    () => {
      const out = "TCP Provider, error: 0 - The wait operation timed out";
      const e = new ContainerError("publish failed", "Cronus28", "publish", {
        rawOutput: out,
      });
      assertEquals(decideSoapFailureAction(e, out), "reroute_infra");
    },
  );

  await t.step(
    "publish output with BOTH infra and collision signatures → reroute_infra (infra wins)",
    () => {
      const out = "TCP Provider, error: 0 - The wait operation timed out\n" +
        "Object Page 50100 is already defined in App 'Stale Candidate'";
      const e = new ContainerError("publish failed", "Cronus28", "publish", {
        rawOutput: out,
      });
      assertEquals(decideSoapFailureAction(e, out), "reroute_infra");
    },
  );

  await t.step("publish output with collision-only → fallback_legacy", () => {
    const out = "Object Page 50100 is already defined in App 'Stale Candidate'";
    const e = new ContainerError("publish failed", "Cronus28", "publish", {
      rawOutput: out,
    });
    assertEquals(decideSoapFailureAction(e, out), "fallback_legacy");
  });

  await t.step("publish output with model-defect-only → score_model", () => {
    const out = "OnInstallAppPerCompany raised an error: division by zero";
    const e = new ContainerError("publish failed", "Cronus28", "publish", {
      rawOutput: out,
    });
    assertEquals(decideSoapFailureAction(e, out), "score_model");
  });
});

// ---------------------------------------------------------------------------
// C3 — compileProject catch-all rethrows infra errors
// ---------------------------------------------------------------------------

Deno.test("C3: compileProject RETHROWS an infra ContainerError instead of synthesizing a SYSTEM compile failure", async () => {
  const provider = new BcContainerProvider();
  const infraError = new ContainerError(
    "compiler folder creation failed: container not running",
    "TestContainer",
    "compile",
  );
  (provider as unknown as {
    getOrCreateCompilerFolder: (c: string) => Promise<string>;
  }).getOrCreateCompilerFolder = () => Promise.reject(infraError);

  const project: ALProject = {
    path: "C:\\tmp\\cg-c3-project",
    appJson: { name: "C3 App", publisher: "CentralGauge", version: "1.0.0.0" },
    sourceFiles: [],
    testFiles: [],
  };

  const err = await assertRejects(
    () => provider.compileProject("TestContainer", project),
    ContainerError,
  );
  assertEquals(err, infraError);
});

Deno.test("C3: compileProject still synthesizes a SYSTEM failure for non-infra unknown errors", async () => {
  const provider = new BcContainerProvider();
  (provider as unknown as {
    getOrCreateCompilerFolder: (c: string) => Promise<string>;
  }).getOrCreateCompilerFolder = () =>
    Promise.reject(new Error("some odd non-infra bug"));

  const project: ALProject = {
    path: "C:\\tmp\\cg-c3-project",
    appJson: { name: "C3 App", publisher: "CentralGauge", version: "1.0.0.0" },
    sourceFiles: [],
    testFiles: [],
  };

  const result = await provider.compileProject("TestContainer", project);
  assertEquals(result.success, false);
  assertEquals(result.errors[0]?.code, "SYSTEM");
  assertStringIncludes(
    result.errors[0]?.message ?? "",
    "some odd non-infra bug",
  );
});
