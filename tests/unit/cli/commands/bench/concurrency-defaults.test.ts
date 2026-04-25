/**
 * Tests for bench concurrency defaults
 * @module tests/unit/cli/commands/bench/concurrency-defaults
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { computeConcurrencyDefaults } from "../../../../../cli/commands/bench/concurrency-defaults.ts";

describe("computeConcurrencyDefaults", () => {
  it("1 container × 1 variant → 2 / 10", () => {
    // max(1*2, ceil(2/1)) = max(2, 2) = 2
    // max(10, 2*1*2) = max(10, 4) = 10
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 1,
      variantCount: 1,
    });
    assertEquals(r.taskConcurrency, 2);
    assertEquals(r.maxConcurrency, 10);
    assertEquals(r.autoTaskConcurrency, true);
    assertEquals(r.autoMaxConcurrency, true);
  });

  it("4 containers × 2 variants → 8 / 32", () => {
    // max(4*2, ceil(8/2)) = max(8, 4) = 8
    // max(10, 8*2*2) = 32
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 4,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 8);
    assertEquals(r.maxConcurrency, 32);
  });

  it("4 containers × 5 variants → 8 / 80 (flagship preset)", () => {
    // max(4*2, ceil(8/5)) = max(8, 2) = 8
    // max(10, 8*5*2) = 80
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 4,
      variantCount: 5,
    });
    assertEquals(r.taskConcurrency, 8);
    assertEquals(r.maxConcurrency, 80);
  });

  it("8 containers × 2 variants → 16 / 64", () => {
    // max(8*2, ceil(16/2)) = max(16, 8) = 16
    // max(10, 16*2*2) = 64
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 8,
      variantCount: 2,
    });
    assertEquals(r.taskConcurrency, 16);
    assertEquals(r.maxConcurrency, 64);
  });

  it("3 containers × 4 variants → 6 / 48", () => {
    // max(3*2, ceil(6/4)) = max(6, 2) = 6
    // max(10, 6*4*2) = 48
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 3,
      variantCount: 4,
    });
    assertEquals(r.taskConcurrency, 6);
    assertEquals(r.maxConcurrency, 48);
  });

  it("5 containers × 3 variants → 10 / 60", () => {
    // max(5*2, ceil(10/3)) = max(10, 4) = 10
    // max(10, 10*3*2) = 60
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 5,
      variantCount: 3,
    });
    assertEquals(r.taskConcurrency, 10);
    assertEquals(r.maxConcurrency, 60);
  });

  it("4 containers × 1 variant → 8 / 16 (single-variant burst)", () => {
    // max(4*2, ceil(8/1)) = max(8, 8) = 8
    // max(10, 8*1*2) = 16
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 4,
      variantCount: 1,
    });
    assertEquals(r.taskConcurrency, 8);
    assertEquals(r.maxConcurrency, 16);
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

  it("user-provided max concurrency is respected (auto task uses new formula)", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: 50,
      containerCount: 4,
      variantCount: 2,
    });
    // Auto task: max(8, 4) = 8
    assertEquals(r.taskConcurrency, 8);
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

  it("zero or negative counts coerced to 1 → 2 / 10", () => {
    const r = computeConcurrencyDefaults({
      userTaskConcurrency: undefined,
      userMaxConcurrency: undefined,
      containerCount: 0,
      variantCount: 0,
    });
    assertEquals(r.taskConcurrency, 2);
    assertEquals(r.maxConcurrency, 10);
  });
});
