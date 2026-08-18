/**
 * Ties a model response's `X.Y` member references to a prereq index,
 * producing a confidence-tiered verdict an author can read.
 *
 * Everything upstream in this plan (the prereq index, the per-procedure
 * Record bindings, the position-tagged member refs) exists to make this
 * module able to say "I don't know" instead of guessing. A wrong `hard`
 * tier is a false accusation against a model that wrote correct code, so
 * this module only ever tiers a reference once two things are BOTH true:
 * the variable is provably bound to a table the index actually contains,
 * and the reference's syntactic position is provably decisive (assignment
 * target or a curated method's field argument) or explicitly downgraded to
 * `soft` when it isn't (a bare call).
 *
 * @module al/prereq-binder
 */

import type { PrereqIndex } from "./prereq-index.ts";
import { lookupField, lookupProcedure } from "./prereq-index.ts";
import { collectRecordBindings } from "./record-bindings.ts";
import { collectMemberRefs } from "./member-refs.ts";
import type { MemberRef } from "./member-refs.ts";
import { normalizeName } from "./object-identity.ts";
import { parseAlObjects } from "./object-parser.ts";

/** Confidence tier, per spec §5. Never render a soft label as an accusation. */
export type BinderTier = "hard" | "soft" | "known";

export interface BinderFinding {
  procedureName: string;
  /** Table the variable was bound to, as written. */
  table: string;
  /** The referenced member, as written. */
  member: string;
  tier: BinderTier;
  line: number;
}

export interface BinderResult {
  /** Only references to variables bound to a PREREQ table. */
  findings: BinderFinding[];
  /** True when analysis could not run; caller degrades to the static listing. */
  degraded: boolean;
}

/**
 * Tiers a single ref that is already known to be bound to `table`, a table
 * present in the index.
 *
 * `assignment-target` and `curated-method-arg` are provable positions — AL
 * has no way for a procedure name to occupy either — so an unknown member
 * there is `hard`. `call` is not provable: the member may be a Record
 * built-in the index cannot know about, so an unknown member there is only
 * `soft`. `other` is neither provable nor curated-arg, and is skipped by
 * the caller before this function is reached.
 */
function tierRef(
  index: PrereqIndex,
  table: string,
  ref: MemberRef,
): BinderTier {
  if (
    ref.position === "assignment-target" ||
    ref.position === "curated-method-arg"
  ) {
    return lookupField(index, table, ref.member) ? "known" : "hard";
  }
  // ref.position === "call"
  return (lookupProcedure(index, table, ref.member) ||
      lookupField(index, table, ref.member))
    ? "known"
    : "soft";
}

/**
 * Binds every `X.Y` reference in `responseSource` to the prereq table its
 * variable `X` is provably bound to, then tiers each by how confidently its
 * position proves the member is invented.
 *
 * A ref is skipped entirely — never tiered, never included in `findings` —
 * when its variable is unbound in that procedure, when it's bound to a
 * table absent from `index` (a base-app record, a `RecordRef`, or anything
 * else this plan doesn't track), or when its position is `"other"`. This is
 * the spec's "Untracked" tier: silence, not a guess.
 *
 * Sets `degraded: true` (with no findings) when the index itself could not
 * be trusted (`index.hasError`, or `opts.sourcesIncomplete` for an index
 * built from a partial disk load), or when `responseSource` itself failed
 * to parse — `parseAlObjects` reports that as `hasError`, or (a non-empty
 * source producing zero top-level objects) as an empty `objects` list. That
 * is deliberately narrower than "found nothing to bind": a response that
 * parses cleanly into one or more objects but simply declares no procedure
 * or trigger (a table-only or enum-only candidate, which plenty of trap
 * tasks legitimately ask for) is NOT degraded — analysis ran, and correctly
 * found nothing to check. Conflating "couldn't analyse" with "analysed,
 * found nothing" would render a permanent false "couldn't check the
 * prereq" alarm across every task whose correct answer never references a
 * prereq table at all.
 */
export async function bindResponseToPrereqs(
  responseSource: string,
  index: PrereqIndex,
  opts: {
    /**
     * True when the prereq SOURCES the index was built from were themselves
     * loaded incompletely (`PrereqSources.hasError`). The index parses
     * cleanly and looks trustworthy in that case — it is simply missing
     * whatever never reached it, so every reference to a missing member
     * would be reported as a confident `hard` finding produced by a disk
     * error rather than by anything the model wrote.
     */
    sourcesIncomplete?: boolean;
  } = {},
): Promise<BinderResult> {
  if (index.hasError || opts.sourcesIncomplete === true) {
    return { findings: [], degraded: true };
  }

  const parsed = await parseAlObjects(responseSource);
  const failedToParse = parsed.hasError ||
    (responseSource.trim().length > 0 && parsed.objects.length === 0);
  if (failedToParse) {
    return { findings: [], degraded: true };
  }

  const [bindingsByProcedure, refs] = await Promise.all([
    collectRecordBindings(responseSource),
    collectMemberRefs(responseSource),
  ]);

  // Joined on the enclosing member's BYTE OFFSET, never on its name.
  // `procedureName` is not a unique identifier for a member — one table
  // with two fields, each with its own `trigger OnValidate()`, already
  // collides — and `Map` construction keeps the LAST entry for a duplicate
  // key, so a name join silently gave every reference in the first member
  // the last one's bindings. That reports a provably-correct field as
  // `hard` ("Made up this field") against a table it was never declared
  // against, and even names the wrong table in the finding, so the author
  // cannot spot it from the rail. Both modules parse the same string with
  // the same grammar and select member nodes with the identical predicate,
  // so their offsets are identical by construction.
  const bindingsByMember = new Map(
    bindingsByProcedure.map((p) => [p.startIndex, p.bindings]),
  );

  const findings: BinderFinding[] = [];
  for (const ref of refs) {
    if (ref.position === "other") continue;

    const bindings = bindingsByMember.get(ref.startIndex);
    const table = bindings?.get(ref.variable);
    if (table === undefined) continue;
    if (!index.tables.has(normalizeName(table))) continue;

    findings.push({
      procedureName: ref.procedureName,
      table,
      member: ref.member,
      tier: tierRef(index, table, ref),
      line: ref.line,
    });
  }

  return { findings, degraded: false };
}
