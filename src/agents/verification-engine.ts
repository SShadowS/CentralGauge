/**
 * Verification Engine
 *
 * Handles AL project compilation and test execution for agent benchmarking.
 * Manages verification directory setup, app.json configuration, and test toolkit dependencies.
 */

import { basename, join } from "@std/path";
import {
  DEFAULT_CONTAINER_NAME,
  TEST_TOOLKIT_DEPENDENCIES,
} from "../constants.ts";
import { ensureDir } from "@std/fs";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("agent:verify");
import type {
  ALProject,
  CompilationError,
  TestCaseResult,
  TestResult,
} from "../container/types.ts";
import type { ContainerProvider } from "../container/interface.ts";
import {
  extractProjectRoot,
  extractTaskIdFromTestPath,
  findAllPrereqApps,
  type PrereqApp,
} from "../tasks/prereq-resolver.ts";

/**
 * Result of a verification operation
 */
export interface VerificationResult {
  success: boolean;
  message: string;
  failures?: string[];
  testResult?: TestResult;
}

/** Local alias for centralized test toolkit dependencies */
const TEST_TOOLKIT_DEPS = TEST_TOOLKIT_DEPENDENCIES;

/**
 * Handles compilation and test verification for AL projects.
 */
export class VerificationEngine {
  constructor(private containerProvider: ContainerProvider) {}

  /**
   * Run test verification for an agent-generated project.
   *
   * @param taskWorkingDir - Directory containing generated AL files
   * @param testFilePath - Path to the test file
   * @param debug - Enable debug logging
   */
  async runTestVerification(
    taskWorkingDir: string,
    testFilePath: string,
    debug?: boolean,
  ): Promise<{ success: boolean; testResult?: TestResult }> {
    if (debug) {
      log.info("Verifying with tests");
    }

    const verifyResult = await this.verifyWithTests(
      taskWorkingDir,
      testFilePath,
      debug,
    );

    if (!verifyResult.success) {
      if (debug) {
        log.debug("Test verification failed", {
          message: verifyResult.message,
          failures: verifyResult.failures,
        });
      }
      const result: { success: boolean; testResult?: TestResult } = {
        success: false,
      };
      if (verifyResult.testResult) {
        result.testResult = verifyResult.testResult;
      }
      return result;
    }

    if (debug) {
      log.debug("Test verification passed", { message: verifyResult.message });
    }
    const result: { success: boolean; testResult?: TestResult } = {
      success: true,
    };
    if (verifyResult.testResult) {
      result.testResult = verifyResult.testResult;
    }
    return result;
  }

  /**
   * Verify AL project by compiling and running tests.
   */
  async verifyWithTests(
    projectDir: string,
    testFilePath: string,
    debug?: boolean,
  ): Promise<VerificationResult> {
    const containerName = Deno.env.get("CENTRALGAUGE_CONTAINER_NAME") ||
      DEFAULT_CONTAINER_NAME;

    try {
      // Check for prereq apps based on task ID
      const taskId = extractTaskIdFromTestPath(testFilePath);
      const projectRoot = extractProjectRoot(testFilePath);
      const compiledPrereqs: PrereqApp[] = [];

      if (debug) {
        log.debug("Test verification context", {
          testFile: testFilePath,
          taskId,
          projectRoot,
        });
      }

      if (taskId) {
        const allPrereqs = await findAllPrereqApps(taskId, projectRoot);
        if (debug) {
          log.debug("Found prereqs", { count: allPrereqs.length });
        }

        for (const prereq of allPrereqs) {
          if (debug) {
            log.debug("Compiling prereq", { name: prereq.appJson["name"] });
          }

          // Build prereq project
          const prereqProject = await this.buildALProject(prereq.path);
          const prereqCompileResult = await this.containerProvider
            .compileProject(containerName, prereqProject);

          if (!prereqCompileResult.success) {
            return {
              success: false,
              message: `Prereq app compilation failed for ${
                prereq.appJson["name"]
              }`,
              failures: prereqCompileResult.errors.map(
                (e: CompilationError) =>
                  `${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`,
              ),
            };
          }

          compiledPrereqs.push({
            ...prereq,
            compiledAppPath: prereqCompileResult.artifactPath,
          });
        }
      }

      // Create isolated verification directory
      const verifyDir = await this.createVerificationDir(projectDir);
      if (debug) {
        log.debug("Verification directory", { path: verifyDir });
      }

      // Prepare app.json with test dependencies (and prereq dependency if exists)
      // Only add the last prereq as direct dependency - it will chain to others
      const lastPrereq = compiledPrereqs[compiledPrereqs.length - 1];
      const appResult = await this.prepareAppJsonForTests(
        projectDir,
        verifyDir,
        lastPrereq?.appJson,
      );
      if (!appResult.success) {
        return { success: false, message: appResult.error! };
      }

      // Copy source files
      await this.copyAlFiles(projectDir, verifyDir);

      // Copy test file
      const testResult = await this.copyTestFile(testFilePath, verifyDir);
      if (!testResult.success) {
        return { success: false, message: testResult.error! };
      }
      if (debug) {
        log.debug("Copied test file", { file: basename(testFilePath) });
      }

      // Build and verify project
      const project = await this.buildALProject(verifyDir);
      if (debug) {
        log.debug("AL project built", {
          sourceFiles: project.sourceFiles.length,
          testFiles: project.testFiles.length,
        });
      }

      // Get prereq app paths for runTests
      const prereqAppPaths = compiledPrereqs
        .map((p) => p.compiledAppPath)
        .filter((p): p is string => p !== undefined);

      return await this.compileAndRunTests(
        containerName,
        project,
        prereqAppPaths.length > 0 ? prereqAppPaths : undefined,
        debug,
      );
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      return { success: false, message: `Verification error: ${errorMessage}` };
    }
  }

  /**
   * Compile project and run tests.
   */
  async compileAndRunTests(
    containerName: string,
    project: ALProject,
    prereqAppPaths?: string[],
    debug?: boolean,
    testCodeunitId?: number,
  ): Promise<VerificationResult> {
    const compileResult = await this.containerProvider.compileProject(
      containerName,
      project,
    );

    if (!compileResult.success) {
      return {
        success: false,
        message: "Verification compilation failed",
        failures: compileResult.errors.map(
          (e: CompilationError) =>
            `${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`,
        ),
      };
    }

    // Publish prereq apps before running tests
    if (prereqAppPaths && prereqAppPaths.length > 0) {
      // Sweep orphan prereqs left by prior tasks (cross-task ID collision guard)
      if (this.containerProvider.cleanupOrphanedPrereqs) {
        await this.containerProvider.cleanupOrphanedPrereqs(
          containerName,
          prereqAppPaths,
        );
      }
      for (const prereqPath of prereqAppPaths) {
        if (debug) {
          log.debug("Publishing prereq", { path: prereqPath });
        }
        await this.containerProvider.publishApp(containerName, prereqPath);
      }
    }

    const testResult = await this.containerProvider.runTests(
      containerName,
      project,
      undefined, // appFilePath
      testCodeunitId,
    );

    // Debug: show full test output if enabled
    if (debug && testResult.output) {
      log.debug("Test output", { output: testResult.output });
    }

    if (testResult.success) {
      return {
        success: true,
        message:
          `All tests passed! (${testResult.passedTests}/${testResult.totalTests})`,
        testResult,
      };
    }

    const failures = testResult.results
      .filter((r: TestCaseResult) => !r.passed)
      .map((r: TestCaseResult) => `${r.name}: ${r.error || "Failed"}`);

    return {
      success: false,
      message:
        `Tests failed: ${testResult.failedTests} of ${testResult.totalTests} tests failed`,
      failures,
      testResult,
    };
  }

  /**
   * Build an ALProject structure from a directory.
   */
  async buildALProject(projectDir: string): Promise<ALProject> {
    const appJsonPath = join(projectDir, "app.json");
    const appJsonContent = await Deno.readTextFile(appJsonPath);
    const appJson = JSON.parse(appJsonContent);

    // Find all .al files in the directory
    const sourceFiles: string[] = [];
    const testFiles: string[] = [];

    for await (const entry of Deno.readDir(projectDir)) {
      if (entry.isFile && entry.name.endsWith(".al")) {
        const filePath = join(projectDir, entry.name);
        // Test files typically have "Test" in the name
        const isTestFile = entry.name.toLowerCase().includes("test") ||
          entry.name.toLowerCase().includes(".test.");

        if (isTestFile) {
          testFiles.push(filePath);
        } else {
          sourceFiles.push(filePath);
        }
      }
    }

    return {
      path: projectDir,
      appJson,
      sourceFiles,
      testFiles,
    };
  }

  /**
   * Create an isolated verification directory.
   */
  private async createVerificationDir(projectDir: string): Promise<string> {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const relativeVerifyDir = join(
      projectDir,
      "..",
      `verify-${timestamp}-${random}`,
    );

    // Ensure absolute path for PowerShell compilation
    const verifyDir =
      relativeVerifyDir.match(/^[A-Z]:/i) || relativeVerifyDir.startsWith("/")
        ? relativeVerifyDir
        : join(Deno.cwd(), relativeVerifyDir);

    await ensureDir(verifyDir);
    return verifyDir;
  }

  /**
   * Prepare app.json with test toolkit dependencies.
   */
  private async prepareAppJsonForTests(
    projectDir: string,
    verifyDir: string,
    prereqAppJson?: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    const appJsonPath = join(projectDir, "app.json");

    try {
      const appJsonContent = await Deno.readTextFile(appJsonPath);
      const appJson = JSON.parse(appJsonContent);

      // Add Test Toolkit dependencies if not present
      if (!appJson.dependencies) {
        appJson.dependencies = [];
      }
      for (const dep of TEST_TOOLKIT_DEPS) {
        const depExists = appJson.dependencies.some(
          (d: { id: string }) => d.id === dep.id,
        );
        if (!depExists) {
          appJson.dependencies.push(dep);
        }
      }

      // Add prereq app as dependency if provided
      if (prereqAppJson) {
        const prereqId = prereqAppJson["id"] as string;
        const prereqExists = appJson.dependencies.some(
          (d: { id: string }) => d.id === prereqId,
        );
        if (!prereqExists) {
          appJson.dependencies.push({
            id: prereqId,
            name: prereqAppJson["name"] as string,
            publisher: prereqAppJson["publisher"] as string,
            version: prereqAppJson["version"] as string,
          });
        }
      }

      // Extend idRanges to include test codeunit range (80000-89999)
      if (!appJson.idRanges) {
        appJson.idRanges = [];
      }
      const hasTestRange = appJson.idRanges.some(
        (r: { from: number; to: number }) => r.from <= 80001 && r.to >= 80001,
      );
      if (!hasTestRange) {
        appJson.idRanges.push({ from: 80000, to: 89999 });
      }

      await Deno.writeTextFile(
        join(verifyDir, "app.json"),
        JSON.stringify(appJson, null, 2),
      );
      return { success: true };
    } catch {
      return { success: false, error: `No app.json found in ${projectDir}` };
    }
  }

  /**
   * Copy AL source files to verification directory.
   */
  private async copyAlFiles(
    projectDir: string,
    verifyDir: string,
  ): Promise<void> {
    for await (const entry of Deno.readDir(projectDir)) {
      if (entry.isFile && entry.name.endsWith(".al")) {
        const content = await Deno.readTextFile(join(projectDir, entry.name));
        await Deno.writeTextFile(join(verifyDir, entry.name), content);
      }
    }
  }

  /**
   * Copy test file to verification directory.
   */
  private async copyTestFile(
    testFilePath: string,
    verifyDir: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const testContent = await Deno.readTextFile(testFilePath);
      const testFileName = basename(testFilePath);
      await Deno.writeTextFile(join(verifyDir, testFileName), testContent);
      return { success: true };
    } catch {
      return { success: false, error: `Test file not found: ${testFilePath}` };
    }
  }
}
