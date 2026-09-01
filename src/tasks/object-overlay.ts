/**
 * Identity-keyed AL object overlay — the "changed objects only" response
 * contract.
 *
 * Under `templates/diagnose.md` rule 2 the model returns EVERY object of the
 * corrected application and the harness writes the whole response as the
 * candidate. Dropping one object is therefore destructive: the compiler
 * reports AL0185/AL0132 and the attempt dies before reaching the oracle. On
 * the seven-model panel of 2026-08-30 that accounted for 37% of all failures
 * and cost 28% of repair attempts.
 *
 * This module implements the alternative measured against it: the model
 * returns only the complete objects it changed, and they are overlaid onto
 * the starter application by IDENTITY. Anything not returned is carried
 * through unchanged, so omission becomes a no-op instead of a failure —
 * matching every other harness surveyed (SWE-bench leaves unmentioned files
 * untouched; Aider's `whole` format writes only files that appeared in the
 * response).
 *
 * Two design constraints come straight from the literature:
 *
 * - The unit is the COMPLETE object, never a diff of it. RepairLLaMA
 *   (arXiv 2312.15698) varied only the output representation across 488
 *   Defects4J bugs: fixed-chunk 144 semantic matches, full-function 45,
 *   3-line diff 24, 1-line diff 3. Diff formats are far worse than either
 *   whole-unit form, so this is OR2, not OR3.
 * - Identity, not file path or line number. No surveyed harness keys
 *   placement on symbol identity, because in Python and Java a function name
 *   does not determine placement (same name, different classes and modules).
 *   In AL it does: an object is type + name, globally unique within the app,
 *   and free to live in any file. The absence of prior art reflects their
 *   constraint, not a discovered problem with the approach.
 *
 * See docs/reasoning-suite/hardening-levers-evidence.md.
 */

/**
 * Top-level AL object declarations. Kept deliberately identical to
 * `candidate-guard.ts`'s `OBJECT_DECL`: two divergent object parsers in one
 * codebase is exactly how a candidate passes one gate and fails the other.
 * The name is either quoted or a bare identifier; `extends` clauses follow
 * the name and do not participate in identity.
 */
const OBJECT_DECL = new RegExp(
  String.raw`^\s*(table|tableextension|page|pageextension|codeunit|report|` +
    String.raw`reportextension|enum|enumextension|interface|query|xmlport|` +
    String.raw`controladdin|permissionset|permissionsetextension|profile|` +
    String
      .raw`pagecustomization|entitlement)\s+(\d+\s+)?("([^"]+)"|[A-Za-z_]\w*)`,
  "im",
);

export interface AlObject {
  /** Lower-cased object kind, e.g. `codeunit`. */
  kind: string;
  /** Object name as written, without surrounding quotes. */
  name: string;
  /** Full source text of the object, including its declaration line. */
  text: string;
}

/** Case-insensitive identity key. AL object names are not case-sensitive. */
export function objectKey(obj: Pick<AlObject, "kind" | "name">): string {
  return `${obj.kind.toLowerCase()}:${obj.name.trim().toLowerCase()}`;
}

/**
 * Split AL source into top-level objects by brace counting.
 *
 * Brace counting rather than a grammar: AL string literals use single quotes
 * and cannot contain an unescaped brace that would unbalance the count. Text
 * before the first declaration, and any trailing text after the last object
 * closes, is discarded — it is prose or fencing, never compilable content.
 */
export function splitAlObjects(source: string): AlObject[] {
  const lines = source.split(/\r?\n/);
  const objects: AlObject[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = OBJECT_DECL.exec(lines[i]!);
    if (!match) {
      i++;
      continue;
    }
    const kind = match[1]!.toLowerCase();
    const name = (match[4] ?? match[3] ?? "").trim();
    const start = i;
    let depth = 0;
    let sawBrace = false;
    while (i < lines.length) {
      const line = lines[i]!;
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          sawBrace = true;
        } else if (ch === "}") depth--;
      }
      i++;
      if (sawBrace && depth <= 0) break;
    }
    // An unterminated object (truncated output) still yields its text, so the
    // compiler reports the real syntax error rather than the object silently
    // vanishing into a "not returned, keep the starter's" no-op.
    objects.push({ kind, name, text: lines.slice(start, i).join("\n") });
  }
  return objects;
}

export interface OverlayResult {
  /** Merged application source, starter order preserved, additions appended. */
  source: string;
  /** Starter objects the model returned a replacement for. */
  replaced: string[];
  /** Objects the model returned that the starter did not contain. */
  added: string[];
  /** Starter objects carried through untouched — the omissions this forgives. */
  carried: string[];
}

/**
 * Overlay returned objects onto the starter application by identity.
 *
 * Starter order is preserved so a diff against the starter reads naturally,
 * and genuinely new objects are appended in the order the model emitted them.
 * A returned object that matches nothing in the starter is an ADDITION, not
 * an error: a repair may legitimately introduce a new enum or helper.
 */
/**
 * The source a RETRY attempt must be built from: the previous attempt's full
 * compiled candidate when one was recorded, else its raw output. Under
 * `diagnose-objects.md` the raw output is only the objects the model changed,
 * so showing it to the model as "your previous submission" hands it an app
 * with most objects missing (measured 2026-09-01: 18 of 22 Fable 5.1 retries
 * died on AL0185 references to tables it could no longer see). Under the
 * full-app contract the two are identical, so this is a no-op there.
 */
export function retrySourceFor(
  attempt: { candidateCode?: string | undefined; extractedCode: string },
): string {
  return attempt.candidateCode ? attempt.candidateCode : attempt.extractedCode;
}

export function overlayObjects(
  starterSource: string,
  returnedSource: string,
): OverlayResult {
  const starter = splitAlObjects(starterSource);
  const returned = splitAlObjects(returnedSource);

  const byKey = new Map<string, AlObject>();
  for (const obj of returned) byKey.set(objectKey(obj), obj);

  const replaced: string[] = [];
  const carried: string[] = [];
  const merged: string[] = [];
  const consumed = new Set<string>();

  for (const obj of starter) {
    const key = objectKey(obj);
    const replacement = byKey.get(key);
    if (replacement) {
      merged.push(replacement.text);
      replaced.push(key);
      consumed.add(key);
    } else {
      merged.push(obj.text);
      carried.push(key);
    }
  }

  const added: string[] = [];
  for (const obj of returned) {
    const key = objectKey(obj);
    if (consumed.has(key)) continue;
    // Guard against a model emitting the same object twice: the first wins,
    // matching the map-build above.
    if (added.includes(key)) continue;
    merged.push(obj.text);
    added.push(key);
  }

  return {
    source: merged.join("\n\n"),
    replaced,
    added,
    carried,
  };
}

/**
 * Template that selects the changed-objects-only contract. A task opts in by
 * naming it in `prompt_template`, which keeps the two A/B arms selectable per
 * task rather than by a global flag - the same 110 tasks can be run under
 * both contracts without editing the harness between runs.
 */
export const OBJECT_OVERLAY_TEMPLATE = "diagnose-objects.md";

/**
 * True when a task's response contract is changed-objects-only, so the
 * candidate must be overlaid onto the starter rather than written outright.
 */
export function usesObjectOverlay(
  manifest: { prompt_template: string },
): boolean {
  return manifest.prompt_template.trim().toLowerCase().endsWith(
    OBJECT_OVERLAY_TEMPLATE,
  );
}

/**
 * Members a returned object can silently lose. Enumerated rather than parsed
 * with a grammar, for the same reason `splitAlObjects` counts braces: AL
 * string literals are single-quoted and cannot unbalance the scan.
 *
 * `field`/`value`/`key` carry an id or name in the first slot; `procedure`
 * and `trigger` carry a bare identifier. Together these cover what an oracle
 * can reference across an object boundary, which is what a dropped member
 * turns into an AL0132 for.
 */
const MEMBER_DECL = new RegExp(
  String
    .raw`^\s*(?:(field|value|key)\s*\(\s*[^;)]*?;?\s*("([^"]+)"|[A-Za-z_]\w*)` +
    String
      .raw`|(?:local\s+|internal\s+|protected\s+)?(procedure|trigger)\s+("([^"]+)"|[A-Za-z_]\w*))`,
  "i",
);

/** Member identities declared directly inside one object's source text. */
export function splitAlMembers(objectText: string): Set<string> {
  const members = new Set<string>();
  for (const line of objectText.split("\n")) {
    const m = MEMBER_DECL.exec(line);
    if (!m) continue;
    const kind = (m[1] ?? m[4] ?? "").toLowerCase();
    const name = (m[3] ?? m[2] ?? m[6] ?? m[5] ?? "").trim().toLowerCase();
    if (kind && name) members.add(`${kind}:${name}`);
  }
  return members;
}

export interface DroppedMember {
  /** Identity key of the object that lost it. */
  object: string;
  /** `kind:name` of the vanished member. */
  member: string;
}

export interface CompletenessReport {
  /** Starter objects absent from the response entirely. */
  droppedObjects: string[];
  /** Members that vanished from an object the response DID return. */
  droppedMembers: DroppedMember[];
  /**
   * Objects the response returned at under half the starter's line count.
   * Advisory only - a legitimate fix can shorten an object, and identity
   * comparison cannot see a procedure that survives but loses its body. This
   * is the analogue of Aider's AST-node-count band (`verify_old_class_children`
   * in `benchmark/refactor_tools.py`, +/-10%), which works there only because
   * a pure cut-and-paste refactor conserves total nodes. A repair does not, so
   * this signal is reported and never gated on.
   */
  shrunkObjects: string[];
}

/**
 * Compare a response against the starter and report what it silently lost.
 *
 * This is a DETECTOR that scores, never a repairer that hides. Two precedents
 * decide that posture. Aider's `verify_refactor` is written into the generated
 * unittest, so elision IS the oracle rather than something the harness fixes
 * up. And Roo Code deleted its omission detector outright (commit `86edc01c`,
 * "remove omission detection logic to fix false positives") without ever
 * measuring the false-positive rate first - so measure before gating.
 *
 * Note the false positive this WILL produce: a fix that legitimately removes a
 * member is indistinguishable from one that drops it. SWE-agent documents the
 * same cost for its edit guardrail (arXiv 2405.15793 Figure 11: the gate
 * forces a model removing an argument to remove every reference in the same
 * action). Report the rate; do not reject on it.
 *
 * Nothing in the surveyed literature implements this. arXiv 2604.05100
 * surveyed 150+ code benchmarks and found that AST inspection confirms what an
 * edit adds and testing confirms what it produces, "but none of them confirms
 * what the edit preserves" - 56% of tests scope exclusively to the edited
 * code. Agentless computes the identical symbol-set difference
 * (`postprocess_data.py`, `# removes functions`) and uses it only as a dedup
 * key for majority voting; it never flags or counts.
 */
export function checkCompleteness(
  starterSource: string,
  returnedSource: string,
): CompletenessReport {
  const starter = splitAlObjects(starterSource);
  const returned = new Map(
    splitAlObjects(returnedSource).map((o) => [objectKey(o), o]),
  );

  const droppedObjects: string[] = [];
  const droppedMembers: DroppedMember[] = [];
  const shrunkObjects: string[] = [];

  for (const base of starter) {
    const key = objectKey(base);
    const got = returned.get(key);
    if (!got) {
      droppedObjects.push(key);
      continue;
    }
    const baseMembers = splitAlMembers(base.text);
    const gotMembers = splitAlMembers(got.text);
    for (const member of baseMembers) {
      if (!gotMembers.has(member)) droppedMembers.push({ object: key, member });
    }
    const baseLines = base.text.split("\n").length;
    const gotLines = got.text.split("\n").length;
    if (baseLines >= 10 && gotLines * 2 < baseLines) shrunkObjects.push(key);
  }

  return { droppedObjects, droppedMembers, shrunkObjects };
}
