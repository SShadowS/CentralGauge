/**
 * Reflow a task description for markdown rendering.
 *
 * Descriptions come from task YAML in two shapes:
 *   - Literal blocks (`|-`) and indented folded lines keep their newlines and
 *     indentation. Those are already close to markdown: nested lists, 4-space
 *     code samples (`    procedure Foo()`), one sentence-paragraph per line.
 *     The indentation is what makes nesting and code blocks work, so it is
 *     kept and only re-anchored relative to the list it belongs to.
 *   - Fully folded (`>-`) lines collapse an authored list onto one line:
 *     `fields: - Code (Code[20]) - Name (Text[100])`. Such a line is split
 *     only on the unambiguous shape "colon, then ` - ` items that start with
 *     an uppercase letter, a quote or a bracket" (or repeat the first item's
 *     leading token, e.g. `value(0; ...) - value(1; ...)`). A lowercase
 *     ` - capitalizes the first letter` is prose and stays inside its item.
 *
 * Per-line rules outside lists: a newline between two prose lines is a
 * paragraph break (authors put one sentence-paragraph per line), and a line
 * indented 4+ spaces is a code block. Inside a list, a non-item line indented
 * deeper than the list is a continuation and keeps its own line (a hard
 * break), so multi-line samples under an item (SQL, JSON) stay readable.
 */

const ITEM = /^([-*+]|\d+\.)\s/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a folded `intro: - A - B - C` line into an intro plus list items. */
function splitInlineList(line: string): string[] {
  const at = line.indexOf(": - ");
  if (at < 0) return [line];
  const pad = " ".repeat(indentOf(line));
  const head = line.slice(0, at + 1);
  const rest = line.slice(at + 4);
  const firstToken = /^[^\s(]*\(?/.exec(rest)?.[0] ?? "";
  const starts =
    firstToken.length > 1 ? `[A-Z"'([]|${escapeRe(firstToken)}` : `[A-Z"'([]`;
  const items = rest.split(new RegExp(` - (?=${starts})`));
  if (items.length < 2) return [line];
  return [head, ...items.map((i) => `${pad}- ${i.trim()}`)];
}

export function reflowDescription(s: string): string {
  if (!s) return s;
  const lines = s.replace(/\r\n?/g, "\n").split("\n").flatMap(splitInlineList);

  const out: string[] = [];
  let inList = false;
  let base = 0; // indent of the current top-level list's items
  const prev = () => out[out.length - 1];
  const prevBlank = () => out.length === 0 || prev() === "";

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "") {
      if (!prevBlank()) out.push("");
      continue;
    }
    const indent = indentOf(line);
    const body = line.trimStart();
    const isItem = ITEM.test(body);

    if (inList && !isItem && indent <= base) inList = false;

    if (isItem && !inList) {
      inList = true;
      base = indent;
      if (!prevBlank()) out.push("");
    }

    if (inList) {
      const rel = Math.max(0, indent - base);
      if (!isItem && !prevBlank()) out[out.length - 1] = prev() + "  ";
      out.push(" ".repeat(rel) + body);
      continue;
    }

    if (indent >= 4) {
      // Code block: needs a blank line before it, then verbatim lines.
      if (!prevBlank() && indentOf(prev()) < 4) out.push("");
      out.push(line);
      continue;
    }

    if (!prevBlank()) out.push("");
    out.push(body);
  }
  return out.join("\n").trim();
}
