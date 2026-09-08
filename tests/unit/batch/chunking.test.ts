import { assertEquals } from "@std/assert";
import { chunkItems, halveChunk } from "../../../src/batch/chunking.ts";

const wrap = (items: unknown[]) => ({ requests: items });
const item = (id: string, size: number) => ({
  itemId: id,
  body: { p: "x".repeat(size) },
});

Deno.test("chunkItems respects maxItems and maxBytes in order", () => {
  const chunks = chunkItems(
    [item("a", 10), item("b", 10), item("c", 10)],
    { maxItems: 2, maxBytes: 1_000_000 },
    wrap,
  );
  assertEquals(chunks.map((c) => c.items.map((i) => i.itemId)), [[
    "a",
    "b",
  ], ["c"]]);
  assertEquals(chunks.map((c) => c.chunk), [0, 1]);

  // maxBytes: 700 sits strictly between one item's envelope (445 bytes) and
  // two items' combined envelope (876 bytes), so it forces each item into
  // its own chunk without maxItems ever coming into play.
  const byBytes = chunkItems(
    [item("a", 400), item("b", 400), item("c", 400)],
    { maxItems: 100, maxBytes: 700 },
    wrap,
  );
  assertEquals(byBytes.length, 3);
});

Deno.test("halveChunk splits in the middle, keeps ids, and refuses a single item", () => {
  const [left, right] = halveChunk(
    { chunk: 0, items: [item("a", 1), item("b", 1), item("c", 1)], bytes: 0 },
    7,
    wrap,
  )!;
  assertEquals(left.items.map((i) => i.itemId), ["a", "b"]);
  assertEquals(right.items.map((i) => i.itemId), ["c"]);
  assertEquals([left.chunk, right.chunk], [0, 7]);
  assertEquals(
    halveChunk({ chunk: 0, items: [item("a", 1)], bytes: 0 }, 1, wrap),
    null,
  );
});
