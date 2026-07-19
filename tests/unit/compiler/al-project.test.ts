/**
 * Unit tests for ALProjectManager
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ALProjectManager } from "../../../src/compiler/al-project.ts";
import type { ALProject } from "../../../src/container/types.ts";
import { ResourceNotFoundError } from "../../../src/errors.ts";
import {
  cleanupTempDir,
  createTempDir,
  MockALCode,
} from "../../utils/test-helpers.ts";

describe("ALProjectManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("al-project-test");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("createProject()", () => {
    it("should create a new AL project with app.json", async () => {
      const projectPath = join(tempDir, "new-project");
      const config = {
        id: "12345678-1234-1234-1234-123456789012",
        name: "Test App",
        publisher: "Test Publisher",
        version: "1.0.0.0",
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [{ from: 50100, to: 50199 }],
      };

      const project = await ALProjectManager.createProject(projectPath, config);

      assertExists(project);
      assertEquals(project.path, projectPath);
      assertEquals(project.sourceFiles.length, 0);
      assertEquals(project.testFiles.length, 0);

      // Verify app.json was created
      const appJsonPath = join(projectPath, "app.json");
      const appJsonContent = await Deno.readTextFile(appJsonPath);
      const appJson = JSON.parse(appJsonContent);

      assertEquals(appJson.id, config.id);
      assertEquals(appJson.name, config.name);
      assertEquals(appJson.publisher, config.publisher);
      assertEquals(appJson.version, config.version);
      assertEquals(appJson.platform, config.platform);
      assertEquals(appJson.application, config.application);
      assertEquals(appJson.idRanges, config.idRanges);
    });

    it("should create project with default runtime and features", async () => {
      const projectPath = join(tempDir, "runtime-test");
      const config = {
        id: "00000000-0000-0000-0000-000000000000",
        name: "Runtime Test",
        publisher: "Test",
        version: "1.0.0.0",
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [{ from: 50000, to: 50099 }],
      };

      await ALProjectManager.createProject(projectPath, config);

      const appJsonPath = join(projectPath, "app.json");
      const appJson = JSON.parse(await Deno.readTextFile(appJsonPath));

      assertEquals(appJson.runtime, "15.0");
      assert(appJson.features.includes("NoImplicitWith"));
    });

    it("should create nested directories if needed", async () => {
      const projectPath = join(tempDir, "deep", "nested", "project");
      const config = {
        id: "00000000-0000-0000-0000-000000000000",
        name: "Nested Project",
        publisher: "Test",
        version: "1.0.0.0",
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [],
      };

      const project = await ALProjectManager.createProject(projectPath, config);

      assertExists(project);
      assertEquals(project.path, projectPath);
    });
  });

  describe("loadProject()", () => {
    it("should load an existing AL project", async () => {
      // Create a project structure
      const projectPath = join(tempDir, "existing-project");
      await Deno.mkdir(projectPath, { recursive: true });

      const appJson = {
        id: "test-id",
        name: "Test Project",
        publisher: "Test Publisher",
        version: "1.0.0.0",
        platform: "27.0.0.0",
        application: "27.0.0.0",
      };
      await Deno.writeTextFile(
        join(projectPath, "app.json"),
        JSON.stringify(appJson),
      );

      // Create a source file
      await Deno.writeTextFile(
        join(projectPath, "Codeunit.al"),
        MockALCode.codeunit,
      );

      const project = await ALProjectManager.loadProject(projectPath);

      assertExists(project);
      assertEquals(project.path, projectPath);
      assertEquals((project.appJson as { name: string }).name, "Test Project");
      assert(project.sourceFiles.length >= 1);
    });

    it("should throw error if app.json is missing", async () => {
      const projectPath = join(tempDir, "no-app-json");
      await Deno.mkdir(projectPath, { recursive: true });

      await assertRejects(
        async () => {
          await ALProjectManager.loadProject(projectPath);
        },
        Error,
        "No app.json found",
      );
    });

    it("should throw a structured ResourceNotFoundError (not a raw SyntaxError) when app.json is malformed", async () => {
      const projectPath = join(tempDir, "malformed-app-json");
      await Deno.mkdir(projectPath, { recursive: true });
      await Deno.writeTextFile(
        join(projectPath, "app.json"),
        "{ this is not valid json",
      );

      let caught: unknown = null;
      try {
        await ALProjectManager.loadProject(projectPath);
      } catch (e) {
        caught = e;
      }
      assertExists(caught);
      assert(!(caught instanceof SyntaxError));
      assert(caught instanceof ResourceNotFoundError);
      assertEquals(
        (caught as ResourceNotFoundError).code,
        "RESOURCE_NOT_FOUND",
      );
      assertEquals((caught as ResourceNotFoundError).resourceId, "app.json");
    });

    it("should separate source files from test files", async () => {
      const projectPath = join(tempDir, "mixed-files");
      await Deno.mkdir(projectPath, { recursive: true });

      await Deno.writeTextFile(
        join(projectPath, "app.json"),
        JSON.stringify({ id: "test", name: "Test" }),
      );

      // Create source file
      await Deno.writeTextFile(
        join(projectPath, "MyCodeunit.al"),
        MockALCode.codeunit,
      );

      // Create test file (contains "Test" in name)
      await Deno.writeTextFile(
        join(projectPath, "MyCodeunitTest.al"),
        'codeunit 50101 "My Codeunit Test" { }',
      );

      const project = await ALProjectManager.loadProject(projectPath);

      // Source files should exclude Test files
      const sourceFileNames = project.sourceFiles.map((f) =>
        f.split(/[\\/]/).pop()
      );
      const testFileNames = project.testFiles.map((f) =>
        f.split(/[\\/]/).pop()
      );

      assert(!sourceFileNames.includes("MyCodeunitTest.al"));
      assert(testFileNames.includes("MyCodeunitTest.al"));
    });

    it("should find files in subdirectories", async () => {
      const projectPath = join(tempDir, "nested-files");
      const srcDir = join(projectPath, "src");
      await Deno.mkdir(srcDir, { recursive: true });

      await Deno.writeTextFile(
        join(projectPath, "app.json"),
        JSON.stringify({ id: "test", name: "Test" }),
      );

      await Deno.writeTextFile(
        join(srcDir, "NestedCodeunit.al"),
        MockALCode.codeunit,
      );

      const project = await ALProjectManager.loadProject(projectPath);

      assert(project.sourceFiles.length >= 1);
      assert(
        project.sourceFiles.some((f) => f.includes("NestedCodeunit.al")),
      );
    });
  });

  describe("validateProject()", () => {
    it("should return no issues for valid project", async () => {
      const projectPath = join(tempDir, "valid-project");
      await Deno.mkdir(projectPath, { recursive: true });

      await Deno.writeTextFile(
        join(projectPath, "app.json"),
        JSON.stringify({
          id: "test-id",
          name: "Test",
          publisher: "Publisher",
          version: "1.0.0.0",
          platform: "27.0.0.0",
          application: "27.0.0.0",
        }),
      );

      await Deno.writeTextFile(
        join(projectPath, "Source.al"),
        MockALCode.codeunit,
      );

      const project = await ALProjectManager.loadProject(projectPath);
      const issues = await ALProjectManager.validateProject(project);

      assertEquals(issues.length, 0);
    });

    it("should detect missing app.json", async () => {
      const project: ALProject = {
        path: tempDir,
        appJson: null as unknown as object,
        sourceFiles: [],
        testFiles: [],
      };

      const issues = await ALProjectManager.validateProject(project);

      assert(issues.includes("Missing app.json"));
    });

    it("should detect missing required fields in app.json", async () => {
      const project: ALProject = {
        path: tempDir,
        appJson: {
          id: "test-id",
          name: "Test",
          // Missing: publisher, version, platform, application
        },
        sourceFiles: [],
        testFiles: [],
      };

      const issues = await ALProjectManager.validateProject(project);

      assert(issues.some((i) => i.includes("publisher")));
      assert(issues.some((i) => i.includes("version")));
      assert(issues.some((i) => i.includes("platform")));
      assert(issues.some((i) => i.includes("application")));
    });

    it("should detect missing source files", async () => {
      const project: ALProject = {
        path: tempDir,
        appJson: {
          id: "test",
          name: "Test",
          publisher: "Pub",
          version: "1.0.0.0",
          platform: "27.0.0.0",
          application: "27.0.0.0",
        },
        sourceFiles: [join(tempDir, "NonExistent.al")],
        testFiles: [],
      };

      const issues = await ALProjectManager.validateProject(project);

      assert(issues.some((i) => i.includes("Source file not found")));
    });

    it("should detect missing test files", async () => {
      const project: ALProject = {
        path: tempDir,
        appJson: {
          id: "test",
          name: "Test",
          publisher: "Pub",
          version: "1.0.0.0",
          platform: "27.0.0.0",
          application: "27.0.0.0",
        },
        sourceFiles: [],
        testFiles: [join(tempDir, "NonExistentTest.al")],
      };

      const issues = await ALProjectManager.validateProject(project);

      assert(issues.some((i) => i.includes("Test file not found")));
    });
  });

  describe("getProjectInfo()", () => {
    it("should format project info correctly", () => {
      const project: ALProject = {
        path: "/test",
        appJson: {
          name: "My App",
          version: "2.1.0.0",
          publisher: "Contoso",
        },
        sourceFiles: [],
        testFiles: [],
      };

      const info = ALProjectManager.getProjectInfo(project);

      assertEquals(info, "My App v2.1.0.0 by Contoso");
    });

    it("should handle missing fields gracefully", () => {
      const project: ALProject = {
        path: "/test",
        appJson: {},
        sourceFiles: [],
        testFiles: [],
      };

      const info = ALProjectManager.getProjectInfo(project);

      assertEquals(info, "Unknown v0.0.0 by Unknown");
    });

    it("should handle partial app.json", () => {
      const project: ALProject = {
        path: "/test",
        appJson: {
          name: "Partial App",
        },
        sourceFiles: [],
        testFiles: [],
      };

      const info = ALProjectManager.getProjectInfo(project);

      assertEquals(info, "Partial App v0.0.0 by Unknown");
    });
  });

  describe("copyProject()", () => {
    it("should copy all files to destination", async () => {
      // Create source project
      const sourcePath = join(tempDir, "source");
      const destPath = join(tempDir, "dest");
      await Deno.mkdir(sourcePath, { recursive: true });

      await Deno.writeTextFile(
        join(sourcePath, "app.json"),
        JSON.stringify({ id: "test", name: "Test" }),
      );
      await Deno.writeTextFile(
        join(sourcePath, "Codeunit.al"),
        MockALCode.codeunit,
      );

      await ALProjectManager.copyProject(sourcePath, destPath);

      // Verify files were copied
      const destAppJson = await Deno.readTextFile(join(destPath, "app.json"));
      const destCodeunit = await Deno.readTextFile(
        join(destPath, "Codeunit.al"),
      );

      assertEquals(JSON.parse(destAppJson).name, "Test");
      assert(destCodeunit.includes("codeunit 50100"));
    });

    it("should copy subdirectories recursively", async () => {
      const sourcePath = join(tempDir, "source-nested");
      const destPath = join(tempDir, "dest-nested");
      const subDir = join(sourcePath, "src", "codeunits");
      await Deno.mkdir(subDir, { recursive: true });

      await Deno.writeTextFile(
        join(sourcePath, "app.json"),
        "{}",
      );
      await Deno.writeTextFile(
        join(subDir, "MyCodeunit.al"),
        MockALCode.codeunit,
      );

      await ALProjectManager.copyProject(sourcePath, destPath);

      const copiedFile = await Deno.readTextFile(
        join(destPath, "src", "codeunits", "MyCodeunit.al"),
      );
      assert(copiedFile.includes("codeunit 50100"));
    });

    it("should create destination directory if not exists", async () => {
      const sourcePath = join(tempDir, "source-create");
      const destPath = join(tempDir, "new", "deep", "dest");
      await Deno.mkdir(sourcePath, { recursive: true });

      await Deno.writeTextFile(join(sourcePath, "file.txt"), "content");

      await ALProjectManager.copyProject(sourcePath, destPath);

      const content = await Deno.readTextFile(join(destPath, "file.txt"));
      assertEquals(content, "content");
    });
  });
});

describe("File filtering logic", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir("file-filter-test");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("should only include .al files", async () => {
    const projectPath = join(tempDir, "extension-test");
    await Deno.mkdir(projectPath, { recursive: true });

    await Deno.writeTextFile(
      join(projectPath, "app.json"),
      JSON.stringify({ id: "test", name: "Test" }),
    );
    await Deno.writeTextFile(join(projectPath, "code.al"), "// AL code");
    await Deno.writeTextFile(join(projectPath, "readme.md"), "# Readme");
    await Deno.writeTextFile(join(projectPath, "script.ps1"), "# PowerShell");

    const project = await ALProjectManager.loadProject(projectPath);

    // Should only have the .al file
    assertEquals(project.sourceFiles.length, 1);
    assertExists(project.sourceFiles[0]);
    assert(project.sourceFiles[0].endsWith(".al"));
  });

  it("should handle empty directories", async () => {
    const projectPath = join(tempDir, "empty-dir");
    await Deno.mkdir(projectPath, { recursive: true });

    await Deno.writeTextFile(
      join(projectPath, "app.json"),
      JSON.stringify({ id: "test", name: "Test" }),
    );

    const project = await ALProjectManager.loadProject(projectPath);

    assertEquals(project.sourceFiles.length, 0);
    assertEquals(project.testFiles.length, 0);
  });

  it("should handle case-insensitive extensions", async () => {
    const projectPath = join(tempDir, "case-test");
    await Deno.mkdir(projectPath, { recursive: true });

    await Deno.writeTextFile(
      join(projectPath, "app.json"),
      JSON.stringify({ id: "test", name: "Test" }),
    );
    await Deno.writeTextFile(join(projectPath, "lower.al"), "// lower");
    await Deno.writeTextFile(join(projectPath, "upper.AL"), "// upper");

    const project = await ALProjectManager.loadProject(projectPath);

    // Both should be found (extension matching is case-insensitive)
    assertEquals(project.sourceFiles.length, 2);
  });
});
