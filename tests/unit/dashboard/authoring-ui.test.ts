import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

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

interface Ui {
  buildColumnHeader: (response: unknown) => StubNode;
  buildCell: (row: unknown, response: unknown) => StubNode;
  renderTrapSummary: (run: unknown) => void;
  renderArtifactNote: (run: unknown) => void;
  renderMatrix: (run: unknown) => void;
}

async function loadUi(): Promise<Ui> {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = stubDocument;
  const src = await Deno.readTextFile(
    new URL("../../../src/dashboard/ui/app.js", import.meta.url),
  );
  const module = `${src}\nexport { buildColumnHeader, buildCell, ` +
    `renderTrapSummary, renderArtifactNote, renderMatrix };\n`;
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
});
