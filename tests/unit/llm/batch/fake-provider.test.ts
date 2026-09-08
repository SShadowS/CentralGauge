import { assertEquals, assertRejects } from "@std/assert";
import { BatchSubmitRejected } from "../../../../src/llm/batch/types.ts";
import { FakeBatchProvider } from "../../../utils/fake-batch-provider.ts";

Deno.test("fake provider records calls and follows its script", async () => {
  const fake = new FakeBatchProvider("anthropic", {
    submit: [{ throws: new BatchSubmitRejected("too big", 413, false, true) }, {
      handleId: "h-1",
    }],
    poll: {
      "h-1": [
        { processing: true, providerStatus: "in_progress", rawCounts: {} },
        {
          processing: false,
          providerStatus: "ended",
          rawCounts: { succeeded: 2 },
        },
      ],
    },
  });
  await assertRejects(
    () => fake.submit("m", [{ itemId: "a", body: {} }], "n"),
    BatchSubmitRejected,
  );
  const h = await fake.submit("m", [{ itemId: "a", body: {} }, {
    itemId: "b",
    body: {},
  }], "n");
  assertEquals(h.batchId, "h-1");
  assertEquals((await fake.poll(h)).processing, true);
  assertEquals((await fake.poll(h)).processing, false);
  assertEquals(
    (await fake.poll(h)).processing,
    false,
    "last poll entry repeats",
  );
  const results = await fake.collect(h);
  assertEquals(results.map((r) => r.itemId), ["a", "b"]);
  assertEquals(fake.calls.map((c) => c.op), [
    "submit",
    "submit",
    "poll",
    "poll",
    "poll",
    "collect",
  ]);
});
