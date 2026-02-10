#!/usr/bin/env -S deno run --allow-all
/**
 * AL Tools MCP Server
 *
 * Provides AL compilation and testing tools for Claude Code agents
 * via the Model Context Protocol (MCP).
 *
 * Tools:
 * - al_compile: Compile AL code in a BC container
 * - al_test: Run AL tests in a BC container
 * - al_container_status: Check container health
 */

import { basename, dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseYaml } from "@std/yaml";

/** Get the CentralGauge project root from the script location */
function getProjectRoot(): string {
  const scriptPath = fromFileUrl(import.meta.url);
  // Script is at mcp/al-tools-server.ts, so project root is one level up
  return dirname(dirname(scriptPath));
}
import { BcContainerProvider } from "../src/container/bc-container-provider.ts";
import type { ALProject } from "../src/container/types.ts";

// =============================================================================
// MCP Protocol Types
// =============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// =============================================================================
// Server State
// =============================================================================

const containerProvider = new BcContainerProvider();
const DEFAULT_CONTAINER = "Cronus27";

// Initialize credentials from environment variables
const containerUsername = Deno.env.get("CENTRALGAUGE_CONTAINER_USERNAME");
const containerPassword = Deno.env.get("CENTRALGAUGE_CONTAINER_PASSWORD");
if (containerUsername && containerPassword) {
  containerProvider.setCredentials(DEFAULT_CONTAINER, {
    username: containerUsername,
    password: containerPassword,
  });
  console.error(
    `[MCP] Credentials configured for container: ${DEFAULT_CONTAINER}`,
  );
} else {
  console.error(
    `[MCP] Warning: No credentials found in environment. Using defaults.`,
  );
}

/**
 * Workspace path mapping for sandbox mode.
 * Maps container paths (e.g., C:\workspace) to host paths.
 */
let workspaceMapping: { containerPath: string; hostPath: string } | null = null;

/**
 * Translate a path from container format to host format.
 * Used in sandbox mode where the container uses C:\workspace but the host
 * needs the actual path to access files.
 */
function translatePath(inputPath: string): string {
  if (!workspaceMapping) return inputPath;

  // Handle various path formats from container (forward/back slashes)
  const normalized = inputPath.replace(/\//g, "\\");
  const containerNormalized = workspaceMapping.containerPath.replace(
    /\//g,
    "\\",
  );

  if (normalized.toLowerCase().startsWith(containerNormalized.toLowerCase())) {
    const relativePart = normalized.substring(containerNormalized.length);
    const translated = workspaceMapping.hostPath + relativePart;
    console.error(`[MCP] Path translation: ${inputPath} → ${translated}`);
    return translated;
  }
  return inputPath;
}

/** Log timing for performance analysis - writes to both stderr and a log file */
function logTiming(label: string, startTime: number): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const message = `[TIMING] ${label}: ${elapsed}s`;
  console.error(message);
  // Also append to timing log file for visibility
  try {
    Deno.writeTextFileSync("timing.log", message + "\n", { append: true });
  } catch {
    // Ignore file write errors
  }
}

/** Debug log file for sandbox mode diagnostics */
const DEBUG_LOG_FILE = "sandbox-debug.log";

/** Write debug message to file for sandbox diagnostics */
function debugLog(context: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  let logEntry = `[${timestamp}] [${context}] ${message}`;
  if (data !== undefined) {
    logEntry += `\n  Data: ${
      JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")
    }`;
  }
  logEntry += "\n";

  console.error(logEntry.trim()); // Also to stderr
  try {
    Deno.writeTextFileSync(DEBUG_LOG_FILE, logEntry, { append: true });
  } catch {
    // Ignore file write errors
  }
}

/**
 * Cache for compiled prereq apps to avoid recompiling on every al_verify_task call.
 * Key: taskId, Value: array of compiled prereq app paths
 */
const prereqCache = new Map<
  string,
  Array<{
    path: string;
    appJson: AppJson;
    compiledAppPath: string;
  }>
>();

/**
 * Cache for published prereq apps to avoid republishing on every al_verify_task call.
 * Key: "containerName:appId", Value: true (published)
 * Prereqs never change during a run, so once published they stay published.
 */
const publishedPrereqCache = new Set<string>();

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: "al_compile",
    description:
      "Compile AL code in a Business Central container. Returns compilation result with errors/warnings. " +
      "The projectDir must contain app.json and .al source files.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Directory containing AL files and app.json. Must be an absolute path.",
        },
        containerName: {
          type: "string",
          description:
            `Name of the BC container to use. Default: ${DEFAULT_CONTAINER}`,
        },
        target: {
          type: "string",
          enum: ["Cloud", "OnPrem"],
          description:
            "App target. Use 'OnPrem' for features like HttpClient, NavApp. Default: Cloud.",
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "al_test",
    description:
      "Run AL tests in a Business Central container. Compiles and runs tests from the project directory.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Directory containing AL test files and app.json. Must be an absolute path.",
        },
        containerName: {
          type: "string",
          description:
            `Name of the BC container to use. Default: ${DEFAULT_CONTAINER}`,
        },
      },
      required: ["projectDir"],
    },
  },
  {
    name: "al_container_status",
    description: "Check the status of a Business Central container.",
    inputSchema: {
      type: "object",
      properties: {
        containerName: {
          type: "string",
          description:
            `Name of the BC container to check. Default: ${DEFAULT_CONTAINER}`,
        },
      },
    },
  },
  {
    name: "al_verify",
    description:
      "Internal tool for test verification. Copies agent code to isolated directory, " +
      "adds test file, compiles with Test Toolkit dependencies, and runs tests.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Agent's compiled project directory containing AL files and app.json.",
        },
        testFile: {
          type: "string",
          description:
            "Absolute path to the test file to copy into the project.",
        },
        containerName: {
          type: "string",
          description:
            `Name of the BC container to use. Default: ${DEFAULT_CONTAINER}`,
        },
        target: {
          type: "string",
          enum: ["Cloud", "OnPrem"],
          description:
            "App target. Use 'OnPrem' for features like HttpClient, NavApp. Default: Cloud.",
        },
      },
      required: ["projectDir", "testFile"],
    },
  },
  {
    name: "al_verify_task",
    description: "Compile AL code and run tests for a benchmark task. " +
      "Looks up the test file by task ID, so the agent cannot read or modify tests. " +
      "Returns test results with pass/fail status and error messages.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description:
            "Directory containing AL files and app.json. Must be an absolute path.",
        },
        taskId: {
          type: "string",
          description: "Task ID (e.g., 'CG-AL-E007') to look up the test file.",
        },
        containerName: {
          type: "string",
          description:
            `Name of the BC container to use. Default: ${DEFAULT_CONTAINER}`,
        },
        target: {
          type: "string",
          enum: ["Cloud", "OnPrem"],
          description:
            "App target. Use 'OnPrem' for features like HttpClient, NavApp. Default: Cloud.",
        },
      },
      required: ["projectDir", "taskId"],
    },
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build ALProject from a directory path
 * @param includeTestFiles - Whether to include test files (default: true)
 */
async function buildALProject(
  projectDir: string,
  includeTestFiles = true,
): Promise<ALProject> {
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
        if (includeTestFiles) {
          testFiles.push(filePath);
        }
        // Skip test files from sourceFiles to avoid compilation errors
        // (test files require Test Toolkit dependencies)
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

// =============================================================================
// App.json Helpers for Test Verification
// =============================================================================

interface AppJson {
  dependencies?: Array<
    { id: string; name: string; publisher: string; version: string }
  >;
  idRanges?: Array<{ from: number; to: number }>;
  [key: string]: unknown;
}

/** Test Toolkit dependencies required for running AL tests */
const TEST_TOOLKIT_DEPS = [
  {
    id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
    name: "Library Assert",
    publisher: "Microsoft",
    version: "27.0.0.0",
  },
  {
    id: "e7320ebb-08b3-4406-b1ec-b4927d3e280b",
    name: "Any",
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

/**
 * Add Test Toolkit dependencies to app.json if not already present.
 */
function ensureTestDependencies(appJson: AppJson): void {
  if (!appJson.dependencies) {
    appJson.dependencies = [];
  }

  for (const dep of TEST_TOOLKIT_DEPS) {
    const exists = appJson.dependencies.some((d) => d.id === dep.id);
    if (!exists) {
      appJson.dependencies.push(dep);
    }
  }
}

/**
 * Extend idRanges to include test codeunit range (80000-89999) if not present.
 */
function ensureTestCodeunitRange(appJson: AppJson): void {
  if (!appJson.idRanges) {
    appJson.idRanges = [];
  }
  const hasTestRange = appJson.idRanges.some(
    (r) => r.from <= 80001 && r.to >= 80001,
  );
  if (!hasTestRange) {
    appJson.idRanges.push({ from: 80000, to: 89999 });
  }
}

/**
 * Extract task ID from a test file path.
 * e.g., "tests/al/easy/CG-AL-E002.Test.al" -> "CG-AL-E002"
 */
function extractTaskIdFromTestPath(testFilePath: string): string | null {
  const fileName = basename(testFilePath);
  const match = fileName.match(/^(CG-AL-[A-Z]\d+)/);
  return match?.[1] ?? null;
}

/**
 * Extract project root from a test file path.
 * Looks for the "tests/al/" marker in the path and returns the parent.
 */
function extractProjectRoot(testFilePath: string): string {
  const normalized = testFilePath.replace(/\\/g, "/");
  const testsAlIndex = normalized.indexOf("tests/al/");
  if (testsAlIndex > 0) {
    return normalized.substring(0, testsAlIndex);
  }
  return Deno.cwd();
}

/**
 * Find prereq app directory for a given task ID.
 * Checks for tests/al/dependencies/{task-id}/ directory.
 */
async function findPrereqApp(
  taskId: string,
  projectRoot: string,
): Promise<{ path: string; appJson: AppJson } | null> {
  // Resolve path relative to project root
  const prereqDir = join(
    projectRoot,
    "tests",
    "al",
    "dependencies",
    taskId,
  );

  try {
    const stat = await Deno.stat(prereqDir);
    if (!stat.isDirectory) return null;

    // Check for app.json
    const appJsonPath = join(prereqDir, "app.json");
    const appJsonContent = await Deno.readTextFile(appJsonPath);
    const appJson = JSON.parse(appJsonContent) as AppJson;

    return { path: prereqDir, appJson };
  } catch {
    return null;
  }
}

/**
 * Find prereq app by its app ID (used for resolving dependencies).
 */
async function findPrereqAppById(
  appId: string,
  projectRoot: string,
): Promise<{ path: string; appJson: AppJson } | null> {
  const depsDir = join(projectRoot, "tests", "al", "dependencies");

  try {
    for await (const entry of Deno.readDir(depsDir)) {
      if (!entry.isDirectory) continue;

      const appJsonPath = join(depsDir, entry.name, "app.json");
      try {
        const content = await Deno.readTextFile(appJsonPath);
        const appJson = JSON.parse(content) as AppJson;
        if (appJson["id"] === appId) {
          return { path: join(depsDir, entry.name), appJson };
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Find all prereq apps needed for a task, in dependency order.
 * Returns array with dependencies first, then the main prereq.
 */
async function findAllPrereqApps(
  taskId: string,
  projectRoot: string,
): Promise<Array<{ path: string; appJson: AppJson }>> {
  const result: Array<{ path: string; appJson: AppJson }> = [];
  const visited = new Set<string>();

  async function collectDeps(
    prereq: { path: string; appJson: AppJson },
  ): Promise<void> {
    const appId = prereq.appJson["id"] as string;
    if (visited.has(appId)) return;
    visited.add(appId);

    // First, process dependencies
    const deps = prereq.appJson.dependencies || [];
    for (const dep of deps) {
      // Check if this dependency is one of our prereq apps
      const depPrereq = await findPrereqAppById(dep.id, projectRoot);
      if (depPrereq) {
        await collectDeps(depPrereq);
      }
    }

    // Then add this prereq
    result.push(prereq);
  }

  const mainPrereq = await findPrereqApp(taskId, projectRoot);
  if (mainPrereq) {
    await collectDeps(mainPrereq);
  }

  return result;
}

/**
 * Add prereq app as dependency to app.json.
 */
function ensurePrereqDependency(
  appJson: AppJson,
  prereqAppJson: AppJson,
): void {
  if (!appJson.dependencies) {
    appJson.dependencies = [];
  }

  const prereqId = prereqAppJson["id"] as string;
  const exists = appJson.dependencies.some((d) => d.id === prereqId);
  if (!exists) {
    appJson.dependencies.push({
      id: prereqId,
      name: prereqAppJson["name"] as string,
      publisher: prereqAppJson["publisher"] as string,
      version: prereqAppJson["version"] as string,
    });
  }
}

/**
 * Prepare app.json for test verification by adding dependencies and ID ranges.
 */
// Fixed UUID for benchmark apps - enables ForceSync to update in place
// This eliminates the need for PRECLEAN step (~13s savings per test run)
const BENCHMARK_APP_ID = "00000000-cafe-0000-0000-be4c00decade";

async function prepareAppJsonForTesting(
  sourceDir: string,
  targetDir: string,
  prereqAppJson?: AppJson,
  appTarget?: "Cloud" | "OnPrem",
): Promise<{ success: true } | { success: false; message: string }> {
  const appJsonPath = join(sourceDir, "app.json");
  try {
    const appJsonContent = await Deno.readTextFile(appJsonPath);
    const appJson = JSON.parse(appJsonContent) as AppJson;

    // Force fixed app ID for ForceSync optimization
    appJson["id"] = BENCHMARK_APP_ID;

    // Add prereq dependency if provided
    if (prereqAppJson) {
      ensurePrereqDependency(appJson, prereqAppJson);
    }

    // Set target if provided (OnPrem required for HttpClient, NavApp, etc.)
    if (appTarget) {
      appJson["target"] = appTarget;
    }

    ensureTestDependencies(appJson);
    ensureTestCodeunitRange(appJson);

    await Deno.writeTextFile(
      join(targetDir, "app.json"),
      JSON.stringify(appJson, null, 2),
    );
    return { success: true };
  } catch {
    return { success: false, message: `No app.json found in ${sourceDir}` };
  }
}

/**
 * Copy all .al files from source to target directory (excluding test files).
 */
async function copyAlFilesToDir(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  for await (const entry of Deno.readDir(sourceDir)) {
    if (entry.isFile && entry.name.endsWith(".al")) {
      const content = await Deno.readTextFile(join(sourceDir, entry.name));
      await Deno.writeTextFile(join(targetDir, entry.name), content);
    }
  }
}

/**
 * Copy test file to target directory.
 */
async function copyTestFile(
  testFilePath: string,
  targetDir: string,
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    const testContent = await Deno.readTextFile(testFilePath);
    const testFileName = basename(testFilePath);
    await Deno.writeTextFile(join(targetDir, testFileName), testContent);
    return { success: true };
  } catch {
    return { success: false, message: `Test file not found: ${testFilePath}` };
  }
}

/**
 * Copy support files (e.g., RDLC layouts, images) for a task into the target directory.
 * Looks for files in tests/al/support-files/{task-id}/ and copies them all.
 */
async function copySupportFilesForTask(
  taskId: string,
  projectRoot: string,
  targetDir: string,
): Promise<void> {
  const supportDir = join(
    projectRoot,
    "tests",
    "al",
    "support-files",
    taskId,
  );
  try {
    const stat = await Deno.stat(supportDir);
    if (!stat.isDirectory) return;
  } catch {
    // No support-files directory for this task
    return;
  }

  let copiedCount = 0;
  for await (const entry of Deno.readDir(supportDir)) {
    if (entry.isFile) {
      await Deno.copyFile(
        join(supportDir, entry.name),
        join(targetDir, entry.name),
      );
      copiedCount++;
    }
  }

  if (copiedCount > 0) {
    debugLog("al_verify", "Support files copied", {
      taskId,
      supportDir,
      targetDir,
      copiedCount,
    });
  }
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Find app.json in directory or immediate subdirectories.
 * Returns the directory containing app.json, or null if not found.
 */
async function findProjectDir(baseDir: string): Promise<string | null> {
  // First check if app.json exists directly in baseDir
  const directPath = join(baseDir, "app.json");
  try {
    await Deno.stat(directPath);
    return baseDir;
  } catch {
    // Not in root, search subdirectories
  }

  // Search immediate subdirectories
  try {
    for await (const entry of Deno.readDir(baseDir)) {
      if (entry.isDirectory) {
        const subPath = join(baseDir, entry.name, "app.json");
        try {
          await Deno.stat(subPath);
          return join(baseDir, entry.name);
        } catch {
          // Not here, continue
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return null;
}

async function handleAlCompile(params: {
  projectDir: string;
  containerName?: string;
  target?: "Cloud" | "OnPrem";
}): Promise<{
  success: boolean;
  message: string;
  errors?: string[];
  warnings?: string[];
  artifactPath?: string;
}> {
  const containerName = params.containerName || DEFAULT_CONTAINER;
  // Translate path for sandbox mode (e.g., C:\workspace → host path)
  const inputDir = translatePath(params.projectDir);

  try {
    // Find project directory (checks subdirectories if needed)
    const projectDir = await findProjectDir(inputDir);
    if (!projectDir) {
      const pathInfo = inputDir !== params.projectDir
        ? ` (translated from ${params.projectDir})`
        : "";
      return {
        success: false,
        message:
          `No app.json found in ${inputDir}${pathInfo} or its subdirectories. Create an app.json manifest first.`,
      };
    }

    // Build ALProject (exclude test files from compilation)
    // Test files require Test Toolkit dependencies that the app may not have
    const project = await buildALProject(projectDir, false);

    // Set target if provided (OnPrem required for HttpClient, NavApp, etc.)
    if (params.target) {
      (project.appJson as AppJson)["target"] = params.target;
    }

    // Compile
    const result = await containerProvider.compileProject(
      containerName,
      project,
    );

    if (result.success) {
      const response: {
        success: boolean;
        message: string;
        errors?: string[];
        warnings?: string[];
        artifactPath?: string;
      } = {
        success: true,
        message: `Compilation successful! Duration: ${result.duration}ms`,
        warnings: result.warnings.map(
          (w) => `${w.file}(${w.line},${w.column}): ${w.code} - ${w.message}`,
        ),
      };
      if (result.artifactPath) {
        response.artifactPath = result.artifactPath;
      }
      return response;
    } else {
      return {
        success: false,
        message: "Compilation failed with errors",
        errors: result.errors.map(
          (e) => `${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`,
        ),
        warnings: result.warnings.map(
          (w) => `${w.file}(${w.line},${w.column}): ${w.code} - ${w.message}`,
        ),
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Compilation error: ${errorMessage}`,
    };
  }
}

async function handleAlTest(params: {
  projectDir: string;
  containerName?: string;
}): Promise<{
  success: boolean;
  message: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  failures?: string[];
}> {
  const containerName = params.containerName || DEFAULT_CONTAINER;
  // Translate path for sandbox mode (e.g., C:\workspace → host path)
  const inputDir = translatePath(params.projectDir);

  try {
    // Find project directory (checks subdirectories if needed)
    const projectDir = await findProjectDir(inputDir);
    if (!projectDir) {
      const pathInfo = inputDir !== params.projectDir
        ? ` (translated from ${params.projectDir})`
        : "";
      return {
        success: false,
        message:
          `No app.json found in ${inputDir}${pathInfo} or its subdirectories. Create an app.json manifest first.`,
      };
    }

    // Build ALProject
    const project = await buildALProject(projectDir);

    // Run tests
    const result = await containerProvider.runTests(containerName, project);

    if (result.success) {
      return {
        success: true,
        message:
          `All tests passed! (${result.passedTests}/${result.totalTests})`,
        totalTests: result.totalTests,
        passed: result.passedTests,
        failed: result.failedTests,
      };
    } else {
      const failures = result.results
        .filter((r) => !r.passed)
        .map((r) => `${r.name}: ${r.error || "Failed"}`);

      return {
        success: false,
        message:
          `Tests failed: ${result.failedTests} of ${result.totalTests} tests failed`,
        totalTests: result.totalTests,
        passed: result.passedTests,
        failed: result.failedTests,
        failures,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Test execution error: ${errorMessage}`,
    };
  }
}

async function handleContainerStatus(params: {
  containerName?: string;
}): Promise<{ status: string; healthy: boolean; message: string }> {
  const containerName = params.containerName || DEFAULT_CONTAINER;

  try {
    const status = await containerProvider.status(containerName);
    const healthy = status.health === "healthy";
    return {
      status: status.health,
      healthy,
      message: healthy
        ? `Container ${containerName} is running and healthy`
        : `Container ${containerName} is ${status.health} (running: ${status.isRunning})`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      healthy: false,
      message: `Failed to get container status: ${errorMessage}`,
    };
  }
}

interface VerifyResult {
  success: boolean;
  message: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  failures?: string[];
  compileErrors?: string[];
}

/**
 * Load testCodeunitId from task YAML for targeted test execution.
 * Returns undefined if task YAML not found or doesn't have testCodeunitId.
 */
async function loadTestCodeunitId(
  taskId: string,
  projectRoot: string,
): Promise<number | undefined> {
  // Parse difficulty from task ID (e.g., CG-AL-E007 -> E -> easy)
  const match = taskId.match(/^CG-AL-([EMH])\d+$/);
  if (!match) return undefined;

  const difficultyCode = match[1] as "E" | "M" | "H";
  const difficultyMap: Record<"E" | "M" | "H", string> = {
    E: "easy",
    M: "medium",
    H: "hard",
  };
  const difficulty = difficultyMap[difficultyCode];

  // Find task YAML file (pattern: tasks/{difficulty}/CG-AL-{ID}-*.yml)
  const tasksDir = join(projectRoot, "tasks", difficulty);
  try {
    for await (const entry of Deno.readDir(tasksDir)) {
      if (
        entry.isFile && entry.name.startsWith(taskId) &&
        entry.name.endsWith(".yml")
      ) {
        const yamlPath = join(tasksDir, entry.name);
        const content = await Deno.readTextFile(yamlPath);
        const manifest = parseYaml(content) as {
          expected?: { testCodeunitId?: number };
        };
        return manifest.expected?.testCodeunitId;
      }
    }
  } catch {
    // Directory doesn't exist or read error
  }
  return undefined;
}

/**
 * Load target from task YAML metadata for OnPrem features.
 * Returns undefined if task YAML not found or doesn't have metadata.target.
 */
async function loadTaskTarget(
  taskId: string,
  projectRoot: string,
): Promise<"Cloud" | "OnPrem" | undefined> {
  // Parse difficulty from task ID (e.g., CG-AL-M022 -> M -> medium)
  const match = taskId.match(/^CG-AL-([EMH])\d+$/);
  if (!match) return undefined;

  const difficultyCode = match[1] as "E" | "M" | "H";
  const difficultyMap: Record<"E" | "M" | "H", string> = {
    E: "easy",
    M: "medium",
    H: "hard",
  };
  const difficulty = difficultyMap[difficultyCode];

  // Find task YAML file (pattern: tasks/{difficulty}/CG-AL-{ID}-*.yml)
  const tasksDir = join(projectRoot, "tasks", difficulty);
  try {
    for await (const entry of Deno.readDir(tasksDir)) {
      if (
        entry.isFile && entry.name.startsWith(taskId) &&
        entry.name.endsWith(".yml")
      ) {
        const yamlPath = join(tasksDir, entry.name);
        const content = await Deno.readTextFile(yamlPath);
        const manifest = parseYaml(content) as {
          metadata?: { target?: "Cloud" | "OnPrem" };
        };
        return manifest.metadata?.target;
      }
    }
  } catch {
    // Directory doesn't exist or read error
  }
  return undefined;
}

/**
 * Resolve test file path from task ID.
 * Maps task ID prefixes to difficulty folders:
 * - E = easy (e.g., CG-AL-E007 -> tests/al/easy/CG-AL-E007.Test.al)
 * - M = medium
 * - H = hard
 */
async function resolveTestFileFromTaskId(
  taskId: string,
  projectRoot: string,
): Promise<
  { success: true; testFile: string } | { success: false; error: string }
> {
  // Parse the difficulty from task ID (e.g., CG-AL-E007 -> E -> easy)
  const match = taskId.match(/^CG-AL-([EMH])\d+$/);
  if (!match) {
    return {
      success: false,
      error:
        `Invalid task ID format: ${taskId}. Expected format like 'CG-AL-E007'`,
    };
  }

  const difficultyCode = match[1] as "E" | "M" | "H";
  const difficultyMap: Record<"E" | "M" | "H", string> = {
    E: "easy",
    M: "medium",
    H: "hard",
  };
  const difficulty = difficultyMap[difficultyCode];

  // Build the test file path
  const testFilePath = join(
    projectRoot,
    "tests",
    "al",
    difficulty,
    `${taskId}.Test.al`,
  );

  // Check if the file exists
  try {
    const stat = await Deno.stat(testFilePath);
    if (stat.isFile) {
      return { success: true, testFile: testFilePath };
    }
    return {
      success: false,
      error: `Test file is not a regular file: ${testFilePath}`,
    };
  } catch {
    return { success: false, error: `Test file not found: ${testFilePath}` };
  }
}

/**
 * Handle al_verify_task - compile and run tests using task ID to look up test file.
 * This prevents the agent from seeing or reading the test file directly.
 */
async function handleAlVerifyTask(params: {
  projectDir: string;
  taskId: string;
  containerName?: string;
  target?: "Cloud" | "OnPrem";
}): Promise<VerifyResult> {
  debugLog("al_verify_task", "Called with params", {
    projectDir: params.projectDir,
    taskId: params.taskId,
    containerName: params.containerName,
  });

  // Translate path for sandbox mode (e.g., C:\workspace → host path)
  const inputDir = translatePath(params.projectDir);
  debugLog("al_verify_task", "Path translation", {
    original: params.projectDir,
    translated: inputDir,
  });

  // Resolve the test file from the task ID
  // Use script location to find project root, not CWD (which may be agent workspace)
  const projectRoot = getProjectRoot();
  debugLog("al_verify_task", "Project root resolved", { projectRoot });

  const resolution = await resolveTestFileFromTaskId(
    params.taskId,
    projectRoot,
  );
  debugLog("al_verify_task", "Test file resolution", resolution);

  if (!resolution.success) {
    debugLog("al_verify_task", "FAILED: Test file not found");
    return { success: false, message: resolution.error };
  }

  // Load testCodeunitId from task YAML for targeted test execution
  const testCodeunitId = await loadTestCodeunitId(params.taskId, projectRoot);
  debugLog("al_verify_task", "Test codeunit ID loaded", { testCodeunitId });

  // Load target from task YAML if not explicitly provided
  const target = params.target ??
    await loadTaskTarget(params.taskId, projectRoot);

  // Delegate to handleAlVerify with the resolved test file path
  const verifyParams: {
    projectDir: string;
    testFile: string;
    containerName?: string;
    target?: "Cloud" | "OnPrem";
    testCodeunitId?: number;
  } = {
    projectDir: inputDir, // Use translated path
    testFile: resolution.testFile,
  };
  if (params.containerName !== undefined) {
    verifyParams.containerName = params.containerName;
  }
  if (target !== undefined) {
    verifyParams.target = target;
  }
  if (testCodeunitId !== undefined) {
    verifyParams.testCodeunitId = testCodeunitId;
  }
  return handleAlVerify(verifyParams);
}

/**
 * Verify agent code by running tests in an isolated directory.
 * This prevents the agent from seeing or modifying test files.
 */
async function handleAlVerify(params: {
  projectDir: string;
  testFile: string;
  containerName?: string;
  target?: "Cloud" | "OnPrem";
  testCodeunitId?: number;
}): Promise<VerifyResult> {
  debugLog("al_verify", "Starting verification", {
    projectDir: params.projectDir,
    testFile: params.testFile,
    testCodeunitId: params.testCodeunitId,
  });

  const containerName = params.containerName || DEFAULT_CONTAINER;
  const totalStart = Date.now();
  // Translate path for sandbox mode (e.g., C:\workspace → host path)
  // Note: handleAlVerifyTask already translates, but this handles direct calls
  const inputDir = translatePath(params.projectDir);

  try {
    // Find project directory (checks subdirectories if needed)
    const projectDir = await findProjectDir(inputDir);
    debugLog("al_verify", "Project directory lookup", {
      inputDir,
      projectDir: projectDir ?? "NOT FOUND",
    });

    if (!projectDir) {
      const pathInfo = inputDir !== params.projectDir
        ? ` (translated from ${params.projectDir})`
        : "";
      debugLog("al_verify", "FAILED: No app.json found");
      return {
        success: false,
        message:
          `No app.json found in ${inputDir}${pathInfo} or its subdirectories. Create an app.json manifest first.`,
      };
    }

    // 1. Check for prereq apps based on task ID (handles dependency chains)
    const prereqStart = Date.now();
    const taskId = extractTaskIdFromTestPath(params.testFile);
    const projectRoot = extractProjectRoot(params.testFile);
    let prereqApps: Array<{
      path: string;
      appJson: AppJson;
      compiledAppPath: string;
    }> = [];

    if (taskId) {
      debugLog("al_verify", "Checking for prereqs", { taskId, projectRoot });
      // Check cache first to avoid recompiling prereqs on every call
      const cachedPrereqs = prereqCache.get(taskId);
      if (cachedPrereqs) {
        debugLog("al_verify", "Using cached prereqs", {
          taskId,
          count: cachedPrereqs.length,
        });
        prereqApps = cachedPrereqs;
      } else {
        // Find all prereqs in dependency order
        const allPrereqs = await findAllPrereqApps(taskId, projectRoot);
        debugLog("al_verify", "Found prereqs", {
          taskId,
          count: allPrereqs.length,
          prereqs: allPrereqs.map((p) => ({
            path: p.path,
            name: p.appJson["name"],
          })),
        });

        for (const prereq of allPrereqs) {
          // Compile each prereq in order
          debugLog("al_verify", "Compiling prereq", {
            name: prereq.appJson["name"],
            path: prereq.path,
          });
          const prereqProject = await buildALProject(prereq.path, false);
          debugLog("al_verify", "Prereq project built", {
            name: prereq.appJson["name"],
            sourceFiles: prereqProject.sourceFiles.length,
          });
          const prereqCompileResult = await containerProvider.compileProject(
            containerName,
            prereqProject,
          );
          debugLog("al_verify", "Prereq compilation result", {
            name: prereq.appJson["name"],
            success: prereqCompileResult.success,
            artifactPath: prereqCompileResult.artifactPath,
            errorCount: prereqCompileResult.errors.length,
          });
          if (!prereqCompileResult.success) {
            debugLog("al_verify", "Prereq compilation FAILED", {
              name: prereq.appJson["name"],
              errors: prereqCompileResult.errors,
            });
            return {
              success: false,
              message: `Prereq app compilation failed for ${
                prereq.appJson["name"]
              }`,
              compileErrors: prereqCompileResult.errors.map(
                (e) =>
                  `${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`,
              ),
            };
          }
          if (prereqCompileResult.artifactPath) {
            prereqApps.push({
              path: prereq.path,
              appJson: prereq.appJson,
              compiledAppPath: prereqCompileResult.artifactPath,
            });
          }
        }

        // Cache the compiled prereqs for future calls
        if (prereqApps.length > 0) {
          prereqCache.set(taskId, prereqApps);
          debugLog("al_verify", "Prereqs cached", {
            taskId,
            count: prereqApps.length,
          });
        }
      }
    }
    logTiming("Prereq resolution", prereqStart);

    // 2. Create isolated verification directory and copy files
    const setupStart = Date.now();
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const verifyDir = join(
      projectDir,
      "..",
      `verify-${timestamp}-${random}`,
    );
    await ensureDir(verifyDir);
    debugLog("al_verify", "Verify directory created", { verifyDir });

    // Prepare app.json with test dependencies (and prereq dependencies if exist)
    // Only add the last prereq as direct dependency - it will chain to others
    const lastPrereq = prereqApps[prereqApps.length - 1];
    const mainPrereqAppJson = lastPrereq?.appJson;
    const appJsonResult = await prepareAppJsonForTesting(
      projectDir,
      verifyDir,
      mainPrereqAppJson,
      params.target,
    );
    if (!appJsonResult.success) {
      debugLog("al_verify", "FAILED: app.json preparation failed", {
        message: appJsonResult.message,
      });
      return { success: false, message: appJsonResult.message };
    }

    // Copy source files, support files, and test file
    await copyAlFilesToDir(projectDir, verifyDir);
    debugLog("al_verify", "Source files copied to verify dir");

    if (taskId) {
      await copySupportFilesForTask(taskId, projectRoot, verifyDir);
    }

    const testFileResult = await copyTestFile(params.testFile, verifyDir);
    debugLog("al_verify", "Test file copy result", {
      testFile: params.testFile,
      targetDir: verifyDir,
      success: testFileResult.success,
      message: testFileResult.success ? "OK" : testFileResult.message,
    });
    if (!testFileResult.success) {
      debugLog("al_verify", "FAILED: Test file copy failed");
      return { success: false, message: testFileResult.message };
    }

    // Copy prereq app files to .alpackages so the compiler can find dependency symbols
    if (prereqApps.length > 0) {
      const alpackagesDir = join(verifyDir, ".alpackages");
      await ensureDir(alpackagesDir);
      for (const prereqApp of prereqApps) {
        if (prereqApp.compiledAppPath) {
          const appFileName = prereqApp.compiledAppPath.split(/[/\\]/).pop()!;
          const targetPath = join(alpackagesDir, appFileName);
          await Deno.copyFile(prereqApp.compiledAppPath, targetPath);
          debugLog("al_verify", "Copied prereq app to .alpackages", {
            name: prereqApp.appJson["name"],
            source: prereqApp.compiledAppPath,
            target: targetPath,
          });
        }
      }
    }
    logTiming("Setup & copy files", setupStart);

    // 3. Build and compile
    const compileStart = Date.now();
    const project = await buildALProject(verifyDir, true);
    debugLog("al_verify", "Project built from verify dir", {
      path: project.path,
      sourceFiles: project.sourceFiles.length,
      testFiles: project.testFiles.length,
      testFileNames: project.testFiles.map((f) => f.split(/[/\\]/).pop()),
    });

    const compileResult = await containerProvider.compileProject(
      containerName,
      project,
    );
    debugLog("al_verify", "Compilation result", {
      success: compileResult.success,
      artifactPath: compileResult.artifactPath,
      errorCount: compileResult.errors.length,
    });

    if (!compileResult.success) {
      debugLog("al_verify", "FAILED: Compilation failed", {
        errors: compileResult.errors.slice(0, 5),
      });
      return {
        success: false,
        message: "Verification compilation failed",
        compileErrors: compileResult.errors.map(
          (e) => `${e.file}(${e.line},${e.column}): ${e.code} - ${e.message}`,
        ),
      };
    }
    logTiming("Compile project", compileStart);

    // 4. Publish prereq apps in order before running tests (only if not already published)
    const publishStart = Date.now();
    for (const prereqApp of prereqApps) {
      if (prereqApp.compiledAppPath) {
        const appId = prereqApp.appJson["id"] as string;
        const cacheKey = `${containerName}:${appId}`;
        if (!publishedPrereqCache.has(cacheKey)) {
          console.error(
            `[DEBUG] Publishing prereq ${appId} to ${containerName}`,
          );
          await containerProvider.publishApp(
            containerName,
            prereqApp.compiledAppPath,
          );
          publishedPrereqCache.add(cacheKey);
        } else {
          console.error(`[DEBUG] Prereq ${appId} already published, skipping`);
        }
      }
    }
    logTiming("Publish prereqs", publishStart);

    // 5. Run tests
    const testStart = Date.now();
    debugLog("al_verify", "Running tests", {
      containerName,
      extensionId: (project.appJson as { id?: string }).id,
      testCodeunitId: params.testCodeunitId,
      artifactPath: compileResult.artifactPath,
    });

    const testResult = await containerProvider.runTests(
      containerName,
      project,
      compileResult.artifactPath,
      params.testCodeunitId,
    );
    logTiming("Run tests", testStart);
    logTiming("TOTAL", totalStart);

    // Log detailed test result for debugging
    debugLog("al_verify", "Test execution result", {
      success: testResult.success,
      totalTests: testResult.totalTests,
      passedTests: testResult.passedTests,
      failedTests: testResult.failedTests,
      resultCount: testResult.results.length,
      results: testResult.results.slice(0, 10),
    });

    // If no tests were found, log the raw output for debugging
    if (testResult.totalTests === 0) {
      debugLog("al_verify", "WARNING: Zero tests detected!", {
        rawOutputLength: testResult.output?.length ?? 0,
        rawOutputSample: testResult.output?.substring(0, 2000) ?? "N/A",
      });
    }

    if (testResult.success) {
      return {
        success: true,
        message:
          `All tests passed! (${testResult.passedTests}/${testResult.totalTests})`,
        totalTests: testResult.totalTests,
        passed: testResult.passedTests,
        failed: testResult.failedTests,
      };
    }

    return {
      success: false,
      message:
        `Tests failed: ${testResult.failedTests} of ${testResult.totalTests} tests failed`,
      totalTests: testResult.totalTests,
      passed: testResult.passedTests,
      failed: testResult.failedTests,
      failures: testResult.results
        .filter((r) => !r.passed)
        .map((r) => `${r.name}: ${r.error || "Failed"}`),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugLog("al_verify", "EXCEPTION", { error: errorMessage });
    return { success: false, message: `Verification error: ${errorMessage}` };
  }
}

// =============================================================================
// MCP Protocol Helpers
// =============================================================================

function buildErrorResponse(
  id: string | number,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function wrapToolResult(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    },
  };
}

/** Map of tool names to their handlers */
const TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  al_compile: (args) =>
    handleAlCompile(
      args as {
        projectDir: string;
        containerName?: string;
        target?: "Cloud" | "OnPrem";
      },
    ),
  al_test: (args) =>
    handleAlTest(args as { projectDir: string; containerName?: string }),
  al_container_status: (args) =>
    handleContainerStatus(args as { containerName?: string }),
  al_verify: (args) =>
    handleAlVerify(
      args as {
        projectDir: string;
        testFile: string;
        containerName?: string;
        target?: "Cloud" | "OnPrem";
      },
    ),
  al_verify_task: (args) =>
    handleAlVerifyTask(
      args as {
        projectDir: string;
        taskId: string;
        containerName?: string;
        target?: "Cloud" | "OnPrem";
      },
    ),
};

async function dispatchToolCall(
  id: string | number,
  params: unknown,
): Promise<JsonRpcResponse> {
  const { name: toolName, arguments: toolArgs } = params as {
    name: string;
    arguments: Record<string, unknown>;
  };

  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return buildErrorResponse(id, -32601, `Unknown tool: ${toolName}`);
  }

  const result = await handler(toolArgs);
  return wrapToolResult(id, result);
}

// =============================================================================
// MCP Protocol Handler
// =============================================================================

async function handleRequest(
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "al-tools-server", version: "1.0.0" },
          },
        };

      case "notifications/initialized":
        return null;

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call":
        return await dispatchToolCall(id, params);

      default:
        return buildErrorResponse(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return buildErrorResponse(id, -32603, `Internal error: ${errorMessage}`);
  }
}

// =============================================================================
// Main Entry Point - stdio transport
// =============================================================================

async function runStdioTransport() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";

  // Read from stdin
  for await (const chunk of Deno.stdin.readable) {
    buffer += decoder.decode(chunk);

    // Process complete messages (newline-delimited JSON)
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        const response = await handleRequest(request);

        // Only write response if not null (notifications don't get responses)
        if (response !== null) {
          const responseJson = JSON.stringify(response) + "\n";
          await Deno.stdout.write(encoder.encode(responseJson));
        }
      } catch (error) {
        // Parse error
        const errorResponse: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32700,
            message: `Parse error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
        await Deno.stdout.write(
          encoder.encode(JSON.stringify(errorResponse) + "\n"),
        );
      }
    }
  }
}

// =============================================================================
// HTTP Transport with SSE Support
// =============================================================================

const DEFAULT_HTTP_PORT = 3100;

/**
 * Handle CORS preflight and add CORS headers to responses.
 */
function addCorsHeaders(headers: Headers): void {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Run MCP server with HTTP/SSE transport.
 * Endpoints:
 * - POST /rpc - JSON-RPC requests
 * - GET /health - Health check
 * - GET /tools - List available tools
 */
function runHttpTransport(port: number): void {
  console.error(`[MCP HTTP] Starting HTTP server on port ${port}`);

  Deno.serve({ port }, async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers = new Headers();
    addCorsHeaders(headers);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Health check endpoint
    if (url.pathname === "/health" && request.method === "GET") {
      headers.set("Content-Type", "application/json");
      return new Response(
        JSON.stringify({
          status: "ok",
          server: "al-tools-server",
          version: "1.0.0",
          transport: "http",
        }),
        { status: 200, headers },
      );
    }

    // List tools endpoint (convenience)
    if (url.pathname === "/tools" && request.method === "GET") {
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify({ tools: TOOLS }, null, 2), {
        status: 200,
        headers,
      });
    }

    // JSON-RPC endpoint (supports both /mcp and /rpc for compatibility)
    if (
      (url.pathname === "/mcp" || url.pathname === "/rpc") &&
      request.method === "POST"
    ) {
      headers.set("Content-Type", "application/json");

      try {
        const body = await request.text();
        const jsonRpcRequest = JSON.parse(body) as JsonRpcRequest;

        const response = await handleRequest(jsonRpcRequest);

        if (response === null) {
          // Notification - no response expected
          return new Response(null, { status: 204, headers });
        }

        return new Response(JSON.stringify(response), {
          status: 200,
          headers,
        });
      } catch (error) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: 0,
          error: {
            code: -32700,
            message: `Parse error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 400,
          headers,
        });
      }
    }

    // SSE endpoint for streaming (future use)
    if (url.pathname === "/sse" && request.method === "GET") {
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache");
      headers.set("Connection", "keep-alive");

      // For now, just send a heartbeat stream
      // Tool results will be sent via this channel when streaming is implemented
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "connected" })}\n\n`,
            ),
          );

          // Send heartbeat every 30 seconds
          const interval = setInterval(() => {
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${
                    JSON.stringify({ type: "heartbeat", timestamp: Date.now() })
                  }\n\n`,
                ),
              );
            } catch {
              clearInterval(interval);
            }
          }, 30000);

          // Clean up on close (handled by request abort)
          request.signal.addEventListener("abort", () => {
            clearInterval(interval);
            controller.close();
          });
        },
      });

      return new Response(stream, { headers });
    }

    // 404 for unknown paths
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({ error: "Not found", path: url.pathname }),
      { status: 404, headers },
    );
  });

  console.error(`[MCP HTTP] Server listening at http://localhost:${port}`);
  console.error(`[MCP HTTP] Endpoints:`);
  console.error(`  POST /rpc    - JSON-RPC requests`);
  console.error(`  GET  /health - Health check`);
  console.error(`  GET  /tools  - List available tools`);
  console.error(`  GET  /sse    - Server-Sent Events stream`);
}

// =============================================================================
// CLI Entry Point
// =============================================================================

function printUsage(): void {
  console.error(`
AL Tools MCP Server

Usage:
  al-tools-server.ts [options]

Options:
  --http         Run HTTP transport instead of stdio
  --port <port>  HTTP port (default: ${DEFAULT_HTTP_PORT}, env: MCP_HTTP_PORT)
  --help         Show this help message

Environment Variables:
  MCP_HTTP_PORT  HTTP server port (default: ${DEFAULT_HTTP_PORT})

Examples:
  # Run with stdio transport (default, for MCP clients)
  deno run --allow-all al-tools-server.ts

  # Run with HTTP transport (for sandbox mode)
  deno run --allow-all al-tools-server.ts --http

  # Run with HTTP on custom port
  deno run --allow-all al-tools-server.ts --http --port 8080
`);
}

// Run if executed directly
if (import.meta.main) {
  const args = Deno.args;

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    Deno.exit(0);
  }

  const useHttp = args.includes("--http");

  // Parse --workspace-map for sandbox mode path translation
  // Format: --workspace-map "C:\workspace=U:\Git\CentralGauge\results\..."
  const mapIndex = args.indexOf("--workspace-map");
  const mapArg = mapIndex !== -1 ? args[mapIndex + 1] : undefined;
  if (mapArg) {
    const separatorIndex = mapArg.indexOf("=");
    if (separatorIndex > 0) {
      const containerPath = mapArg.substring(0, separatorIndex);
      const hostPath = mapArg.substring(separatorIndex + 1);
      workspaceMapping = { containerPath, hostPath };
      console.error(
        `[MCP] Workspace mapping configured: ${containerPath} → ${hostPath}`,
      );
    } else {
      console.error(`[MCP] Warning: Invalid --workspace-map format: ${mapArg}`);
      console.error(`[MCP] Expected format: "C:\\workspace=U:\\host\\path"`);
    }
  }

  if (useHttp) {
    // Determine port from args or environment
    let port = DEFAULT_HTTP_PORT;
    const portIndex = args.indexOf("--port");
    const portArg = portIndex !== -1 ? args[portIndex + 1] : undefined;
    if (portArg) {
      port = parseInt(portArg, 10);
    } else {
      const envPort = Deno.env.get("MCP_HTTP_PORT");
      if (envPort) {
        port = parseInt(envPort, 10);
      }
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`[ERROR] Invalid port: ${port}`);
      Deno.exit(1);
    }

    runHttpTransport(port);
  } else {
    runStdioTransport();
  }
}

// Export for testing
export { loadTaskTarget, loadTestCodeunitId };
