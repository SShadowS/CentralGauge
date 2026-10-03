# AL conventions

These are the conventions every app in this repository follows. When an app
already does something its own way, match the app: consistency inside an app
beats a rule applied halfway.

## Naming

- Objects, procedures, variables and parameters use PascalCase.
- Object names carry the prefix the app already uses. Look at existing objects
  in the same app before you name a new one.
- New object IDs come from the ID range in the app's `app.json` (`idRanges`).
  Take the next free ID in that range; never reuse an ID from another app.
- Record variables are named after their table, without the prefix, so a
  reader can tell which table they point to.
- Name procedures after what they do, with a verb first.

## Files

- One object per file.
- File name: `<Name>.<ObjectType>.al`, the object name without spaces or the
  prefix, for example `CustomerBalance.Codeunit.al` or `ShipmentStatus.Enum.al`.
- Put the file in the folder of the app that owns the object, next to objects of
  the same kind if the app groups them that way.

## Text and errors

- Every user-facing text is a label: `Error`, `Message`, `Confirm` and captions
  never take a literal string.
- Label names end in `Err`, `Msg`, `Qst` or `Lbl` by purpose.
- Use placeholders (`%1`, `%2`) with a `Comment` that says what each one is.
- Raise errors with `Error(SomeErr, ...)`, where `SomeErr` is a label.

## Visibility

- Procedures are `local` by default.
- A procedure is public only when another object or another app needs to call
  it. Mark helpers that other apps must not call as `internal`.
- Prefer `Access = Internal` on codeunits that are not part of the app's
  public surface.
- Anything public is a contract with other apps: see the breaking changes rule.

## Events

- Extension points are integration events published from the object that owns
  the process, with parameters that give a subscriber what it needs.
- Event subscribers live in their own codeunits, grouped by the area they
  extend, not inside the codeunit that publishes the event.
- Keep subscriber bodies short: call a procedure that does the work.
- Before adding a new publisher, check whether the process already raises an
  event a subscriber can use.

## Record access

- When you read only a few fields of a large table, call `SetLoadFields` with
  those fields before the read.
- Loop over records with `FindSet` and `repeat ... until Next() = 0`.
- Check existence with `IsEmpty`, not with `Count` or a `Find` you then ignore.
- Use `Get` when you have the full primary key.
- Set filters with `SetRange` and `SetFilter` before reading; do not filter in
  code what the database can filter.

## Code shape

- Keep procedures short and give each one a single job.
- Use `begin ... end` only where it is needed.
- Use named enums instead of magic option or integer values.
- Remove code you made unused. Do not leave commented-out code behind.
- Fix every compiler and code analysis warning your change introduces.
