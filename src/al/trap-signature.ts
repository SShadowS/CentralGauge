/**
 * Derives the trap signature between a `correct/` and a `naive/` reference
 * solution.
 *
 * `correct/` is one valid implementation of a task, not a canonical text —
 * formatting and naming differences swamp any plain textual-similarity
 * signal. The actual trap is the *specific* statement (or statements) where
 * the two solutions diverge. Locating it once, at authoring time, turns
 * classifying a model's response into an exact question ("did it land on the
 * correct side of this divergence?") instead of a fuzzy similarity score.
 *
 * @module al/trap-signature
 */

import type { Node } from "web-tree-sitter";
import { Language, Parser } from "web-tree-sitter";

import type { AlObject } from "./object-parser.ts";
import { parseAlObjects } from "./object-parser.ts";
import { normalizeName, objectKey } from "./object-identity.ts";

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance. `object-parser.ts` does not
// export its parser instance, so this module loads the grammar the same way
// rather than inventing a second mechanism for it.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

export interface TrapSite {
  objectKey: string;
  procedureName: string;
  /**
   * Index into the CORRECT procedure's normalized statement list where the
   * divergence begins. For a statement present only in naive/, this is the
   * index it would have occupied.
   */
  statementIndex: number;
  /** Normalized statement text. Absent when the statement exists only in naive/. */
  correctForm?: string;
  /** Normalized statement text. Absent when the statement exists only in correct/. */
  naiveForm?: string;
}

export interface TrapSignature {
  sites: TrapSite[];
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

/**
 * Collects procedure-shaped nodes (type contains `procedure`, e.g. the
 * grammar's `procedure` node — matched by substring rather than an exact
 * name for the same reason `object-parser.ts` treats `kind` as an open set:
 * a node whose type merely mentions "procedure", such as `procedure_keyword`
 * or `procedure_modifier`, has no `code_block` child and is rejected here,
 * then recursed through in case it wraps the real procedure node).
 *
 * Does not recurse into a matched procedure's own body — AL procedures do
 * not nest, and body statements can themselves contain nodes that merely
 * mention "procedure" in an unrelated way (none observed in the grammar
 * today, but nothing rules it out for expression subtrees).
 */
function findProcedureNodes(node: Node, out: Node[]): void {
  if (
    node.type.includes("procedure") &&
    findDirectChild(node, "code_block") !== undefined
  ) {
    out.push(node);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) findProcedureNodes(child, out);
  }
}

/**
 * Strips `//` and `/* *\/` comments from a statement's own source text.
 * Comments can appear as siblings between statements (excluded when the
 * statement list is built) AND embedded inside a statement's own span (e.g.
 * `Quote.Validate(Qty, /* inline *\/ Qty)`), so both must be handled: the
 * caller excludes sibling comment nodes, and this strips embedded ones.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** Comments stripped, internal whitespace collapsed, lowercased. */
function normalizeStatement(text: string): string {
  return stripComments(text).replace(/\s+/g, " ").trim().toLowerCase();
}

interface ProcedureInfo {
  name: string;
  statements: string[];
}

/**
 * Parses a single object's own source text (e.g. an `AlObject.source`
 * snippet — a complete, self-contained top-level declaration) and returns
 * its procedures keyed by normalized name.
 */
async function extractProcedures(
  objectSource: string,
): Promise<Map<string, ProcedureInfo>> {
  const parser = await getAlParser();
  const result = new Map<string, ProcedureInfo>();

  let tree: ReturnType<Parser["parse"]>;
  try {
    tree = parser.parse(objectSource);
  } catch {
    return result;
  }
  if (!tree) return result;

  try {
    if (tree.rootNode.hasError) return result;

    const procedureNodes: Node[] = [];
    findProcedureNodes(tree.rootNode, procedureNodes);

    for (const proc of procedureNodes) {
      const nameNode = findDirectChild(proc, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text;

      const statements: string[] = [];
      const codeBlock = findDirectChild(proc, "code_block");
      const statementBlock = codeBlock
        ? findDirectChild(codeBlock, "statement_block")
        : undefined;
      if (statementBlock) {
        for (let i = 0; i < statementBlock.namedChildCount; i++) {
          const stmt = statementBlock.namedChild(i);
          if (!stmt) continue;
          if (stmt.type === "comment" || stmt.type === "multiline_comment") {
            continue;
          }
          statements.push(normalizeStatement(stmt.text));
        }
      }

      result.set(normalizeName(name), { name, statements });
    }

    return result;
  } finally {
    tree.delete();
  }
}

/** Parses every source and merges their objects, keyed by objectKey. */
async function extractObjectsByKey(
  sources: string[],
): Promise<Map<string, AlObject>> {
  const map = new Map<string, AlObject>();
  for (const source of sources) {
    const { objects } = await parseAlObjects(source);
    for (const obj of objects) {
      const key = objectKey(obj);
      if (!map.has(key)) map.set(key, obj);
    }
  }
  return map;
}

/** Safe 2D lookup for the LCS table; out-of-range reads are the padding 0. */
function dpAt(dp: number[][], i: number, j: number): number {
  return dp[i]?.[j] ?? 0;
}

/**
 * Longest-common-subsequence match between two normalized statement lists.
 * Returns matched (correctIndex, naiveIndex) pairs in increasing order.
 * Statements outside these pairs are the divergence.
 */
function lcsMatchPairs(
  a: readonly string[],
  b: readonly string[],
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from(
    { length: n + 1 },
    () => new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const ai = a[i];
      const bj = b[j];
      const row = dp[i];
      if (!row) continue;
      if (ai !== undefined && bj !== undefined && ai === bj) {
        row[j] = dpAt(dp, i + 1, j + 1) + 1;
      } else {
        row[j] = Math.max(dpAt(dp, i + 1, j), dpAt(dp, i, j + 1));
      }
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i];
    const bj = b[j];
    if (ai !== undefined && bj !== undefined && ai === bj) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dpAt(dp, i + 1, j) >= dpAt(dp, i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Diffs one matched pair of procedures and emits a `TrapSite` per
 * divergence. A contiguous run of correct-only statements immediately
 * followed by naive-only statements (no matched statement between them) is
 * treated as a run of substitutions, paired element-by-element; any excess
 * on either side becomes single-form sites. This is what keeps a single
 * changed statement from being reported as a "reorder" of its neighbors —
 * see the module-level LCS note in the task brief this implements.
 */
function diffToSites(
  key: string,
  procedureName: string,
  correctStatements: readonly string[],
  naiveStatements: readonly string[],
): TrapSite[] {
  const matches = lcsMatchPairs(correctStatements, naiveStatements);
  const boundaries: Array<[number, number]> = [
    ...matches,
    [correctStatements.length, naiveStatements.length],
  ];

  const sites: TrapSite[] = [];
  let ci = 0;
  let ni = 0;

  for (const [mi, mj] of boundaries) {
    const deleteSlice = correctStatements.slice(ci, mi);
    const insertSlice = naiveStatements.slice(ni, mj);
    const pairCount = Math.min(deleteSlice.length, insertSlice.length);

    for (let k = 0; k < pairCount; k++) {
      const correctForm = deleteSlice[k];
      const naiveForm = insertSlice[k];
      if (correctForm === undefined || naiveForm === undefined) continue;
      sites.push({
        objectKey: key,
        procedureName,
        statementIndex: ci + k,
        correctForm,
        naiveForm,
      });
    }
    for (let k = pairCount; k < deleteSlice.length; k++) {
      const correctForm = deleteSlice[k];
      if (correctForm === undefined) continue;
      sites.push({
        objectKey: key,
        procedureName,
        statementIndex: ci + k,
        correctForm,
      });
    }
    for (let k = pairCount; k < insertSlice.length; k++) {
      const naiveForm = insertSlice[k];
      if (naiveForm === undefined) continue;
      sites.push({
        objectKey: key,
        procedureName,
        statementIndex: mi,
        naiveForm,
      });
    }

    ci = mi + 1;
    ni = mj + 1;
  }

  return sites;
}

/**
 * Derives the trap signature between a correct and a naive reference
 * solution, each possibly spread across multiple source files.
 *
 * Objects are matched by `objectKey` (kind + id/name + extends target);
 * procedures within a matched object pair are matched by normalized name.
 * An object or procedure present on only one side contributes no sites —
 * this module locates *statement-level* divergence within a matched
 * procedure, which has no natural TrapSite shape for a procedure that does
 * not exist on both sides.
 *
 * Returns an empty signature when either side has no objects, when no
 * objects match, or when no procedures match.
 */
export async function deriveTrapSignature(
  correctSources: string[],
  naiveSources: string[],
): Promise<TrapSignature> {
  const correctObjects = await extractObjectsByKey(correctSources);
  const naiveObjects = await extractObjectsByKey(naiveSources);

  const sites: TrapSite[] = [];

  for (const [key, correctObj] of correctObjects) {
    const naiveObj = naiveObjects.get(key);
    if (!naiveObj) continue;

    const correctProcedures = await extractProcedures(correctObj.source);
    const naiveProcedures = await extractProcedures(naiveObj.source);

    for (const [normalizedName, correctProc] of correctProcedures) {
      const naiveProc = naiveProcedures.get(normalizedName);
      if (!naiveProc) continue;

      sites.push(
        ...diffToSites(
          key,
          correctProc.name,
          correctProc.statements,
          naiveProc.statements,
        ),
      );
    }
  }

  return { sites };
}
