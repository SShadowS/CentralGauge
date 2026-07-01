# Containment policy: self-contained vs base-app-faithful

When distilling a PR trap into a task, decide where it lives on this axis. The
rule: **distill to self-contained AL unless the trap IS a base-app behavior — then
keep the base-app object.**

## Self-contained (default)

The trap is a language/platform semantic that does not depend on any specific
base-app object. Reproduce it with a small prereq app (custom tables + helper
codeunits) so the model writes only the trap-bearing object.

Use when the trap is about: transaction boundaries (`Codeunit.Run` rollback),
`[TryFunction]` write restrictions, record iteration-vs-mutation, manual event
subscribers (`EventSubscriberInstance = Manual` + `BindSubscription`), idempotent
insert, single-instance state, etc.

Seed-batch examples:
- **X002** — `Codeunit.Run` as a rollback boundary. Prereq: state/input/result
  tables; model writes the migration codeunit.
- **X004** — idempotent list-then-insert copy. Prereq: one item table; model
  writes the copier.
- **X001** — manual event subscriber must be bound. Prereq: counter table +
  publisher + manual subscriber; model writes the worker.

Advantages: deterministic, portable, easy oracle, no dependence on base-app
version quirks. Prefer this whenever the trap survives isolation.

## Base-app-faithful

The trap only exists because of a specific base-app object's behavior, so a
synthetic reproduction would not test the real thing. Use the real base-app object
(present in the vanilla container).

Use when the trap is about: `Change Log` semantics, posted-document tables, base
codeunits like `Change Log Management` / `Disable Aggregate Table Update`,
`Access Control` / permission tables, etc.

Seed-batch example:
- **X003** — the `Change Log` always-logged false positive
  (`IsAlwaysLoggedTable` returns true regardless of the global flag). Uses the real
  `Change Log Setup`, `Change Log Setup (Table)`, `Change Log Management`, and the
  base `User` table — no prereq app.

Caveats: base-app behavior is version-specific and MUST be premise-gated (see
SKILL.md stage 4). The seed batch burned two designs here before landing:
`Sales Invoice Header` is not always-logged on BC 28 (`User` is), and the
`Permissions`-property indirect-write trap is not honored under
`TestPermissions = Restrictive` at all. Verify the base-app premise on the real
container before authoring.

## Decision checklist

1. Does the trap reference a specific base-app object's behavior? If no →
   self-contained.
2. If yes, would a synthetic stand-in reproduce the exact behavior? If yes →
   still self-contained (simpler oracle). If no → base-app-faithful.
3. For base-app-faithful: can you observe the behavior deterministically in a
   vanilla container's test runner? If unsure → premise-gate FIRST; if it does not
   reproduce, retarget to an object that does, or drop.
