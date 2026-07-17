import { assertEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import {
  signBlobUpload,
  signEnvelopeV2,
  signHeaderRequest,
  signPayload,
} from "../../../src/ingest/sign.ts";
import { buildSignedEnvelope } from "../../../src/ingest/mod.ts";

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

Deno.test("signEnvelopeV2 binds run_id + signed_at into the signed message (S5)", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const payload = { b: 2, a: 1 };
  const now = new Date("2026-07-17T12:00:00Z");

  const sig = await signEnvelopeV2(payload, "run-1", priv, 9, now);
  assertEquals(sig.alg, "Ed25519");
  assertEquals(sig.key_id, 9);
  assertEquals(sig.signed_at, "2026-07-17T12:00:00.000Z");

  const canonical =
    `{"payload":{"a":1,"b":2},"run_id":"run-1","signed_at":"${sig.signed_at}"}`;
  const raw = Uint8Array.from(atob(sig.value), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(canonical),
    pub,
  );
  assertEquals(ok, true);

  // Mutating run_id in the message breaks verification — the replay class
  // (captured body + fresh run_id) the v2 envelope exists to close.
  const tampered = canonical.replace("run-1", "run-2");
  const bad = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(tampered),
    pub,
  );
  assertEquals(bad, false);
});

Deno.test("buildSignedEnvelope emits a v2 envelope whose signature round-trips", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const payload = { machine_id: "m1", results: [] };

  const envelope = await buildSignedEnvelope("run-abc", payload, priv, 7);
  assertEquals(envelope["version"], 2);
  assertEquals(envelope["run_id"], "run-abc");
  const sig = envelope["signature"] as {
    signed_at: string;
    value: string;
    key_id: number;
  };
  assertEquals(sig.key_id, 7);

  const canonical =
    `{"payload":{"machine_id":"m1","results":[]},"run_id":"run-abc","signed_at":"${sig.signed_at}"}`;
  const raw = Uint8Array.from(atob(sig.value), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(canonical),
    pub,
  );
  assertEquals(ok, true);
});

Deno.test("signHeaderRequest signs canonical(method, path, body_sha256, signed_at) for POST (S3 finalize)", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const path = "/api/v1/runs/run-xyz/finalize";
  const now = new Date("2026-07-17T13:00:00Z");

  // Finalize has no body — body_sha256 is the empty string, matching the
  // server's `bodyBytes.length === 0 → ""` convention.
  const out = await signHeaderRequest("POST", path, "", priv, 5, now);
  assertEquals(out.key_id, 5);
  assertEquals(out.signed_at, "2026-07-17T13:00:00.000Z");

  const canonical =
    `{"body_sha256":"","method":"POST","path":"${path}","signed_at":"${out.signed_at}"}`;
  const raw = Uint8Array.from(atob(out.signature), (c) => c.charCodeAt(0));
  const ok = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(canonical),
    pub,
  );
  assertEquals(ok, true);
});
