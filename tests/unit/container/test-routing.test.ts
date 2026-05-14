import { assertEquals } from "@std/assert";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";
import type { ALProject } from "../../../src/container/types.ts";
import { projectUsesTestPage } from "../../../src/container/test-routing.ts";

function project(path: string, testFiles: string[]): ALProject {
  return { path, appJson: {}, sourceFiles: [], testFiles };
}

Deno.test("projectUsesTestPage is true when a test file declares a TestPage", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      'codeunit 80006 X { procedure T() var P: TestPage "Customer Card"; begin end; }',
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage is false for a pure codeunit-logic test", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      "codeunit 80052 X { procedure T() var R: Decimal; begin R := 1; end; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), false);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage ignores the word inside identifiers/comments", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    // "TestPageView" is an identifier, "// TestPage" is a comment — neither is a TestPage var.
    await Deno.writeTextFile(
      f,
      "codeunit 80001 X { // TestPage usage avoided\n  var TestPageViewCount: Integer; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), false);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage routes an unreadable test file to the legacy path", async () => {
  // Safe default: unknown content is treated as potentially using TestPage.
  assertEquals(
    await projectUsesTestPage(project("/nope", ["/nope/missing.al"])),
    true,
  );
});

Deno.test("projectUsesTestPage scans all test files, not just the first", async () => {
  const dir = await createTempDir("routing");
  try {
    const plain = `${dir}/Plain.Test.al`;
    const withPage = `${dir}/Page.Test.al`;
    await Deno.writeTextFile(
      plain,
      "codeunit 80001 X { procedure T() begin end; }",
    );
    await Deno.writeTextFile(
      withPage,
      'codeunit 80002 Y { procedure T() var P: TestPage "Customer Card"; begin end; }',
    );
    assertEquals(
      await projectUsesTestPage(project(dir, [plain, withPage])),
      true,
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage detects a TestPage parameter declaration", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      "codeunit 80100 X { procedure H(var P: testpage 138) begin end; }",
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("projectUsesTestPage detects a TestRequestPage declaration", async () => {
  const dir = await createTempDir("routing");
  try {
    const f = `${dir}/CG.Test.al`;
    await Deno.writeTextFile(
      f,
      'codeunit 80101 X { procedure T() var P: TestRequestPage "My Report"; begin end; }',
    );
    assertEquals(await projectUsesTestPage(project(dir, [f])), true);
  } finally {
    await cleanupTempDir(dir);
  }
});
