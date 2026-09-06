import { assert, assertEquals } from "@std/assert";
import { bodyDigest, itemIdFor } from "../../../src/batch/items.ts";

Deno.test("itemIdFor is 32 chars, starts with b, is deterministic and round-sensitive", async () => {
  const a = await itemIdFor("run-1", "CG-AL-E001", 1, 0);
  assertEquals(a.length, 32);
  assert(a.startsWith("b"));
  assert(/^[a-f0-9]{31}$/.test(a.slice(1)));
  assertEquals(a, await itemIdFor("run-1", "CG-AL-E001", 1, 0));
  assert(a !== await itemIdFor("run-1", "CG-AL-E001", 1, 1));
  assert(a !== await itemIdFor("run-1", "CG-AL-E001", 2, 0));
});

Deno.test("bodyDigest is order-independent for object keys", async () => {
  assertEquals(
    await bodyDigest({ a: 1, b: [1, 2] }),
    await bodyDigest({ b: [1, 2], a: 1 }),
  );
});
