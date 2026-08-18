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

const detailPanel = createNode("section");
const detailTitle = createNode("h2");
const detailSource = createNode("pre");

const stubDocument = {
  readyState: "loading",
  createElement: (tag: string) => createNode(tag),
  createDocumentFragment: () => createNode("#fragment"),
  getElementById: (id: string) => {
    if (id === "detail-panel") return detailPanel;
    if (id === "detail-title") return detailTitle;
    if (id === "detail-source") return detailSource;
    return createNode("div");
  },
  addEventListener: () => {},
};

interface Ui {
  buildColumnHeader: (response: unknown) => StubNode;
  buildCell: (row: unknown, response: unknown) => StubNode;
}

async function loadUi(): Promise<Ui> {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = stubDocument;
  const src = await Deno.readTextFile(
    new URL("../../../src/dashboard/ui/app.js", import.meta.url),
  );
  const module = `${src}\nexport { buildColumnHeader, buildCell };\n`;
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
});
