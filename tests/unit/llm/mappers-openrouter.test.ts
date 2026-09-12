import { assertEquals } from "@std/assert";
import {
  assembleResponse,
  extractUpstreamIdentity,
  mapFinishReason,
} from "../../../src/llm/mappers/openrouter.ts";

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

Deno.test("extractUpstreamIdentity reads the legacy provider field alone", () => {
  assertEquals(extractUpstreamIdentity({ provider: "Novita" }), {
    servedUpstream: "Novita",
    servedUpstreamModel: undefined,
    source: "provider_field",
  });
});

Deno.test("extractUpstreamIdentity reads router metadata alone, with the dated model", () => {
  assertEquals(
    extractUpstreamIdentity({
      openrouter_metadata: {
        endpoints: {
          available: [
            { provider: "Morph", model: "x-1", selected: false },
            {
              provider: "Novita",
              model: "z-ai/glm-5.3-flash-20260826",
              selected: true,
            },
          ],
        },
      },
    }),
    {
      servedUpstream: "Novita",
      servedUpstreamModel: "z-ai/glm-5.3-flash-20260826",
      source: "router_metadata",
    },
  );
});

Deno.test("extractUpstreamIdentity reports both when the two sources agree", () => {
  const id = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: {
      endpoints: {
        available: [{ provider: "Novita", model: "m", selected: true }],
      },
    },
  });
  assertEquals(id, {
    servedUpstream: "Novita",
    servedUpstreamModel: "m",
    source: "both",
  });
});

Deno.test("extractUpstreamIdentity reports a conflict when the two sources disagree", () => {
  assertEquals(
    extractUpstreamIdentity({
      provider: "Novita",
      openrouter_metadata: {
        endpoints: {
          available: [{ provider: "Together", model: "m", selected: true }],
        },
      },
    }),
    { conflict: true, providerField: "Novita", metadata: "Together" },
  );
});

Deno.test("extractUpstreamIdentity ignores metadata with zero or several selected entries", () => {
  const none = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: {
      endpoints: {
        available: [{ provider: "A", model: "m", selected: false }],
      },
    },
  });
  assertEquals(none, {
    servedUpstream: "Novita",
    servedUpstreamModel: undefined,
    source: "provider_field",
  });
  const many = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: {
      endpoints: {
        available: [
          { provider: "A", model: "m", selected: true },
          { provider: "B", model: "m", selected: true },
        ],
      },
    },
  });
  assertEquals(many, {
    servedUpstream: "Novita",
    servedUpstreamModel: undefined,
    source: "provider_field",
  });
});

Deno.test("extractUpstreamIdentity returns undefined when neither source is present", () => {
  assertEquals(extractUpstreamIdentity({}), undefined);
  assertEquals(extractUpstreamIdentity(null), undefined);
  assertEquals(extractUpstreamIdentity({ provider: "" }), undefined);
});

Deno.test("assembleResponse carries identity onto the response, and marks a conflict", () => {
  const ok = assembleResponse({
    content: "x",
    model: "m",
    usage,
    duration: 1,
    finish: mapFinishReason("stop"),
    upstream: {
      servedUpstream: "Novita",
      servedUpstreamModel: "v",
      source: "both",
    },
  });
  assertEquals(ok.servedUpstream, "Novita");
  assertEquals(ok.servedUpstreamModel, "v");
  assertEquals(ok.upstreamIdentitySource, "both");
  assertEquals(ok.upstreamIdentityConflict, undefined);

  const bad = assembleResponse({
    content: "x",
    model: "m",
    usage,
    duration: 1,
    finish: mapFinishReason("stop"),
    upstream: { conflict: true, providerField: "Novita", metadata: "Together" },
  });
  assertEquals(bad.servedUpstream, "Novita");
  assertEquals(bad.upstreamIdentityConflict, true);
  assertEquals(bad.upstreamIdentitySource, "both");

  const none = assembleResponse({
    content: "x",
    model: "m",
    usage,
    duration: 1,
    finish: mapFinishReason("stop"),
  });
  assertEquals(none.servedUpstream, undefined);
  assertEquals("upstreamIdentitySource" in none, false);
});

import { reduceStreamUpstream } from "../../../src/llm/mappers/openrouter.ts";

Deno.test("reduceStreamUpstream keeps the first identity and flags a later different one", () => {
  const a = reduceStreamUpstream(undefined, {
    provider: "Novita",
    choices: [],
  });
  assertEquals(a, {
    servedUpstream: "Novita",
    servedUpstreamModel: undefined,
    source: "provider_field",
  });
  const same = reduceStreamUpstream(a, { provider: "Novita", choices: [] });
  assertEquals(same, a);
  const noId = reduceStreamUpstream(a, {
    choices: [{ delta: { content: "x" } }],
  });
  assertEquals(noId, a);
  const diff = reduceStreamUpstream(a, { provider: "Together", choices: [] });
  assertEquals(diff, {
    conflict: true,
    providerField: "Novita",
    metadata: "Together",
  });
  const stays = reduceStreamUpstream(diff, { provider: "Novita", choices: [] });
  assertEquals(stays, diff);
});
