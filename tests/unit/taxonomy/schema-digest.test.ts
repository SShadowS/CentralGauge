import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalJson,
  catalogDigest,
  type NormalizedCatalog,
} from "../../../site/src/lib/shared/taxonomy-schema.ts";

const golden = JSON.parse(
  await Deno.readTextFile("site/src/lib/shared/fixtures/taxonomy-golden.json"),
) as {
  name: string;
  normalized: NormalizedCatalog;
  canonical: string;
  digest: string;
}[];

Deno.test("canonicalJson sorts keys at every depth and emits no whitespace", () => {
  const out = canonicalJson({ b: [{ z: 1, a: "é" }], a: null });
  assertEquals(out, '{"a":null,"b":[{"a":"é","z":1}]}');
});

Deno.test("canonicalJson rejects undefined and non-finite numbers", () => {
  assertThrows(() => canonicalJson({ a: undefined }));
  assertThrows(() => canonicalJson({ a: Number.NaN }));
});

Deno.test("golden vectors reproduce byte for byte", async () => {
  for (const g of golden) {
    assertEquals(canonicalJson(g.normalized), g.canonical, g.name);
    assertEquals(await catalogDigest(g.normalized), g.digest, g.name);
  }
});
