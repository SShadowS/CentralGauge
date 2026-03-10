import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { FileTransport } from "../../../src/logger/transports/file.ts";

Deno.test("FileTransport", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "cg-file-transport-" });

  try {
    await t.step("writes log events as JSONL", async () => {
      const logPath = join(tempDir, "test.jsonl");
      const transport = new FileTransport(logPath);

      transport.write({
        level: "info",
        timestamp: new Date("2026-03-11T10:00:00Z"),
        namespace: "test",
        message: "Hello world",
      });

      transport.write({
        level: "debug",
        timestamp: new Date("2026-03-11T10:00:01Z"),
        namespace: "test:child",
        message: "Details here",
        data: { key: "value" },
      });

      await transport.flush();

      const content = await Deno.readTextFile(logPath);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 2);

      const event1 = JSON.parse(lines[0]!);
      assertEquals(event1.level, "info");
      assertEquals(event1.namespace, "test");
      assertEquals(event1.message, "Hello world");

      const event2 = JSON.parse(lines[1]!);
      assertEquals(event2.level, "debug");
      assertEquals(event2.data.key, "value");
    });

    await t.step("creates parent directories if needed", async () => {
      const deepPath = join(tempDir, "sub", "dir", "deep.jsonl");
      const transport = new FileTransport(deepPath);

      transport.write({
        level: "info",
        timestamp: new Date(),
        namespace: "test",
        message: "Deep write",
      });

      await transport.flush();

      const content = await Deno.readTextFile(deepPath);
      assertExists(content);
    });

    await t.step("name property returns 'file'", () => {
      const transport = new FileTransport(join(tempDir, "name-test.jsonl"));
      assertEquals(transport.name, "file");
    });

    await t.step("flush with empty buffer is a no-op", async () => {
      const logPath = join(tempDir, "empty.jsonl");
      const transport = new FileTransport(logPath);
      await transport.flush();
      // File should not be created
      let exists = true;
      try {
        await Deno.stat(logPath);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    });

    await t.step("appends on multiple flushes", async () => {
      const logPath = join(tempDir, "append.jsonl");
      const transport = new FileTransport(logPath);

      transport.write({
        level: "info",
        timestamp: new Date(),
        namespace: "test",
        message: "First",
      });
      await transport.flush();

      transport.write({
        level: "info",
        timestamp: new Date(),
        namespace: "test",
        message: "Second",
      });
      await transport.flush();

      const content = await Deno.readTextFile(logPath);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 2);
      assertEquals(JSON.parse(lines[0]!).message, "First");
      assertEquals(JSON.parse(lines[1]!).message, "Second");
    });

    await t.step("omits data field when not present", async () => {
      const logPath = join(tempDir, "no-data.jsonl");
      const transport = new FileTransport(logPath);

      transport.write({
        level: "warn",
        timestamp: new Date(),
        namespace: "test",
        message: "No data",
      });
      await transport.flush();

      const content = await Deno.readTextFile(logPath);
      const parsed = JSON.parse(content.trim());
      assertEquals(parsed.data, undefined);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
