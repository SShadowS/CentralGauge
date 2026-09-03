import { assertEquals, assertRejects } from "@std/assert";
import {
  buildV2Payload,
  readCatalogFile,
} from "../../../../cli/commands/sync-taxonomy-command.ts";
import {
  emitCatalogYaml,
  parseCatalogYaml,
} from "../../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";
import {
  catalogDigest,
  type CatalogV2,
  normalizeCatalog,
} from "../../../../site/src/lib/shared/taxonomy-schema.ts";

Deno.test("readCatalogFile reports schema_version and refuses unknown versions", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/v3.yml`, "schema_version: 3\n");
  await assertRejects(
    () => readCatalogFile(`${dir}/v3.yml`),
    Error,
    "schema_version 3",
  );
  await Deno.writeTextFile(
    `${dir}/v1.yml`,
    "groups: []\ntags: []\ntasks: {}\n",
  );
  assertEquals((await readCatalogFile(`${dir}/v1.yml`)).schema_version, 1);
});

// A self-consistent catalog (mirrors the synthetic fixture pattern used by
// tests/unit/taxonomy/merge.test.ts's "deriveComposites" test) rather than
// tests/fixtures/taxonomy/manifests. That shared fixture's CG-AL-X283
// composite deliberately references donors that do not exist as sibling
// manifests (noted in the taxonomy-v2 plan and worked around in
// merge.test.ts by filtering the unresolved_donor/donor_not_single codes),
// so it never passes validateCatalog's strict donor-resolution check that
// buildV2Payload gates on. Building a small catalog that IS fully valid is
// what actually exercises buildV2Payload's success path.
function validCatalog(): CatalogV2 {
  return {
    schema_version: 2,
    groups: [
      { slug: "build-from-spec", name: "Build from spec", description: "d" },
      { slug: "runtime-trap", name: "Runtime trap", description: "d" },
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
      { slug: "invariant", name: "Invariant", description: "d" },
      { slug: "surface", name: "AL surface", description: "d" },
      { slug: "environment", name: "Environment", description: "d" },
    ],
    tags: [
      {
        slug: "facet-a",
        family: "mechanism",
        name: "Facet A",
        description: "d",
      },
      {
        slug: "facet-b",
        family: "mechanism",
        name: "Facet B",
        description: "d",
      },
    ],
    aliases: [],
    overrides: [],
    tasks: {
      "CG-AL-D1": {
        group: "diagnose-single",
        facets: ["facet-a"],
        min_bc_version: 15,
      },
      "CG-AL-D2": {
        group: "diagnose-single",
        facets: ["facet-b"],
        min_bc_version: 16,
      },
      "CG-AL-D3": {
        group: "diagnose-single",
        facets: ["facet-a"],
        min_bc_version: 15,
      },
      "CG-AL-D4": {
        group: "diagnose-single",
        facets: ["facet-b"],
        min_bc_version: 15,
      },
      "CG-AL-C1": {
        group: "diagnose-composite",
        donors: ["CG-AL-D1", "CG-AL-D2", "CG-AL-D3", "CG-AL-D4"],
        derived_facets: ["facet-a", "facet-b"],
        local_facets: [],
        min_bc_version: 16,
      },
    },
  };
}

Deno.test("v2 payload carries the hash and the digest of the normalized catalog", async () => {
  const parsed = parseCatalogYaml(emitCatalogYaml(validCatalog()));
  const hash = "c".repeat(64);
  const { payload, digest } = await buildV2Payload(parsed, hash);
  assertEquals(payload.version, 2);
  assertEquals(payload.hash, hash);
  assertEquals(digest, await catalogDigest(normalizeCatalog(parsed, hash)));
});

Deno.test("buildV2Payload rejects an invalid catalog before computing a digest", async () => {
  const invalid = validCatalog();
  // Break the composite's derived_facets so it no longer equals the donor union.
  const c1 = invalid.tasks["CG-AL-C1"];
  if (c1 && "donors" in c1) c1.derived_facets = [];
  await assertRejects(
    () => buildV2Payload(invalid, "d".repeat(64)),
    Error,
    "catalog invalid",
  );
});

Deno.test("buildV2Payload carries aliases and overrides through, defaulting to empty arrays", async () => {
  const catalog = validCatalog();
  catalog.overrides = [
    {
      task: "CG-AL-D1",
      group: "diagnose-single",
      rule: "manual",
      reason: "authored override",
    },
  ];
  const { payload } = await buildV2Payload(catalog, "e".repeat(64));
  assertEquals(payload.overrides, catalog.overrides);
  assertEquals(payload.aliases, []);
});
