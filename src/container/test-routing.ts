/**
 * Decides whether an AL test project can run through the headless SOAP
 * harness, or must use the legacy client-session path.
 *
 * A web-service session cannot open a `TestPage` / `TestRequestPage` (it throws
 * `System.NotSupportedException` at `NavSession.CreateNavTestService()`), and
 * such a failure is indistinguishable from a genuine test failure in the
 * harness output — so the decision MUST be made statically from source.
 *
 * Detection parses each test file with the tree-sitter-al grammar and looks
 * for an `object_reference_type` node whose object type is `testpage` or
 * `testrequestpage`. Parsing (rather than a regex) means comments, string
 * literals, and identifiers like `TestPageView` cannot produce a false match.
 *
 * @module container/test-routing
 */

import { Language, Parser, Query } from "web-tree-sitter";
import type { ALProject } from "./types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:test-routing");

// Vendored tree-sitter-al grammar (@sshadows/tree-sitter-al). See
// vendor/tree-sitter-al/README.md for provenance.
const AL_WASM_URL = new URL(
  "../../vendor/tree-sitter-al/tree-sitter-al.wasm",
  import.meta.url,
);

// `object_reference_type` covers Codeunit/Page/Report/.../TestPage references;
// the keyword text discriminates the UI test-page types we must route away
// from the SOAP path.
const OBJECT_REFERENCE_QUERY = "(object_reference_type) @ref";
const TEST_PAGE_TYPE = /^test(request)?page\b/i;

let parserPromise: Promise<{ parser: Parser; query: Query }> | undefined;

/** Lazily initialise the tree-sitter AL parser + query (once per process). */
function getAlParser(): Promise<{ parser: Parser; query: Query }> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const language = await Language.load(await Deno.readFile(AL_WASM_URL));
      const parser = new Parser();
      parser.setLanguage(language);
      const query = new Query(language, OBJECT_REFERENCE_QUERY);
      return { parser, query };
    })();
  }
  return parserPromise;
}

/**
 * True when any test file in the project declares a `TestPage` or
 * `TestRequestPage` variable/parameter.
 *
 * Safe default: if the parser cannot initialise, a file cannot be read, or a
 * file fails to parse, this returns `true` (route to the legacy path) — a
 * TestPage test wrongly sent to the SOAP path fails in a way that looks like a
 * real test failure, so "unknown" must bias to the safe side.
 */
export async function projectUsesTestPage(
  project: ALProject,
): Promise<boolean> {
  let parser: Parser;
  let query: Query;
  try {
    ({ parser, query } = await getAlParser());
  } catch (e) {
    log.warn("AL parser init failed; assuming TestPage (safe default)", {
      error: e instanceof Error ? e.message : String(e),
    });
    return true;
  }

  for (const file of project.testFiles) {
    let source: string;
    try {
      source = await Deno.readTextFile(file);
    } catch (e) {
      log.warn(
        "could not read test file for routing; assuming TestPage (safe default)",
        { file, error: e instanceof Error ? e.message : String(e) },
      );
      return true;
    }

    const tree = parser.parse(source);
    if (!tree) {
      log.warn("AL parse produced no tree; assuming TestPage (safe default)", {
        file,
      });
      return true;
    }
    try {
      for (const capture of query.captures(tree.rootNode)) {
        if (TEST_PAGE_TYPE.test(capture.node.text.trim())) {
          log.debug("project uses TestPage; routing to client-session path", {
            file,
          });
          return true;
        }
      }
    } finally {
      tree.delete();
    }
  }
  return false;
}
