/**
 * Static-content checks for the dashboard's generated page (CLI5, CLI12).
 *
 * `generateDashboardPage()` emits a single HTML+inline-JS string executed
 * only in a browser: there's no JS harness in this repo to actually run
 * `handleSSEEvent`/`esc` (see the CLI5 brief's own manual-verify note for
 * this file). These are source-level
 * regression checks: they pin the shape of the generated JS so a future
 * edit can't silently reintroduce either bug, but the actual runtime
 * behavior of both fixes was verified by manual browser testing.
 *
 * @module tests/unit/dashboard/page
 */

import { assert, assertStringIncludes } from "@std/assert";
import { generateDashboardPage } from "../../../cli/dashboard/page.ts";

Deno.test("generateDashboardPage source", async (t) => {
  const html = generateDashboardPage();

  await t.step(
    "CLI5: full-state/health-snapshot/pool-snapshot are dispatched before the state===null guard",
    () => {
      const handlerStart = html.indexOf("function handleSSEEvent(event)");
      assert(handlerStart >= 0, "handleSSEEvent function not found");
      const handlerBody = html.slice(handlerStart, handlerStart + 1500);

      const guardIndex = handlerBody.indexOf("if (!state) return;");
      const fullStateIndex = handlerBody.indexOf("case 'full-state':");
      const healthIndex = handlerBody.indexOf("case 'health-snapshot':");
      const poolIndex = handlerBody.indexOf("case 'pool-snapshot':");

      assert(guardIndex >= 0, "state===null guard not found");
      assert(fullStateIndex >= 0, "full-state case not found");
      assert(healthIndex >= 0, "health-snapshot case not found");
      assert(poolIndex >= 0, "pool-snapshot case not found");

      // All three replay-style events must be handled BEFORE the guard,
      // otherwise a null `state` (failed initial fetch) drops them forever.
      assert(
        fullStateIndex < guardIndex,
        "full-state case must be dispatched before the state===null guard",
      );
      assert(
        healthIndex < guardIndex,
        "health-snapshot case must be dispatched before the state===null guard",
      );
      assert(
        poolIndex < guardIndex,
        "pool-snapshot case must be dispatched before the state===null guard",
      );
    },
  );

  await t.step(
    "CLI12: esc() escapes single quotes for escapeHtml() parity",
    () => {
      const escStart = html.indexOf("function esc(str)");
      assert(escStart >= 0, "esc function not found");
      const escBody = html.slice(escStart, escStart + 500);
      assertStringIncludes(escBody, "&#39;");
    },
  );
});
