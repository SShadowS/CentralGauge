import { describe, expect, it } from "vitest";
import { resetIdCounter, useId } from "./use-id";

describe("useId", () => {
  it("produces unique sequential ids", () => {
    const a = useId();
    const b = useId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^cg-id-\d+$/);
    expect(b).toMatch(/^cg-id-\d+$/);
  });

  it("resetIdCounter restarts the sequence", () => {
    const a = useId();
    resetIdCounter();
    const b = useId();
    expect(b).toBe("cg-id-1");
    expect(a).not.toBe(b);
  });

  it("produces matching id sequences across two reset cycles", () => {
    resetIdCounter();
    const id1 = useId();
    const id2 = useId();
    resetIdCounter();
    const id1b = useId();
    const id2b = useId();
    expect(id1).toBe(id1b); // both 'cg-id-1' after reset
    expect(id2).toBe(id2b); // both 'cg-id-2'
  });
});
