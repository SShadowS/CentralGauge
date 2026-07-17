/**
 * V7 — lifecycle header signing emits a replay-preventing nonce.
 *
 * `signLifecycleHeaders` now (1) supports POST (cluster 7 wires the
 * endpoint), (2) generates a per-request nonce, folds it into the signed
 * canonical bytes, and returns it as `X-CG-Nonce` so the server can
 * INSERT-or-409 it. The nonce is inside the signature, so stripping or
 * swapping the header breaks verification.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import { canonicalJSON } from "../../../src/ingest/canonical.ts";
import { signLifecycleHeaders } from "../../../src/lifecycle/event-log.ts";

Deno.test("signLifecycleHeaders emits X-CG-Nonce folded into the signed bytes", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);

  const headers = await signLifecycleHeaders(priv, 3, {
    method: "GET",
    path: "/api/v1/admin/lifecycle/events",
    query: { model: "m/x", limit: 5, task_set: undefined },
  });

  const nonce = headers["X-CG-Nonce"];
  assert(nonce !== undefined && nonce.length > 0, "X-CG-Nonce header missing");

  const canonical = canonicalJSON({
    method: "GET",
    path: "/api/v1/admin/lifecycle/events",
    query: { model: "m/x", limit: "5" },
    body_sha256: "",
    signed_at: headers["X-CG-Signed-At"],
    nonce,
  });
  const raw = Uint8Array.from(
    atob(headers["X-CG-Signature"]!),
    (c) => c.charCodeAt(0),
  );
  const ok = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(canonical),
    pub,
  );
  assertEquals(ok, true, "signature must verify over fields INCLUDING nonce");

  // Swapped nonce → verification fails (header can't be replayed with a
  // fresh nonce to dodge the server's replay table).
  const swapped = canonicalJSON({
    method: "GET",
    path: "/api/v1/admin/lifecycle/events",
    query: { model: "m/x", limit: "5" },
    body_sha256: "",
    signed_at: headers["X-CG-Signed-At"],
    nonce: crypto.randomUUID(),
  });
  const bad = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(swapped),
    pub,
  );
  assertEquals(bad, false);
});

Deno.test("signLifecycleHeaders mints a fresh nonce per call", async () => {
  const priv = ed.utils.randomSecretKey();
  const args = {
    method: "GET" as const,
    path: "/api/v1/admin/lifecycle/state",
    query: { model: "m/y" },
  };
  const h1 = await signLifecycleHeaders(priv, 3, args);
  const h2 = await signLifecycleHeaders(priv, 3, args);
  assertNotEquals(h1["X-CG-Nonce"], h2["X-CG-Nonce"]);
});

Deno.test("signLifecycleHeaders supports POST with a signed body hash (cluster 7 seam)", async () => {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const body = new TextEncoder().encode(`{"decision":"merge"}`);
  const bodyDigest = await crypto.subtle.digest(
    "SHA-256",
    body as BufferSource,
  );
  const bodySha = Array.from(new Uint8Array(bodyDigest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  const headers = await signLifecycleHeaders(priv, 4, {
    method: "POST",
    path: "/api/v1/admin/lifecycle/cluster-review/decide",
    body,
  });

  const canonical = canonicalJSON({
    method: "POST",
    path: "/api/v1/admin/lifecycle/cluster-review/decide",
    query: {},
    body_sha256: bodySha,
    signed_at: headers["X-CG-Signed-At"],
    nonce: headers["X-CG-Nonce"],
  });
  const raw = Uint8Array.from(
    atob(headers["X-CG-Signature"]!),
    (c) => c.charCodeAt(0),
  );
  const ok = await ed.verifyAsync(
    raw,
    new TextEncoder().encode(canonical),
    pub,
  );
  assertEquals(ok, true);
});
