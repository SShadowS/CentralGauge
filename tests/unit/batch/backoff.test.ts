import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTransportBackoff } from "../../../src/batch/backoff.ts";
import { BatchSubmitRejected } from "../../../src/llm/batch/types.ts";

Deno.test("withTransportBackoff retries a transport error with increasing exponential bounds, full jitter", async () => {
  const originalRandom = Math.random;
  try {
    // Full jitter multiplies the bound by Math.random(); fixing it to 1
    // makes the recorded sleep equal the bound exactly, so the test can
    // assert the bounds grow without being flaky.
    Math.random = () => 1;

    const sleeps: number[] = [];
    let calls = 0;
    const result = await withTransportBackoff(() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve("ok");
    }, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    assertEquals(result, "ok");
    assertEquals(calls, 3);
    assertEquals(sleeps.length, 2);
    assert(
      sleeps[1]! > sleeps[0]!,
      `expected increasing bounds, got ${JSON.stringify(sleeps)}`,
    );
  } finally {
    Math.random = originalRandom;
  }
});

Deno.test("withTransportBackoff propagates BatchSubmitRejected immediately, without retrying", async () => {
  let calls = 0;
  const rejection = new BatchSubmitRejected("bad request", 400, false, false);

  await assertRejects(
    () =>
      withTransportBackoff(() => {
        calls++;
        return Promise.reject(rejection);
      }, { sleep: () => Promise.resolve() }),
    BatchSubmitRejected,
  );
  assertEquals(calls, 1);
});

Deno.test("withTransportBackoff gives up after the configured number of tries, propagating the last error", async () => {
  const errors = [
    new Error("e1"),
    new Error("e2"),
    new Error("e3"),
    new Error("e4"),
    new Error("e5"),
    new Error("e6"),
  ];
  let calls = 0;

  const err = await assertRejects(
    () =>
      withTransportBackoff(() => {
        const thrown = errors[calls]!;
        calls++;
        return Promise.reject(thrown);
      }, { sleep: () => Promise.resolve() }),
    Error,
  );

  assertEquals(calls, 5);
  assertEquals((err as Error).message, "e5");
});
