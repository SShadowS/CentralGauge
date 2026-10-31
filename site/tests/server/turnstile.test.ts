import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/lib/server/turnstile";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status });

describe("verifyTurnstile", () => {
  it("returns true on success and sends the form fields", async () => {
    const f = vi.fn(async () => json({ success: true }));
    expect(await verifyTurnstile("tok", "sec", "1.2.3.4", f as never)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits remoteip when null", async () => {
    const f = vi.fn(async () => json({ success: true }));
    await verifyTurnstile("tok", "sec", null, f as never);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.body as URLSearchParams).has("remoteip")).toBe(false);
  });

  it("returns false on success false", async () => {
    const f = async () => json({ success: false });
    expect(await verifyTurnstile("tok", "sec", null, f as never)).toBe(false);
  });

  it("returns false for null or empty token without fetching", async () => {
    const f = vi.fn();
    expect(await verifyTurnstile(null, "sec", null, f as never)).toBe(false);
    expect(await verifyTurnstile("", "sec", null, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns false when fetch throws", async () => {
    const f = async () => {
      throw new Error("net");
    };
    expect(await verifyTurnstile("tok", "sec", null, f as never)).toBe(false);
  });

  it("passes a timeout signal and returns false when it aborts", async () => {
    let seen: AbortSignal | undefined;
    const f = (_url: string, init: RequestInit) => {
      seen = init.signal ?? undefined;
      return Promise.reject(new DOMException("timed out", "TimeoutError"));
    };
    expect(await verifyTurnstile("tok", "sec", null, f as never)).toBe(false);
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("returns false on a 500 and on invalid JSON", async () => {
    expect(
      await verifyTurnstile("t", "s", null, (async () => json({ success: true }, 500)) as never),
    ).toBe(false);
    expect(
      await verifyTurnstile("t", "s", null, (async () => new Response("nope")) as never),
    ).toBe(false);
  });
});
