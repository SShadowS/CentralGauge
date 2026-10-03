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

- `cg-al symbols` lists the objects, procedures and events of the installed
  packages. Use it to check that a base app or system app object exists and
  what its procedures and events look like.
- Prefer an existing procedure or event from a package over writing your own.

## Before you change something

- Find every caller and every subscriber of the element you are changing.
- Find the tests that cover it, so you know which test codeunits to run.
- Check how the same thing is done elsewhere in the app and follow that.
