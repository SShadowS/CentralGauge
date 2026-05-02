import { describe, expect, it } from "vitest";
import { cellColorBucket } from "./matrix-helpers";

describe("cellColorBucket", () => {
  it("returns 'no-data' when attempted is 0", () => {
    expect(cellColorBucket(0, 0)).toBe("no-data");
  });

  it("returns 'pass-all' when ratio === 1", () => {
    expect(cellColorBucket(4, 4)).toBe("pass-all");
    expect(cellColorBucket(1, 1)).toBe("pass-all");
  });

  it("returns 'pass-most' when ratio >= 0.5 and < 1", () => {
    expect(cellColorBucket(3, 4)).toBe("pass-most");
    expect(cellColorBucket(2, 4)).toBe("pass-most");
    expect(cellColorBucket(1, 2)).toBe("pass-most");
  });

  it("returns 'pass-some' when 0 < ratio < 0.5", () => {
    expect(cellColorBucket(1, 4)).toBe("pass-some");
    expect(cellColorBucket(1, 3)).toBe("pass-some");
  });

  it("returns 'fail-all' when ratio === 0 and attempted > 0", () => {
    expect(cellColorBucket(0, 4)).toBe("fail-all");
    expect(cellColorBucket(0, 1)).toBe("fail-all");
  });
});
