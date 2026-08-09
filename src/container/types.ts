export interface ContainerCredentials {
  username: string;
  password: string;
}

export interface ContainerConfig {
  name: string;
  bcVersion: string;
  memoryLimit: string;
  acceptEula: boolean;
  includeAL: boolean;
  includeTestToolkit: boolean;
  credentials?: ContainerCredentials;
}

export interface CompilationResult {
  success: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  output: string;
  duration: number; // milliseconds
  artifactPath?: string; // Path to compiled app file
}

export interface CompilationError {
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
}

export interface CompilationWarning extends CompilationError {
  severity: "warning";
}

export interface TestResult {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number; // milliseconds
  results: TestCaseResult[];
  output: string;
  /**
   * True when the counts above are SYNTHETIC — no AL test method actually
   * ran. Today the only producer is `makePublishFailureTestResult`
   * (`src/container/bc-container-provider.ts`), which reports a
   * model-attributable candidate publish/install defect as `totalTests: 1,
   * failedTests: 1` so the bench's normal aggregation scores it as a model
   * failure rather than infra.
   *
   * The bench WANTS that shape. The task workbench's discrimination probe
   * does not: `scripts/trap-probe.ts` proves a trap task discriminates by
   * requiring evidence that the oracle's assertions ran and lost, and a
   * naive solution that never installed never reached one. Without this
   * flag the two consumers cannot tell the synthetic pair apart from a real
   * one-test-failed run.
   */
  syntheticNoTestsRan?: boolean;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface ContainerStatus {
  name: string;
  isRunning: boolean;
  bcVersion?: string;
  uptime?: number;
  health: "healthy" | "unhealthy" | "starting" | "stopped";
}

export interface ALProject {
  path: string;
  appJson: object;
  sourceFiles: string[];
  testFiles: string[];
}
