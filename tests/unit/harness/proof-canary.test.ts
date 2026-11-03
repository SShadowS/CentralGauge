import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  canaryName,
  judgeProbe,
  plantCanaries,
  removeCanaries,
} from "../../../scripts/harness/proof/access.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

Deno.test("H-35c: canaries go into every existing denied root plus the own workspace (positive control), and are removed again", async () => {
  const base = await Deno.realPath(await testTempDir());
  const roots = {
    resultsRoot: join(base, "results"),
    privateRoot: join(base, "private"),
    symbolStore: join(base, "symbols"),
    keyCustody: null,
    executionId: "e1",
  };
  for (
    const d of [
      "results",
      "private/custody",
      "private/build-cache-judge",
      "symbols",
    ]
  ) {
    await Deno.mkdir(join(base, d), { recursive: true });
  }
  const ws = join(base, "private", "work", "e1", "workspace");
  await Deno.mkdir(ws, { recursive: true });
  const planted = await plantCanaries(roots, ws, "tok123");
  const name = canaryName("tok123");
  assertEquals(
    planted.map((p) => p.path.slice(base.length + 1)).sort(),
    [
      join("private", "build-cache-judge", name),
      join("private", "custody", name),
      join("private", "work", "e1", "workspace", name),
      join("results", name),
      join("symbols", name),
    ].sort(),
  );
  assertEquals(planted.filter((p) => p.positive).length, 1);
  await removeCanaries(planted);
  for (const p of planted) {
    assert(!(await Deno.stat(p.path).catch(() => null)), p.path);
  }
});

Deno.test("H-35c: the sandbox probe passes only when it found the workspace canary and nothing else", () => {
  const n = canaryName("tok");
  const ok = judgeProbe([`C:\\workspace\\${n}`], "tok");
  assertEquals([ok.pass, ok.positive, ok.leaks], [true, true, []]);
  const blind = judgeProbe([], "tok");
  assertEquals([blind.pass, blind.positive], [false, false]);
  const leak = judgeProbe([`C:\\workspace\\${n}`, `C:\\task\\x\\${n}`], "tok");
  assertEquals([leak.pass, leak.leaks], [false, [`C:\\task\\x\\${n}`]]);
  // Another token's canary is not this run's.
  assertEquals(
    judgeProbe([`C:\\workspace\\${canaryName("old")}`], "tok").pass,
    false,
  );
});
