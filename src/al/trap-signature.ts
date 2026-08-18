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
  /**
   * The exact scope-qualified key `extractProcedures` uses as its own map
   * key for this member (e.g. `"requestpage.layout.area.a.onvalidate"`).
   * Load-bearing for re-locating this exact member in a different source
   * (a model response): `procedureName` is a *display* path that only
   * carries NAMED scope segments (a table/page field, a page action, a
   * report dataitem, ...) and silently drops keyword-only ones (`layout`,
   * `area`, `requestpage`, ...), so two different members can share the same
   * `procedureName` while having different `memberKey`s — a page field
   * named "A" placed directly in `layout` and the same-named field nested
   * inside `requestpage`'s own layout both display as `"A.OnValidate"`, but
   * only `memberKey` tells them apart. Consumers MUST look a member up by
   * `memberKey`, never by re-deriving or string-comparing `procedureName`.
   */
  memberKey: string;
  /** Display path for the UI only — see `memberKey` for why this is not
   * safe to use for member lookup. */
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
  /**
   * Why `sites` is empty. Absent when `sites` is non-empty. Distinguishes
   * "compared, found nothing different" (`no-divergence` — the author's
   * naive/ needs work) from every shape of "couldn't actually compare"
   * (a malformed side, or nothing on both sides to line up), which need the
   * opposite action from an author. A parse failure has no reason of its
   * own: `parseAlObjects` returns zero objects when a source has a syntax
   * error, so it folds into `no-correct-objects`/`no-naive-objects` — a side
   * that failed to parse looks identical to a side with nothing on it.
   *
   * Checked in this priority order (first match wins) when `sites` is
   * empty: `no-correct-objects` (nothing parsed on the correct side) >
   * `no-naive-objects` (same, naive side) > `no-matching-objects` (both
   * sides parsed, but no `objectKey` is common to both) >
   * `no-matching-procedures` (a matching object exists, but no member key
   * is common to it on both sides) > `divergence-outside-statements` (the
   * two sides DO differ, but only by an object or member that exists on one
   * side alone, which contributes no sites — see `deriveTrapSignature`) >
   * `no-divergence` (every object and member lines up, and diffing them
   * found nothing different).
   *
   * `divergence-outside-statements` exists because folding it into
   * `no-divergence` inverted the instruction it gives the author. A naive/
   * that forgot the `OnValidate` trigger entirely, or forgot a helper
   * codeunit, differs from correct/ in an ordinary trap-shaped way; telling
   * the author "compared, found nothing different, your naive/ needs work"
   * is confidently wrong. What it actually needs is a divergence this
   * statement-level classifier can see.
   */
  emptyReason?:
    | "no-correct-objects"
    | "no-naive-objects"
    | "no-matching-objects"
    | "no-matching-procedures"
    | "divergence-outside-statements"
    | "no-divergence";
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

/**
 * True for a procedure- or trigger-shaped member node: type contains
 * `procedure` (matched by substring rather than an exact name for the same
 * reason `object-parser.ts` treats `kind` as an open set — this rejects
 * `procedure_keyword`/`procedure_modifier`, which also contain the substring
 * but have no `code_block` child) or is exactly `trigger_declaration`
 * (table/page/field/report triggers — `OnValidate`, `OnModify`, `OnRun`,
 * `OnOpenPage`, ... — carry the divergence for a whole class of tasks, most
 * sharply the xRec family, where the trap cannot live anywhere else).
 */
function isMemberNode(node: Node): boolean {
  return (
    (node.type.includes("procedure") || node.type === "trigger_declaration") &&
    findDirectChild(node, "code_block") !== undefined
  );
}

/**
 * The scope-path label a container node contributes, or undefined when the
 * node is not itself a scope boundary.
 *
 * Every node type in this grammar that wraps a member without itself BEING
 * one is either a genuine named/keyword container (`field_declaration`,
 * `requestpage_section`, `report_dataitem`, `page_field`, `xmlport_element`,
 * ...) or a `*_body` node whose sole job is to hold that container's
 * children (`declaration_body`, `fields_body`, `layout_body`,
 * `layout_container_body`, `dataset_body`, `report_body`, `xmlport_body`,
 * ...) — every one of the latter observed in this grammar ends in `_body`,
 * and none of the former do. So rather than enumerate which container KINDS
 * to recognize (a list that silently misses whatever wasn't tested — a
 * table field is `field_declaration` and used to be recognized, a page
 * field is `page_field` and used not to be, despite being the same
 * authoring concept), this excludes only `_body` wrappers and treats every
 * other non-member node between the object root and a member as a
 * boundary. `collectMembers`'s `depth < 2` guard is what keeps this from
 * also labeling `source_file` and the object's own top-level declaration
 * (neither ends in `_body` either, but both are excluded by depth instead).
 *
 * Prefers the container's own name: a table/page field, a page action, a
 * page group, and a report dataitem/xmlport element all carry a direct
 * `identifier`/`quoted_identifier` child (e.g. `field(2; Balance; Decimal)`
 * names itself "Balance", `dataitem(Cust; Customer)` names itself "Cust").
 * Falls back to the container's own leading keyword when it has no name of
 * its own — a report's `requestpage` section is unique per report and never
 * named, so its `requestpage_keyword` child names the scope instead.
 *
 * Known simplification: the keyword fallback takes the FIRST keyword-typed
 * child, which for most container kinds is that node's own self-naming
 * keyword (`requestpage_keyword`, `fields_keyword`, ...) — exactly what we
 * want for a container that occurs once. A page can have multiple
 * `area(...)` sections (`area(Content)`, `area(Factboxes)`, ...) where the
 * qualifying keyword is the SECOND one (`content_keyword`, not the leading
 * `area_keyword`), so those currently collapse to the same "area" label.
 * Not disambiguated: no committed task's trap lives inside a page area, and
 * the failure mode is a verbose-but-correct key, not a silent collision —
 * confirmed by construction, unlike the enumeration gap above.
 *
 * `named` distinguishes the two forms for the display path built in
 * `extractProcedures`: a container's OWN name (`named: true`) is always
 * meaningful to show ("Balance.OnValidate" — which field), but a keyword
 * fallback (`named: false`) is only worth showing when nothing more specific
 * exists on the path — showing "fields.Balance.OnValidate" would be a
 * redundant prefix (there is one `fields` section per table), while
 * "requestpage.Apply" is not redundant (a requestpage section has no name
 * of its own, so its keyword IS the only distinguishing information).
 */
function scopeLabel(
  node: Node,
): { normalized: string; raw: string; named: boolean } | undefined {
  if (node.type.endsWith("_body")) {
    return undefined;
  }

  const nameNode = findDirectChild(node, "identifier") ??
    findDirectChild(node, "quoted_identifier");
  if (nameNode) {
    const raw = unquote(nameNode.text);
    return { normalized: normalizeName(raw), raw, named: true };
  }

  const KEYWORD_SUFFIX = "_keyword";
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && child.type.endsWith(KEYWORD_SUFFIX)) {
      const label = child.type.slice(0, -KEYWORD_SUFFIX.length);
      return { normalized: label, raw: label, named: false };
    }
  }
  return undefined;
}

interface ScopedMember {
  node: Node;
  /** Normalized (matching) scope segments, outermost first — every
   * boundary, named or keyword-fallback. Empty for a top-level member. */
  normalizedPath: string[];
  /** Display-form scope segments, outermost first — every boundary, same
   * set as `normalizedPath`. Empty for a top-level member. */
  rawPathAll: string[];
  /** Display-form scope segments, outermost first — named boundaries only
   * (field/action/group names), excluding keyword fallbacks. Preferred for
   * display when non-empty; see `scopeLabel`'s `named` doc for why. */
  rawPathNamed: string[];
}

/**
 * Walks an object's own parse tree collecting every procedure/trigger
 * member, each tagged with the scope path of named/keyword-identified
 * containers between the object root and the member (a table field, a page
 * action, a report's requestpage section, ...).
 *
 * `depth < 2` never scope-labels: depth 0 is `source_file` and depth 1 is
 * the object's own top-level declaration (e.g. `table_declaration`) — the
 * latter's type also ends in `_declaration` and would otherwise contribute
 * a redundant leading segment for information `objectKey` already carries.
 *
 * Does not recurse into a matched member's own body — AL members don't
 * nest, and body statements can themselves contain nodes that merely
 * mention "procedure" in an unrelated way (none observed in the grammar
 * today, but nothing rules it out for expression subtrees).
 */
function collectMembers(
  node: Node,
  depth: number,
  normalizedPath: readonly string[],
  rawPathAll: readonly string[],
  rawPathNamed: readonly string[],
  out: ScopedMember[],
): void {
  if (isMemberNode(node)) {
    out.push({
      node,
      normalizedPath: [...normalizedPath],
      rawPathAll: [...rawPathAll],
      rawPathNamed: [...rawPathNamed],
    });
    return;
  }

  let nextNormalized: readonly string[] = normalizedPath;
  let nextRawAll: readonly string[] = rawPathAll;
  let nextRawNamed: readonly string[] = rawPathNamed;
  if (depth >= 2) {
    const label = scopeLabel(node);
    if (label) {
      nextNormalized = [...normalizedPath, label.normalized];
      nextRawAll = [...rawPathAll, label.raw];
      if (label.named) nextRawNamed = [...rawPathNamed, label.raw];
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) {
      collectMembers(
        child,
        depth + 1,
        nextNormalized,
        nextRawAll,
        nextRawNamed,
        out,
      );
    }
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
  /**
   * Display form: the bare member name for a top-level procedure/trigger
   * (`"SetTerms"`, `"OnModify"`), or the scope path joined onto the bare
   * name for a nested one (`"Balance.OnValidate"`, `"requestpage.Apply"`) —
   * a bare `OnValidate` gives no way to tell which field it belongs to.
   */
  name: string;
  statements: string[];
}

/**
 * Parses a single object's own source text (e.g. an `AlObject.source`
 * snippet — a complete, self-contained top-level declaration) and returns
 * its procedures/triggers keyed by a scope-qualified normalized path
 * (`"fields.balance.onvalidate"`, `"onmodify"`, `"requestpage.apply"`).
 *
 * The key must be scope-qualified, not just the bare normalized name: AL
 * permits the same member name in different scopes of one object (two table
 * fields each with their own `OnValidate` trigger; a report-level
 * `procedure Apply()` alongside a `requestpage`-scoped `procedure Apply()`),
 * and a flat `Map` keyed on the bare name would let the second collide with
 * and silently overwrite the first, dropping whatever divergence lived
 * there with no signal.
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

    const members: ScopedMember[] = [];
    collectMembers(tree.rootNode, 0, [], [], [], members);

    for (
      const { node: proc, normalizedPath, rawPathAll, rawPathNamed } of members
    ) {
      const nameNode = findDirectChild(proc, "identifier");
      if (!nameNode) continue;
      const bareName = nameNode.text;

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

      const key = [...normalizedPath, normalizeName(bareName)].join(".");
      // Prefer named boundaries for display (which field/action/group);
      // fall back to keyword boundaries only when nothing more specific
      // exists on the path (e.g. a requestpage section, which has no name
      // of its own). See `scopeLabel`'s `named` doc for the full rationale.
      const displayPath = rawPathNamed.length > 0 ? rawPathNamed : rawPathAll;
      const displayName = displayPath.length > 0
        ? [...displayPath, bareName].join(".")
        : bareName;
      result.set(key, { name: displayName, statements });
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
  memberKey: string,
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
        memberKey,
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
        memberKey,
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
        memberKey,
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
 * Objects are matched by `objectKey` (kind + id/name + extends target).
 * Procedures AND triggers within a matched object pair are matched by a
 * scope-qualified key: the bare normalized name for a top-level member, or
 * the normalized scope path (table/page field, page action, report
 * requestpage, ...) joined onto it for a nested one — see `extractProcedures`
 * for why a bare name is not enough. An object or member present on only one
 * side contributes no sites — this module locates *statement-level*
 * divergence within a matched member, which has no natural TrapSite shape
 * for a member that does not exist on both sides. It IS still a divergence,
 * though, so it is tracked and reported as `divergence-outside-statements`
 * rather than folded into `no-divergence`, which claims the opposite.
 *
 * Returns an empty signature (with `emptyReason` set — see `TrapSignature`)
 * when either side has no objects, when no objects match, when no members
 * match, when the only difference is an unmatched object or member, or when
 * every matched member's statement lists agree.
 */
export async function deriveTrapSignature(
  correctSources: string[],
  naiveSources: string[],
): Promise<TrapSignature> {
  const correctObjects = await extractObjectsByKey(correctSources);
  const naiveObjects = await extractObjectsByKey(naiveSources);

  if (correctObjects.size === 0) {
    return { sites: [], emptyReason: "no-correct-objects" };
  }
  if (naiveObjects.size === 0) {
    return { sites: [], emptyReason: "no-naive-objects" };
  }

  const sites: TrapSite[] = [];
  let matchedAnyObject = false;
  let matchedAnyMember = false;
  // Anything the two sides differ by that this statement-level diff cannot
  // express as a site: an object or member that exists on one side alone.
  let sawUnmatched = false;

  for (const naiveKey of naiveObjects.keys()) {
    if (!correctObjects.has(naiveKey)) sawUnmatched = true;
  }

  for (const [key, correctObj] of correctObjects) {
    const naiveObj = naiveObjects.get(key);
    if (!naiveObj) {
      sawUnmatched = true;
      continue;
    }
    matchedAnyObject = true;

    const correctProcedures = await extractProcedures(correctObj.source);
    const naiveProcedures = await extractProcedures(naiveObj.source);

    for (const naiveMemberKey of naiveProcedures.keys()) {
      if (!correctProcedures.has(naiveMemberKey)) sawUnmatched = true;
    }

    for (const [memberKey, correctProc] of correctProcedures) {
      const naiveProc = naiveProcedures.get(memberKey);
      if (!naiveProc) {
        sawUnmatched = true;
        continue;
      }
      matchedAnyMember = true;

      sites.push(
        ...diffToSites(
          key,
          memberKey,
          correctProc.name,
          correctProc.statements,
          naiveProc.statements,
        ),
      );
    }
  }

  if (sites.length > 0) return { sites };
  if (!matchedAnyObject) {
    return { sites: [], emptyReason: "no-matching-objects" };
  }
  if (!matchedAnyMember) {
    return { sites: [], emptyReason: "no-matching-procedures" };
  }
  if (sawUnmatched) {
    return { sites: [], emptyReason: "divergence-outside-statements" };
  }
  return { sites: [], emptyReason: "no-divergence" };
}

export type TrapVerdict =
  | "made-the-mistake"
  | "avoided-the-mistake"
  | "different-approach"
  | "cannot-compare";

export interface TrapClassification {
  verdict: TrapVerdict;
  /** The site that decided it, for the UI to name. Absent for cannot-compare. */
  decidingSite?: TrapSite;
}

/**
 * The normalized statement list for the procedure/trigger a site names,
 * within a response already parsed into objects by `objectKey` — or
 * `undefined` when the site's object or procedure doesn't exist in the
 * response (an object the response never declares, or a member it never
 * defines, has nothing to compare at that site).
 *
 * Locates the procedure through the same AST walk `deriveTrapSignature`
 * itself uses (`extractProcedures`), then does an EXACT lookup by
 * `site.memberKey` — the same scope-qualified key `extractProcedures` uses
 * as its own map key. This must NOT match on `TrapSite.procedureName`
 * instead: `procedureName` is a display path that drops keyword-only scope
 * segments (`layout`, `area`, `requestpage`, ...), so two distinct members
 * can share one display name while having different `memberKey`s — see
 * `TrapSite.memberKey`'s own doc comment. A display-name match would pick
 * whichever member happens to come first in the response's own `Map`
 * iteration order, silently comparing a site against the wrong member's
 * statements.
 */
async function statementsAtSite(
  responseObjects: Map<string, AlObject>,
  procedureCache: Map<string, Map<string, ProcedureInfo>>,
  site: TrapSite,
): Promise<string[] | undefined> {
  const obj = responseObjects.get(site.objectKey);
  if (!obj) return undefined;

  let procedures = procedureCache.get(site.objectKey);
  if (!procedures) {
    procedures = await extractProcedures(obj.source);
    procedureCache.set(site.objectKey, procedures);
  }

  return procedures.get(site.memberKey)?.statements;
}

/**
 * Classifies a model response against a previously-derived trap signature.
 *
 * An empty signature (nothing to compare — see `TrapSignature.emptyReason`)
 * is always `cannot-compare`, before the response is even parsed.
 *
 * Otherwise every site's NAIVE form is checked first, across the whole
 * signature, before anything else is considered: any site whose naive form
 * appears in the response is `made-the-mistake`, full stop — even when some
 * other site in the same response looks correct. This is deliberate: the
 * dangerous verdict is the one that requires positive evidence, not the safe
 * one, so a response that is naive at one site and correct at another still
 * reports the mistake.
 *
 * Only once no site has fired `made-the-mistake` does the response need
 * every site *satisfied* to earn `avoided-the-mistake`: a site with a
 * `correctForm` is satisfied when that form is present; a site with only a
 * `naiveForm` (naive/ inserted a statement correct/ never had) is satisfied
 * when that form is *absent*, since not writing it is what the correct
 * solution does. A missing object, a missing procedure, or any unsatisfied
 * site falls through to `different-approach`.
 */
export async function classifyAgainstSignature(
  signature: TrapSignature,
  responseSource: string,
): Promise<TrapClassification> {
  if (signature.sites.length === 0) {
    return { verdict: "cannot-compare" };
  }

  const responseObjects = await extractObjectsByKey([responseSource]);
  const procedureCache = new Map<string, Map<string, ProcedureInfo>>();

  for (const site of signature.sites) {
    if (site.naiveForm === undefined) continue;
    const statements = await statementsAtSite(
      responseObjects,
      procedureCache,
      site,
    );
    if (statements?.includes(site.naiveForm)) {
      return { verdict: "made-the-mistake", decidingSite: site };
    }
  }

  for (const site of signature.sites) {
    const statements = await statementsAtSite(
      responseObjects,
      procedureCache,
      site,
    );
    if (statements === undefined) {
      return { verdict: "different-approach", decidingSite: site };
    }
    if (site.correctForm !== undefined) {
      if (!statements.includes(site.correctForm)) {
        return { verdict: "different-approach", decidingSite: site };
      }
    } else if (
      site.naiveForm !== undefined && statements.includes(site.naiveForm)
    ) {
      // Already excluded by the naive-form pass above; kept so this rule
      // reads correctly (and stays correct) on its own.
      return { verdict: "different-approach", decidingSite: site };
    }
  }

  return { verdict: "avoided-the-mistake" };
}
