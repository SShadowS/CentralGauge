/**
 * Reserve one supervised credential-bearing run in the shared cross-lane
 * ledger (CG_CREDENTIAL_LEDGER) before a credential is released (M4-17's
 * pilot runner calls it). Usage:
 *   deno run --allow-all scripts/harness/reserve-credential-run.ts --lane <lane> --task <HX-00N> --config <model-or-arm> --purpose <text>
 * Exit 0 with the ordinal, exit 1 when refused.
 */

import { parseArgs } from "@std/cli/parse-args";
import {
  CREDENTIAL_RUN_LIMIT,
  reserveCredentialRun,
} from "../../src/harness/credential-budget.ts";

const a = parseArgs(Deno.args, {
  string: ["lane", "task", "config", "purpose"],
});
try {
  const n = await reserveCredentialRun(
    Deno.env.get("CG_CREDENTIAL_LEDGER") ?? null,
    {
      lane: a.lane ?? "",
      task: a.task ?? "",
      config: a.config ?? "",
      purpose: a.purpose ?? "",
    },
  );
  console.log(
    `[OK] credential run ${n} of ${CREDENTIAL_RUN_LIMIT} reserved`,
  );
} catch (err) {
  console.error(`[FAIL] ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
}
