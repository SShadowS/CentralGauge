import { assertEquals, assertStringIncludes } from "@std/assert";
import { postWithRetry } from "../../../src/ingest/client.ts";

Deno.test("postWithRetry returns success on first try", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, {
    fetchFn: fakeFetch,
    maxAttempts: 3,
  });
  assertEquals(resp.status, 200);
  assertEquals(calls, 1);
});

Deno.test("postWithRetry retries on 5xx", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    if (calls < 3) {
      return Promise.resolve(new Response("oops", { status: 503 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, {
    fetchFn: fakeFetch,
    maxAttempts: 5,
    backoffBaseMs: 1,
  });
  assertEquals(resp.status, 200);
  assertEquals(calls, 3);
});

Deno.test("postWithRetry does NOT retry on 4xx", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    return Promise.resolve(
      new Response(JSON.stringify({ code: "bad_signature" }), { status: 400 }),
    );
  };
  const resp = await postWithRetry("https://x/y", { a: 1 }, {
    fetchFn: fakeFetch,
    maxAttempts: 5,
    backoffBaseMs: 1,
  });
  assertEquals(resp.status, 400);
  assertEquals(calls, 1);
  const body = await resp.json() as { code: string };
  assertStringIncludes(body.code, "bad_signature");
});

Deno.test("postWithRetry retries on network error and eventually throws", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    return Promise.reject(new Error("econnreset"));
  };
  try {
    await postWithRetry("https://x/y", { a: 1 }, {
      fetchFn: fakeFetch,
      maxAttempts: 3,
      backoffBaseMs: 1,
    });
    throw new Error("expected postWithRetry to throw");
  } catch (e) {
    assertStringIncludes((e as Error).message, "econnreset");
    assertEquals(calls, 3);
  }
});
