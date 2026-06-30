// tests/unit/scripts/trap-probe.test.ts
import { assertEquals } from "@std/assert";
import {
  classifyProbeOutcome,
  type VerifyResult,
} from "../../../scripts/trap-probe.ts";

Deno.test("classifyProbeOutcome: success:true is pass", () => {
  const res: VerifyResult = {
    success: true,
    message: "All tests passed! (5/5)",
    totalTests: 5,
    passed: 5,
    failed: 0,
  };
  assertEquals(classifyProbeOutcome(res), "pass");
});

Deno.test("classifyProbeOutcome: success:false with testResults failures is fail", () => {
  const res: VerifyResult = {
    success: false,
    message: "Tests failed: 2 of 5 tests failed",
    totalTests: 5,
    passed: 3,
    failed: 2,
    failures: ["TestAdd: expected 5 got 4", "TestSub: expected 1 got 2"],
  };
  assertEquals(classifyProbeOutcome(res), "fail");
});

Deno.test("classifyProbeOutcome: success:false with compile errors is fail", () => {
  const res: VerifyResult = {
    success: false,
    message: "Verification compilation failed",
    compileErrors: [
      "MyCodeunit.al(10,5): AL0118 - The name 'Foo' does not exist",
    ],
  };
  assertEquals(classifyProbeOutcome(res), "fail");
});

Deno.test("classifyProbeOutcome: caught-exception catch-all message is inconclusive (GH #13 zero_tests)", () => {
  const res: VerifyResult = {
    success: false,
    message:
      "Verification error: Zero tests detected after successful publish (infra)",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});

Deno.test("classifyProbeOutcome: caught-exception catch-all with generic ContainerError label is inconclusive", () => {
  // Most ContainerError messages are generic operation labels — the real
  // SYSLIB0014/SQL-down/PSSession-lost signature text lives in rawOutput,
  // which never survives into VerifyResult.message. The catch-all prefix
  // alone must be enough to classify these as inconclusive.
  const res: VerifyResult = {
    success: false,
    message: "Verification error: Publish failed",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});

Deno.test("classifyProbeOutcome: non-prefixed message matching a known infra signature is inconclusive", () => {
  const res: VerifyResult = {
    success: false,
    message: "SYSLIB0014: ServicePointManager is obsolete",
  };
  assertEquals(classifyProbeOutcome(res), "inconclusive");
});
