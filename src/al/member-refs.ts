/**
 * Collects every `X.Y` member reference in an AL source, tagged with the
 * syntactic position it appears in.
 *
 * A model response that names a field existing in no prereq table is only
 * safe to flag once we know *how confidently* — and that confidence comes
 * entirely from where the reference sits, not from the reference itself.
 * `Line."Unit Price" := 1` is provable: `Y` is on the left of `:=`, and AL
 * has no way for a procedure to occupy that position, so an unknown `Y`
 * there is provably not a field. `Line.Modify(true)` is not provable the
 * same way — `Y` is a call target, and `Modify` might be a Record built-in
 * nobody indexed, not an invented field. Getting the position wrong turns a
 * soft "unknown member" into a hard "made up this field": a false
 * accusation against a model that wrote correct code. This module answers
 * only "where does this reference sit"; tiering the confidence from that
 * position is a later task's job.
 *
 * @module al/member-refs
 */

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance. `object-parser.ts` does not
// export its parser instance, so this module loads the grammar the same way
// (copied from `trap-signature.ts`'s lazy-init pattern) rather than inventing
// a second mechanism, or a shared one, for it — see `record-bindings.ts` and
// `prereq-index.ts` for the same deliberate duplication in this plan.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

/** Where an `X.Y` reference appears, which is what decides its tier. */
export type RefPosition =
  | "assignment-target"
  | "curated-method-arg"
  | "call"
  | "other";

export interface MemberRef {
  /** Display name of the enclosing procedure or trigger. */
  procedureName: string;
  /** The `X` in `X.Y`, lowercased. */
  variable: string;
  /** The `Y` in `X.Y`, as written. */
  member: string;
  position: RefPosition;
  /** 1-based line within the parsed source, for the UI to point at. */
  line: number;
}

/** Methods whose first argument is a field name (spec §5). */
export const FIELD_NAME_METHODS: readonly string[] = [
  "Validate",
  "SetRange",
  "SetFilter",
  "TestField",
  "CalcFields",
  "CalcSums",
  "FieldError",
  "GetRangeMin",
  "GetRangeMax",
];

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

/** True for a plain or quoted identifier node — the only two shapes that
 * name something in this grammar. */
function isNameNode(node: Node): boolean {
  return node.type === "identifier" || node.type === "quoted_identifier";
}

/**
 * The `variable`/`member` pair a `member_expression` node names, or
 * undefined when either side isn't a name (nested/chained member access,
 * which this module doesn't resolve).
 *
 * Both parts may be `quoted_identifier`, not just `identifier` — probed
 * against the vendored grammar: `Line."Unit Price" := 1` yields a
 * `member_expression` whose children are `identifier="Line"` and
 * `quoted_identifier="\"Unit Price\""`, parsing with `hasError: false`.
 * Matching `identifier` only here would silently drop every quoted member
 * reference — the exact defect that already shipped twice in this plan
 * (Task 2 for variable/parameter/procedure names, Task 1 for table
 * procedure names). Both node types are matched at both positions.
 */
function extractMemberParts(
  memberExpr: Node,
): { variable: string; member: string } | undefined {
  const objectNode = memberExpr.namedChild(0);
  const propertyNode = memberExpr.namedChild(1);
  if (!objectNode || !propertyNode) return undefined;
  if (!isNameNode(objectNode) || !isNameNode(propertyNode)) return undefined;
  return {
    variable: unquote(objectNode.text).toLowerCase(),
    member: unquote(propertyNode.text),
  };
}

/** True for a procedure- or trigger-shaped member node. Members don't
 * nest in AL, so this is an exact type match rather than a substring one
 * (matches `record-bindings.ts`'s `isMemberNode`). */
function isMemberNode(node: Node): boolean {
  return node.type === "procedure" || node.type === "trigger_declaration";
}

/**
 * The first direct child that names something — `identifier` or
 * `quoted_identifier`, matching `isNameNode` above — or undefined when
 * neither is present.
 */
function findNameNode(node: Node): Node | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && isNameNode(child)) return child;
  }
  return undefined;
}

/**
 * A member node's own display name, quotes stripped. Case is preserved
 * (unlike `variable`) since this is what the UI shows for the enclosing
 * procedure/trigger, not a lookup key.
 */
function memberName(node: Node): string {
  const nameNode = findNameNode(node);
  return nameNode ? unquote(nameNode.text) : "";
}

/**
 * Walks the tree collecting every procedure/trigger member node. Stops
 * descending the instant a member node is found — AL members don't nest.
 */
function collectMembers(node: Node, out: Node[]): void {
  if (isMemberNode(node)) {
    out.push(node);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectMembers(child, out);
  }
}

/**
 * Walks a member's body collecting `MemberRef`s, one node at a time:
 *
 * 1. `assignment_statement` whose first named child is a `member_expression`
 *    — that expression is the assignment target, so it's classified
 *    `"assignment-target"` and NOT re-visited generically (the loop below
 *    continues into the remaining children — the RHS — instead of falling
 *    through to the generic branch, so the target isn't also emitted as
 *    `"other"`).
 * 2. `call_expression` whose callee `member_expression`'s member is in
 *    `FIELD_NAME_METHODS` — emits one ref **per identifier-shaped argument**
 *    (`identifier` or `quoted_identifier`; an `integer`/`boolean`/
 *    `string_literal`/nested expression is not a field name), each tagged
 *    `"curated-method-arg"` with `variable` from the call's own `X`. The
 *    method name itself is NOT emitted as a ref — only its arguments are.
 * 3. Any other `call_expression` on a `member_expression` — emits the
 *    method name itself as `"call"`.
 * 4. A `member_expression` reached by neither case above (e.g. the RHS of
 *    an assignment, a condition, a non-field-shaped argument) — emitted as
 *    `"other"` rather than silently dropped or miscounted as a call.
 *
 * Every `call_expression`'s `argument_list` is still walked recursively
 * (whether or not the call is curated) so a nested call or member
 * expression inside an argument contributes its own, correctly classified
 * ref — and does NOT create a spurious curated-method-arg entry for the
 * outer call, since the curated-arg scan only matches direct
 * `identifier`/`quoted_identifier` children of `argument_list`, never a
 * nested `call_expression`.
 */
function walkNode(node: Node, procedureName: string, out: MemberRef[]): void {
  if (node.type === "assignment_statement") {
    const first = node.namedChild(0);
    if (first && first.type === "member_expression") {
      const parts = extractMemberParts(first);
      if (parts) {
        out.push({
          procedureName,
          variable: parts.variable,
          member: parts.member,
          position: "assignment-target",
          line: first.startPosition.row + 1,
        });
      }
      for (let i = 1; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) walkNode(child, procedureName, out);
      }
      return;
    }
    // Target isn't a member_expression (e.g. a plain variable) — fall
    // through to the generic branch below.
  }

  if (node.type === "call_expression") {
    const memberExpr = findDirectChild(node, "member_expression");
    const argList = findDirectChild(node, "argument_list");

    if (memberExpr) {
      const parts = extractMemberParts(memberExpr);
      if (parts) {
        if (FIELD_NAME_METHODS.includes(parts.member)) {
          if (argList) {
            for (let i = 0; i < argList.namedChildCount; i++) {
              const arg = argList.namedChild(i);
              if (arg && isNameNode(arg)) {
                out.push({
                  procedureName,
                  variable: parts.variable,
                  member: unquote(arg.text),
                  position: "curated-method-arg",
                  line: arg.startPosition.row + 1,
                });
              }
            }
          }
        } else {
          out.push({
            procedureName,
            variable: parts.variable,
            member: parts.member,
            position: "call",
            line: memberExpr.startPosition.row + 1,
          });
        }
      }
    }

    if (argList) {
      for (let i = 0; i < argList.namedChildCount; i++) {
        const child = argList.namedChild(i);
        if (child) walkNode(child, procedureName, out);
      }
    }
    return;
  }

  if (node.type === "member_expression") {
    const parts = extractMemberParts(node);
    if (parts) {
      out.push({
        procedureName,
        variable: parts.variable,
        member: parts.member,
        position: "other",
        line: node.startPosition.row + 1,
      });
    }
    return;
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkNode(child, procedureName, out);
  }
}

/**
 * Parses `source` and returns every `X.Y` member reference across all
 * procedures/triggers, tagged with its position.
 *
 * Returns `[]` when the source fails to parse, or parses with an error —
 * a partial tree is not a safe basis for classifying a reference's
 * position.
 */
export async function collectMemberRefs(source: string): Promise<MemberRef[]> {
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

    const members: Node[] = [];
    collectMembers(tree.rootNode, members);

    const out: MemberRef[] = [];
    for (const member of members) {
      const procedureName = memberName(member);
      const codeBlock = findDirectChild(member, "code_block");
      if (codeBlock) {
        walkNode(codeBlock, procedureName, out);
      }
    }
    return out;
  } finally {
    tree.delete();
  }
}
