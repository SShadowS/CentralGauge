/**
 * Indexes the fields and procedures a prereq app's table (or table
 * extension) objects actually declare.
 *
 * A trap task's draft may ship a `prereq/` app the model is expected to
 * reference, never author. Flagging a model response that invents a field
 * on that table (a hallucinated field a real compile would catch) needs
 * something that first knows what the prereq genuinely contains — this
 * module builds that lookup.
 *
 * @module al/prereq-index
 */

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

import { parseAlObjects } from "./object-parser.ts";
import { normalizeName } from "./object-identity.ts";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance. `object-parser.ts` does not
// export its parser instance, so this module loads the grammar the same way
// (copied from `trap-signature.ts`'s lazy-init pattern) rather than inventing
// a second mechanism, or a shared one, for it.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

const TABLE_KINDS = new Set(["table", "tableextension"]);

export interface PrereqTable {
  /** Table name exactly as written, for display. */
  name: string;
  /** Field names as written, in declaration order. */
  fields: string[];
  /** Procedure names as written, in declaration order. */
  procedures: string[];
}

export interface PrereqIndex {
  /** Keyed by normalizeName(table name). */
  tables: Map<string, PrereqTable>;
  /** True when any source failed to parse; the caller degrades to a file listing. */
  hasError: boolean;
}

let parserPromise: Promise<Parser> | undefined;

/** Lazily initialise the tree-sitter AL parser (once per process). */
function getAlParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const language = await Language.load(await Deno.readFile(AL_WASM_URL));
      const parser = new Parser();
      parser.setLanguage(language);
      return parser;
    })();
  }
  return parserPromise;
}

/** Strip a leading and trailing `"` when both are present. */
function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * A `field_declaration`'s named children, in order, are `field_keyword`,
 * `integer` (the id), then the name as either `quoted_identifier` or
 * `identifier`, then `type_specification`. Returns the first
 * `quoted_identifier`/`identifier` child that appears after the `integer` —
 * matching on position (rather than "the first name-like child") is what
 * keeps this from ever mistaking the id itself, or something inside a
 * populated field body, for the name.
 */
function extractFieldName(node: Node): string | undefined {
  let sawInteger = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === "integer") {
      sawInteger = true;
      continue;
    }
    if (
      sawInteger &&
      (child.type === "quoted_identifier" || child.type === "identifier")
    ) {
      return unquote(child.text);
    }
  }
  return undefined;
}

/** A `procedure` node's name is its first direct `identifier` child. */
function extractProcedureName(node: Node): string | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && child.type === "identifier") {
      return child.text;
    }
  }
  return undefined;
}

/**
 * Walks a table (or table extension) object's own parse tree, collecting
 * every field and procedure name in declaration order.
 *
 * Stops descending the moment it matches either node type: a
 * `field_declaration` has nothing below it worth walking further, and a
 * `procedure` node's body must never be recursed into while collecting
 * fields — a local variable or parameter inside a procedure is not a table
 * field, and nothing about AL forbids code that merely resembles one.
 */
function walk(node: Node, fields: string[], procedures: string[]): void {
  if (node.type === "field_declaration") {
    const name = extractFieldName(node);
    if (name !== undefined) fields.push(name);
    return;
  }
  if (node.type === "procedure") {
    const name = extractProcedureName(node);
    if (name !== undefined) procedures.push(name);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walk(child, fields, procedures);
  }
}

/**
 * Builds a lookup of every table/table-extension object across `sources`,
 * keyed by `normalizeName(table name)`.
 *
 * `hasError` is set when `parseAlObjects` itself fails on a source, or when
 * a table object's own re-parse yields a tree whose `rootNode.hasError` is
 * true — either way the caller cannot trust the index is complete, and
 * degrades to a plain file listing rather than asserting (wrongly) that a
 * field doesn't exist.
 */
export async function buildPrereqIndex(
  sources: string[],
): Promise<PrereqIndex> {
  const tables = new Map<string, PrereqTable>();
  let hasError = false;

  for (const source of sources) {
    const parsed = await parseAlObjects(source);
    if (parsed.hasError) {
      hasError = true;
      continue;
    }

    for (const obj of parsed.objects) {
      if (!TABLE_KINDS.has(obj.kind)) continue;

      const parser = await getAlParser();
      let tree: ReturnType<Parser["parse"]>;
      try {
        tree = parser.parse(obj.source);
      } catch {
        hasError = true;
        continue;
      }
      if (!tree) {
        hasError = true;
        continue;
      }

      try {
        if (tree.rootNode.hasError) {
          hasError = true;
          continue;
        }

        const fields: string[] = [];
        const procedures: string[] = [];
        walk(tree.rootNode, fields, procedures);

        tables.set(normalizeName(obj.name), {
          name: obj.name,
          fields,
          procedures,
        });
      } finally {
        tree.delete();
      }
    }
  }

  return { tables, hasError };
}

/** True when `table` has a field named `member` (quote/case-insensitive). */
export function lookupField(
  index: PrereqIndex,
  table: string,
  member: string,
): boolean {
  const t = index.tables.get(normalizeName(table));
  if (!t) return false;
  const target = normalizeName(member);
  return t.fields.some((f) => normalizeName(f) === target);
}

/** True when `table` has a procedure named `member` (quote/case-insensitive). */
export function lookupProcedure(
  index: PrereqIndex,
  table: string,
  member: string,
): boolean {
  const t = index.tables.get(normalizeName(table));
  if (!t) return false;
  const target = normalizeName(member);
  return t.procedures.some((p) => normalizeName(p) === target);
}
