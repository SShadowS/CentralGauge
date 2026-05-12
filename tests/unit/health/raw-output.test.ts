import { assert, assertEquals } from "@std/assert";
import {
  captureRawTail,
  writeArtifact,
} from "../../../src/health/raw-output.ts";

Deno.test("captureRawTail returns last N bytes", () => {
  const big = "A".repeat(10_000) + "TAIL";
  const tail = captureRawTail(big, 100);
  assertEquals(tail.length, 100);
  assert(tail.endsWith("TAIL"));
});

Deno.test("captureRawTail returns whole string when shorter than max", () => {
  assertEquals(captureRawTail("short", 100), "short");
});

Deno.test("captureRawTail handles empty input", () => {
  assertEquals(captureRawTail("", 100), "");
});

Deno.test("writeArtifact writes file and returns path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-test-artifact-" });
  try {
    const p = await writeArtifact(
      tempDir,
      "task-CG-AL-H024_attempt-1",
      "raw output text",
    );
    assert(p.startsWith(tempDir));
    const content = await Deno.readTextFile(p);
    assertEquals(content, "raw output text");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeArtifact key normalizes unsafe chars", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-test-artifact-" });
  try {
    const p = await writeArtifact(tempDir, "task/with:bad*chars", "x");
    // Path is safe (no slashes/colons/asterisks in basename)
    const basename = p.substring(tempDir.length + 1);
    assertEquals(basename.includes("/"), false);
    assertEquals(basename.includes(":"), false);
    assertEquals(basename.includes("*"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
