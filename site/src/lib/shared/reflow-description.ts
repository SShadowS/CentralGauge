/**
 * Reflow a task description for markdown rendering.
 *
 * Task YAML descriptions are authored as folded block scalars (`>-`), which
 * collapse single newlines into spaces at parse time. Authors who INDENTED
 * list items (more than the intro line) keep their newlines — YAML preserves
 * line breaks for more-indented lines and blank lines. Those survive as `\n`
 * (often `\n` + leading spaces) in the stored text. This helper turns those
 * preserved breaks back into clean markdown so `marked` renders real lists and
 * paragraphs.
 *
 * SAFETY: it only reflows on UNAMBIGUOUS markers — a list/numbered marker
 * preceded by 2+ whitespace characters (i.e. a folded/indented line break).
 * A single-space " - " is left untouched: in the fully-flat-folded easy tasks
 * a single-space dash is indistinguishable from a genuine prose hyphen
 * (e.g. "InputText: Text): Text - capitalizes the first letter"), so splitting
 * it would mangle prose. Those descriptions render as-is (one paragraph) rather
 * than risk a wrong list. Fixing them properly requires re-authoring the YAML
 * to a literal block (`|-`), which changes the task_set hash.
 */
export function reflowDescription(s: string): string {
  if (!s) return s;
  let out = s
    // Folded bullet: 2+ whitespace (a collapsed indented line break) + "- ".
    .replace(/\s{2,}-\s+/g, "\n- ")
    // Folded numbered item: 2+ whitespace + "N. ".
    .replace(/\s{2,}(\d+)\.\s+/g, "\n$1. ")
    // Collapse any remaining runs of fold-spaces to a single space.
    .replace(/[ \t]{2,}/g, " ");
  // Ensure a blank line before a list item that directly follows non-list text
  // so markdown parses a list, not a soft-wrapped paragraph line.
  out = out.replace(/([^\n])\n(- |\d+\. )/g, "$1\n\n$2");
  return out.trim();
}
