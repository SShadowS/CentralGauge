import { assertEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import { signBlobUpload, signPayload } from "../../../src/ingest/sign.ts";

Deno.test("signPayload produces verifiable Ed25519 signature over canonical JSON", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const payload = { b: 2, a: 1 };
  const sig = await signPayload(payload, priv, 42);
  assertEquals(sig.alg, "Ed25519");
  assertEquals(sig.key_id, 42);

  const canonical = '{"a":1,"b":2}';
  const msg = new TextEncoder().encode(canonical);
  const raw = Uint8Array.from(atob(sig.value), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(raw, msg, pub);
  assertEquals(ok, true);
});

Deno.test("signBlobUpload signs canonical(method, path, body_sha256, signed_at)", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const path = "/api/v1/blobs/" + "a".repeat(64);
  const bodySha256 = "a".repeat(64);
  const now = new Date("2026-04-20T12:00:00Z");

  const out = await signBlobUpload(path, bodySha256, priv, 7, now);
  assertEquals(out.key_id, 7);
  assertEquals(out.signed_at, "2026-04-20T12:00:00.000Z");

  const canonical =
    `{"body_sha256":"${bodySha256}","method":"PUT","path":"${path}","signed_at":"${out.signed_at}"}`;
  const msg = new TextEncoder().encode(canonical);
  const raw = Uint8Array.from(atob(out.signature), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(raw, msg, pub);
  assertEquals(ok, true);
});
