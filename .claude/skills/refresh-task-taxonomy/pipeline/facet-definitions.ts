// One-sentence definitions for every mechanism, invariant and environment
// facet. These are HAND-WRITTEN and are the source of truth: merge-taxonomy.ts
// stamps them onto the catalog on every run, so a rebuild can never replace a
// definition with a generated placeholder. Surface-facet descriptions are
// generated in aliases.ts instead.
//
// Adding a slug to MECHANISM_VOCAB / INVARIANT_VOCAB / ENVIRONMENT_VOCAB
// without adding its definition here fails tests/unit/taxonomy/merge.test.ts.

export const FACET_DEFINITIONS: Record<string, string> = {
  // mechanism — the Business Central runtime or language semantic at stake
  "tryfunction-write-rollback":
    "A TryFunction that catches an error also rolls back every database write made inside it, so a write that must survive the failure has to happen outside it.",
  "commit-scope":
    "Where a Commit falls decides which writes are already durable when a later error rolls the surrounding transaction back.",
  "error-flow":
    "Whether an error is raised, caught, turned into a return value or swallowed decides what the caller sees and what remains written.",
  "filter-key-semantics":
    "Filters, the current key and the sort order decide which rows a call sees and in which order it sees them.",
  "filter-group-state":
    "Filters live in numbered filter groups, so a filter set in one group intersects with, rather than replaces, the filters set in another.",
  "temporary-record":
    "A temporary record variable holds its rows in memory with its own contents, filters and trigger behaviour, separate from the real table.",
  "xrec-trigger-state":
    "Inside a table trigger, xRec carries the row's previous values, so a change can be measured against what was stored before it.",
  "event-binding":
    "Whether a subscriber is bound at all, and through which codeunit instance, decides whether it observes the event.",
  "event-order":
    "Subscribers and their publisher share a record or parameter, so which one runs first, and what it writes, decides the result.",
  "validation-trigger":
    "Table triggers, field validation and table-relation declarations make the platform run logic of its own, so what it computes or cascades on insert, modify, rename or validate is part of the answer.",
  "decimal-precision":
    "Where a decimal is rounded, in which direction and to which precision changes the value that ends up stored.",
  "culture-format-roundtrip":
    "Formatting or parsing under the session's culture produces different text than the culture-invariant form an external system expects.",
  "serialization-encoding":
    "Reading or writing an external representation, such as JSON, XML, a stream or a delimited string, has to follow that format's own rules.",
  "company-scope":
    "Which company's rows a record variable reads follows from the current company, from ChangeCompany and from whether the table is per-company at all.",
  "permission-check":
    "A permission set grant, or a read or write permission probe, decides whether an operation may touch a table.",
  "flowfield-sift":
    "A FlowField holds no value until it is calculated, and what it then holds depends on the filters in force at that moment.",
  "sql-cost-scaling":
    "How the work is expressed decides whether its database cost grows with the volume of data or stays flat.",
  "single-instance-state":
    "State kept in a SingleInstance codeunit is shared by every variable of that codeunit for the whole session, and survives until something invalidates it.",
  "recordref-reflection":
    "Reading or writing through RecordRef, FieldRef or object metadata resolves fields at run time instead of at compile time.",
  "upgrade-datatransfer":
    "Install and upgrade code, upgrade tags and DataTransfer move existing data when an extension's schema changes.",
  "record-locking-concurrency":
    "A record already read into a variable can go stale, so a later write can silently discard what another call or session has stored in the meantime.",

  // invariant — the domain contract the oracle grades
  "largest-remainder-allocation":
    "An amount split in proportion to weights is paid out in whole units, with each leftover unit going to whichever share was rounded down by the most.",
  "reversal-conservation":
    "A reversal, transfer or compensating write leaves the totals it was meant to preserve exactly as they were.",
  "exact-total":
    "The figure produced has to equal the specified value exactly, not approximately and not on average.",
  "inclusive-boundary":
    "A threshold, interval endpoint or capacity limit counts as inside or outside exactly as specified, with no off-by-one.",
  "idempotent-rebuild":
    "Running the operation again over the same input reproduces the same result instead of duplicating or compounding it.",
  "company-isolation":
    "Each company's data stays its own: a read or a write in one company never shows up in another.",
  "roundtrip-fidelity":
    "A value carried through a copy, an encode and decode, or a store and read comes back exactly as it went in.",
  "bounded-sql-cost":
    "The number of database round trips stays bounded and does not grow with the number of rows involved.",

  // environment — what the task needs in order to run
  "multi-company":
    "The task needs more than one company on the database to exercise its behaviour.",
  "culture-sensitive":
    "The task's outcome depends on the session's language or regional settings.",
  "test-permissions":
    "The task has to run under a restricted permission set rather than as a full-rights user.",
};
