import { assertEquals, assertStringIncludes } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import { uploadBlob, uploadMissing } from "../../../src/ingest/blobs.ts";

Deno.test("uploadBlob sends PUT with signature headers on 200", async () => {
  const priv = ed.utils.randomSecretKey();
  const body = new Uint8Array([1, 2, 3]);
  const sha = "a".repeat(64);
  let method = "";
  let sigHeader = "";
  let keyIdHeader = "";
  let pathSeen = "";
  const fakeFetch: typeof fetch = (input, init) => {
    const i = init as RequestInit | undefined;
    method = i?.method ?? "";
    sigHeader = new Headers(i?.headers).get("x-cg-signature") ?? "";
    keyIdHeader = new Headers(i?.headers).get("x-cg-key-id") ?? "";
    pathSeen = String(input);
    return Promise.resolve(new Response("", { status: 200 }));
  };
  await uploadBlob("https://host", sha, body, priv, 7, { fetchFn: fakeFetch });
  assertEquals(method, "PUT");
  assertEquals(keyIdHeader, "7");
  assertStringIncludes(pathSeen, `/api/v1/blobs/${sha}`);
  assertEquals(sigHeader.length > 0, true);
});

Deno.test("uploadBlob does NOT retry on 4xx", async () => {
  const priv = ed.utils.randomSecretKey();
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response("bad sig", { status: 401 }));
  };
  try {
    await uploadBlob(
      "https://h",
      "b".repeat(64),
      new Uint8Array([1]),
      priv,
      1,
      {
        fetchFn: fakeFetch,
        backoffBaseMs: 1,
      },
    );
    throw new Error("expected uploadBlob to throw");
  } catch (e) {
    assertStringIncludes((e as Error).message, "401");
  }
  assertEquals(calls, 1);
});

Deno.test("uploadBlob retries on 5xx and eventually succeeds", async () => {
  const priv = ed.utils.randomSecretKey();
  let calls = 0;
  const fakeFetch: typeof fetch = () => {
    calls++;
    if (calls < 3) return Promise.resolve(new Response("", { status: 503 }));
    return Promise.resolve(new Response("", { status: 201 }));
  };
  await uploadBlob("https://h", "c".repeat(64), new Uint8Array([1]), priv, 1, {
    fetchFn: fakeFetch,
    maxAttempts: 5,
    backoffBaseMs: 1,
  });
  assertEquals(calls, 3);
});

Deno.test("uploadMissing uploads each blob and returns count", async () => {
  const priv = ed.utils.randomSecretKey();
  let uploads = 0;
  const fakeFetch: typeof fetch = () => {
    uploads++;
    return Promise.resolve(new Response("", { status: 200 }));
  };
  const result = await uploadMissing(
    "https://h",
    [
      { sha256: "d".repeat(64), body: new Uint8Array([1]) },
      { sha256: "e".repeat(64), body: new Uint8Array([2, 3]) },
    ],
    priv,
    1,
    { fetchFn: fakeFetch },
  );
  assertEquals(result, { uploaded: 2, skipped: 0 });
  assertEquals(uploads, 2);
});
