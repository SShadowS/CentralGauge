import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  QualifyManifestSchema,
  variantAllowed,
} from "../../../src/harness/qualify.ts";

const manifest = (fixture?: string[]) =>
  QualifyManifestSchema.parse({
    v: 1,
    refapp_version: "refapp-v2",
    tasks: {
      "HX-101": {
        rev: "abc",
        positive: "correct",
        naive: ["a"],
        ...(fixture ? { fixture } : {}),
      },
    },
  });

Deno.test("variantAllowed: a listed fixture/<name> is allowed; unlisted and the withdrawn measure/<name> are refused (M11-07)", () => {
  const m = manifest(["dead-call"]);
  assertEquals(variantAllowed(m, "HX-101", "fixture/dead-call", "abc"), null);
  assertEquals(variantAllowed(m, "HX-101", "correct", "abc"), null);
  assertEquals(variantAllowed(m, "HX-101", "naive/a", "abc"), null);
  for (const v of ["fixture/other", "measure/dead-call"]) {
    assertStringIncludes(
      variantAllowed(m, "HX-101", v, "abc") ?? "",
      `variant ${v} is not listed`,
    );
  }
});

Deno.test("QualifyManifestSchema: fixture defaults to none and names stay folder-safe (M11-07)", () => {
  assertEquals(manifest().tasks["HX-101"]!.fixture, []);
  assertStringIncludes(
    variantAllowed(manifest(), "HX-101", "fixture/dead-call", "abc") ?? "",
    "is not listed",
  );
  assertEquals(
    QualifyManifestSchema.safeParse({
      v: 1,
      refapp_version: "r",
      tasks: {
        "HX-101": {
          rev: "abc",
          positive: "correct",
          naive: ["a"],
          fixture: ["../x"],
        },
      },
    }).success,
    false,
  );
});
