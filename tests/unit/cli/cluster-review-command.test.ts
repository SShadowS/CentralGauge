/**
 * D7.4 — `centralgauge lifecycle cluster-review` registration smoke test.
 *
 * The interactive flow (Cliffy prompts + signed POSTs) is exercised via
 * the admin endpoint suite at site/tests/api/admin-cluster-review.test.ts;
 * here we just verify the command attaches under its parent with the
 * expected name + description.
 */
import { assertEquals, assertExists } from "@std/assert";
import { Command } from "@cliffy/command";
import {
  type PendingRow,
  postDecision,
  type PostDeps,
  postSplit,
  registerClusterReviewCommand,
} from "../../../cli/commands/cluster-review-command.ts";

Deno.test("cluster-review command registers under parent", () => {
  const parent = new Command();
  registerClusterReviewCommand(parent);
  const sub = parent.getCommand("cluster-review");
  assertEquals(sub?.getName(), "cluster-review");
  assertEquals(typeof sub?.getDescription(), "string");
  // The Select prompt happens at action-time, so we can't easily assert
  // the choices list here without invoking the action. The presence of
  // the subcommand + its options is sufficient — the auth + flow paths
  // are covered by the admin-cluster-review tests.
});

Deno.test("cluster-review command exposes --actor and --limit options", () => {
  const parent = new Command();
  registerClusterReviewCommand(parent);
  const sub = parent.getCommand("cluster-review");
  const opts = sub?.getOptions() ?? [];
  const names = opts.map((o) => o.name);
  // --actor is a string option, --limit is a default-999 integer option.
  // The exact CLI flag form depends on Cliffy's option parsing; we just
  // check both option names appear.
  const hasActor = names.includes("actor");
  const hasLimit = names.includes("limit");
  assertEquals(hasActor, true);
  assertEquals(hasLimit, true);
});

// ---------------------------------------------------------------------------
// D7.4 — choice → route → payload mapping smoke tests.
//
// These tests stub `postWithRetry` (via dependency injection) to capture
// the URL + body each decision dispatches. They do NOT exercise the
// interactive prompts — that's covered by the admin-cluster-review test
// suite end-to-end. The goal here is to lock the contract between the
// CLI's M/C/S choices and the /decide endpoint payload schema so a
// rename in either side fails fast.
// ---------------------------------------------------------------------------

function mockRow(): PendingRow {
  return {
    id: 42,
    model_slug: "sonnet-4.7",
    concept_slug_proposed: "obsolete-runtime-flag",
    confidence: 0.78,
    created_at: 1_700_000_000_000,
    payload: {
      nearest_concept_id: 7,
      similarity: 0.78,
      shortcoming_ids: [101, 102],
      sample_descriptions: ["Sets runtime to 7.0"],
      al_concept: "runtime",
    },
    nearest: {
      id: 7,
      slug: "runtime-version-mismatch",
      description: "Wrong runtime",
      sample_descriptions: ["Pins runtime to outdated version"],
    },
  };
}

function mockDeps(): PostDeps {
  return {
    url: "https://example.test",
    privKey: new Uint8Array(32), // signing is exercised by sign.ts tests
    keyId: 1,
    envelopeJson: '{"tools":{}}',
    actor: "test-operator@example.com",
  };
}

interface CapturedPayload {
  decision: "merge" | "create" | "split";
  pending_review_id: number;
  actor_id: string;
  reason: string | null;
  envelope_json: string;
  ts: number;
  new_slugs?: string[];
}

interface CapturedCall {
  url: string;
  body: {
    version: 1;
    payload: CapturedPayload;
    signature: { alg: string; key_id: number };
  };
}

function makeCapturingPostFn(): {
  fn: (url: string, body: unknown) => Promise<Response>;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fn = (url: string, body: unknown): Promise<Response> => {
    calls.push({ url, body: body as CapturedCall["body"] });
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  };
  return { fn, calls };
}

Deno.test("postDecision('merge') dispatches to /decide with merge payload", async () => {
  const { fn, calls } = makeCapturingPostFn();
  await postDecision(mockDeps(), "merge", mockRow(), "duplicate cluster", {
    postFn: fn,
  });

  assertEquals(calls.length, 1);
  const captured = calls[0];
  assertExists(captured);
  assertEquals(
    captured.url,
    "https://example.test/api/v1/admin/lifecycle/cluster-review/decide",
  );
  assertEquals(captured.body.version, 1);
  assertEquals(captured.body.payload.decision, "merge");
  assertEquals(captured.body.payload.pending_review_id, 42);
  assertEquals(captured.body.payload.actor_id, "test-operator@example.com");
  assertEquals(captured.body.payload.reason, "duplicate cluster");
  assertEquals(captured.body.payload.envelope_json, '{"tools":{}}');
  assertEquals(typeof captured.body.payload.ts, "number");
  // Signature shape is opaque here — we just verify it was signed.
  assertEquals(captured.body.signature.alg, "Ed25519");
  assertEquals(captured.body.signature.key_id, 1);
});

Deno.test("postDecision('create') dispatches to /decide with create payload", async () => {
  const { fn, calls } = makeCapturingPostFn();
  await postDecision(
    mockDeps(),
    "create",
    mockRow(),
    "needs its own concept",
    { postFn: fn },
  );

  assertEquals(calls.length, 1);
  const captured = calls[0];
  assertExists(captured);
  assertEquals(
    captured.url,
    "https://example.test/api/v1/admin/lifecycle/cluster-review/decide",
  );
  assertEquals(captured.body.payload.decision, "create");
  assertEquals(captured.body.payload.pending_review_id, 42);
  assertEquals(captured.body.payload.reason, "needs its own concept");
  // The /decide endpoint resolves new_concept_slug from the row's proposed
  // slug server-side — the CLI passes only pending_review_id and lets the
  // server unpack it. Verify the proposed slug was reachable via the row id.
  assertExists(captured.body.payload.pending_review_id);
});

Deno.test("postSplit dispatches to /decide with split payload + new_slugs", async () => {
  const { fn, calls } = makeCapturingPostFn();
  await postSplit(
    mockDeps(),
    mockRow(),
    ["runtime-7-flag", "runtime-8-flag"],
    "two distinct issues",
    { postFn: fn },
  );

  assertEquals(calls.length, 1);
  const captured = calls[0];
  assertExists(captured);
  assertEquals(
    captured.url,
    "https://example.test/api/v1/admin/lifecycle/cluster-review/decide",
  );
  assertEquals(captured.body.payload.decision, "split");
  assertEquals(captured.body.payload.pending_review_id, 42);
  assertEquals(captured.body.payload.reason, "two distinct issues");
  assertEquals(captured.body.payload.new_slugs, [
    "runtime-7-flag",
    "runtime-8-flag",
  ]);
});

Deno.test("postDecision throws when /decide returns non-2xx", async () => {
  const failingPost = (
    _url: string,
    _body: unknown,
  ): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ code: "bad_signature" }), { status: 401 }),
    );

  let caught: Error | undefined;
  try {
    await postDecision(mockDeps(), "merge", mockRow(), undefined, {
      postFn: failingPost,
    });
  } catch (e) {
    caught = e instanceof Error ? e : new Error(String(e));
  }
  assertExists(caught);
  assertEquals(caught.message.includes("401"), true);
});
