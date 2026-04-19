/**
 * Tests for bench concurrency defaults
 * @module tests/unit/cli/commands/bench/concurrency-defaults
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { computeConcurrencyDefaults } from "../../../../../cli/commands/bench/concurrency-defaults.ts";

describe("computeConcurrencyDefaults", () => {
  it("1 container, 1 variant → floor of 3 / 10", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 1,
      variantCount: 1,
    });
    assertEquals(r.taskConcurrency, 3);
    assertEquals(r.maxConcurrency, 10);
    assertEquals(r.autoTaskConcurrency, true);
    assertEquals(r.autoMaxConcurrency, true);
  });

  it("4 containers, 2 variants → 4 / 16", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 4,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 4);
    assertEquals(r.maxConcurrency, 16);
  });

  it("8 containers, 2 variants → 8 / 32", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 8,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 8);
    assertEquals(r.maxConcurrency, 32);
  });

  it("3 containers, 4 variants → floor 3 / 24", () => {
    // ceil(3*2/4) = ceil(1.5) = 2, below floor 3 → 3
    // max(10, 3*4*2) = max(10, 24) = 24
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 3,
      variantCount: 4,
    });
    assertEquals(r.taskConcurrency, 3);
    assertEquals(r.maxConcurrency, 24);
  });

  it("odd container/variant ratios round up", () => {
    // ceil(5*2/3) = ceil(3.33) = 4
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 5,
      variantCount: 3,
    });
    assertEquals(r.taskConcurrency, 4);
    // max(10, 4*3*2) = 24
    assertEquals(r.maxConcurrency, 24);
  });

  it("user-provided task concurrency is respected", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: 7,
      userMaxConcurrency: undefined,
      containerCount: 4,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 7);
    assertEquals(r.autoTaskConcurrency, false);
    // Auto-max cascades off the user value: max(10, 7*2*2) = 28
    assertEquals(r.maxConcurrency, 28);
    assertEquals(r.autoMaxConcurrency, true);
  });

  it("user-provided max concurrency is respected", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: 50,
      containerCount: 4,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 4);
    assertEquals(r.maxConcurrency, 50);
    assertEquals(r.autoMaxConcurrency, false);
  });

  it("both user-provided values pass through verbatim", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: 1,
      userMaxConcurrency: 5,
      containerCount: 4,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 1);
    assertEquals(r.maxConcurrency, 5);
    assertEquals(r.autoTaskConcurrency, false);
    assertEquals(r.autoMaxConcurrency, false);
  });

  it("zero or negative counts coerced to 1", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 0,
      variantCount: 0,
    });
    assertEquals(r.taskConcurrency, 3);
    assertEquals(r.maxConcurrency, 10);
  });
});
