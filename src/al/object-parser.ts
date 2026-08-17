/**
 * Splits AL source into its top-level objects.
 *
 * The bench writes a model's entire response into a single `<taskId>.al`
 * file, and AL permits many objects per file, so one response can contain N
 * objects. The task-authoring matrix is object-per-row, so this is the parse
 * pass every downstream consumer shares.
 *
 * @module al/object-parser
 */

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

const DECLARATION_SUFFIX = "_declaration";
const NAME_NODE_TYPES = new Set(["quoted_identifier", "identifier"]);

export interface AlObject {
  kind: string; // "codeunit" | "table" | "enum" | "interface" | "tableextension" | ...
  id?: number; // absent for interface, controladdin
  name: string; // unquoted
  extendsTarget?: string; // tableextension/enumextension only, unquoted
  startIndex: number; // byte offset into the source
  endIndex: number;
  source: string; // the object's own text
}

export interface ParsedAl {
  objects: AlObject[];
  hasError: boolean; // true when the grammar could not parse (e.g. prose)
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
 * Reads id/name/extendsTarget off an object declaration node by walking its
 * direct named children only (never recursing into the body). This keeps the
 * extraction generic across object kinds instead of hardcoding per-kind field
 * positions: the first `integer` child is the id, `quoted_identifier`/
 * `identifier` children accumulate as candidate names in source order, and an
 * `extends_keyword` child marks that the next name-like child is the extends
 * target rather than a second object name. Body nodes (`declaration_body`,
 * `interface_body`, `fields_section`, ...) are distinct node types, so their
 * nested integers/identifiers (e.g. an enum's value ordinals) are never
 * visited.
 */
function extractFields(
  node: Node,
): { id?: number; name: string; extendsTarget?: string } {
  let id: number | undefined;
  let name: string | undefined;
  let extendsTarget: string | undefined;
  let sawExtends = false;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "extends_keyword") {
      sawExtends = true;
      continue;
    }
    if (child.type === "integer" && id === undefined && !sawExtends) {
      id = Number(child.text);
      continue;
    }
    if (NAME_NODE_TYPES.has(child.type)) {
      if (sawExtends) {
        if (extendsTarget === undefined) extendsTarget = unquote(child.text);
      } else if (name === undefined) {
        name = unquote(child.text);
      }
    }
  }

  return {
    ...(id !== undefined ? { id } : {}),
    name: name ?? "",
    ...(extendsTarget !== undefined ? { extendsTarget } : {}),
  };
}

/**
 * Parses AL source and splits it into its top-level objects.
 *
 * When the grammar cannot parse the source (e.g. prose returned by a model
 * that refused the task), `hasError` is true and `objects` is empty — a
 * partially-parsed candidate would produce misleading rows in an
 * object-per-row matrix, so a parse error yields no objects rather than a
 * best-effort partial list.
 */
export async function parseAlObjects(source: string): Promise<ParsedAl> {
  const parser = await getAlParser();
  const tree = parser.parse(source);
  if (!tree) {
    return { objects: [], hasError: true };
  }

  try {
    const root = tree.rootNode;
    if (root.hasError) {
      return { objects: [], hasError: true };
    }

    const objects: AlObject[] = [];
    for (let i = 0; i < root.namedChildCount; i++) {
      const child = root.namedChild(i);
      if (!child || !child.type.endsWith(DECLARATION_SUFFIX)) continue;

      const kind = child.type.slice(0, -DECLARATION_SUFFIX.length);
      const { id, name, extendsTarget } = extractFields(child);
      objects.push({
        kind,
        ...(id !== undefined ? { id } : {}),
        name,
        ...(extendsTarget !== undefined ? { extendsTarget } : {}),
        startIndex: child.startIndex,
        endIndex: child.endIndex,
        source: child.text,
      });
    }

    return { objects, hasError: false };
  } finally {
    tree.delete();
  }
}
