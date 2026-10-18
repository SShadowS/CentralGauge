/**
 * Unit tests for temporary project creation
 * Verifies that test files are copied and dependencies are added correctly
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { basename, join } from "@std/path";
import { testTempDir } from "../../utils/temp-dir.ts";

/**
 * Helper to create a temp project with the same logic as executor-v2.ts
 * Extracted for unit testing purposes.
 */
async function createTempProjectForTest(
  tempDir: string,
  taskId: string,
  code: string,
  testAppPath?: string,
): Promise<void> {
  await Deno.mkdir(tempDir, { recursive: true });

  const hasTestApp = testAppPath && testAppPath.length > 0;

  // Create app.json with test toolkit dependencies if needed
  const appJson: Record<string, unknown> = {
    id: `${taskId}-1`,
    name: `CentralGauge_${taskId}_1`,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "27.0.0.0",
    runtime: "11.0",
    idRanges: [{ from: 70000, to: 80099 }],
  };

  // Add test toolkit dependencies if testApp is specified
  if (hasTestApp) {
    appJson["dependencies"] = [
      {
        id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
        name: "Library Assert",
        publisher: "Microsoft",
        version: "27.0.0.0",
      },
      {
        id: "5d86850b-0d76-4eca-bd7b-951ad998e997",
        name: "Tests-TestLibraries",
        publisher: "Microsoft",
        version: "27.0.0.0",
      },
    ];
  }

  await Deno.writeTextFile(
    join(tempDir, "app.json"),
    JSON.stringify(appJson, null, 2),
  );

  // Write code file
  await Deno.writeTextFile(join(tempDir, `${taskId}.al`), code);

  // Copy test file if testApp is specified
  if (hasTestApp) {
    const fullTestPath = testAppPath!;
    if (await exists(fullTestPath)) {
      const testFileName = basename(fullTestPath);
      await Deno.copyFile(fullTestPath, join(tempDir, testFileName));
    }
  }
}

describe("Temporary Project Creation", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = await testTempDir({ prefix: "cg_test_project_" });

    // Create a mock test file to copy
    testFilePath = join(tempDir, "MockTest.al");
    await Deno.writeTextFile(
      testFilePath,
      `codeunit 80001 "Mock Test"
{
    Subtype = Test;

    [Test]
    procedure TestSomething()
    begin
        // Test code
    end;
}`,
    );
  });

  afterEach(async () => {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Without testApp", () => {
    it("should create app.json without test dependencies", async () => {
      const projectDir = join(tempDir, "project_no_tests");

      await createTempProjectForTest(
        projectDir,
        "CG-AL-E001",
        "// Generated AL code",
        undefined, // No testApp
      );

      const appJsonPath = join(projectDir, "app.json");
      assert(await exists(appJsonPath), "app.json should exist");

      const appJson = JSON.parse(await Deno.readTextFile(appJsonPath));
      assertEquals(
        appJson.dependencies,
        undefined,
        "Should have no dependencies without testApp",
      );
    });

    it("should create the generated code file", async () => {
      const projectDir = join(tempDir, "project_code_only");
      const code = `table 70000 "My Table" { }`;

      await createTempProjectForTest(projectDir, "CG-AL-E001", code, undefined);

      const codeFilePath = join(projectDir, "CG-AL-E001.al");
      assert(await exists(codeFilePath), "Code file should exist");

      const content = await Deno.readTextFile(codeFilePath);
      assertEquals(content, code);
    });
  });

  describe("With testApp", () => {
    it("should add test toolkit dependencies to app.json", async () => {
      const projectDir = join(tempDir, "project_with_tests");

      await createTempProjectForTest(
        projectDir,
        "CG-AL-E001",
        "// Generated AL code",
        testFilePath,
      );

      const appJsonPath = join(projectDir, "app.json");
      const appJson = JSON.parse(await Deno.readTextFile(appJsonPath));

      assert(
        Array.isArray(appJson.dependencies),
        "Should have dependencies array",
      );
      assertEquals(
        appJson.dependencies.length,
        2,
        "Should have 2 test toolkit dependencies",
      );

      // Check Library Assert dependency
      const assertDep = appJson.dependencies.find(
        (d: { name: string }) => d.name === "Library Assert",
      );
      assert(assertDep, "Should include Library Assert dependency");
      assertEquals(assertDep.id, "dd0be2ea-f733-4d65-bb34-a28f4624fb14");
      assertEquals(assertDep.publisher, "Microsoft");

      // Check Tests-TestLibraries dependency
      const testLibDep = appJson.dependencies.find(
        (d: { name: string }) => d.name === "Tests-TestLibraries",
      );
      assert(testLibDep, "Should include Tests-TestLibraries dependency");
      assertEquals(testLibDep.id, "5d86850b-0d76-4eca-bd7b-951ad998e997");
    });

    it("should copy the test file to the project directory", async () => {
      const projectDir = join(tempDir, "project_copy_test");

      await createTempProjectForTest(
        projectDir,
        "CG-AL-E001",
        "// Generated AL code",
        testFilePath,
      );

      const copiedTestPath = join(projectDir, "MockTest.al");
      assert(await exists(copiedTestPath), "Test file should be copied");

      const content = await Deno.readTextFile(copiedTestPath);
      assertStringIncludes(content, 'codeunit 80001 "Mock Test"');
      assertStringIncludes(content, "Subtype = Test");
    });

    it("should handle non-existent test file gracefully", async () => {
      const projectDir = join(tempDir, "project_missing_test");

      // This should not throw, just skip copying
      await createTempProjectForTest(
        projectDir,
        "CG-AL-E001",
        "// Generated AL code",
        "/nonexistent/path/Test.al",
      );

      // Project should still be created
      assert(
        await exists(join(projectDir, "app.json")),
        "app.json should exist",
      );
      assert(
        await exists(join(projectDir, "CG-AL-E001.al")),
        "Code file should exist",
      );
    });
  });

  describe("ID Range for test codeunits", () => {
    it("should include extended ID range for test codeunits", async () => {
      const projectDir = join(tempDir, "project_id_range");

      await createTempProjectForTest(
        projectDir,
        "CG-AL-E001",
        "// Generated AL code",
        testFilePath,
      );

      const appJsonPath = join(projectDir, "app.json");
      const appJson = JSON.parse(await Deno.readTextFile(appJsonPath));

      assert(Array.isArray(appJson.idRanges), "Should have idRanges array");
      const range = appJson.idRanges[0];
      assertEquals(range.from, 70000);
      assertEquals(
        range.to,
        80099,
        "ID range should extend to 80099 for test codeunits",
      );
    });
  });
});
