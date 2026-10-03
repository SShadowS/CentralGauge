# Breaking changes

Our apps are extended by other apps we do not see. Anything public is a
contract: another app may call it, subscribe to it or store data in it. A
change that compiles here can still break an app that depends on ours.

## Never do this to public surface

- Remove or rename a public procedure.
- Change a public procedure's signature: parameter types, parameter order,
  `var` on a parameter, or the type it returns.
- Remove or rename a table field, or an enum value.
- Change the ID of a field or an enum value.
- Remove an event publisher, rename it, or change its parameters. Subscribers
  bind to the exact signature.
- Change an `Access` or `Extensible` setting so that something public becomes
  internal or non-extensible.

## Obsolete instead of removing

- Mark the old element with `[Obsolete('<reason>', '<tag>')]` for procedures and
  events, or `ObsoleteState = Pending` with `ObsoleteReason` and `ObsoleteTag`
  for fields, keys and objects.
- The reason names what to use instead.
- Keep the obsolete element working until it is removed in a later release.
- Add the new procedure, field or event next to the old one rather than
  changing the old one in place.

## Signatures

- When a procedure needs a new parameter, add an overload with the new
  signature and let the old one call it with a sensible value.
- When an event needs more data, publish a new event next to the old one
  instead of changing the old one's parameters.

## Tables and fields

- Changing a field's data type is breaking: stored data and every caller depend
  on it.
- Shortening a `Text` or `Code` field is breaking: existing data may not fit.
- Lengthening a field can break other apps that copy the value into a shorter
  variable or field; check the callers you can see and mention the change.
- Changing a primary key is breaking.
- New fields go after the existing ones, with IDs from the app's range.

## Enums

- An enum that is `Extensible = true` may have values added by other apps.
  Whether an enum is extensible is part of its contract: once it is shipped as
  extensible, it stays extensible.
- Adding a value to an enum is not breaking. Removing one is.

## Behaviour

- Existing callers keep getting the behaviour they get today unless the ticket
  explicitly changes it.
- When a change has to alter existing behaviour, say so in the summary of the
  change, together with who is affected.

## When in doubt

Search the repository for every caller and subscriber of what you are about to
change. If the element is public and you cannot see every caller, treat it as
used.
