import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/settings-hash.fixture.json?raw";
import { settingsHash } from "../src/lib/server/ingest";
import { settingsHashOf } from "../src/lib/shared/settings-hash";

describe("settings hash parity (client helper == server hash)", () => {
  it("matches the committed fixture on both entry points", async () => {
    const cases = (
      JSON.parse(fixture) as {
        cases: Array<{
          name: string;
          settings: Record<string, unknown>;
          hash: string;
        }>;
      }
    ).cases;
    for (const c of cases) {
      expect(await settingsHashOf(c.settings), c.name).toBe(c.hash);
      expect(await settingsHash(c.settings), c.name).toBe(c.hash);
    }
  });
});
