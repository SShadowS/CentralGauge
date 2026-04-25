/**
 * Integration tests for real Business Central container (Cronus28)
 *
 * Prerequisites:
 * - BC container "Cronus28" must be running
 * - bccontainerhelper PowerShell module installed
 * - Windows only
 *
 * Run with: deno test --allow-all tests/integration/bc-container-real.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const CONTAINER_NAME = Deno.env.get("CENTRALGAUGE_TEST_CONTAINER") ??
  "Cronus28";
const isWindows = Deno.build.os === "windows";

// Skip all tests if not on Windows
const testOptions = isWindows ? {} : { ignore: true };

/**
 * Helper to run PowerShell commands via pwsh
 */
async function runPwsh(
  script: string,
): Promise<{ output: string; error: string; exitCode: number }> {
  const cmd = new Deno.Command("pwsh", {
    args: ["-NoProfile", "-Command", script],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    output: new TextDecoder().decode(stdout),
    error: new TextDecoder().decode(stderr),
    exitCode: code,
  };
}

// ============================================================================
// Container Status Tests
// ============================================================================

Deno.test({
  name: "BC Container: Container exists in list",
  ...testOptions,
  async fn() {
    const result = await runPwsh(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue 2>$null
      Get-BcContainers
    `);

    console.log("Containers:", result.output.trim());
    assert(
      result.output.includes(CONTAINER_NAME),
      `Container ${CONTAINER_NAME} not found`,
    );
  },
});

Deno.test({
  name: "BC Container: Test-BcContainer returns true",
  ...testOptions,
  async fn() {
    const result = await runPwsh(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue 2>$null
      Test-BcContainer ${CONTAINER_NAME}
    `);

    console.log("Test-BcContainer result:", result.output.trim());
    assert(result.output.includes("True"), "Container should be healthy");
  },
});

Deno.test({
  name: "BC Container: Get BC version",
  ...testOptions,
  async fn() {
    const result = await runPwsh(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue 2>$null
      Get-BcContainerNavVersion ${CONTAINER_NAME}
    `);

    console.log("BC Version:", result.output.trim());
    // Should contain version number like "27.2.xxxxx"
    assert(result.output.match(/\d+\.\d+/), "Should return a version number");
  },
});

// ============================================================================
// Script Execution Tests
// ============================================================================

Deno.test({
  name: "BC Container: Invoke-ScriptInBcContainer works",
  ...testOptions,
  async fn() {
    const result = await runPwsh(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue 2>$null
      Invoke-ScriptInBcContainer -containerName ${CONTAINER_NAME} -scriptblock {
        Write-Output "Hello from BC container"
      }
    `);

    console.log("Script output:", result.output);
    assert(
      result.output.includes("Hello from BC container"),
      "Should execute script in container",
    );
  },
});

// ============================================================================
// AL Compilation Tests (using 'al compile' on HOST - not in container)
// ============================================================================

Deno.test({
  name: "AL Compile: Compile simple AL codeunit on host",
  ...testOptions,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Create a temporary AL project locally
    const tempDir = await Deno.makeTempDir({ prefix: "centralgauge_test_" });

    try {
      // Write app.json for BC 27
      const appJson = {
        id: "11111111-1111-1111-1111-111111111111",
        name: "TestApp",
        publisher: "CentralGauge",
        version: "1.0.0.0",
        brief: "Test application",
        description: "Test application for integration testing",
        privacyStatement: "",
        EULA: "",
        help: "",
        url: "",
        logo: "",
        dependencies: [],
        screenshots: [],
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [{ from: 50100, to: 50199 }],
        resourceExposurePolicy: {
          allowDebugging: true,
          allowDownloadingSource: true,
          includeSourceInSymbolFile: true,
        },
        runtime: "14.0",
        target: "OnPrem",
      };

      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify(appJson, null, 2),
      );

      // Write a simple codeunit
      const codeunit = `codeunit 50100 "Test Codeunit"
{
    procedure HelloWorld(): Text
    begin
        exit('Hello from CentralGauge!');
    end;
}
`;
      await Deno.writeTextFile(`${tempDir}/TestCodeunit.Codeunit.al`, codeunit);

      console.log(`Created test project at: ${tempDir}`);

      // Create compiler folder with symbols from container using New-BcCompilerFolder
      // First get the artifact URL from the container, then create compiler folder
      const setupResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        $artifactUrl = Get-BcContainerArtifactUrl -containerName ${CONTAINER_NAME}
        Write-Output "Artifact URL: $artifactUrl"
        $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl
        Write-Output "COMPILER_FOLDER:$compilerFolder"
      `);
      console.log("Compiler setup:", setupResult.output);

      // Extract compiler folder path from output
      const compilerFolderMatch = setupResult.output.match(
        /COMPILER_FOLDER:(.+)/,
      );
      if (!compilerFolderMatch || !compilerFolderMatch[1]) {
        throw new Error(
          `Failed to create compiler folder. Output: ${setupResult.output}`,
        );
      }
      const actualCompilerFolder = compilerFolderMatch[1].trim();
      console.log("Compiler folder:", actualCompilerFolder);

      // Compile using Compile-AppWithBcCompilerFolder
      const outputDir = `${tempDir}/output`;
      await Deno.mkdir(outputDir, { recursive: true });

      const escapedProjectPath = tempDir.replace(/\\/g, "\\\\");
      const escapedOutputDir = outputDir.replace(/\\/g, "\\\\");
      const escapedCompilerFolder = actualCompilerFolder.replace(/\\/g, "\\\\");

      const result = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        Compile-AppWithBcCompilerFolder -compilerFolder "${escapedCompilerFolder}" -appProjectFolder "${escapedProjectPath}" -appOutputFolder "${escapedOutputDir}" -ErrorAction Continue
        Get-ChildItem "${escapedOutputDir}" -Filter "*.app" | ForEach-Object { Write-Output "SUCCESS: App compiled to $($_.FullName)" }
      `);

      console.log("Compilation output:", result.output);
      if (result.error) console.log("Compilation stderr:", result.error);

      // Check for success
      const hasErrors = result.output.includes("error AL") ||
        result.error.includes("error AL");
      const appCompiled = result.output.includes("SUCCESS: App compiled to");

      assertEquals(
        hasErrors,
        false,
        `Compilation should succeed. Output: ${result.output}`,
      );
      assert(
        appCompiled,
        "App file should be created on successful compilation",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "AL Compile: Detect compilation errors in invalid AL",
  ...testOptions,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    // Create a temporary AL project with errors
    const tempDir = await Deno.makeTempDir({
      prefix: "centralgauge_error_test_",
    });

    try {
      // Write app.json for BC 27
      const appJson = {
        id: "22222222-2222-2222-2222-222222222222",
        name: "TestAppWithErrors",
        publisher: "CentralGauge",
        version: "1.0.0.0",
        brief: "Test application with errors",
        description: "Test application for error detection",
        privacyStatement: "",
        EULA: "",
        help: "",
        url: "",
        logo: "",
        dependencies: [],
        screenshots: [],
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [{ from: 50200, to: 50299 }],
        resourceExposurePolicy: {
          allowDebugging: true,
          allowDownloadingSource: true,
          includeSourceInSymbolFile: true,
        },
        runtime: "14.0",
        target: "OnPrem",
      };

      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify(appJson, null, 2),
      );

      // Write a codeunit with syntax errors
      const codeunitWithErrors = `codeunit 50200 "Error Codeunit"
{
    procedure BrokenCode(): Text
    var
        x: Integer;
    begin
        y := 10;  // Error: y is not declared
        exit('This will not compile')  // Error: missing semicolon
    end;
}
`;
      await Deno.writeTextFile(
        `${tempDir}/ErrorCodeunit.Codeunit.al`,
        codeunitWithErrors,
      );

      console.log(`Created error test project at: ${tempDir}`);

      // Create compiler folder with symbols from container
      const setupResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        $artifactUrl = Get-BcContainerArtifactUrl -containerName ${CONTAINER_NAME}
        $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl
        Write-Output "COMPILER_FOLDER:$compilerFolder"
      `);

      const compilerFolderMatch = setupResult.output.match(
        /COMPILER_FOLDER:(.+)/,
      );
      if (!compilerFolderMatch || !compilerFolderMatch[1]) {
        throw new Error(
          `Failed to create compiler folder. Output: ${setupResult.output}`,
        );
      }
      const actualCompilerFolder = compilerFolderMatch[1].trim();

      // Create output directory
      const outputDir = `${tempDir}/output`;
      await Deno.mkdir(outputDir, { recursive: true });

      const escapedProjectPath = tempDir.replace(/\\/g, "\\\\");
      const escapedOutputDir = outputDir.replace(/\\/g, "\\\\");
      const escapedCompilerFolder = actualCompilerFolder.replace(/\\/g, "\\\\");

      // Compile on HOST - should fail
      const result = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        Compile-AppWithBcCompilerFolder -compilerFolder "${escapedCompilerFolder}" -appProjectFolder "${escapedProjectPath}" -appOutputFolder "${escapedOutputDir}" -ErrorAction Continue 2>&1
      `);

      console.log("Compilation output:", result.output);
      if (result.error) console.log("Compilation stderr:", result.error);

      // Check that errors were detected (should have AL errors in output)
      const hasAlErrors = result.output.includes("error AL") ||
        result.error.includes("error AL");
      assert(
        hasAlErrors,
        `Should detect AL compilation errors. Output: ${result.output}\nStderr: ${result.error}`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// ============================================================================
// Full Workflow: Compile, Publish, Install, Run Tests
// ============================================================================

Deno.test({
  name: "BC Container: Full workflow - compile, publish, install, run tests",
  ...testOptions,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({
      prefix: "centralgauge_fulltest_",
    });
    const appId = "33333333-3333-3333-3333-333333333333";

    try {
      // Write app.json with test toolkit dependency
      const appJson = {
        id: appId,
        name: "CentralGaugeTestApp",
        publisher: "CentralGauge",
        version: "1.0.0.0",
        brief: "Test application with AL tests",
        description: "Integration test app",
        privacyStatement: "",
        EULA: "",
        help: "",
        url: "",
        logo: "",
        dependencies: [],
        screenshots: [],
        platform: "27.0.0.0",
        application: "27.0.0.0",
        idRanges: [{ from: 50300, to: 50399 }],
        resourceExposurePolicy: {
          allowDebugging: true,
          allowDownloadingSource: true,
          includeSourceInSymbolFile: true,
        },
        runtime: "14.0",
        target: "OnPrem",
      };

      await Deno.writeTextFile(
        `${tempDir}/app.json`,
        JSON.stringify(appJson, null, 2),
      );

      // Write a simple codeunit with business logic
      const codeunit = `codeunit 50300 "CG Math Functions"
{
    procedure Add(a: Integer; b: Integer): Integer
    begin
        exit(a + b);
    end;

    procedure Multiply(a: Integer; b: Integer): Integer
    begin
        exit(a * b);
    end;
}
`;
      await Deno.writeTextFile(
        `${tempDir}/CGMathFunctions.Codeunit.al`,
        codeunit,
      );

      // Write a test codeunit
      const testCodeunit = `codeunit 50301 "CG Math Functions Test"
{
    Subtype = Test;

    [Test]
    procedure TestAddition()
    var
        MathFunctions: Codeunit "CG Math Functions";
    begin
        // Test that 2 + 3 = 5
        if MathFunctions.Add(2, 3) <> 5 then
            Error('Addition test failed: expected 5');
    end;

    [Test]
    procedure TestMultiplication()
    var
        MathFunctions: Codeunit "CG Math Functions";
    begin
        // Test that 4 * 5 = 20
        if MathFunctions.Multiply(4, 5) <> 20 then
            Error('Multiplication test failed: expected 20');
    end;
}
`;
      await Deno.writeTextFile(
        `${tempDir}/CGMathFunctionsTest.Codeunit.al`,
        testCodeunit,
      );

      console.log(`Created test project at: ${tempDir}`);

      // Step 1: Create compiler folder
      console.log("Step 1: Creating compiler folder...");
      const setupResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        $artifactUrl = Get-BcContainerArtifactUrl -containerName ${CONTAINER_NAME}
        $compilerFolder = New-BcCompilerFolder -artifactUrl $artifactUrl
        Write-Output "COMPILER_FOLDER:$compilerFolder"
      `);

      const compilerFolderMatch = setupResult.output.match(
        /COMPILER_FOLDER:(.+)/,
      );
      if (!compilerFolderMatch || !compilerFolderMatch[1]) {
        throw new Error(
          `Failed to create compiler folder. Output: ${setupResult.output}`,
        );
      }
      const compilerFolder = compilerFolderMatch[1].trim();

      // Step 2: Compile the app
      console.log("Step 2: Compiling app...");
      const outputDir = `${tempDir}/output`;
      await Deno.mkdir(outputDir, { recursive: true });

      const escapedProjectPath = tempDir.replace(/\\/g, "\\\\");
      const escapedOutputDir = outputDir.replace(/\\/g, "\\\\");
      const escapedCompilerFolder = compilerFolder.replace(/\\/g, "\\\\");

      const compileResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        Compile-AppWithBcCompilerFolder -compilerFolder "${escapedCompilerFolder}" -appProjectFolder "${escapedProjectPath}" -appOutputFolder "${escapedOutputDir}"
        $appFile = Get-ChildItem "${escapedOutputDir}" -Filter "*.app" | Select-Object -First 1
        if ($appFile) {
          Write-Output "APP_FILE:$($appFile.FullName)"
        }
      `);

      console.log("Compile output:", compileResult.output);

      const appFileMatch = compileResult.output.match(/APP_FILE:(.+)/);
      if (!appFileMatch || !appFileMatch[1]) {
        throw new Error(
          `Compilation failed. Output: ${compileResult.output}\nStderr: ${compileResult.error}`,
        );
      }
      const appFile = appFileMatch[1].trim();
      console.log("Compiled app:", appFile);

      // Step 3: Publish and install the app
      console.log("Step 3: Publishing and installing app...");
      const escapedAppFile = appFile.replace(/\\/g, "\\\\");

      const publishResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue

        # First uninstall/unpublish if exists
        $existingApp = Get-BcContainerAppInfo -containerName ${CONTAINER_NAME} | Where-Object { $_.AppId -eq "${appId}" }
        if ($existingApp) {
          Write-Output "Removing existing app..."
          UnInstall-BcContainerApp -containerName ${CONTAINER_NAME} -name $existingApp.Name -publisher $existingApp.Publisher -version $existingApp.Version -Force
          UnPublish-BcContainerApp -containerName ${CONTAINER_NAME} -name $existingApp.Name -publisher $existingApp.Publisher -version $existingApp.Version
        }

        # Publish, sync, and install
        Write-Output "Publishing app..."
        Publish-BcContainerApp -containerName ${CONTAINER_NAME} -appFile "${escapedAppFile}" -skipVerification -sync -install
        Write-Output "PUBLISH_SUCCESS"
      `);

      console.log("Publish output:", publishResult.output);
      assert(
        publishResult.output.includes("PUBLISH_SUCCESS"),
        `Failed to publish app: ${publishResult.output}\n${publishResult.error}`,
      );

      // Step 4: Run the tests
      console.log("Step 4: Running tests in container...");
      const testResult = await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue

        # Create credential for test run
        $password = ConvertTo-SecureString "1234" -AsPlainText -Force
        $credential = New-Object PSCredential("sshadows", $password)

        # Run tests
        $results = Run-TestsInBcContainer -containerName ${CONTAINER_NAME} -credential $credential -testCodeunit 50301 -detailed -returnTrueIfAllPassed

        Write-Output "TEST_RESULTS_START"
        Write-Output $results
        Write-Output "TEST_RESULTS_END"

        if ($results -eq $true) {
          Write-Output "ALL_TESTS_PASSED"
        }
      `);

      console.log("Test output:", testResult.output);
      if (testResult.error) console.log("Test stderr:", testResult.error);

      // Check test results
      const allTestsPassed = testResult.output.includes("ALL_TESTS_PASSED");
      assert(
        allTestsPassed,
        `Tests should pass. Output: ${testResult.output}\nStderr: ${testResult.error}`,
      );
    } finally {
      // Cleanup: uninstall and unpublish the app
      console.log("Cleanup: Removing test app...");
      await runPwsh(`
        Import-Module bccontainerhelper -WarningAction SilentlyContinue
        $app = Get-BcContainerAppInfo -containerName ${CONTAINER_NAME} | Where-Object { $_.AppId -eq "${appId}" }
        if ($app) {
          UnInstall-BcContainerApp -containerName ${CONTAINER_NAME} -name $app.Name -publisher $app.Publisher -version $app.Version -Force -ErrorAction SilentlyContinue
          UnPublish-BcContainerApp -containerName ${CONTAINER_NAME} -name $app.Name -publisher $app.Publisher -version $app.Version -ErrorAction SilentlyContinue
        }
      `);
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// ============================================================================
// Container Info Tests
// ============================================================================

Deno.test({
  name: "BC Container: Get installed apps",
  ...testOptions,
  async fn() {
    const result = await runPwsh(`
      Import-Module bccontainerhelper -WarningAction SilentlyContinue 2>$null
      Get-BcContainerAppInfo -containerName ${CONTAINER_NAME} |
        Select-Object -First 5 -Property Name, Publisher, Version |
        ForEach-Object { Write-Output "$($_.Name) by $($_.Publisher)" }
    `);

    console.log("Installed apps:", result.output);
    // Should find some apps (Base Application, System Application, etc.)
    assert(result.output.length > 0, "Should list installed apps");
  },
});

// ============================================================================
// bccontainerhelper Version-Pin Regression Tests
//
// Guard against the 6.1.12 PSSession regression: BC v28+ containers lose the
// NAV admin module mid-task, so Get-BcContainerServerConfiguration fails with
// "Get-NavServerInstance not recognized" — which surfaces as PUBLISH_FAILED
// for every benchmark task. Provider pins to 6.1.11 in-source.
// ============================================================================

Deno.test({
  name: "Provider source pins every bccontainerhelper Import/Install to 6.1.11",
  // Static check — runs everywhere, no container needed. Scans the whole
  // src/container directory so any new file with embedded PowerShell scripts
  // gets caught automatically (e.g. bc-script-builders.ts).
  async fn() {
    const containerDirUrl = new URL("../../src/container/", import.meta.url);
    const containerDirPath = decodeURIComponent(
      containerDirUrl.pathname.replace(/^\/([A-Za-z]:\/)/, "$1"),
    );
    const allMatches: { file: string; line: string }[] = [];

    for await (const entry of Deno.readDir(containerDirPath)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
      const src = await Deno.readTextFile(`${containerDirPath}${entry.name}`);
      const re = /(Import-Module|Install-Module)\s+bccontainerhelper[^\n]*/g;
      for (const m of src.matchAll(re)) {
        allMatches.push({ file: entry.name, line: m[0] });
      }
    }

    assert(
      allMatches.length > 0,
      "expected at least one bccontainerhelper Import/Install site",
    );

    const unpinned = allMatches.filter(
      ({ line }) => !line.includes("-RequiredVersion 6.1.11"),
    );

    assertEquals(
      unpinned,
      [],
      `bccontainerhelper version pin missing on ${unpinned.length} line(s):\n${
        unpinned.map((u) => `  ${u.file}: ${u.line}`).join("\n")
      }`,
    );
  },
});

Deno.test({
  name:
    `BC Container: Get-NavServerInstance resolves via PSSession (regression for bccontainerhelper 6.1.12)`,
  ...testOptions,
  async fn() {
    const { BcContainerProvider } = await import(
      "../../src/container/bc-container-provider.ts"
    );
    const provider = new BcContainerProvider();

    // executeCommand goes through the same Import-Module + Invoke-ScriptInBcContainer
    // chain that Publish-BcContainerApp uses internally. If the version pin is
    // dropped (or upstream re-breaks), this throws or returns empty output.
    const { output, exitCode } = await provider.executeCommand(
      CONTAINER_NAME,
      "Get-NavServerInstance | Select-Object -First 1 -ExpandProperty ServerInstance",
    );

    console.log("ServerInstance output:", output.trim());
    assertEquals(exitCode, 0, `executeCommand failed with exit ${exitCode}`);
    assert(
      !output.includes("not recognized as a name of a cmdlet"),
      "Get-NavServerInstance went missing — bccontainerhelper PSSession regression returned",
    );
    assert(
      output.trim().length > 0,
      "expected a non-empty ServerInstance name (e.g. 'BC')",
    );
  },
});
