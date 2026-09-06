// Child process for the multi-process lock race test. Never releases: the
// parent deletes the temp dir, and a held lock is what the losers must see.
import { tryAcquireBenchLock } from "../../src/utils/bench-lock.ts";

const dir = Deno.args[0];
if (!dir) throw new Error("dir argument required");
const result = tryAcquireBenchLock(dir, { command: "race-child" });
console.log(result.acquired ? "acquired" : "held");
