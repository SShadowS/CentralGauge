import { assertEquals } from "@std/assert";
import { canonicalJSON } from "../../shared/canonical.ts";

Deno.test("canonical JSON matches golden fixture (Deno)", async () => {
  const input = JSON.parse(
    await Deno.readTextFile("tests/fixtures/canonical-parity/input.json"),
  );
  const expected = await Deno.readTextFile(
    "tests/fixtures/canonical-parity/expected.txt",
  );
  assertEquals(canonicalJSON(input), expected);
});
