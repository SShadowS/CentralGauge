/**
 * Pins the exact tree-sitter-al node shapes the prereq binder
 * (`src/al/prereq-index.ts`, `src/al/record-bindings.ts`,
 * `src/al/member-refs.ts`) depends on.
 *
 * Those three modules walk the parse tree by NODE TYPE and NAMED-CHILD
 * POSITION, not by any grammar-provided field name, so there is no compiler
 * to catch a shape assumption breaking under a future grammar bump.
 * `trap-signature.test.ts` already pins the `_body` wrapper node-type set
 * plan 1 depends on; this file pins the three additional shapes THIS plan
 * reads. If a bump silently changes one of them, the binder does not crash
 * — it quietly stops flagging hallucinated fields, which is the failure
 * mode hardest to notice and the one this whole plan exists to prevent. A
 * named failure here turns that into a loud one instead.
 *
 * @module
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). Same lazy-init
// pattern as prereq-index.ts / record-bindings.ts / member-refs.ts / the
// trap-signature.test.ts grammar-invariant test — this file deliberately
// loads its own parser instance rather than sharing one, matching the
// established pattern in this plan.
const AL_WASM_URL = new URL(
  "../../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

// Covers all three pinned shapes in one object: a table with a quoted and
// an unquoted field, and a procedure that calls a FIRST_ARG_ONLY_METHODS
// method (SetRange) with an identifier argument and another (Validate)
// with a quoted-identifier field name followed by a boolean literal.
const FIXTURE = `table 69001 "T"
{
    fields
    {
        field(1; "Quoted Name"; Code[20]) { }
        field(2; Unquoted; Boolean) { }
    }
}
codeunit 70001 "C"
{
    procedure P(var Line: Record "T")
    begin
        Line.SetRange(Unquoted, 1);
        Line.Validate("Quoted Name", true);
    end;
}`;

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

/** Depth-first collection of every node of the given type. */
function collectByType(node: Node, type: string, out: Node[]): void {
  if (node.type === type) out.push(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectByType(child, type, out);
  }
}

/** Named child types, in declaration order — used both to assert against
 * and to render into failure messages. */
function namedChildTypes(node: Node): string[] {
  const types: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    types.push(node.namedChild(i)?.type ?? "<null>");
  }
  return types;
}

/** True for the two node types that name something in this grammar
 * (matches member-refs.ts's `isNameNode`). */
function isNameNodeType(type: string): boolean {
  return type === "identifier" || type === "quoted_identifier";
}

/**
 * Finds the `argument_list` of the one `call_expression` whose
 * `member_expression` property (case-insensitive, quotes stripped) equals
 * `methodName`. The fixture has exactly one call per method name, so a
 * depth-first first-match is unambiguous here.
 */
function findArgumentList(root: Node, methodName: string): Node | undefined {
  const calls: Node[] = [];
  collectByType(root, "call_expression", calls);
  for (const call of calls) {
    let memberExpr: Node | undefined;
    let argList: Node | undefined;
    for (let i = 0; i < call.namedChildCount; i++) {
      const child = call.namedChild(i);
      if (!child) continue;
      if (child.type === "member_expression") memberExpr = child;
      if (child.type === "argument_list") argList = child;
    }
    if (!memberExpr) continue;
    const property = memberExpr.namedChild(1);
    if (!property) continue;
    const propertyText = property.text.replace(/^"|"$/g, "");
    if (propertyText.toLowerCase() === methodName.toLowerCase()) {
      return argList;
    }
  }
  return undefined;
}

describe("al/grammar-shape: pinned shapes the prereq binder depends on", () => {
  it("reads a field's name by position: field_keyword, integer, then quoted_identifier or identifier", async () => {
    const parser = await getAlParser();
    const tree = parser.parse(FIXTURE);
    assertExists(tree, "fixture failed to parse at all");
    try {
      assertEquals(
        tree.rootNode.hasError,
        false,
        "fixture parsed with a syntax error — the vendored grammar may have changed",
      );

      const fieldDeclarations: Node[] = [];
      collectByType(tree.rootNode, "field_declaration", fieldDeclarations);
      assertEquals(
        fieldDeclarations.length,
        2,
        `expected exactly 2 field_declaration nodes, got ${fieldDeclarations.length} — the vendored grammar may have changed how "field(...)" is parsed`,
      );

      const quotedField = fieldDeclarations[0];
      const plainField = fieldDeclarations[1];
      assertExists(quotedField);
      assertExists(plainField);

      const quotedTypes = namedChildTypes(quotedField);
      assertEquals(
        quotedTypes.slice(0, 3),
        ["field_keyword", "integer", "quoted_identifier"],
        `field_declaration's first 3 named children changed shape (expected: field_keyword, integer, quoted_identifier; got: ${
          quotedTypes.join(", ")
        }) — src/al/prereq-index.ts's extractFieldName() reads the field name BY POSITION after the integer id; if this shape moved, quoted field names silently stop being found`,
      );

      const plainTypes = namedChildTypes(plainField);
      assertEquals(
        plainTypes[2],
        "identifier",
        `field_declaration's 3rd named child changed shape (expected: identifier; got: ${
          plainTypes[2] ?? "<missing>"
        }) — src/al/prereq-index.ts's extractFieldName() expects an unquoted field name here as a plain identifier`,
      );
    } finally {
      tree.delete();
    }
  });

  it("gives every member_expression exactly 2 identifier-ish named children", async () => {
    const parser = await getAlParser();
    const tree = parser.parse(FIXTURE);
    assertExists(tree, "fixture failed to parse at all");
    try {
      const memberExpressions: Node[] = [];
      collectByType(tree.rootNode, "member_expression", memberExpressions);
      assertEquals(
        memberExpressions.length > 0,
        true,
        'expected at least one member_expression in the fixture — the vendored grammar may have changed how "X.Y" is parsed',
      );

      for (const expr of memberExpressions) {
        assertEquals(
          expr.namedChildCount,
          2,
          `member_expression "${expr.text}" has ${expr.namedChildCount} named children, expected exactly 2 — src/al/member-refs.ts's extractMemberParts() reads namedChild(0) as the object and namedChild(1) as the property; if this shape changed, X.Y splitting silently breaks`,
        );
        const types = namedChildTypes(expr);
        assertEquals(
          types.every(isNameNodeType),
          true,
          `member_expression "${expr.text}" has a non-identifier-ish child (got: ${
            types.join(", ")
          }) — expected both children to be "identifier" or "quoted_identifier"`,
        );
      }
    } finally {
      tree.delete();
    }
  });

  it("distinguishes identifier-shaped arguments from literal arguments in an argument_list", async () => {
    const parser = await getAlParser();
    const tree = parser.parse(FIXTURE);
    assertExists(tree, "fixture failed to parse at all");
    try {
      const setRangeArgs = findArgumentList(tree.rootNode, "SetRange");
      assertExists(
        setRangeArgs,
        "could not locate SetRange's argument_list — the vendored grammar may have changed how call_expression/member_expression is structured",
      );
      assertEquals(
        namedChildTypes(setRangeArgs),
        ["identifier", "integer"],
        `SetRange's argument_list changed shape (expected: identifier, integer; got: ${
          namedChildTypes(setRangeArgs).join(", ")
        }) — src/al/member-refs.ts's FIRST_ARG_ONLY_METHODS handling expects an identifier-shaped first argument here`,
      );

      const validateArgs = findArgumentList(tree.rootNode, "Validate");
      assertExists(
        validateArgs,
        "could not locate Validate's argument_list — the vendored grammar may have changed how call_expression/member_expression is structured",
      );
      assertEquals(
        namedChildTypes(validateArgs),
        ["quoted_identifier", "boolean"],
        `Validate's argument_list changed shape (expected: quoted_identifier, boolean; got: ${
          namedChildTypes(validateArgs).join(", ")
        }) — src/al/member-refs.ts tells a field-name argument from a literal argument by node type; if "boolean" is no longer the true/false literal's type, that distinction silently breaks`,
      );
    } finally {
      tree.delete();
    }
  });
});
