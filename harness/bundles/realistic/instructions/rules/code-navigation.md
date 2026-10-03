If an LSP tool is available, use it first for symbols, definitions, references and diagnostics, and fall back to search when it has no answer.

# Code navigation

Find what you need before you read it. Opening whole files to look for a
procedure wastes time and hides what matters.

## Searching the repository

Search from `C:\workspace` and name the folder you search in. Useful patterns:

- A procedure: `procedure <Name>(` (quote the name if it has spaces).
- An object: the object type and name, for example `codeunit <ID> "<Name>"` or
  `table <ID> "<Name>"`.
- Callers of a procedure: `<Name>(` across all apps, not only the app that
  defines it.
- Event publishers: `[IntegrationEvent` and `[BusinessEvent`.
- Subscribers to an event: `[EventSubscriber` together with the event name.
- Interface implementations: `implements "<Interface Name>"`.
- Extensions of an object: `tableextension`, `pageextension` or
  `enumextension` with the base object's name.
- Labels and error texts: search the text itself to find where a message is
  raised.

Read the matching lines first; open the file only when you need the context
around them.

## App structure

- Each app folder has an `app.json`. Its `dependencies` tell you which other
  apps the app can see, and so where a referenced object can live.
- An object referenced in code but not found in the repository comes from a
  dependency package: the base app, the system app, or another installed app.

## Symbols from packages

- `cg-al symbols` lists the packages installed on the server: the name,
  publisher and version of each one. It does not list objects, procedures or
  events.
- Use it to see which apps and versions are available, and compare that with
  the `dependencies` in each `app.json`. Two steps need them in different
  ways: compiling resolves each dependency from its symbol package, while
  publishing and running tests need the dependency installed on the server. A
  dependency that is missing from the list, or listed in an older version than
  `app.json` asks for, fails at one of those steps.
- To find out what an app in the repository offers, search its source. For a
  package without source here, rely on the objects your code already uses from
  it and on what the compiler reports.
- Prefer an existing procedure or event over writing your own.

## Before you change something

- Find every caller and every subscriber of the element you are changing.
- Find the tests that cover it, so you know which test codeunits to run.
- Check how the same thing is done elsewhere in the app and follow that.
