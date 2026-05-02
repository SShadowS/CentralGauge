import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("canonical URL link", () => {
  it("emits canonical for / pointing at site root", async () => {
    const res = await SELF.fetch("http://x/");
    const body = await res.text();
    expect(body).toMatch(
      /<link rel="canonical" href="https:\/\/centralgauge\.sshadows\.workers\.dev\/"\s*\/>/,
    );
  });

  it("strips query string from canonical", async () => {
    const res = await SELF.fetch("http://x/?tier=verified");
    const body = await res.text();
    expect(body).toMatch(
      /<link rel="canonical" href="https:\/\/centralgauge\.sshadows\.workers\.dev\/"\s*\/>/,
    );
    expect(body).not.toContain(
      'canonical" href="https://centralgauge.sshadows.workers.dev/?tier=verified"',
    );
  });

  it("emits canonical for /models", async () => {
    const res = await SELF.fetch("http://x/models");
    const body = await res.text();
    expect(body).toMatch(
      /<link rel="canonical" href="https:\/\/centralgauge\.sshadows\.workers\.dev\/models"\s*\/>/,
    );
  });
});
