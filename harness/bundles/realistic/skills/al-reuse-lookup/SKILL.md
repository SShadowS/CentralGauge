---
name: al-reuse-lookup
description: Look for an existing procedure, event or interface before writing a new one. Use whenever you are about to add a procedure or helper.
---

# Reuse lookup

Before you write a procedure, find out whether one already does the job. Calling
an existing procedure beats writing a copy: the copy drifts, and the original
may already handle cases you have not thought of.

## Procedure

1. Say in one line what the procedure you need does, and list the words a name
   for it would contain (verbs and nouns, singular and plural).
2. Search the app you are changing, from its folder under `C:\workspace`:
   - Procedures: `procedure ` followed by a name containing the word
     (case-insensitive), quoted or not, for each word.
   - Callers of a candidate: `<Name>(` across all app folders.
   - Events: `[IntegrationEvent` and `[BusinessEvent`, then the lines after
     them for names containing your words.
   - Interfaces: `interface "` and `implements "`.
3. Read the `dependencies` in the app's `app.json` and search each dependency
   that is an app folder in the workspace the same way.
4. Run `cg-al symbols` to see which other packages the server has. For those
   there is no source here; note them, and rely on objects the code already
   uses from them.
5. For each candidate, read its signature and its body. Check its visibility:
   a `local` procedure can only be called inside its own object, and an
   `internal` one only inside its own app.

## Report

List the candidates, best first, each as:

- `file:line` and the full signature.
- What it does, in one line.
- Why it fits or what it lacks for the need.

If nothing fits, say so and say what you searched for, so the reader knows the
search was done.

## Deciding

- Prefer calling an existing public procedure over copying its code.
- If an existing procedure almost fits, consider extending it only when that
  does not change its behaviour for its current callers; see the breaking
  changes rule.
- If a process raises an event that gives you what you need, subscribe to it
  rather than changing the process.
