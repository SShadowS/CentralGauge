---
name: al-app-structure
description: Business Central app layout, app.json, object ID ranges and dependencies between apps. Use when adding objects, adding a new app, or fixing missing-symbol and ID errors.
---

# AL app structure

## One folder per app

Each app folder has an `app.json` and its `.al` files (any subfolders). The
compiler reads every `.al` file under the folder; file names do not matter to
it, but one object per file named after the object keeps things findable.

## app.json essentials

- `id` (GUID), `name`, `publisher`, `version`: identify the app. Other apps depend on it by `id`.
- `idRanges`: the object IDs this app may use, for example `[{ "from": 50100, "to": 50149 }]`.
  Every table, page, codeunit, report, query, xmlport, enum and extension object needs an ID
  inside a range of its own app. Interfaces have no ID.
- `dependencies`: the apps whose objects this app uses, each with `id`, `name`, `publisher`,
  `version` (minimum). Using an object from an app that is not listed is a compile error
  about a missing type or symbol, not a runtime error.
- `internalsVisibleTo`: apps allowed to call this app's `internal` procedures and objects
  (commonly its test app).
- `runtime`, `platform`, `application`: target versions. Keep them as they are unless a
  feature needs a newer runtime.

## Picking IDs

Before adding an object, list the IDs already used in that app (search for
`codeunit 5`, `table 5` and so on) and take a free number inside `idRanges`.
Two objects of the same type with the same ID, in any apps loaded together,
fail to compile or publish.

## Access

- `Access = Internal` on an object, or the `internal` keyword on a procedure, hides it from
  other apps unless `internalsVisibleTo` names them.
- `local` procedures are visible only inside their own object.
- Table extensions and page extensions add to objects of other apps; they cannot change
  existing fields, only add fields, keys (on the new fields) and triggers.

## Where a change belongs

Put new behavior in the app that owns the concept. If an app lower in the
dependency chain needs something from a higher one, the dependency is the wrong
way round: publish an event or an interface in the lower app instead and
implement it in the higher one (see the al-events-interfaces skill).
