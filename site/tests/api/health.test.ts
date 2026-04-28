import { describe, it, expect } from "vitest";
import { GET } from "../../src/routes/health/+server";

interface HealthBody {
  ok: boolean;
  service: string;
  now: string;
}

describe("GET /health", () => {
  it("returns 200 with ok:true", async () => {
    const resp = await GET({} as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("centralgauge");
    expect(typeof body.now).toBe("string");
  });
});
