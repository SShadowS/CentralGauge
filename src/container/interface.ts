import type {
  ALProject,
  CompilationResult,
  ContainerConfig,
  ContainerStatus,
  TestResult,
} from "./types.ts";

export interface ContainerProvider {
  readonly name: string;
  readonly platform: "windows" | "linux" | "mock";

  // Container lifecycle
  setup(config: ContainerConfig): Promise<void>;
  start(containerName: string): Promise<void>;
  stop(containerName: string): Promise<void>;
  remove(containerName: string): Promise<void>;
  status(containerName: string): Promise<ContainerStatus>;

  // AL compilation operations
  compileProject(
    containerName: string,
    project: ALProject,
    options?: { label?: string },
  ): Promise<CompilationResult>;

  // Publish an app to the container (install and sync)
  publishApp(
    containerName: string,
    appPath: string,
  ): Promise<void>;

  // Unpublish CentralGauge prereq apps in the container that are NOT in the
  // given expected set. Each task's prereqs are task-scoped — a prior task's
  // prereq lingering on the container can collide with the current task's
  // prereq IDs (e.g. M001 Prereq + E002 Prereq both declare table 69001).
  // expectedPrereqAppPaths: array of compiled .app file paths whose
  // Publisher_Name pairs (parsed from filename) form the allow-list.
  // Optional — providers without a real BC catalog (mock/docker) can skip.
  cleanupOrphanedPrereqs?(
    containerName: string,
    expectedPrereqAppPaths: string[],
  ): Promise<void>;

  runTests(
    containerName: string,
    project: ALProject,
    appFilePath?: string,
    testCodeunitId?: number,
    options?: { label?: string },
  ): Promise<TestResult>;

  // File operations
  copyToContainer(
    containerName: string,
    localPath: string,
    containerPath: string,
  ): Promise<void>;
  copyFromContainer(
    containerName: string,
    containerPath: string,
    localPath: string,
  ): Promise<void>;

  // Utility operations
  executeCommand(
    containerName: string,
    command: string,
  ): Promise<{ output: string; exitCode: number }>;

  // Health checks
  isHealthy(containerName: string): Promise<boolean>;

  // Cleanup operations (optional - not all providers need this)
  cleanupCompilerFolders?(): Promise<void>;

  // Tear down per-container persistent resources (e.g. pwsh sessions).
  // Optional — only providers with persistent state implement this.
  dispose?(): Promise<void>;

  // Persistent session recycle hook (optional - only persistent-session providers implement)
  maybeRecycleSession?(containerName: string): Promise<void>;
}
