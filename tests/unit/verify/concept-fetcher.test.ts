/**
 * Unit tests for the analyzer's concept-registry seed fetcher.
 *
 * The fetcher seeds the LLM system prompt with the top-N most-recently-seen
 * concepts so the model can propose `concept_slug_existing_match` rather than
 * always inventing a fresh slug. Failures must be non-fatal: a registry
 * outage returns `[]`, the analyzer continues with an empty seed list.
 */

import { assertEquals } from "@std/assert";
import {
  _resetConceptCache,
  fetchRecentConcepts,
} from "../../../src/verify/concept-fetcher.ts";

Deno.test("fetchRecentConcepts: returns N items, ordered as server returned", async () => {
  _resetConceptCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes("/api/v1/concepts?recent=20")) {
      throw new Error("unexpected url: " + url);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              slug: "flowfield-calcfields",
              display_name: "FlowField CalcFields",
              description: "...",
              last_seen: "2026-04-29T00:00:00Z",
            },
            {
              slug: "reserved-keyword",
              display_name: "Reserved keyword",
              description: "...",
              last_seen: "2026-04-28T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
  };
  try {
    const got = await fetchRecentConcepts({
      recent: 20,
      baseUrl: "https://example.test",
    });
    assertEquals(got.length, 2);
    assertEquals(got[0]!.slug, "flowfield-calcfields");
  } finally {
    globalThis.fetch = originalFetch;
    _resetConceptCache();
  }
});

Deno.test("fetchRecentConcepts: returns [] on non-2xx", async () => {
  _resetConceptCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response("nope", { status: 503 }));
  try {
    const got = await fetchRecentConcepts({
      recent: 5,
      baseUrl: "https://example.test",
    });
    assertEquals(got.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    _resetConceptCache();
  }
});

Deno.test("fetchRecentConcepts: returns [] on fetch throw (network outage)", async () => {
  _resetConceptCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("ECONNREFUSED"));
  try {
    const got = await fetchRecentConcepts({
      recent: 5,
      baseUrl: "https://example.test",
    });
    assertEquals(got.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    _resetConceptCache();
  }
});
