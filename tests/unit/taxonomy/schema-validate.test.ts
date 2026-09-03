import { assertEquals } from "@std/assert";
import {
  type CatalogV2,
  normalizeCatalog,
  validateCatalog,
} from "../../../site/src/lib/shared/taxonomy-schema.ts";

function base(): CatalogV2 {
  return {
    schema_version: 2,
    groups: [
      {
        slug: "diagnose-single",
        name: "Single-defect diagnose",
        description: "d",
      },
      {
        slug: "diagnose-composite",
        name: "Composite diagnose",
        description: "d",
      },
    ],
    families: [
      { slug: "mechanism", name: "Mechanism", description: "d" },
      { slug: "surface", name: "AL surface", description: "d" },
    ],
    tags: [
      {
        slug: "tryfunction-write-rollback",
        family: "mechanism",
        name: "n",
        description: "d",
      },
      {
        slug: "codeunit",
        family: "surface",
        name: "n",
        description: "d",
        hidden_by_default: true,
      },
      { slug: "table", family: "surface", name: "n", description: "d" },
    ],
    aliases: [{ from: "try-function", to: "tryfunction-write-rollback" }],
    overrides: [],
    tasks: {
      "CG-AL-X076": {
        group: "diagnose-single",
        facets: ["tryfunction-write-rollback", "codeunit"],
        min_bc_version: 17,
      },
      "CG-AL-X079": {
        group: "diagnose-single",
        facets: ["table"],
        min_bc_version: 16,
      },
      "CG-AL-X999": {
        group: "diagnose-composite",
        donors: ["CG-AL-X076", "CG-AL-X079", "CG-AL-X076A", "CG-AL-X079A"],
        derived_facets: ["codeunit", "table", "tryfunction-write-rollback"],
        local_facets: [],
        min_bc_version: 17,
      },
      "CG-AL-X076A": {
        group: "diagnose-single",
        facets: ["codeunit"],
        min_bc_version: 15,
      },
      "CG-AL-X079A": {
        group: "diagnose-single",
        facets: ["table"],
        min_bc_version: 15,
      },
    },
  };
}
const codes = (c: unknown) => validateCatalog(c).map((i) => i.code).sort();

Deno.test("a well-formed catalog has no issues", () =>
  assertEquals(codes(base()), []));

Deno.test("unknown facet, bad slug, retired slug, missing description are reported", () => {
  const c = base();
  (c.tasks["CG-AL-X079"] as { facets: string[] }).facets.push("nope");
  c.tags.push({
    slug: "Bad Slug",
    family: "surface",
    name: "n",
    description: "d",
  });
  c.tags.push({
    slug: "calculations",
    family: "surface",
    name: "n",
    description: "d",
  });
  c.groups[0]!.description = "";
  const got = codes(c);
  for (
    const want of [
      "unknown_facet",
      "bad_slug",
      "retired_slug",
      "missing_description",
    ]
  ) {
    assertEquals(got.includes(want), true, want);
  }
});

Deno.test("composite rules: donor count, self donor, composite donor, derived mismatch, local overlap, version max", () => {
  const c = base();
  const comp = c.tasks["CG-AL-X999"] as Extract<
    CatalogV2["tasks"][string],
    { donors: string[] }
  >;
  comp.donors = ["CG-AL-X076", "CG-AL-X999", "CG-AL-X079"]; // self + only 3
  comp.derived_facets = ["codeunit"]; // mismatch
  comp.local_facets = ["codeunit"]; // overlap
  comp.min_bc_version = 16; // max is 17
  const got = codes(c);
  for (
    const want of [
      "donor_count",
      "self_donor",
      "derived_mismatch",
      "local_overlap",
      "version_not_max",
    ]
  ) {
    assertEquals(got.includes(want), true, want);
  }
});

Deno.test("donors present iff composite", () => {
  const c = base();
  (c.tasks["CG-AL-X076"] as unknown as { donors: string[] }).donors = [
    "CG-AL-X079",
  ];
  assertEquals(codes(c).includes("donors_on_single"), true);
});

Deno.test("normalize sorts keys, facets and vocab and stamps origins", () => {
  const n = normalizeCatalog(base(), "b".repeat(64));
  assertEquals(Object.keys(n.tasks), [
    "CG-AL-X076",
    "CG-AL-X076A",
    "CG-AL-X079",
    "CG-AL-X079A",
    "CG-AL-X999",
  ]);
  assertEquals(n.tasks["CG-AL-X076"]!.facets, [
    { slug: "codeunit", origin: "direct" },
    { slug: "tryfunction-write-rollback", origin: "direct" },
  ]);
  assertEquals(
    n.tasks["CG-AL-X999"]!.facets.every((f) => f.origin === "derived"),
    true,
  );
  assertEquals(n.tasks["CG-AL-X999"]!.donors, [
    "CG-AL-X076",
    "CG-AL-X079",
    "CG-AL-X076A",
    "CG-AL-X079A",
  ]);
  assertEquals(
    n.tags.every((t) => typeof t.hidden_by_default === "boolean"),
    true,
  );
});

Deno.test("override group validation", () => {
  const c = base();
  c.overrides.push({
    task: "CG-AL-X076",
    group: "unknown-format" as unknown as CatalogV2["groups"][0]["slug"],
    rule: "r",
    reason: "reason",
  });
  assertEquals(codes(c).includes("unknown_group"), true);
});

Deno.test("composite facets field rejection", () => {
  const c = base();
  (c.tasks["CG-AL-X999"] as unknown as {
    facets: string[];
  }).facets = ["codeunit"];
  assertEquals(codes(c).includes("wrong_entry_form"), true);
});

Deno.test("single task without a facets array is reported, not thrown (missing_facets)", () => {
  const c = base();
  delete (c.tasks["CG-AL-X076"] as { facets?: string[] }).facets;
  const got = codes(c);
  assertEquals(got.includes("missing_facets"), true);
  // normalizeCatalog must never be reached on invalid input in real callers,
  // but assert it wouldn't have found an array to .map() over either.
  assertEquals("facets" in c.tasks["CG-AL-X076"]!, false);
});

Deno.test("composite without derived_facets or local_facets is reported (missing_facets)", () => {
  const c = base();
  const comp = c.tasks["CG-AL-X999"] as unknown as {
    derived_facets?: string[];
    local_facets?: string[];
  };
  delete comp.derived_facets;
  delete comp.local_facets;
  const got = codes(c);
  assertEquals(got.filter((code) => code === "missing_facets").length, 2);
});

Deno.test("composite without a donors array is reported (missing_donors)", () => {
  const c = base();
  const comp = c.tasks["CG-AL-X999"] as unknown as { donors?: string[] };
  delete comp.donors;
  assertEquals(codes(c).includes("missing_donors"), true);
});

Deno.test("non-array top-level collections are reported, not thrown (not_an_array)", () => {
  for (const field of ["groups", "families", "tags", "aliases", "overrides"]) {
    const c = base() as unknown as Record<string, unknown>;
    c[field] = { not: "an array" };
    const got = codes(c);
    assertEquals(got.includes("not_an_array"), true, field);
  }
});

Deno.test("non-array task facet fields are reported, not thrown (not_an_array)", () => {
  const single = base();
  (single.tasks["CG-AL-X076"] as unknown as { facets: unknown }).facets =
    "not-an-array";
  assertEquals(codes(single).includes("not_an_array"), true);

  const compositeDonors = base();
  (compositeDonors.tasks["CG-AL-X999"] as unknown as { donors: unknown })
    .donors = "not-an-array";
  assertEquals(codes(compositeDonors).includes("not_an_array"), true);

  const compositeDerived = base();
  (compositeDerived.tasks["CG-AL-X999"] as unknown as {
    derived_facets: unknown;
  }).derived_facets = "not-an-array";
  assertEquals(codes(compositeDerived).includes("not_an_array"), true);

  const compositeLocal = base();
  (compositeLocal.tasks["CG-AL-X999"] as unknown as { local_facets: unknown })
    .local_facets = "not-an-array";
  assertEquals(codes(compositeLocal).includes("not_an_array"), true);
});

Deno.test("duplicate facets within a task", () => {
  const c = base();
  (c.tasks["CG-AL-X076"] as { facets: string[] }).facets = [
    "codeunit",
    "codeunit",
  ];
  assertEquals(codes(c).includes("duplicate_facet"), true);
  const comp = c.tasks["CG-AL-X999"] as Extract<
    CatalogV2["tasks"][string],
    { derived_facets: string[] }
  >;
  comp.derived_facets = ["codeunit", "table", "codeunit"];
  assertEquals(codes(c).includes("duplicate_facet"), true);
});
