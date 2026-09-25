/**
 * Write harness-tasks/symbols.lock.json from a BCH compiler-cache symbols
 * folder (M1-26). Usage:
 *   deno run --allow-all scripts/harness/symbols-lock.ts --from <symbolsDir> --store <symbolStore> [--altool <path>]
 */

import { parseArgs } from "@std/cli/parse-args";
import {
  altoolReader,
  buildSymbolsLock,
  defaultAltool,
  writeSymbolsLock,
} from "../../src/harness/symbols.ts";

const a = parseArgs(Deno.args, { string: ["from", "store", "altool"] });
if (!a.from || !a.store) {
  console.error(
    "usage: symbols-lock.ts --from <symbolsDir> --store <symbolStore> [--altool <path>]",
  );
  Deno.exit(64);
}
const lock = await buildSymbolsLock(
  a.from,
  a.store,
  altoolReader(a.altool ?? defaultAltool(a.from)),
);
await writeSymbolsLock(Deno.cwd(), lock);
console.log(
  `[OK] ${lock.packages.length} symbol packages locked; store ${a.store}`,
);
