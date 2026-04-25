/**
 * Tests for observability primitives — CircularBuffer + helpers.
 * @module tests/unit/parallel/observability
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  CircularBuffer,
  imbalanceScore,
  mean,
  percentile95,
} from "../../../src/parallel/observability.ts";

describe("CircularBuffer", () => {
  it("rejects non-positive capacity", () => {
    let threw = false;
    try {
      new CircularBuffer(0);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });

  it("returns newest-first when not yet full", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    assertEquals(buf.toArray(), [3, 2, 1]);
    assertEquals(buf.size, 3);
  });

  it("evicts oldest entries once full and stays newest-first", () => {
    const buf = new CircularBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) buf.push(n);
    // Buffer holds [3, 4, 5], newest-first → [5, 4, 3]
    assertEquals(buf.toArray(), [5, 4, 3]);
    assertEquals(buf.size, 3);
  });

  it("clear() resets buffer state", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    assertEquals(buf.size, 0);
    assertEquals(buf.toArray(), []);
    buf.push(99);
    assertEquals(buf.toArray(), [99]);
  });

  it("supports object payloads without aliasing surprises", () => {
    const buf = new CircularBuffer<{ id: number }>(2);
    const a = { id: 1 };
    const b = { id: 2 };
    buf.push(a);
    buf.push(b);
    const out = buf.toArray();
    assertEquals(out.map((o) => o.id), [2, 1]);
    // Mutating a returned reference should not affect the buffer
    out[0]!.id = 99;
    assertEquals(buf.toArray()[0]!.id, 99); // shared ref by design
  });
});

describe("mean", () => {
  it("returns 0 for empty input", () => {
    assertEquals(mean([]), 0);
  });

  it("computes arithmetic mean", () => {
    assertEquals(mean([2, 4, 6]), 4);
    assertEquals(mean([10]), 10);
  });
});

describe("percentile95", () => {
  it("returns 0 for empty input", () => {
    assertEquals(percentile95([]), 0);
  });

  it("returns single value", () => {
    assertEquals(percentile95([42]), 42);
  });

  it("picks the 95th percentile element", () => {
    // 20 values 1..20 — index = floor(20 * 0.95) = 19 → value 20
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    assertEquals(percentile95(values), 20);
  });

  it("handles unsorted input", () => {
    const values = [10, 1, 5, 2, 8, 4, 7, 3, 9, 6];
    // Sorted: 1..10, idx = floor(10 * 0.95) = 9 → value 10
    assertEquals(percentile95(values), 10);
  });
});

describe("imbalanceScore", () => {
  it("returns 0 for empty input", () => {
    assertEquals(imbalanceScore([]), 0);
  });

  it("returns 0 for single value", () => {
    assertEquals(imbalanceScore([5]), 0);
  });

  it("returns 0 when all values identical", () => {
    assertEquals(imbalanceScore([3, 3, 3, 3]), 0);
  });

  it("is positive when values differ", () => {
    const score = imbalanceScore([0, 0, 0, 8]);
    // mean=2, stddev=sqrt(((0-2)^2 * 3 + (8-2)^2)/4) = sqrt((12+36)/4) = sqrt(12) ≈ 3.464
    // score = 3.464 / (2+1) ≈ 1.155
    assertEquals(score > 1.1 && score < 1.2, true);
  });

  it("stays bounded for empty queues", () => {
    const score = imbalanceScore([0, 0, 0, 0]);
    assertEquals(score, 0);
  });

  it("monotonically increases with skew", () => {
    const balanced = imbalanceScore([2, 2, 2, 2]);
    const slightSkew = imbalanceScore([1, 2, 2, 3]);
    const heavySkew = imbalanceScore([0, 0, 0, 8]);
    assertEquals(balanced < slightSkew, true);
    assertEquals(slightSkew < heavySkew, true);
  });
});
