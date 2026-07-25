import { assertEquals, assertNotEquals } from "@std/assert";
import {
  compilerCacheKey,
  normalizeArtifactUrl,
} from "../../../src/container/compiler-cache-key.ts";

const BASE = "https://bcartifacts.azureedge.net/sandbox/28.3.52162.52884/dk";

Deno.test("normalizeArtifactUrl strips the query string at the first ?", () => {
  assertEquals(normalizeArtifactUrl(`${BASE}?sv=2021&sig=abc`), BASE);
  assertEquals(normalizeArtifactUrl(`${BASE}?a=1?b=2`), BASE);
  assertEquals(normalizeArtifactUrl(BASE), BASE);
});

Deno.test("compilerCacheKey is 12 lowercase hex chars", async () => {
  const key = await compilerCacheKey(BASE);
  assertEquals(key.length, 12);
  assertEquals(/^[0-9a-f]{12}$/.test(key), true);
});

Deno.test("compilerCacheKey is deterministic", async () => {
  assertEquals(await compilerCacheKey(BASE), await compilerCacheKey(BASE));
});

Deno.test("compilerCacheKey ignores a SAS token", async () => {
  // A volatile SAS token must not churn the key — that would silently defeat
  // the cache on every run.
  assertEquals(
    await compilerCacheKey(`${BASE}?sv=2021&sig=abc`),
    await compilerCacheKey(BASE),
  );
});

Deno.test("compilerCacheKey changes when the BC version changes", async () => {
  // This is the whole point: an artifact upgrade must land in a fresh cache.
  assertNotEquals(
    await compilerCacheKey(BASE),
    await compilerCacheKey(
      "https://bcartifacts.azureedge.net/sandbox/28.4.00000.00000/dk",
    ),
  );
});

Deno.test("compilerCacheKey changes when the country changes", async () => {
  assertNotEquals(
    await compilerCacheKey(BASE),
    await compilerCacheKey(
      "https://bcartifacts.azureedge.net/sandbox/28.3.52162.52884/w1",
    ),
  );
});
