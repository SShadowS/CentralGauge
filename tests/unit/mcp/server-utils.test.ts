/**
 * Tests for MCP HTTP server hardening helpers (findings M3, M8, M9, M13).
 *
 * M3: bearer-token authorization + capped request bodies.
 * M8: debug/timing log rotation at a size cap.
 * M9: JSON-RPC parse errors carry id: null (spec).
 * M13: tools/call params are shape-validated before dispatch (-32602).
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  appendTextWithRotation,
  authorize,
  buildParseErrorResponse,
  MAX_BODY_BYTES,
  readBodyCapped,
  validateRequiredStringParams,
  validateToolCallEnvelope,
} from "../../../mcp/server-utils.ts";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3100/mcp", {
    method: "POST",
    body: "{}",
    headers,
  });
}

Deno.test("authorize (M3)", async (t) => {
  const token = "test-token-123";

  await t.step("rejects request without Authorization header", () => {
    assertEquals(authorize(makeRequest(), token), false);
  });

  await t.step("rejects request with wrong token", () => {
    assertEquals(
      authorize(makeRequest({ Authorization: "Bearer wrong" }), token),
      false,
    );
  });

  await t.step("rejects malformed header (no Bearer prefix)", () => {
    assertEquals(
      authorize(makeRequest({ Authorization: token }), token),
      false,
    );
  });

  await t.step("accepts the correct bearer token", () => {
    assertEquals(
      authorize(makeRequest({ Authorization: `Bearer ${token}` }), token),
      true,
    );
  });

  await t.step("no token configured → open (non-sandbox local mode)", () => {
    assertEquals(authorize(makeRequest(), null), true);
  });
});

Deno.test("readBodyCapped (M3)", async (t) => {
  await t.step("reads a small body", async () => {
    const req = new Request("http://x/mcp", { method: "POST", body: "hello" });
    const result = await readBodyCapped(req, MAX_BODY_BYTES);
    assert(result.ok);
    assertEquals(result.body, "hello");
  });

  await t.step("rejects oversize body via Content-Length", async () => {
    const req = new Request("http://x/mcp", {
      method: "POST",
      body: "irrelevant",
      headers: { "Content-Length": String(MAX_BODY_BYTES + 1) },
    });
    const result = await readBodyCapped(req, MAX_BODY_BYTES);
    assertEquals(result.ok, false);
  });

  await t.step("rejects oversize body via capped read", async () => {
    const big = "x".repeat(2048);
    const req = new Request("http://x/mcp", { method: "POST", body: big });
    const result = await readBodyCapped(req, 1024);
    assertEquals(result.ok, false);
  });

  await t.step("empty body is ok", async () => {
    const req = new Request("http://x/mcp", { method: "POST" });
    const result = await readBodyCapped(req, 1024);
    assert(result.ok);
    assertEquals(result.body, "");
  });
});

Deno.test("buildParseErrorResponse (M9)", () => {
  const resp = buildParseErrorResponse("unexpected token");
  assertEquals(resp.jsonrpc, "2.0");
  assertEquals(resp.id, null); // spec: id null when request id is unknowable
  assertEquals(resp.error.code, -32700);
  assert(resp.error.message.includes("unexpected token"));
});

Deno.test("validateToolCallEnvelope (M13)", async (t) => {
  await t.step("accepts a valid envelope", () => {
    const result = validateToolCallEnvelope({
      name: "al_compile",
      arguments: { projectDir: "C:\\workspace" },
    });
    assert(result.ok);
    assertEquals(result.name, "al_compile");
    assertEquals(result.args["projectDir"], "C:\\workspace");
  });

  await t.step("accepts missing arguments as empty object", () => {
    const result = validateToolCallEnvelope({ name: "al_container_status" });
    assert(result.ok);
    assertEquals(result.args, {});
  });

  await t.step("rejects null params", () => {
    assertEquals(validateToolCallEnvelope(null).ok, false);
  });

  await t.step("rejects non-object params", () => {
    assertEquals(validateToolCallEnvelope("al_compile").ok, false);
  });

  await t.step("rejects missing name", () => {
    assertEquals(validateToolCallEnvelope({ arguments: {} }).ok, false);
  });

  await t.step("rejects non-string name", () => {
    assertEquals(validateToolCallEnvelope({ name: 42 }).ok, false);
  });

  await t.step("rejects array arguments", () => {
    assertEquals(
      validateToolCallEnvelope({ name: "al_compile", arguments: [] }).ok,
      false,
    );
  });
});

Deno.test("validateRequiredStringParams (M13)", async (t) => {
  await t.step("passes when all required strings present", () => {
    const result = validateRequiredStringParams(
      { projectDir: "C:\\ws", taskId: "CG-AL-E001" },
      ["projectDir", "taskId"],
    );
    assertEquals(result.ok, true);
  });

  await t.step("fails on missing required param", () => {
    const result = validateRequiredStringParams({}, ["projectDir"]);
    assertEquals(result.ok, false);
  });

  await t.step("fails on non-string required param", () => {
    const result = validateRequiredStringParams({ projectDir: 42 }, [
      "projectDir",
    ]);
    assertEquals(result.ok, false);
  });
});

Deno.test("appendTextWithRotation (M8)", async (t) => {
  await t.step("appends below the cap", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-rotation-" });
    try {
      const file = join(dir, "test.log");
      appendTextWithRotation(file, "line one\n", 1024);
      appendTextWithRotation(file, "line two\n", 1024);
      const content = await Deno.readTextFile(file);
      assertEquals(content, "line one\nline two\n");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("rotates to .1 when the cap is reached", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-rotation-" });
    try {
      const file = join(dir, "test.log");
      appendTextWithRotation(file, "x".repeat(100), 100);
      // File is now at cap — next append must rotate first
      appendTextWithRotation(file, "fresh\n", 100);
      assertEquals(await Deno.readTextFile(file), "fresh\n");
      assertEquals(await Deno.readTextFile(file + ".1"), "x".repeat(100));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("rotation replaces a previous .1", async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-rotation-" });
    try {
      const file = join(dir, "test.log");
      await Deno.writeTextFile(file + ".1", "old rotation");
      appendTextWithRotation(file, "y".repeat(100), 100);
      appendTextWithRotation(file, "fresh\n", 100);
      assertEquals(await Deno.readTextFile(file + ".1"), "y".repeat(100));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
