import { describe, expect, it } from "vitest";
import golden from "./fixtures/taxonomy-golden.json";
import {
  canonicalJson,
  catalogDigest,
  validateCatalog,
} from "./taxonomy-schema";

describe("taxonomy-schema golden vectors", () => {
  it("reproduces canonical bytes and digests under Node", async () => {
    for (const g of golden as {
      name: string;
      normalized: never;
      canonical: string;
      digest: string;
    }[]) {
      expect(canonicalJson(g.normalized), g.name).toBe(g.canonical);
      expect(await catalogDigest(g.normalized), g.name).toBe(g.digest);
    }
  });
  it("validateCatalog rejects a non-object", () => {
    expect(validateCatalog(null)[0].code).toBe("not_object");
  });
});
