/**
 * Unit tests for the digest CLI's `--since` parser.
 *
 * Trivial helper but the CI workflow YAML hard-codes `--since 7d` — a
 * regression here breaks Plan G's weekly run. Tests pin the exact accepted
 * shape so a future "let's accept --since 1w" amendment is intentional, not
 * accidental.
 *
 * @module tests/unit/lifecycle/digest-duration
 */
import { assertEquals, assertThrows } from "@std/assert";
import { parseDuration } from "../../../cli/commands/digest-command.ts";

Deno.test("parseDuration — accepts days", () => {
  assertEquals(parseDuration("7d"), 7 * 86_400_000);
  assertEquals(parseDuration("1d"), 86_400_000);
  assertEquals(parseDuration("30d"), 30 * 86_400_000);
});

Deno.test("parseDuration — accepts hours", () => {
  assertEquals(parseDuration("24h"), 24 * 3_600_000);
  assertEquals(parseDuration("1h"), 3_600_000);
});

Deno.test("parseDuration — rejects unknown units", () => {
  assertThrows(() => parseDuration("7w"), Error, "Invalid --since duration");
  assertThrows(() => parseDuration("7m"), Error, "Invalid --since duration");
  assertThrows(() => parseDuration("7"), Error, "Invalid --since duration");
});

Deno.test("parseDuration — rejects zero / negative / non-numeric", () => {
  assertThrows(() => parseDuration("0d"), Error, "must be a positive integer");
  assertThrows(() => parseDuration("xd"), Error, "Invalid --since duration");
  assertThrows(() => parseDuration(""), Error, "Invalid --since duration");
});
