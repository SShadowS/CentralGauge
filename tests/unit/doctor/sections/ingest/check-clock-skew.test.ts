import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkClockSkew } from "../../../../../src/doctor/sections/ingest/check-clock-skew.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function makeFetch(serverDate: string): typeof fetch {
  return async () =>
    await Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { Date: serverDate },
      }),
    );
}

async function makeCtxWithUrl(
  fetchFn: typeof fetch,
): Promise<{ ctx: DoctorContext; cleanup: () => Promise<void> }> {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: https://x.example.com\n  key_id: 1\n  key_path: /tmp/k\n  machine_id: m\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  return {
    ctx: { cwd: tmp, fetchFn, previousResults: new Map() },
    cleanup: async () => {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    },
  };
}

describe("checkClockSkew", () => {
  it("passes when skew < 10min", async () => {
    const { ctx, cleanup } = await makeCtxWithUrl(
      makeFetch(new Date().toUTCString()),
    );
    try {
      const result = await checkClockSkew.run(ctx);
      assertEquals(result.status, "passed");
    } finally {
      await cleanup();
    }
  });

  it("fails when skew >= 10min", async () => {
    const tooEarly = new Date(Date.now() - 11 * 60 * 1000).toUTCString();
    const { ctx, cleanup } = await makeCtxWithUrl(makeFetch(tooEarly));
    try {
      const result = await checkClockSkew.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.summary, "Sync system clock");
    } finally {
      await cleanup();
    }
  });

  it("warns when probe URL is not configured (skew unknowable)", async () => {
    const tmp = await Deno.makeTempDir();
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    const ctx: DoctorContext = {
      cwd: tmp,
      fetchFn: async () => {
        await Promise.resolve();
        throw new Error("no url");
      },
      previousResults: new Map(),
    };
    try {
      const result = await checkClockSkew.run(ctx);
      assertEquals(result.status, "warning");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
