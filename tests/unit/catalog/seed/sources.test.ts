import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  clearOpenRouterCache,
  fetchOpenRouterMeta,
} from "../../../../src/catalog/seed/sources.ts";
import { CatalogSeedError } from "../../../../src/errors.ts";
import { MockEnv } from "../../../utils/test-helpers.ts";

const mockResponse = {
  data: [
    {
      id: "x-ai/grok-4.3",
      name: "xAI: Grok 4.3",
      created: 1761955200,
      pricing: {
        prompt: "0.00000125",
        completion: "0.0000025",
      },
    },
  ],
};

describe("fetchOpenRouterMeta", () => {
  it("returns parsed meta on 200", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )) as typeof fetch;

    try {
      const meta = await fetchOpenRouterMeta("x-ai/grok-4.3");
      assertEquals(meta?.pricing.input, 1.25);
      assertEquals(meta?.pricing.output, 2.5);
      assertEquals(meta?.displayName, "xAI: Grok 4.3");
      assertEquals(meta?.vendor, "xAI");
      assertEquals(meta?.releasedAt, "2025-11-01");
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("returns null when slug not in response data", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      )) as typeof fetch;

    try {
      const meta = await fetchOpenRouterMeta("nonexistent/model");
      assertEquals(meta, null);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("returns null on HTTP 404", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() =>
        Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;

    try {
      const meta = await fetchOpenRouterMeta("nonexistent/model");
      assertEquals(meta, null);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("throws SEED_NETWORK on HTTP 500", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() =>
        Promise.resolve(new Response("", { status: 500 }))) as typeof fetch;

    try {
      await assertRejects(
        () => fetchOpenRouterMeta("x-ai/grok-4.3"),
        CatalogSeedError,
        "OpenRouter returned 500",
      );
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("throws SEED_NETWORK on fetch failure", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() => Promise.reject(new TypeError("network error"))) as typeof fetch;

    try {
      await assertRejects(
        () => fetchOpenRouterMeta("x-ai/grok-4.3"),
        CatalogSeedError,
        "OpenRouter unreachable",
      );
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("throws SEED_MISSING_KEY when OPENROUTER_API_KEY unset", async () => {
    const env = new MockEnv();
    env.delete("OPENROUTER_API_KEY");
    clearOpenRouterCache();

    try {
      await assertRejects(
        () => fetchOpenRouterMeta("x-ai/grok-4.3"),
        CatalogSeedError,
        "OPENROUTER_API_KEY required",
      );
    } finally {
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("uses cached list on subsequent calls (one fetch for N slugs)", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "x-ai/grok-4.3",
                name: "xAI: Grok 4.3",
                created: 1761955200,
                pricing: { prompt: "0.00000125", completion: "0.0000025" },
              },
              {
                id: "anthropic/claude-haiku-4-5",
                name: "Anthropic: Claude Haiku 4.5",
                created: 1737936000,
                pricing: { prompt: "0.000001", completion: "0.000005" },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      await fetchOpenRouterMeta("x-ai/grok-4.3");
      await fetchOpenRouterMeta("anthropic/claude-haiku-4-5");
      await fetchOpenRouterMeta("nonexistent/model");
      assertEquals(fetchCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });

  it("clearOpenRouterCache forces a re-fetch", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");
    clearOpenRouterCache();

    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [] }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      await fetchOpenRouterMeta("x");
      clearOpenRouterCache();
      await fetchOpenRouterMeta("x");
      assertEquals(fetchCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
      clearOpenRouterCache();
    }
  });
});
