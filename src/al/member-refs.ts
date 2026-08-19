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
 * **Known, deliberate limitation: chained receivers yield no ref.** A
 * `member_expression` whose object part is itself a `member_expression`
 * (`Rec.SubRec.Modify()`) is not resolved — `extractMemberParts` requires
 * both sides to be a plain name, so a chained receiver is silently excluded
 * rather than misread. This fails closed, the same shape of parked decision
 * `record-bindings.ts` documents for a `Record <id>` reference: a missed
 * catch, never a wrong one. Revisit only with real evidence a model does
 * this.
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
  /**
   * Byte offset of the ENCLOSING member node in the parsed source — the
   * join key `prereq-binder.ts` uses against
   * `ProcedureBindings.startIndex`. Both modules parse the same string with
   * the same grammar and select member nodes with the identical predicate,
   * so the offsets are equal by construction and the join is exact.
   *
   * It is the member's offset, not the ref's own, so every ref inside one
   * procedure shares it.
   */
  startIndex: number;
  /** Display name of the enclosing procedure or trigger. NOT unique across
   *  a file (two fields may each declare `trigger OnValidate()`), so it is
   *  display-only and must never be joined on. */
  procedureName: string;
  /** The `X` in `X.Y`, lowercased. */
  variable: string;
  /** The `Y` in `X.Y`, as written. */
  member: string;
  position: RefPosition;
  /** 1-based line within the parsed source, for the UI to point at. */
  line: number;
}

/**
 * Methods that take at least one field-name argument (spec §5). Kept as a
 * flat display-cased list because the brief's own contract test enumerates
 * exactly these nine names; which ARGUMENT POSITIONS actually count as
 * field names for each is NOT uniform across the set — see
 * `FIRST_ARG_ONLY_METHODS` / `ALL_ARGS_METHODS` below, which is what
 * `walkNode` actually matches against.
 */
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

/**
 * `Validate`/`SetRange`/`SetFilter`/`TestField`/`FieldError`/`GetRangeMin`/
 * `GetRangeMax` each take exactly ONE field name, as their first argument —
 * every argument after it is a value, a range bound, a filter string, or a
 * message, never a field. Treating every identifier-shaped argument as a
 * field (the bug this set exists to fix — see the module's fix-round note)
 * hard-flags a model's genuinely correct Decimal/Text/Text parameters as
 * "made up this field," which is exactly the false accusation this whole
 * module exists to avoid.
 *
 * Lowercased for matching: AL identifiers are case-insensitive, and a
 * model's own casing of a built-in method name (`line.validate(...)`) must
 * still be recognised as curated rather than silently falling through to
 * `"call"` and losing the field argument entirely.
 */
const FIRST_ARG_ONLY_METHODS = new Set(
  [
    "Validate",
    "SetRange",
    "SetFilter",
    "TestField",
    "FieldError",
    "GetRangeMin",
    "GetRangeMax",
  ]
    .map((m) => m.toLowerCase()),
);

/**
 * `CalcFields`/`CalcSums` genuinely take a field LIST — every argument is a
 * field name. This is the only shape in `FIELD_NAME_METHODS` where "every
 * identifier-shaped argument is a field" actually holds; it's where that
 * rule came from before it was (wrongly) generalised to the whole curated
 * set.
 */
const ALL_ARGS_METHODS = new Set(
  ["CalcFields", "CalcSums"].map((m) => m.toLowerCase()),
);

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
 *    `FIRST_ARG_ONLY_METHODS` (matched case-insensitively) — emits ONE ref
 *    for the first argument only, when it's identifier-shaped (`identifier`
 *    or `quoted_identifier`; an `integer`/`boolean`/`string_literal`/nested
 *    expression is not a field name). A method in `ALL_ARGS_METHODS` instead
 *    emits one ref per identifier-shaped argument, since every argument
 *    genuinely is a field there. Either way `variable` comes from the
 *    call's own `X`, position is `"curated-method-arg"`, and the method
 *    name itself is NOT emitted as a ref — only its field argument(s) are.
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
/** The enclosing member's identity, stamped onto every ref it contains.
 *  Carried as one object so `startIndex` (the join key) can never be
 *  threaded to one push site and forgotten at another. */
type MemberScope = Pick<MemberRef, "startIndex" | "procedureName">;

function walkNode(node: Node, scope: MemberScope, out: MemberRef[]): void {
  if (node.type === "assignment_statement") {
    const first = node.namedChild(0);
    if (first && first.type === "member_expression") {
      const parts = extractMemberParts(first);
      if (parts) {
        out.push({
          ...scope,
          variable: parts.variable,
          member: parts.member,
          position: "assignment-target",
          line: first.startPosition.row + 1,
        });
      }
      for (let i = 1; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) walkNode(child, scope, out);
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
        const lowerMember = parts.member.toLowerCase();
        if (FIRST_ARG_ONLY_METHODS.has(lowerMember)) {
          const firstArg = argList?.namedChild(0);
          if (firstArg && isNameNode(firstArg)) {
            out.push({
              ...scope,
              variable: parts.variable,
              member: unquote(firstArg.text),
              position: "curated-method-arg",
              line: firstArg.startPosition.row + 1,
            });
          }
        } else if (ALL_ARGS_METHODS.has(lowerMember)) {
          if (argList) {
            for (let i = 0; i < argList.namedChildCount; i++) {
              const arg = argList.namedChild(i);
              if (arg && isNameNode(arg)) {
                out.push({
                  ...scope,
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
            ...scope,
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
        if (child) walkNode(child, scope, out);
      }
    }
    return;
  }

  if (node.type === "member_expression") {
    const parts = extractMemberParts(node);
    if (parts) {
      out.push({
        ...scope,
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
    if (child) walkNode(child, scope, out);
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
      const scope: MemberScope = {
        startIndex: member.startIndex,
        procedureName: memberName(member),
      };
      const codeBlock = findDirectChild(member, "code_block");
      if (codeBlock) {
        walkNode(codeBlock, scope, out);
      }
    }
    return out;
  } finally {
    tree.delete();
  }
}
