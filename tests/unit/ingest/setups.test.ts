import { assert, assertEquals, assertRejects } from "@std/assert";
import * as ed from "@noble/ed25519";
import { decodeBase64 } from "jsr:@std/encoding@^1.0.5/base64";
import { canonicalJSON } from "../../../src/ingest/canonical.ts";
import { signPathBound } from "../../../src/ingest/sign.ts";
import {
  postSetupPromote,
  postSetupPublish,
} from "../../../src/ingest/setups.ts";
import { CentralGaugeError } from "../../../src/errors.ts";
import type { SetupPublishPayload } from "../../../src/ingest/setups.ts";

const key = ed.utils.randomSecretKey();
const config = {
  url: "https://x.test/",
  adminKeyPath: "unused",
  adminKeyId: 7,
};
const PUBLISH = "/api/v1/admin/setups/publish";
const PROMOTE = "/api/v1/admin/setups/task-sets/promote";

const verify = async (
  sig: { value: string; signed_at: string },
  message: string,
) =>
  ed.verifyAsync(
    decodeBase64(sig.value),
    new TextEncoder().encode(message),
    await ed.getPublicKeyAsync(key),
  );

const payload = {
  setup: { id: "s1" },
  run: { id: "r1" },
} as unknown as SetupPublishPayload;

function stub(responses: Response[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return Promise.resolve(
      responses[Math.min(calls.length, responses.length) - 1],
    );
  }) as typeof fetch;
  return { calls, opts: { fetchFn, backoffBaseMs: 1 } };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

Deno.test("signPathBound signs payload+path+signed_at only", async () => {
  const sig = await signPathBound(payload, PUBLISH, key, 7);
  const msg = canonicalJSON({
    payload,
    path: PUBLISH,
    signed_at: sig.signed_at,
  });
  assert(await verify(sig, msg));
  assert(!(await verify(sig, canonicalJSON(payload))));
  assertEquals(sig.key_id, 7);
});

Deno.test("postSetupPublish posts a path-bound signature", async () => {
  const ok = { run_id: "r1", setup_id: "s1", task_set_hash: "h" };
  const { calls, opts } = stub([json(201, ok)]);
  assertEquals(await postSetupPublish(config, key, payload, opts), ok);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.url, `https://x.test${PUBLISH}`);
  const sig = calls[0]?.body["signature"] as {
    value: string;
    signed_at: string;
  };
  assert(
    await verify(
      sig,
      canonicalJSON({ payload, path: PUBLISH, signed_at: sig.signed_at }),
    ),
  );
});

Deno.test("postSetupPromote posts to the promote path", async () => {
  const ok = { hash: "h", promoted_at: "t" };
  const { calls, opts } = stub([json(200, ok)]);
  assertEquals(await postSetupPromote(config, key, "h", opts), ok);
  assertEquals(calls[0]?.url, `https://x.test${PROMOTE}`);
  assertEquals(calls[0]?.body["payload"], { hash: "h" });
});

Deno.test("409 throws with server code after one request", async () => {
  const { calls, opts } = stub([
    json(409, { error: "dup", code: "already_published" }),
  ]);
  const err = await assertRejects(
    () => postSetupPublish(config, key, payload, opts),
    CentralGaugeError,
  );
  assertEquals((err as CentralGaugeError).code, "already_published");
  assertEquals(calls.length, 1);
});

Deno.test("500 is retried up to 3 attempts", async () => {
  const { calls, opts } = stub([
    json(500, { error: "x", code: "internal_error" }),
  ]);
  const err = await assertRejects(
    () => postSetupPublish(config, key, payload, opts),
    CentralGaugeError,
  );
  assertEquals((err as CentralGaugeError).code, "internal_error");
  assertEquals(calls.length, 3);
});

Deno.test("mirrored SetupPublishPayload matches the site interface", async () => {
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/"/g, "'").replace(/[;,]/g, "");
  const block = (src: string) =>
    /export interface SetupPublishPayload \{[\s\S]*?\n\}\n/.exec(src)?.[0];
  const site = block(
    await Deno.readTextFile("site/src/lib/shared/setup-publish.ts"),
  );
  const mirror = block(await Deno.readTextFile("src/ingest/setups.ts"));
  assert(site && mirror);
  assertEquals(norm(mirror), norm(site));
});
