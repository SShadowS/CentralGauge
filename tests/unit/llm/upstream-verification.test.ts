import { assertEquals } from "@std/assert";
import {
  classifyUpstream,
  isUpstreamCompromised,
} from "../../../src/llm/upstream-verification.ts";

const served = (name: string, extra: Record<string, unknown> = {}) => ({
  servedUpstream: name,
  servedUpstreamModel: undefined,
  upstreamIdentitySource: "provider_field" as const,
  upstreamIdentityConflict: undefined,
  ...extra,
});

Deno.test("classifyUpstream: not_applicable for any provider but openrouter", () => {
  const f = classifyUpstream({
    provider: "anthropic",
    requestedUpstream: null,
    expectedProviderName: null,
    response: served("x"),
  });
  assertEquals(f, {
    requestedUpstream: null,
    servedUpstream: null,
    servedUpstreamModel: null,
    upstreamIdentitySource: null,
    upstreamVerification: "not_applicable",
  });
});

Deno.test("classifyUpstream: unpinned records identity without verifying", () => {
  const f = classifyUpstream({
    provider: "openrouter",
    requestedUpstream: null,
    expectedProviderName: null,
    response: served("Google", {
      servedUpstreamModel: "g-1",
      upstreamIdentitySource: "both",
    }),
  });
  assertEquals(f.upstreamVerification, "unpinned");
  assertEquals(f.servedUpstream, "Google");
  assertEquals(f.servedUpstreamModel, "g-1");
  assertEquals(f.upstreamIdentitySource, "both");
  assertEquals(f.requestedUpstream, null);
});

Deno.test("classifyUpstream: pinned outcomes", () => {
  const base = {
    provider: "openrouter",
    requestedUpstream: "novita/fp8",
    expectedProviderName: "Novita",
  };
  assertEquals(
    classifyUpstream({ ...base, response: served("Novita") })
      .upstreamVerification,
    "verified",
  );
  assertEquals(
    classifyUpstream({ ...base, response: served("Together") })
      .upstreamVerification,
    "mismatch",
  );
  assertEquals(
    classifyUpstream({
      ...base,
      response: served("Novita", { upstreamIdentityConflict: true }),
    }).upstreamVerification,
    "mismatch",
  );
  assertEquals(
    classifyUpstream({
      ...base,
      response: {
        servedUpstream: undefined,
        servedUpstreamModel: undefined,
        upstreamIdentitySource: undefined,
        upstreamIdentityConflict: undefined,
      },
    }).upstreamVerification,
    "unverified",
  );
  const ns = classifyUpstream({ ...base, response: undefined });
  assertEquals(ns.upstreamVerification, "not_served");
  assertEquals(ns.requestedUpstream, "novita/fp8");
  assertEquals(ns.servedUpstream, null);
});

Deno.test("isUpstreamCompromised is true only for mismatch and unverified", () => {
  assertEquals(isUpstreamCompromised("mismatch"), true);
  assertEquals(isUpstreamCompromised("unverified"), true);
  for (
    const v of [
      "not_applicable",
      "unpinned",
      "verified",
      "not_served",
    ] as const
  ) {
    assertEquals(isUpstreamCompromised(v), false);
  }
});
