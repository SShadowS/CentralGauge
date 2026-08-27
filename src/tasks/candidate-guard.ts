/**
 * Anti-gaming guard for candidate submissions.
 *
 * The incident this exists for: three "passing" solutions in the 2026-08-27
 * bench run declared `codeunit 70354 Any` — a stub shadowing Microsoft's Any
 * test library, which the harness had failed to make resolvable. The oracle's
 * `Any.IntegerInRange(...)` calls then bound to the model's own stub, and the
 * candidate passed a task it never solved. That is grader gaming in NIST
 * CAISI's taxonomy, and the guard against it is the field's converging rule:
 * success may only come from harness-executed tests in an environment the
 * candidate cannot rewrite or shadow.
 *
 * The guard rejects a candidate that declares any top-level AL object whose
 * NAME collides with the protected surface:
 *
 *   - the test-toolkit libraries every oracle may bind to (`Any`, `Assert`,
 *     `Library Assert`, `Library - *`) — shadowing one redirects the oracle's
 *     calls into candidate-controlled code
 *   - the task's own oracle codeunit and companions (`CG-AL-<id>...`) — the
 *     bench copies oracle files over the candidate's, but a name-level
 *     collision in a DIFFERENT file survives that copy and produces either a
 *     duplicate-symbol failure attributed to the model or, worse, a resolution
 *     the oracle author never intended
 *
 * Deliberately NOT rejected here: object IDs outside the authoring band. The
 * committed manifests span 70000-89999 on purpose so an off-spec id choice
 * stays a wrong answer rather than a compile refusal (see prereq-apps.md).
 * Names are different: no honest solution has any reason to name its objects
 * after the test infrastructure.
 */

/** Exact object names no candidate may declare, case-insensitive. */
const PROTECTED_NAMES = new Set(
  [
    "any",
    "assert",
    "library assert",
    "test runner",
  ],
);

/** Name prefixes no candidate may declare, case-insensitive. */
const PROTECTED_PREFIXES = [
  "library - ", // Library - Sales, Library - Inventory, Library - Random, ...
  "cg-al-", // oracle codeunits and companions are named "CG-AL-<id> ..."
];

/**
 * Top-level AL object declarations. The name is either quoted or a bare
 * identifier; `extends` clauses follow the name and are irrelevant here.
 */
const OBJECT_DECL = new RegExp(
  String.raw`^\s*(table|tableextension|page|pageextension|codeunit|report|` +
    String.raw`reportextension|enum|enumextension|interface|query|xmlport|` +
    String.raw`controladdin|permissionset|permissionsetextension|profile|` +
    String
      .raw`pagecustomization|entitlement)\s+(\d+\s+)?("([^"]+)"|[A-Za-z_]\w*)`,
  "gim",
);

export interface ProtectedNameCollision {
  kind: string;
  name: string;
  reason: string;
}

/**
 * Scan candidate AL source for declarations that shadow the protected surface.
 * Returns every collision; an empty array means the candidate is clean.
 */
export function findProtectedNameCollisions(
  code: string,
): ProtectedNameCollision[] {
  const collisions: ProtectedNameCollision[] = [];
  for (const m of code.matchAll(OBJECT_DECL)) {
    const kind = m[1]!.toLowerCase();
    const rawName = m[4] ?? m[3] ?? "";
    const name = rawName.trim();
    const lower = name.toLowerCase();
    if (PROTECTED_NAMES.has(lower)) {
      collisions.push({
        kind,
        name,
        reason:
          `declares ${kind} "${name}", shadowing a test-toolkit library the oracle binds to`,
      });
      continue;
    }
    const prefix = PROTECTED_PREFIXES.find((p) => lower.startsWith(p));
    if (prefix !== undefined) {
      collisions.push({
        kind,
        name,
        reason: prefix === "cg-al-"
          ? `declares ${kind} "${name}", colliding with the oracle/companion namespace`
          : `declares ${kind} "${name}", shadowing a Microsoft test library`,
      });
    }
  }
  return collisions;
}

/**
 * One-line failure message for scoring. A guarded candidate is MALFORMED —
 * it is never compiled, so the failure can never be mistaken for an infra
 * or oracle problem.
 */
export function describeCollisions(
  collisions: ProtectedNameCollision[],
): string {
  return "candidate rejected by the anti-gaming guard: " +
    collisions.map((c) => c.reason).join("; ");
}
