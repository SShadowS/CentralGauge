/**
 * Task 1 — `mergeBenchDefaults` validation + defaults (pure-function tests).
 *
 * Sibling file `loader.test.ts` already exercises the full
 * `ConfigManager.loadConfig` pipeline (YAML parse → merge → validate). This
 * file targets the pure merge/validation helper directly — no filesystem,
 * no env vars — matching the pattern used by `lifecycle-config.test.ts`.
 *
 * Contract pinned here:
 *
 * 1. `BENCH_DEFAULTS.infraRetriesPerAttempt === 1`. Changing this default
 *    shifts bench behaviour for every operator that never customised the
 *    knob; bump the strategic plan rationale boxes in the same commit if
 *    you ever need to.
 * 2. `mergeBenchDefaults` returns defaults when the section is absent.
 * 3. Explicit values pass through (including `0`).
 * 4. Invalid values throw `ConfigurationError`: negative, non-integer,
 *    `NaN`, `Infinity`, non-number.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  BENCH_DEFAULTS,
  mergeBenchDefaults,
} from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";

Deno.test("BENCH_DEFAULTS pinned values (operator-facing contract)", () => {
  // Default of 1 is the plan's recommended starting point — see
  // `docs/superpowers/plans/2026-05-13-automatic-infra-retry.md`. Bumping
  // this without a plan update silently changes every bench run for
  // operators who never set the knob.
  assertEquals(BENCH_DEFAULTS.infraRetriesPerAttempt, 1);
});

Deno.test("mergeBenchDefaults returns defaults when section is absent", () => {
  const r = mergeBenchDefaults(undefined);
  assertEquals(r, BENCH_DEFAULTS);
});

Deno.test("mergeBenchDefaults returns defaults for empty object", () => {
  const r = mergeBenchDefaults({});
  assertEquals(r, BENCH_DEFAULTS);
});

Deno.test("mergeBenchDefaults passes explicit value through", () => {
  const r = mergeBenchDefaults({ infraRetriesPerAttempt: 3 });
  assertEquals(r.infraRetriesPerAttempt, 3);
});

Deno.test("mergeBenchDefaults accepts explicit zero", () => {
  // 0 is the documented off-switch — must survive `??` short-circuiting.
  const r = mergeBenchDefaults({ infraRetriesPerAttempt: 0 });
  assertEquals(r.infraRetriesPerAttempt, 0);
});

Deno.test("mergeBenchDefaults rejects negative values", () => {
  assertThrows(
    () => mergeBenchDefaults({ infraRetriesPerAttempt: -1 }),
    ConfigurationError,
    "infraRetriesPerAttempt",
  );
});

Deno.test("mergeBenchDefaults rejects non-integer values", () => {
  assertThrows(
    () => mergeBenchDefaults({ infraRetriesPerAttempt: 1.5 }),
    ConfigurationError,
    "infraRetriesPerAttempt",
  );
});

Deno.test("mergeBenchDefaults rejects NaN", () => {
  assertThrows(
    () => mergeBenchDefaults({ infraRetriesPerAttempt: Number.NaN }),
    ConfigurationError,
    "infraRetriesPerAttempt",
  );
});

Deno.test("mergeBenchDefaults rejects Infinity", () => {
  assertThrows(
    () =>
      mergeBenchDefaults({
        infraRetriesPerAttempt: Number.POSITIVE_INFINITY,
      }),
    ConfigurationError,
    "infraRetriesPerAttempt",
  );
});

Deno.test("mergeBenchDefaults rejects non-number value", () => {
  // YAML can hand us a string when the operator quotes the value; the
  // helper must catch that without trusting the static type.
  assertThrows(
    () =>
      mergeBenchDefaults(
        { infraRetriesPerAttempt: "three" } as unknown as {
          infraRetriesPerAttempt?: number;
        },
      ),
    ConfigurationError,
    "infraRetriesPerAttempt",
  );
});
