/**
 * Pure unit tests for the page-loader mode-passthrough helper. No D1 needed,
 * so this runs under `vitest.unit.config.ts` (jsdom pool) rather than the
 * workers pool — same reasoning as `cost-sql.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchWithModeFallback,
  pageMode,
  withMode,
} from "../../src/lib/server/page-mode";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pageMode", () => {
  it("accepts sync and batch", () => {
    expect(pageMode(new URL("https://x/?mode=sync"))).toBe("sync");
    expect(pageMode(new URL("https://x/?mode=batch"))).toBe("batch");
  });

  it("ignores junk and absence", () => {
    expect(pageMode(new URL("https://x/"))).toBeNull();
    expect(pageMode(new URL("https://x/?mode="))).toBeNull();
    expect(pageMode(new URL("https://x/?mode=all"))).toBeNull();
    expect(pageMode(new URL("https://x/?mode=nonsense"))).toBeNull();
  });
});

describe("withMode", () => {
  it("sets mode on a path with no existing params", () => {
    expect(withMode("/api/v1/models", new URLSearchParams(), "batch")).toBe(
      "/api/v1/models?mode=batch",
    );
  });

  it("replaces an existing mode value", () => {
    const params = new URLSearchParams("mode=sync&family=fam");
    expect(withMode("/x", params, "batch")).toBe("/x?mode=batch&family=fam");
  });

  it("deletes mode when passed null", () => {
    const params = new URLSearchParams("mode=batch&family=fam");
    expect(withMode("/x", params, null)).toBe("/x?family=fam");
  });

  it("keeps other params untouched", () => {
    const params = new URLSearchParams("difficulty=easy&category=cat");
    expect(withMode("/api/v1/leaderboard", params, "sync")).toBe(
      "/api/v1/leaderboard?difficulty=easy&category=cat&mode=sync",
    );
  });
});

describe("fetchWithModeFallback", () => {
  it("passes through an ok response without retrying", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    const result = await fetchWithModeFallback(
      fetchFn,
      (m) => `/api/v1/leaderboard${m ? `?mode=${m}` : ""}`,
      null,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.modeSplit).toBe(false);
    expect(result.mode).toBeNull();
    expect(result.res.status).toBe(200);
  });

  it("retries once with sync on a 400 mode_required body", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(400, { error: "needs mode", code: "mode_required" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const result = await fetchWithModeFallback(
      fetchFn,
      (m) => `/api/v1/leaderboard${m ? `?mode=${m}` : ""}`,
      null,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(1, "/api/v1/leaderboard");
    expect(fetchFn).toHaveBeenNthCalledWith(2, "/api/v1/leaderboard?mode=sync");
    expect(result.mode).toBe("sync");
    expect(result.modeSplit).toBe(true);
    expect(result.res.status).toBe(200);
  });

  it("does not retry a 400 with a different error code", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: "bad", code: "invalid_mode" }),
      );
    const result = await fetchWithModeFallback(
      fetchFn,
      (m) => `/api/v1/leaderboard${m ? `?mode=${m}` : ""}`,
      null,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.modeSplit).toBe(false);
    expect(result.mode).toBeNull();
    expect(result.res.status).toBe(400);
  });

  it("does not retry a 500", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: "internal_error" }));
    const result = await fetchWithModeFallback(
      fetchFn,
      (m) => `/api/v1/leaderboard${m ? `?mode=${m}` : ""}`,
      null,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.modeSplit).toBe(false);
    expect(result.res.status).toBe(500);
  });
});
