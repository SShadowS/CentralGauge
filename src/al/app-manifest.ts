/**
 * Shape and mutators for a benchmark AL `app.json`.
 *
 * Extracted from `mcp/al-tools-server.ts` so `src/workbench/` can reuse them.
 * That module constructs a `BcContainerProvider` and reads container
 * credentials at module-evaluation time (`:75-87`), so it must only ever be
 * imported dynamically — see `scripts/trap-probe.ts:30-43`. Anything the
 * eagerly-loaded CLI needs has to live here instead.
 *
 * The dependency arrow runs `mcp/` -> `src/`, never the reverse.
 */

import { TEST_TOOLKIT_DEPENDENCIES } from "../constants.ts";

export interface AppJson {
  dependencies?: Array<
    { id: string; name: string; publisher: string; version: string }
  >;
  idRanges?: Array<{ from: number; to: number }>;
  [key: string]: unknown;
}

/** Add Test Toolkit dependencies to app.json if not already present. */
export function ensureTestDependencies(appJson: AppJson): void {
  if (!appJson.dependencies) {
    appJson.dependencies = [];
  }

  for (const dep of TEST_TOOLKIT_DEPENDENCIES) {
    const exists = appJson.dependencies.some((d) => d.id === dep.id);
    if (!exists) {
      appJson.dependencies.push(dep);
    }
  }
}

/** Extend idRanges to include the test codeunit range if not present. */
export function ensureTestCodeunitRange(appJson: AppJson): void {
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

/** Add a prereq app as a dependency of app.json. */
export function ensurePrereqDependency(
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
