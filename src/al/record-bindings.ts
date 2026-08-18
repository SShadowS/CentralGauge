/**
 * Scoped Record-variable bindings per procedure/trigger.
 *
 * A model response referencing a field on a variable is only safe to flag
 * as invented once we know which table that variable actually names. AL
 * lets a local or parameter reuse a global's name while binding it to a
 * DIFFERENT table (deliberate shadowing, or an unrelated coincidence), so
 * naively taking "the global binding" for every occurrence of a name would
 * turn a correct field reference into a false accusation. This module
 * resolves that per procedure/trigger, in the same scoping order AL itself
 * uses: globals, then that member's own parameters, then its own locals -
 * each later layer shadowing the one before it.
 *
 * A `Record <id>` reference (a table named by numeric id, e.g. `Record 18`)
 * is deliberately NOT resolved: `record_type`'s reference child is an
 * `(integer)` node there, which `recordTableName()` doesn't match, so the
 * variable is silently excluded rather than bound. This fails closed - a
 * missed catch, never a wrong bind - and the realistic case (a base-app
 * table referenced by id) is untracked by this plan's prereq index anyway.
 * Supporting it would mean teaching the prereq index to key by table id as
 * well as name, on a guessed model behaviour nobody has observed. Ruled out
 * during task 2 review; revisit only with real evidence a model does this.
 *
 * An `array[N] of Record "T"` variable is excluded for the same reason and
 * with the same consequence: verified to yield no binding at all, so it
 * fails closed rather than binding to `T`. Grouped here rather than left
 * undocumented so the module's set of deliberate silences is readable in
 * one place.
 *
 * @module al/record-bindings
 */

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance. `object-parser.ts` does not
// export its parser instance, so this module loads the grammar the same way
// (copied from `trap-signature.ts`'s lazy-init pattern) rather than inventing
// a second mechanism, or a shared one, for it.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

export interface ProcedureBindings {
  /**
   * Byte offset of the member node in the parsed source — the JOIN KEY
   * `prereq-binder.ts` uses to tie these bindings to the member refs
   * `member-refs.ts` collects from the SAME string with the SAME grammar,
   * so the two offsets are identical by construction.
   *
   * `procedureName` is display-only and MUST NOT be joined on: it is not
   * unique. Two `trigger OnValidate()`s on two fields of one table — the
   * most ordinary shape in AL — share a name, and joining on it silently
   * gave every reference in the first one the second one's bindings, i.e.
   * a provably-correct field reported as invented against a table it was
   * never declared against.
   */
  startIndex: number;
  /** Display name of the procedure or trigger. NOT unique — see `startIndex`. */
  procedureName: string;
  /** Lowercased variable name -> table name as written. */
  bindings: Map<string, string>;
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

/** First direct named child of the given type, or undefined. Never recurses. */
function findDirectChild(node: Node, type: string): Node | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && child.type === type) return child;
  }
  return undefined;
}

/** Strip a leading and trailing `"` when both are present. */
function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

/** True for a procedure- or trigger-shaped member node. Members don't
 * nest in AL, so this is an exact type match rather than a substring one. */
function isMemberNode(node: Node): boolean {
  return node.type === "procedure" || node.type === "trigger_declaration";
}

/**
 * The first direct child that names something - a plain `identifier`
 * (`Line`) or a `quoted_identifier` (`"My Rec"`, needed the moment a name
 * has a space or another AL keyword collision) - or undefined when neither
 * is present. AL uses `quoted_identifier` for variable, parameter, and
 * procedure/trigger names exactly as often as it does for table/field
 * names elsewhere in this plan; treating only `identifier` as a name would
 * silently drop every quoted one.
 */
function findNameNode(node: Node): Node | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (
      child &&
      (child.type === "identifier" || child.type === "quoted_identifier")
    ) {
      return child;
    }
  }
  return undefined;
}

/**
 * The Record table name a `type_specification` node binds to, as written
 * (quotes stripped), or undefined when it names anything else (a basic
 * type, an interface, an enum, ...).
 */
function recordTableName(typeSpec: Node): string | undefined {
  const recordType = findDirectChild(typeSpec, "record_type");
  if (!recordType) return undefined;
  const reference = findDirectChild(recordType, "quoted_identifier") ??
    findDirectChild(recordType, "identifier");
  return reference ? unquote(reference.text) : undefined;
}

/**
 * The single Record-typed name+table pair declared by a `parameter` node,
 * or `[]` when its type is not a Record. AL parameters declare exactly one
 * name each (`A, B: Record "X"` is a syntax error in a parameter list).
 */
function parameterBindings(node: Node): Array<[string, string]> {
  const typeSpec = findDirectChild(node, "type_specification");
  const table = typeSpec ? recordTableName(typeSpec) : undefined;
  if (table === undefined) return [];
  const nameNode = findNameNode(node);
  return nameNode ? [[unquote(nameNode.text).toLowerCase(), table]] : [];
}

/**
 * Every Record-typed name+table pair declared by a `variable_declaration`
 * node, or `[]` when its type is not a Record. A single declaration may
 * name several variables sharing one type (`A, B: Record "X";`) - every
 * `identifier`/`quoted_identifier` child is a separate name, not just the
 * first.
 */
function variableDeclarationBindings(node: Node): Array<[string, string]> {
  const typeSpec = findDirectChild(node, "type_specification");
  const table = typeSpec ? recordTableName(typeSpec) : undefined;
  if (table === undefined) return [];
  const out: Array<[string, string]> = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (
      child &&
      (child.type === "identifier" || child.type === "quoted_identifier")
    ) {
      out.push([unquote(child.text).toLowerCase(), table]);
    }
  }
  return out;
}

/** Record bindings from every `variable_declaration` under a `var_section`
 * node's `var_body`. */
function varSectionBindings(varSection: Node): Array<[string, string]> {
  const body = findDirectChild(varSection, "var_body");
  if (!body) return [];
  const out: Array<[string, string]> = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (child && child.type === "variable_declaration") {
      out.push(...variableDeclarationBindings(child));
    }
  }
  return out;
}

/** Record bindings from every `parameter` under a `parameter_list` node. */
function parameterListBindings(paramList: Node): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < paramList.namedChildCount; i++) {
    const child = paramList.namedChild(i);
    if (child && child.type === "parameter") {
      out.push(...parameterBindings(child));
    }
  }
  return out;
}

/**
 * Walks ONE top-level object's subtree collecting that object's globals
 * (bindings from every `var_section` that is NOT inside a
 * procedure/trigger) and every procedure/trigger member node it declares.
 *
 * Called once per top-level node by `collectRecordBindings`, with a FRESH
 * `globals` array each time — never once over the whole root. AL scopes a
 * global to the object that declares it, so a shared array let object B's
 * global be in scope for a procedure in object A, binding a variable to a
 * table it was never declared against. Locals and parameters are applied
 * afterwards and so still shadowed correctly, which is exactly why the
 * shadowing tests passed while that went unseen.
 *
 * Stops descending the instant a member node is found - AL members don't
 * nest, so nothing below one can itself be another member or an
 * object-level `var_section`. That early return is what makes "reaches the
 * object's declaration_body without passing through a procedure or
 * trigger_declaration" (the brief's definition of "global") automatic: a
 * `var_section` belonging to a member is only ever visited via that
 * member's own direct-child lookup in `collectRecordBindings`, never via
 * this walk.
 */
function collect(
  node: Node,
  globals: Array<[string, string]>,
  members: Node[],
): void {
  if (isMemberNode(node)) {
    members.push(node);
    return;
  }
  if (node.type === "var_section") {
    globals.push(...varSectionBindings(node));
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collect(child, globals, members);
  }
}

/**
 * A procedure/trigger member's own name (quotes stripped when quoted), or
 * "" when it has none. Every `procedure`/`trigger_declaration` in valid AL
 * names itself, via either an `identifier` or a `quoted_identifier` - both
 * are handled by `findNameNode`, so "" is not reachable from valid,
 * cleanly-parsing AL. (It previously WAS reachable, silently, for any
 * quoted procedure/trigger name, back when this only checked `identifier`
 * - see the record-bindings review for task 2.) Kept as a total fallback
 * rather than throwing, in case a future grammar revision adds a member
 * shape this hasn't seen.
 */
function memberName(node: Node): string {
  const nameNode = findNameNode(node);
  return nameNode ? unquote(nameNode.text) : "";
}

/**
 * Parses `source` and returns Record-variable bindings scoped to each
 * procedure/trigger member.
 *
 * Each member's map is built by inserting, in order: the globals of the
 * object THAT MEMBER BELONGS TO, then that member's own parameters, then
 * that member's own locals - a later layer overwrites an earlier one for
 * the same lowercased name, which is exactly AL's own shadowing rule (a
 * local or parameter reusing a global's name binds to whatever table IT
 * declares, not the global's).
 *
 * Scoping is per top-level node, not per file: each direct named child of
 * the root gets its own `globals` array. Two objects in one response may
 * each declare a global of the same name against a DIFFERENT table, and
 * leaking one into the other's members is a wrong bind, not a missed one.
 *
 * Each entry carries the member node's `startIndex`, which is what
 * `prereq-binder.ts` joins on - `procedureName` is not unique across a
 * file, or even within one object.
 *
 * A variable/parameter whose type is not a Record (including one with no
 * declared type at all) is never inserted - a stray non-Record name colliding
 * with an unrelated global's spelling must not pull in a table binding that
 * was never meant for it.
 *
 * Returns `[]` when the source fails to parse, or parses with an error -
 * a partial tree is not a safe basis for accusing a model of a hallucinated
 * field.
 */
export async function collectRecordBindings(
  source: string,
): Promise<ProcedureBindings[]> {
  const parser = await getAlParser();

  let tree: ReturnType<Parser["parse"]>;
  try {
    tree = parser.parse(source);
  } catch {
    return [];
  }
  if (!tree) return [];

  try {
    if (tree.rootNode.hasError) return [];

    const out: ProcedureBindings[] = [];
    const root = tree.rootNode;
    // One scope per direct named child of the root — every top-level node,
    // not only `*_declaration` ones, so the member set here stays exactly
    // the set `member-refs.ts` walks (it walks the whole root) and no ref
    // is left without an entry to join against.
    for (let i = 0; i < root.namedChildCount; i++) {
      const objectNode = root.namedChild(i);
      if (!objectNode) continue;

      const globals: Array<[string, string]> = [];
      const members: Node[] = [];
      collect(objectNode, globals, members);

      for (const member of members) {
        const bindings = new Map<string, string>(globals);

        const paramList = findDirectChild(member, "parameter_list");
        if (paramList) {
          for (const [name, table] of parameterListBindings(paramList)) {
            bindings.set(name, table);
          }
        }

        const varSection = findDirectChild(member, "var_section");
        if (varSection) {
          for (const [name, table] of varSectionBindings(varSection)) {
            bindings.set(name, table);
          }
        }

        out.push({
          startIndex: member.startIndex,
          procedureName: memberName(member),
          bindings,
        });
      }
    }
    return out;
  } finally {
    tree.delete();
  }
}
