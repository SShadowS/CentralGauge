// src/health/signatures.ts
import type { InfraSignature } from "./types.ts";

export const INFRA_SIGNATURES: InfraSignature[] = [
  {
    id: "syslib0014",
    label: "PsTestTool .NET incompat (SYSLIB0014)",
    patterns: [
      /SYSLIB0014/i,
      /ServicePointManager.*obsolete/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Wipe C:\\ProgramData\\BcContainerHelper\\Extensions\\{container}\\PsTestTool then re-run, or rebuild the container.",
  },
  {
    id: "pssession_lost",
    label: "BC PSSession lost (Get-NavServerInstance missing)",
    patterns: [
      /Get-NavServerInstance.*not recognized/i,
      /CommandNotFoundException.*Get-NavServerInstance/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Container session corrupted after Unpublish. Restart the BC service in the container, or rebuild.",
    catastrophicSingleFailure: true,
  },
  {
    id: "container_oom",
    label: "Container out of memory",
    patterns: [
      /Free Physical Memory:\s*0\.\d+\s*Gb/i,
      /Out of memory/i,
    ],
    scope: "container",
    severity: "warn",
    fixHint:
      "Container is starved. Reduce parallel concurrency, allocate more RAM to Docker, or restart the container.",
  },
  {
    id: "publish_timeout",
    label: "Publish-BcContainerApp timed out",
    patterns: [
      /Publish-BcContainerApp.*timed out/i,
      /Publish.*operation has timed out/i,
    ],
    scope: "container",
    severity: "warn",
    fixHint:
      "BC service is wedged. Restart the BC service in the container or reduce publish parallelism.",
  },
  {
    id: "container_offline",
    label: "Container not running / not found",
    patterns: [
      /container .* not running/i,
      /Cannot find container '/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "Container is down. Run Start-BcContainer or rebuild with New-BcContainer.",
    catastrophicSingleFailure: true,
  },
  {
    id: "sql_service_down",
    label: "Container SQL service stopped / NST detached / SQL unresponsive",
    patterns: [
      /NavServerNotFoundException/i,
      /Cannot establish a connection to the SQL Server\/Database/i,
      /Cannot establish a connection to the SQL Server/i,
      // SQL is up but unresponsive: the local SQLEXPRESS has no free worker /
      // is IO-stalled, so NST's SNI handshake/read times out. Appears as
      // "TCP Provider, error: 0 - The wait operation timed out". One hit is
      // proof the in-container SQL is saturated -> exclude + recover.
      /TCP Provider, error: 0 - The wait operation timed out/i,
      /A connection was successfully established with the server, but then an error occurred/i,
    ],
    scope: "container",
    severity: "critical",
    fixHint:
      "SQL service is stopped inside the container. Run: docker exec {container} powershell -Command \"Start-Service 'MSSQL$SQLEXPRESS'; Start-Service 'MSSQLFDLauncher$SQLEXPRESS'; Restart-Service 'MicrosoftDynamicsNavServer$BC'\"",
    catastrophicSingleFailure: true,
  },
  {
    id: "zero_tests",
    label: "Zero tests found after successful publish",
    patterns: [
      /Zero tests detected after successful publish/i,
    ],
    scope: "container",
    severity: "warn",
    fixHint:
      "Candidate published but the test runner found no tests (GH #13). Check the resolved bccontainerhelper version ([CG-PIN] lines) and for stale-candidate publish collisions; restart the bench after fixing.",
  },
];

/**
 * Return the first matching signature, or undefined if none match.
 */
export function matchSignature(text: string): InfraSignature | undefined {
  for (const sig of INFRA_SIGNATURES) {
    for (const p of sig.patterns) {
      if (p.test(text)) return sig;
    }
  }
  return undefined;
}
