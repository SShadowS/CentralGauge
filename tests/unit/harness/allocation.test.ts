import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { allocatedContainer } from "../../../src/harness/allocation.ts";

async function coordRoot(
  allocation: unknown,
  coord: unknown = { campaign: "harness-bench-2026-10" },
): Promise<string> {
  const d = await Deno.makeTempDir();
  if (coord !== null) {
    await Deno.writeTextFile(join(d, "coord.json"), JSON.stringify(coord));
  }
  if (allocation !== null) {
    await Deno.writeTextFile(
      join(d, "allocation.json"),
      JSON.stringify(allocation),
    );
  }
  return d;
}

const ALLOC = {
  "harness-bench-2026-10": ["Cronus281", "Cronus282", "Cronus283"],
  lethal: ["Cronus28"],
};

Deno.test("allocatedContainer: only the campaign's containers, by exact allocation name", async () => {
  const root = await coordRoot(ALLOC);
  assertEquals(await allocatedContainer("cronus282", root), "Cronus282");
  for (const c of ["Cronus28", "Cronus284", "Cronus285", "Cronus2811"]) {
    await assertRejects(
      () => allocatedContainer(c, root),
      ValidationError,
      "not allocated",
    );
  }
});

Deno.test("allocatedContainer: a missing or unreadable allocation fails closed", async () => {
  const cases = [
    await coordRoot(null),
    await coordRoot(ALLOC, null),
    await coordRoot(ALLOC, { campaign: "other-campaign" }),
    await coordRoot({ "harness-bench-2026-10": "Cronus281" }),
  ];
  const broken = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(broken, "coord.json"),
    JSON.stringify({ campaign: "harness-bench-2026-10" }),
  );
  await Deno.writeTextFile(join(broken, "allocation.json"), "{ not json");
  for (const root of [...cases, broken]) {
    await assertRejects(
      () => allocatedContainer("Cronus281", root),
      ValidationError,
    );
  }
});
