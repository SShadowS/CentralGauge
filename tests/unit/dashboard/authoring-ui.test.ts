import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertStringIncludes } from "@std/assert";

/**
 * Behavioural coverage for `src/dashboard/ui/app.js`.
 *
 * The UI is a plain browser script with no build step, so it cannot be
 * imported directly. It is instead loaded as a `data:` module with a tiny
 * DOM stub installed on `globalThis` first — real execution of the real
 * file, not a re-implementation of it. `readyState: "loading"` keeps `init()`
 * from running: the script defers to `DOMContentLoaded`, which the stub never
 * fires, so importing it has no side effects beyond defining its functions.
 *
 * The gap this closes was named by the final review: `buildColumnHeader` had
 * NO test, which is how an `if (response.error)` branch that could never
 * execute survived to the end of the branch.
 */

interface StubNode {
  tag: string;
  className: string;
  textContent: string;
  children: StubNode[];
  listeners: Record<string, Array<() => void>>;
  classList: { add: (name: string) => void };
  appendChild: (child: StubNode) => StubNode;
  addEventListener: (type: string, fn: () => void) => void;
  [key: string]: unknown;
}

function createNode(tag: string): StubNode {
  const node = {
    tag,
    className: "",
    textContent: "",
    children: [] as StubNode[],
    listeners: {} as Record<string, Array<() => void>>,
    classList: {
      add(name: string) {
        node.className = node.className ? `${node.className} ${name}` : name;
      },
    },
    appendChild(child: StubNode) {
      node.children.push(child);
      return child;
    },
    addEventListener(type: string, fn: () => void) {
      (node.listeners[type] ??= []).push(fn);
    },
  } as StubNode;
  return node;
}

/** Every string rendered anywhere under `node`, joined. */
function allText(node: StubNode): string {
  return [node.textContent, ...node.children.map(allText)].join("\n");
}

/** Depth-first list of `className` values under `node`, including its own. */
function allClasses(node: StubNode): string[] {
  return [node.className, ...node.children.flatMap(allClasses)];
}

/**
 * The first node at or under `node` whose own `className` includes `cls`
 * and whose own `textContent` includes `text`. Matching on the node's OWN
 * text, not its subtree's, is the point: an assertion made against the
 * rail's flattened text cannot tell WHICH finding carries a label, which is
 * precisely how a mutation that labelled every tier "Made up this field"
 * survived the suite.
 */
function findNode(
  node: StubNode,
  cls: string,
  text: string,
): StubNode | undefined {
  if (node.className.includes(cls) && node.textContent.includes(text)) {
    return node;
  }
  for (const child of node.children) {
    const hit = findNode(child, cls, text);
    if (hit) return hit;
  }
  return undefined;
}

/** Stable stand-ins for the ids app.js looks up, so a test can read back
 *  what a render wrote into them. `innerHTML = ""` (which app.js uses to
 *  clear a container) resets the stub's children. */
const byId = new Map<string, StubNode>();
function node(id: string): StubNode {
  let existing = byId.get(id);
  if (!existing) {
    existing = createNode("div");
    Object.defineProperty(existing, "innerHTML", {
      set(_value: string) {
        existing!.children.length = 0;
      },
      get: () => "",
    });
    byId.set(id, existing);
  }
  return existing;
}

const stubDocument = {
  readyState: "loading",
  createElement: (tag: string) => createNode(tag),
  createDocumentFragment: () => createNode("#fragment"),
  getElementById: (id: string) => node(id),
  addEventListener: () => {},
};

const detailTitle = node("detail-title");
const detailSource = node("detail-source");

/** One model's latest escalation outcome (Task 1's `VerifyOutcome`), as read
 *  back by `buildColumnHeader`/`buildVerifyAllAction`. Loosely typed here —
 *  the shape varies by `state` — since the fixtures below build one
 *  discriminant at a time. */
interface VerifyState {
  outcomes: Record<string, unknown>;
  blockedReason: string | null;
  source: unknown;
}

/** The module's mutable client state — `drafts`/`selectedDir`/`run` seeded
 *  directly by a test so `selectModelForRail` (fired by a cell click) has
 *  something to resolve against, without going through the real
 *  fetch-driven `loadDrafts`/`runQuick`. */
interface DashboardState {
  drafts: unknown[];
  selectedDir: string | null;
  run: { responses: unknown[]; rows?: unknown[] } | null;
  selectedModel: string | null;
  runDraftDir: string | null;
  verify: VerifyState;
}

interface Ui {
  buildColumnHeader: (response: unknown) => StubNode;
  buildCell: (row: unknown, response: unknown) => StubNode;
  renderTrapSummary: (run: unknown) => void;
  renderArtifactNote: (run: unknown) => void;
  renderMatrix: (run: unknown) => void;
  renderPrereqRail: (binding: unknown) => StubNode;
  renderFileList: (draft: unknown, binding?: unknown, model?: unknown) => void;
  state: DashboardState;
}

async function loadUi(): Promise<Ui> {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = stubDocument;
  const src = await Deno.readTextFile(
    new URL("../../../src/dashboard/ui/app.js", import.meta.url),
  );
  const module = `${src}\nexport { buildColumnHeader, buildCell, ` +
    `renderTrapSummary, renderArtifactNote, renderMatrix, renderPrereqRail, ` +
    `renderFileList, state };\n`;
  return await import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(module)}`
  ) as Ui;
}

const readyResolution = {
  isReadyForCompile: true,
  method: "delimiters",
  confidence: 0.95,
};
const notReadyResolution = {
  isReadyForCompile: false,
  method: "whole-response",
  confidence: 0,
  failure: {
    error: "Model returned empty response",
    failureKind: "empty_response",
  },
};

describe("dashboard/ui app.js", () => {
  // The defect: `response.error` was appended only AFTER the not-ready branch
  // had already returned, and `error` is set in exactly one place — the
  // runOneModel catch, which also produces resolveCandidate("", "error") and
  // is therefore never ready. So a bad slug, a missing API key or a 401 all
  // rendered as "Model returned empty response", which reads as a refusal.
  it("shows a thrown model error in the no-code column header", async () => {
    const ui = await loadUi();
    const header = ui.buildColumnHeader({
      model: "anthropic/typo",
      prompt: "",
      resolution: notReadyResolution,
      classification: { verdict: "cannot-compare" },
      error: "401 Unauthorized: invalid x-api-key",
    });

    const text = allText(header);
    assertEquals(text.includes("401 Unauthorized: invalid x-api-key"), true);
    assertEquals(allClasses(header).includes("diagnostic-error"), true);
  });

  // Positive control for the test above: without a thrown error the derived
  // extraction failure is still what gets shown, so the assertion above is
  // about precedence rather than about the branch existing at all.
  it("falls back to the extraction failure when nothing was thrown", async () => {
    const ui = await loadUi();
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      prompt: "p",
      resolution: notReadyResolution,
      classification: { verdict: "cannot-compare" },
    });
    assertEquals(
      allText(header).includes("Model returned empty response"),
      true,
    );
  });

  it("shows the verdict for a response that produced usable AL", async () => {
    const ui = await loadUi();
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "made-the-mistake" },
      objects: [],
    });
    assertEquals(allText(header).includes("Made the mistake"), true);
    assertEquals(allClasses(header).includes("badge verdict-bad"), true);
  });

  // The model name is a button that opens the prompt this model was actually
  // sent — the only place an author can read the question, and the reason the
  // prompt is carried per response rather than once per run.
  it("opens the prompt that was sent when the model name is clicked", async () => {
    const ui = await loadUi();
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      prompt: "## Task\n\nWrite a codeunit.",
      resolution: readyResolution,
      classification: { verdict: "avoided-the-mistake" },
      objects: [],
    });
    const name = header.children[0];
    assertEquals(name?.className, "model-name");
    name?.listeners["click"]?.[0]?.();
    assertEquals(detailSource.textContent, "## Task\n\nWrite a codeunit.");
    assertEquals(detailTitle.textContent, "anthropic/opus — prompt sent");
  });

  // parseAlObjects returns {objects: [], hasError: true} for a syntax error
  // ANYWHERE in the candidate, so an unparseable answer used to be
  // indistinguishable from one that wrote nothing: the header showed a
  // verdict and every cell said "not written" for a model that wrote the
  // object inside prose.
  it("marks an unparseable response instead of reporting it wrote nothing", async () => {
    const ui = await loadUi();
    const response = {
      model: "anthropic/opus",
      prompt: "p",
      rawResponse: "Here is the table you asked for: ...",
      resolution: { ...readyResolution, method: "whole-response" },
      classification: { verdict: "different-approach" },
      objects: [],
      hasParseError: true,
    };

    const header = ui.buildColumnHeader(response);
    assertEquals(allText(header).includes("AL would not parse"), true);

    const cell = ui.buildCell(
      { key: "table|70001", kind: "table", id: 70001, name: "CG Foo" },
      response,
    );
    assertEquals(cell.textContent, "unreadable");
    assertEquals(cell.textContent === "not written", false);
  });

  // Control: a parseable response that genuinely omitted the object must
  // still read "not written", or the state above would just be a rename.
  it("still says not written when the response parsed and omitted the object", async () => {
    const ui = await loadUi();
    const cell = ui.buildCell(
      { key: "table|70001", kind: "table", id: 70001, name: "CG Foo" },
      {
        model: "anthropic/opus",
        prompt: "p",
        rawResponse: "",
        resolution: readyResolution,
        classification: { verdict: "different-approach" },
        objects: [],
        hasParseError: false,
      },
    );
    assertEquals(cell.textContent, "not written");
  });

  // The client no longer computes object identity: it reads the server's own
  // assignment. Index 0 is a legitimate answer, so a truthiness check here
  // would drop the first object of every response.
  it("fills a cell from the server's row assignment, index 0 included", async () => {
    const ui = await loadUi();
    const cell = ui.buildCell(
      {
        key: "codeunit|71410",
        kind: "codeunit",
        id: 71410,
        name: "CG Poster",
        inReference: true,
      },
      {
        model: "anthropic/opus",
        prompt: "p",
        resolution: readyResolution,
        classification: { verdict: "avoided-the-mistake" },
        objects: [{
          kind: "codeunit",
          id: 71410,
          name: "CG Poster",
          source: 'codeunit 71410 "CG Poster" { }',
        }],
        rowAssignments: { "codeunit|71410": 0 },
        hasParseError: false,
      },
    );
    assertEquals(cell.textContent, "view source");
    cell.listeners["click"]?.[0]?.();
    assertEquals(detailSource.textContent, 'codeunit 71410 "CG Poster" { }');
  });

  it("says not written when the server assigned this response no object", async () => {
    const ui = await loadUi();
    const cell = ui.buildCell(
      {
        key: "codeunit|71410",
        kind: "codeunit",
        id: 71410,
        name: "CG Poster",
        inReference: true,
      },
      {
        model: "anthropic/opus",
        prompt: "p",
        resolution: readyResolution,
        classification: { verdict: "different-approach" },
        objects: [{ kind: "table", id: 71411, name: "CG Line", source: "" }],
        rowAssignments: {},
        hasParseError: false,
      },
    );
    assertEquals(cell.textContent, "not written");
  });

  // Task 9 / spec §3. object-identity.ts's buildRowUniverse already merges
  // two objects that normalize to the same identity into ONE row (tested in
  // object-identity.test.ts's "merges two responses' same-named objects
  // with different ids into one row" — this fixture reuses those exact
  // values), even when one field disagrees between them. That disagreement
  // must render as an in-cell badge per response, never a second row —
  // splitting it would report the asked-for object as missing and the
  // near-miss as extra, which misreads the failure. Driven through the real
  // renderMatrix pipeline so "one row" is checked at the level an author
  // actually sees it (the table's own row count), not just an array length.
  it("badges an id mismatch, without splitting into two rows, when two responses share a normalized name under different ids", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;

    const row = {
      key: "codeunit|71410",
      kind: "codeunit",
      id: 71410,
      name: "Agent",
      inReference: false,
    };
    const responseExact = {
      model: "model-a",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "codeunit",
        id: 71410,
        name: "Agent",
        source: 'codeunit 71410 "Agent" { }',
      }],
      rowAssignments: { "codeunit|71410": 0 },
      // What the server's real computeRowIdentityConflicts (run-manager.ts)
      // would produce for an exact match — no entry at all.
      rowIdentityConflicts: {},
      hasParseError: false,
    };
    const responseMismatched = {
      model: "model-b",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "codeunit",
        id: 71400,
        name: "Agent",
        source: 'codeunit 71400 "Agent" { }',
      }],
      rowAssignments: { "codeunit|71410": 0 },
      // Same name, only the id genuinely differs — matching what the
      // server's real computation would produce.
      rowIdentityConflicts: {
        "codeunit|71410": {
          expectedId: 71410,
          expectedName: "Agent",
          actualId: 71400,
          actualName: "Agent",
        },
      },
      hasParseError: false,
    };

    ui.renderMatrix({
      rows: [row],
      responses: [responseExact, responseMismatched],
    });

    const table = node("matrix-container").children[0]!;
    const tbody = table.children[1]!;
    assertEquals(tbody.children.length, 1, "expected exactly one row");

    const tr = tbody.children[0]!;
    const cellExact = tr.children[1]!.children[0]!;
    const cellMismatched = tr.children[2]!.children[0]!;

    assertEquals(findNode(cellExact, "mismatch-badge", ""), undefined);

    const expected = findNode(cellMismatched, "mismatch-expected", "71410");
    const actual = findNode(cellMismatched, "mismatch-actual", "71400");
    assertStringIncludes(allText(expected!), 'codeunit 71410 "Agent"');
    assertStringIncludes(allText(actual!), 'codeunit 71400 "Agent"');
  });

  // The mirror direction: same id, different names. `objectKey` keys an
  // object with an id purely by kind+id (name is only part of the key when
  // id is ABSENT), so two objects sharing an id merge on the exact-key pass
  // directly — no fallback needed — yet their names can still disagree.
  it("badges a name mismatch, without splitting into two rows, when two responses share an id under different names", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;

    const row = {
      key: "table|71411",
      kind: "table",
      id: 71411,
      name: "CG Line",
      inReference: true,
    };
    const responseExact = {
      model: "model-a",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "table",
        id: 71411,
        name: "CG Line",
        source: 'table 71411 "CG Line" { }',
      }],
      rowAssignments: { "table|71411": 0 },
      // Exact match on both fields — no entry, matching what the server's
      // real computeRowIdentityConflicts (run-manager.ts) would produce.
      rowIdentityConflicts: {},
      hasParseError: false,
    };
    const responseMismatched = {
      model: "model-b",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "table",
        id: 71411,
        name: "CG Ledger",
        source: 'table 71411 "CG Ledger" { }',
      }],
      rowAssignments: { "table|71411": 0 },
      // Same id, only the name genuinely differs even after normalizeName —
      // matching what the server's real computation would produce.
      rowIdentityConflicts: {
        "table|71411": {
          expectedId: 71411,
          expectedName: "CG Line",
          actualId: 71411,
          actualName: "CG Ledger",
        },
      },
      hasParseError: false,
    };

    ui.renderMatrix({
      rows: [row],
      responses: [responseExact, responseMismatched],
    });

    const table = node("matrix-container").children[0]!;
    const tbody = table.children[1]!;
    assertEquals(tbody.children.length, 1, "expected exactly one row");

    const tr = tbody.children[0]!;
    const cellExact = tr.children[1]!.children[0]!;
    const cellMismatched = tr.children[2]!.children[0]!;

    assertEquals(findNode(cellExact, "mismatch-badge", ""), undefined);

    const expected = findNode(cellMismatched, "mismatch-expected", "CG Line");
    const actual = findNode(cellMismatched, "mismatch-actual", "CG Ledger");
    assertStringIncludes(allText(expected!), 'table 71411 "CG Line"');
    assertStringIncludes(allText(actual!), 'table 71411 "CG Ledger"');
  });

  // Task 9 fix round 2. A pure case/whitespace difference is NOT a genuine
  // conflict: AL identifiers are case-insensitive, and `normalizeName`
  // (object-identity.ts) deliberately erases case and collapses whitespace
  // because those differences do not distinguish objects. Badging one would
  // assert a defect the run does not support — the exact false positive
  // that teaches an author to ignore the badge when it fires on a REAL
  // conflict. Pins the id-less path (interface/controladdin): `row.id` and
  // `obj.id` are both absent, so only the name is in play, and
  // `rowIdentityConflicts` carries no entry at all for this row — what the
  // server's real `computeRowIdentityConflicts` would produce — even though
  // the raw names differ by case and internal whitespace.
  it("does not badge two id-less objects whose names differ only by case or whitespace", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;

    const row = {
      key: "interface|name:cg agent",
      kind: "interface",
      name: "CG Agent",
      inReference: true,
    };
    const responseExact = {
      model: "model-a",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "interface",
        name: "CG Agent",
        source: 'interface "CG Agent" { }',
      }],
      rowAssignments: { "interface|name:cg agent": 0 },
      rowIdentityConflicts: {},
      hasParseError: false,
    };
    const responseDifferentSpelling = {
      model: "model-b",
      prompt: "p",
      resolution: readyResolution,
      classification: { verdict: "different-approach" },
      objects: [{
        kind: "interface",
        // Different case, and doubled internal whitespace — raw string
        // differs from the row's "CG Agent", but normalizeName erases both.
        name: "cg  agent",
        source: 'interface "cg  agent" { }',
      }],
      rowAssignments: { "interface|name:cg agent": 0 },
      rowIdentityConflicts: {},
      hasParseError: false,
    };

    ui.renderMatrix({
      rows: [row],
      responses: [responseExact, responseDifferentSpelling],
    });

    const table = node("matrix-container").children[0]!;
    const tbody = table.children[1]!;
    assertEquals(tbody.children.length, 1, "expected exactly one row");

    const tr = tbody.children[0]!;
    const cellExact = tr.children[1]!.children[0]!;
    const cellDifferentSpelling = tr.children[2]!.children[0]!;

    assertEquals(findNode(cellExact, "mismatch-badge", ""), undefined);
    assertEquals(
      findNode(cellDifferentSpelling, "mismatch-badge", ""),
      undefined,
    );
  });

  // Spec §4: "It is explainable. The UI names the deciding statement rather
  // than showing a score, which is what makes a glance sufficient."
  it("names the deciding statement in the column header", async () => {
    const ui = await loadUi();
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      prompt: "p",
      resolution: readyResolution,
      objects: [],
      hasParseError: false,
      classification: {
        verdict: "made-the-mistake",
        decidingSite: {
          objectKey: "codeunit|71410",
          memberKey: "setterms",
          procedureName: "SetTerms",
          statementIndex: 0,
          correctForm: "Rec.Validate(Qty, 1)",
          naiveForm: "Rec.Qty := 1",
        },
      },
    });
    const text = allText(header);
    assertEquals(text.includes("SetTerms"), true);
    assertEquals(text.includes("Rec.Qty := 1"), true);
    assertEquals(text.includes("Rec.Validate(Qty, 1)"), true);
  });

  // Task 6 fix round 1 added emptyReason because an author seeing
  // "Couldn't compare yet" needs to know whether to fix a malformed naive/
  // or accept that the trap does not discriminate — opposite actions. The
  // reason never reached the screen at all.
  it("explains WHY a comparison could not be made", async () => {
    const ui = await loadUi();
    for (
      const [reason, fragment] of [
        ["no-naive-objects", "Nothing readable in naive/"],
        ["no-divergence", "statement for statement"],
        ["divergence-outside-statements", "whole object or member"],
        ["no-matching-objects", "no object in common"],
      ] as const
    ) {
      ui.renderTrapSummary({
        signature: { sites: [], emptyReason: reason },
        responses: [],
        rows: [],
      });
      const text = allText(node("trap-summary"));
      assertEquals(text.includes("Couldn't compare yet"), true);
      assertEquals(
        text.includes(fragment),
        true,
        `reason ${reason} should explain "${fragment}", got: ${text}`,
      );
    }
  });

  it("names the trap's statements when a signature was derived", async () => {
    const ui = await loadUi();
    ui.renderTrapSummary({
      signature: {
        sites: [
          {
            objectKey: "codeunit|71410",
            memberKey: "setterms",
            procedureName: "SetTerms",
            statementIndex: 0,
            correctForm: "Rec.Validate(Qty, 1)",
            naiveForm: "Rec.Qty := 1",
          },
        ],
      },
      responses: [],
      rows: [],
    });
    const text = allText(node("trap-summary"));
    assertEquals(text.includes("The trap: 1 statement"), true);
    assertEquals(text.includes("SetTerms"), true);
    assertEquals(text.includes("Rec.Qty := 1"), true);
  });

  // The run artifact had no caller at all, so nothing was ever persisted and
  // the author was never told where a run went.
  it("says where the run was saved, and says so when it was not", async () => {
    const ui = await loadUi();
    ui.renderArtifactNote({ artifactPath: "U:/scratch/X/.runs/X-1.json" });
    assertEquals(
      node("artifact-note").textContent,
      "Saved to U:/scratch/X/.runs/X-1.json",
    );

    ui.renderArtifactNote({ artifactError: "permission denied" });
    assertEquals(
      node("artifact-note").textContent,
      "Could not save this run: permission denied",
    );
    assertEquals(
      node("artifact-note").className.includes("artifact-note-failed"),
      true,
    );
  });

  // Spec §5: a `hard` finding is provable — an unknown member in
  // assignment-target or curated-method-arg position cannot be a
  // procedure — so it earns the strongest label. `known` findings are
  // interleaved in the fixture to prove they render plainly alongside it,
  // never picking up the accusation.
  it("labels a hard finding as a made-up field", async () => {
    const ui = await loadUi();
    const rail = ui.renderPrereqRail({
      degraded: false,
      findings: [
        {
          procedureName: "P",
          table: "CG Quote",
          member: "Discount",
          tier: "hard",
          line: 5,
        },
        {
          procedureName: "P",
          table: "CG Quote",
          member: "Unit Price",
          tier: "known",
          line: 6,
        },
      ],
    });

    // Asserted PER NODE, never against the rail's flattened text. Both
    // labels appear somewhere in a rail carrying a hard finding, so a
    // flattened-text assertion passes just as happily when the `known`
    // reference is ALSO accused — which is the whole failure the tiers
    // exist to prevent.
    const hard = findNode(rail, "prereq-member", "Discount");
    assertEquals(hard?.className.includes("prereq-tier-hard"), true);
    assertStringIncludes(allText(hard!), "Made up this field");

    const known = findNode(rail, "prereq-member", "Unit Price");
    assertEquals(known?.className.includes("prereq-tier-known"), true);
    // The correct reference carries NO label of any kind: not the hard
    // one, not the soft one.
    assertEquals(allText(known!).includes("Made up this field"), false);
    assertEquals(allText(known!).includes("Unknown member"), false);
    assertEquals(
      allClasses(known!).some((c) => c.includes("prereq-label")),
      false,
    );
  });

  // A `soft` finding is NOT provable — the member may be a Record built-in
  // nobody indexed — so it must never carry the `hard` label. Rendering it
  // as "Made up this field" would be a false accusation against a model
  // that wrote correct code.
  it("labels a soft finding without accusing", async () => {
    const ui = await loadUi();
    const rail = ui.renderPrereqRail({
      degraded: false,
      findings: [
        {
          procedureName: "P",
          table: "CG Quote",
          member: "Refresh",
          tier: "soft",
          line: 7,
        },
      ],
    });
    const soft = findNode(rail, "prereq-member", "Refresh");
    assertEquals(soft?.className.includes("prereq-tier-soft"), true);
    assertStringIncludes(allText(soft!), "Unknown member");
    assertEquals(allText(soft!).includes("Made up this field"), false);
  });

  it("says it could not check rather than showing an empty rail", async () => {
    const ui = await loadUi();
    const rail = allText(
      ui.renderPrereqRail({ degraded: true, findings: [] }),
    );
    assertStringIncludes(rail, "Couldn't check the prereq");
  });

  // Fix round 1: the rail used to silently scope to the first response with
  // nothing on screen saying so — indistinguishable from describing the
  // whole run. The heading must name whose references it shows.
  it("names the model in the rail heading once a binding is present", async () => {
    const ui = await loadUi();
    ui.renderFileList(
      { hasPrereq: true, prereqFiles: ["Item.Table.al"] },
      { degraded: false, findings: [] },
      "anthropic/opus",
    );
    const text = allText(node("file-list"));
    assertStringIncludes(text, "Already exists (prereq)");
    assertStringIncludes(text, "anthropic/opus");
  });

  // Control: before any run there is no response to name, so the heading
  // must stay exactly as it always has — no "undefined" leaking in.
  it("leaves the heading unnamed before any run has produced a binding", async () => {
    const ui = await loadUi();
    ui.renderFileList({ hasPrereq: true, prereqFiles: ["Item.Table.al"] });
    const heading = node("file-list").children.find((c) =>
      c.className.includes("file-list-heading")
    );
    assertEquals(heading?.textContent, "Already exists (prereq)");
  });

  // Fix round 1: on a multi-model run the rail always described the first
  // response, whichever model that happened to be. Clicking a different
  // model's cell — the same click that already opens that cell's detail —
  // must move the rail onto that model's own findings.
  it("re-scopes the rail to the model whose cell was clicked", async () => {
    const ui = await loadUi();
    const responseA = {
      model: "anthropic/opus",
      resolution: readyResolution,
      prereqBinding: {
        degraded: false,
        findings: [
          {
            procedureName: "P",
            table: "CG Quote",
            member: "Discount",
            tier: "hard",
            line: 5,
          },
        ],
      },
    };
    const responseB = {
      model: "openai/gpt",
      resolution: readyResolution,
      prereqBinding: { degraded: false, findings: [] },
    };
    const row = {
      key: "table|1",
      kind: "table",
      id: 1,
      name: "X",
      inReference: true,
    };

    ui.state.drafts = [
      { dir: "d1", hasPrereq: true, prereqFiles: [] },
    ];
    ui.state.selectedDir = "d1";
    ui.state.run = { responses: [responseA, responseB] };
    ui.state.selectedModel = responseA.model;

    const cellB = ui.buildCell(row, responseB);
    cellB.listeners["click"]?.[0]?.();

    const text = allText(node("file-list"));
    assertStringIncludes(text, "openai/gpt");
    assertEquals(text.includes("Discount"), false);
  });

  // Task 8: escalation's terminal-state vocabulary (spec §6), plus the
  // wording chosen for `publish_defect`, which the spec's table did not
  // anticipate. Each state gets its OWN named `it()` — not one test with a
  // loop of assertions inside it — precisely so a mutation that mismaps one
  // state's label fails exactly one named test, per Step 5 of the brief.
  const terminalLabelCases: Array<
    { caseName: string; outcome: unknown; label: string }
  > = [
    {
      caseName: "passed_first_try",
      outcome: { state: "passed_first_try", passed: 3, total: 3 },
      label: "Passed first try",
    },
    {
      caseName: "passed_second_try",
      outcome: {
        state: "passed_second_try",
        passed: 3,
        total: 3,
        fixPrompt: "fix the compile error",
      },
      label: "Passed on 2nd try",
    },
    {
      caseName: "failed_both",
      outcome: {
        state: "failed_both",
        passed: 1,
        total: 3,
        failures: ["TestFoo"],
      },
      label: "Failed both tries",
    },
    {
      caseName: "didnt_compile",
      outcome: { state: "didnt_compile", compileErrors: ["AL0118"] },
      label: "Didn't compile",
    },
    {
      caseName: "publish_defect",
      outcome: {
        state: "publish_defect",
        message: "install failed: duplicate object id",
      },
      label: "Didn't publish",
    },
  ];

  for (const { caseName, outcome, label } of terminalLabelCases) {
    it(`renders "${label}" for ${caseName} in the right column`, async () => {
      const ui = await loadUi();
      ui.state.verify.outcomes["anthropic/opus"] = outcome;
      const header = ui.buildColumnHeader({
        model: "anthropic/opus",
        resolution: readyResolution,
        objects: [],
        classification: { verdict: "different-approach" },
      });
      assertStringIncludes(allText(header), label);
    });
  }

  it('renders failed_both\'s counts as "n of m tests"', async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes["anthropic/opus"] = {
      state: "failed_both",
      passed: 1,
      total: 3,
      failures: ["TestFoo"],
    };
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    assertStringIncludes(allText(header), "1 of 3 tests");
  });

  // `publish_defect` ran ZERO tests — its pass/fail numbers are a scoring
  // convention, not a measurement. Reusing "Failed both tries" would report
  // a test result that never happened.
  it("does not render publish_defect as Failed both tries", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes["anthropic/opus"] = {
      state: "publish_defect",
      message: "install failed: duplicate object id",
    };
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    const text = allText(header);
    assertStringIncludes(text, "Didn't publish");
    assertEquals(text.includes("Failed both tries"), false);
  });

  // A genuine infrastructure failure — thrown verify call, dead container —
  // must never look like a test result: no counts, no pass/fail wording.
  it("renders errored as an error, not a test result", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes["anthropic/opus"] = {
      state: "errored",
      message: "container offline",
    };
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    const text = allText(header);
    assertStringIncludes(text, "Verification error: container offline");
    assertEquals(text.includes("Failed both tries"), false);
    assertEquals(text.includes("Passed"), false);
    assertEquals(/\d+ of \d+ tests/.test(text), false);
  });

  // A `refused` outcome shows the gate's reason VERBATIM — nothing rewords
  // it, so what renders is exactly what `checkBenchGate`/the queue decided.
  it("shows a refused outcome's gate reason verbatim", async () => {
    const ui = await loadUi();
    const reason =
      "A bench is running, started 2026-08-19T10:00:00Z. Compile and " +
      "test publishes to the same container and would corrupt that run.";
    ui.state.verify.outcomes["anthropic/opus"] = {
      state: "refused",
      reason,
    };
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    assertStringIncludes(allText(header), reason);
  });

  // The phase is frozen at "staging" for the whole verify call, so showing
  // it would claim compilation or testing is under way before either has
  // started. Covers every phase value the type allows.
  it("never surfaces the running phase word", async () => {
    for (const phase of ["staging", "compiling", "testing", "fixing"]) {
      const ui = await loadUi();
      ui.state.verify.outcomes["anthropic/opus"] = { state: "running", phase };
      const header = ui.buildColumnHeader({
        model: "anthropic/opus",
        resolution: readyResolution,
        objects: [],
        classification: { verdict: "different-approach" },
      });
      const text = allText(header);
      assertStringIncludes(text, "In progress");
      assertEquals(
        text.toLowerCase().includes(phase),
        false,
        `header leaked the phase word "${phase}": ${text}`,
      );
    }
  });

  // The hole the Plan 3 final review found in the prereq rail: a test that
  // only checks a label appears SOMEWHERE cannot tell a correct verdict
  // from one attached to the wrong column. Two responses, two different
  // outcomes, asserted on each response's OWN header subtree.
  it("keeps each column's verify status scoped to its own model", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes["model-a"] = {
      state: "failed_both",
      passed: 1,
      total: 4,
      failures: [],
    };
    ui.state.verify.outcomes["model-b"] = {
      state: "passed_first_try",
      passed: 2,
      total: 2,
    };

    const headerA = ui.buildColumnHeader({
      model: "model-a",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    const headerB = ui.buildColumnHeader({
      model: "model-b",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });

    const textA = allText(headerA);
    assertStringIncludes(textA, "Failed both tries");
    assertStringIncludes(textA, "1 of 4 tests");
    assertEquals(textA.includes("Passed first try"), false);

    const textB = allText(headerB);
    assertStringIncludes(textB, "Passed first try");
    assertEquals(textB.includes("Failed both tries"), false);
  });

  // `loadUi()` re-imports app.js through a `data:` URL built from the SAME
  // source text every call, so Deno's module cache resolves every call to
  // one shared module instance — `state` is a de facto singleton across the
  // whole test run, not a fresh one per test. Every test below that reads
  // `state.verify` therefore resets it first, the same discipline the rest
  // of this file already applies to `state.run`/`selectedDir` — a value no
  // test sets explicitly must never be assumed clean.
  it("offers Compile & test for a response ready to compile", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    const button = findNode(header, "verify-button", "Compile & test");
    assertEquals(button?.["disabled"], false);
  });

  it("disables Compile & test while a job for this response is already in flight", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;
    ui.state.verify.outcomes["anthropic/opus"] = {
      state: "running",
      phase: "compiling",
    };
    const header = ui.buildColumnHeader({
      model: "anthropic/opus",
      resolution: readyResolution,
      objects: [],
      classification: { verdict: "different-approach" },
    });
    const button = findNode(header, "verify-button", "Compile & test");
    assertEquals(button?.["disabled"], true);
  });

  it("offers Compile & test all when at least one response is ready", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;
    ui.renderTrapSummary({
      signature: null,
      rows: [],
      responses: [{ model: "anthropic/opus", resolution: readyResolution }],
    });
    const button = findNode(
      node("trap-summary"),
      "verify-all-button",
      "Compile & test all",
    );
    assertEquals(button?.["disabled"], false);
  });

  it("disables Compile & test all when nothing is ready to compile", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;
    ui.renderTrapSummary({
      signature: null,
      rows: [],
      responses: [{ model: "anthropic/opus", resolution: notReadyResolution }],
    });
    const button = findNode(
      node("trap-summary"),
      "verify-all-button",
      "Compile & test all",
    );
    assertEquals(button?.["disabled"], true);
  });

  // Step 3's "disable both while the gate refuses, showing the reason":
  // a POST /api/verify refusal (409/501, both surfaced identically through
  // `body.error`) must disable BOTH actions and show the reason on both,
  // not just record it invisibly in state.
  it("disables both compile-and-test actions once the gate refuses, showing the reason", async () => {
    const ui = await loadUi();
    ui.state.verify.outcomes = {};
    ui.state.verify.blockedReason = null;
    const reason =
      "A bench is running, started 2026-08-19T10:00:00Z. Compile and " +
      "test publishes to the same container and would corrupt that run. " +
      "Ask N models still works.";
    const originalFetch = globalThis.fetch;
    let calls = 0;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = () => {
      calls++;
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: reason }),
      });
    };

    try {
      const response = {
        model: "anthropic/opus",
        resolution: readyResolution,
        objects: [],
        classification: { verdict: "different-approach" },
      };
      ui.state.run = { responses: [response], rows: [] };
      ui.state.runDraftDir = "d1";

      const before = ui.buildColumnHeader(response);
      const buttonBefore = findNode(before, "verify-button", "Compile & test");
      assertEquals(buttonBefore?.["disabled"], false);

      await (buttonBefore!.listeners["click"]![0]! as () => Promise<void>)();
      assertEquals(calls, 1);
      assertEquals(ui.state.verify.blockedReason, reason);

      const after = ui.buildColumnHeader(response);
      const buttonAfter = findNode(after, "verify-button", "Compile & test");
      assertEquals(buttonAfter?.["disabled"], true);
      assertStringIncludes(allText(after), reason);

      ui.renderTrapSummary({
        signature: null,
        rows: [],
        responses: [response],
      });
      const allButton = findNode(
        node("trap-summary"),
        "verify-all-button",
        "Compile & test all",
      );
      assertEquals(allButton?.["disabled"], true);
      assertStringIncludes(allText(node("trap-summary")), reason);
    } finally {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).fetch = originalFetch;
    }
  });
});
