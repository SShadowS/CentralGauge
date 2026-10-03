---
name: al-symbols
description: List the symbol packages installed on the Business Central server with cg-al symbols. Use when a dependency does not resolve or you need to know which apps and versions are available.
---

# Symbol packages with cg-al

## Usage

`cg-al symbols` takes no arguments. Exit codes and the shape of the JSON line
are the same as for compile; see the `al-compile` skill.

`result.packages` lists one entry per installed package with its `name`,
`publisher` and `version`. That is all it returns: no objects, procedures,
fields or events.

## Relating packages to app.json

Each app folder in `C:\workspace` has an `app.json` whose `dependencies` name
the apps it builds on, each with a name, publisher and minimum version.

1. Read the `dependencies` of the app you are working on.
2. Run `cg-al symbols`.
3. For each dependency, find the package with the same name and publisher.
   - Not in the list and not an app folder in the workspace: the dependency
     cannot resolve. Do not add a dependency the server does not have.
   - In the list with a version below the minimum in `app.json`: it will not
     resolve either.
4. A dependency that is another app folder in the workspace is built from
   source by `cg-al compile`; search its source to see what it offers.
5. For a package without source here, rely on the objects your code already
   uses from it and on what the compiler reports when you reference something.

Do not add dependencies to an app to solve a ticket unless the ticket asks for
it; work with what the app can already see.
