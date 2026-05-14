/**
 * Decides whether an AL test project can run through the headless SOAP
 * harness, or must use the legacy client-session path.
 *
 * A web-service session cannot open a `TestPage` (it throws
 * `System.NotSupportedException` at `NavSession.CreateNavTestService()`), and
 * such a failure is indistinguishable from a genuine test failure in the
 * harness output — so the decision MUST be made statically from source.
 *
 * @module container/test-routing
 */

import type { ALProject } from "./types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:test-routing");

// Matches a `TestPage` type declaration: the keyword preceded by `:` (AL
// variable syntax `varName: TestPage "..."`) and terminated by a word boundary.
// This excludes identifiers like `TestPageView` and text in `//` comments,
// because AL type declarations always use the colon form.
const TEST_PAGE_DECL = /:\s*TestPage\b/;

/** True when any test file in the project declares a `TestPage` variable. */
export async function projectUsesTestPage(
  project: ALProject,
): Promise<boolean> {
  for (const file of project.testFiles) {
    let source: string;
    try {
      source = await Deno.readTextFile(file);
    } catch (e) {
      log.warn("could not read test file for routing; assuming non-TestPage", {
        file,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    if (TEST_PAGE_DECL.test(source)) {
      log.debug("project uses TestPage; routing to client-session path", {
        file,
      });
      return true;
    }
  }
  return false;
}
