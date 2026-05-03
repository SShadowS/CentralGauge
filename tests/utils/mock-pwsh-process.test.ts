import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createMockPwshProcess } from "./mock-pwsh-process.ts";

describe("createMockPwshProcess", () => {
  it("captures stdin writes as text", async () => {
    const mock = createMockPwshProcess();
    const writer = mock.process.stdin.getWriter();
    await writer.write(new TextEncoder().encode("hello\n"));
    await writer.write(new TextEncoder().encode("world\n"));
    writer.releaseLock();
    assertEquals(mock.getStdinWrites(), ["hello\n", "world\n"]);
  });

  it("emits stdout on demand", async () => {
    const mock = createMockPwshProcess();
    mock.emitStdout("output line 1\n");
    mock.emitStdout("output line 2\n");

    const reader = mock.process.stdout.getReader();
    const decoder = new TextDecoder();
    const r1 = await reader.read();
    assertEquals(decoder.decode(r1.value!), "output line 1\n");
    const r2 = await reader.read();
    assertEquals(decoder.decode(r2.value!), "output line 2\n");
  });

  it("status resolves when exit() called", async () => {
    const mock = createMockPwshProcess();
    setTimeout(() => mock.exit(0), 10);
    const status = await mock.process.status;
    assertEquals(status.success, true);
    assertEquals(status.code, 0);
  });

  it("status reports non-zero exit", async () => {
    const mock = createMockPwshProcess();
    setTimeout(() => mock.exit(1), 10);
    const status = await mock.process.status;
    assertEquals(status.success, false);
    assertEquals(status.code, 1);
  });

  it("kill() sets wasKilled and resolves status with code 137", async () => {
    const mock = createMockPwshProcess();
    assertEquals(mock.wasKilled(), false);
    mock.process.kill("SIGTERM");
    const status = await mock.process.status;
    assertEquals(mock.wasKilled(), true);
    assertEquals(status.code, 137);
    assertEquals(status.success, false);
  });

  it("emitStdout after exit does not throw or warn", async () => {
    const mock = createMockPwshProcess();
    mock.exit(0);
    await mock.process.status;
    // Should not throw or trigger unhandled rejection.
    mock.emitStdout("late\n");
    mock.emitStderr("late\n");
  });
});
