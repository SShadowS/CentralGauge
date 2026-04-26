import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkNetHealth } from "../../../../../src/doctor/sections/ingest/check-net-health.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function makeFetch(impl: typeof fetch): typeof fetch {
  return impl;
}

async function withTmpConfig<T>(
  url: string,
  body: (cwd: string) => Promise<T>,
): Promise<T> {
  const tmp = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: ${url}\n  key_id: 1\n  key_path: /k\n  machine_id: m\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  try {
    return await body(tmp);
  } finally {
    Deno.env.delete("CENTRALGAUGE_TEST_HOME");
    await Deno.remove(tmp, { recursive: true });
  }
}

describe("checkNetHealth", () => {
  it("passes when /health returns 200", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: makeFetch(async () =>
          await Promise.resolve(new Response("ok", { status: 200 }))
        ),
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "passed");
    });
  });

  it("fails on non-200 response", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: makeFetch(async () =>
          await Promise.resolve(new Response("nope", { status: 502 }))
        ),
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("502"), true);
    });
  });

  it("fails on timeout", async () => {
    await withTmpConfig("https://x.example", async (tmp) => {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: (_url, init?: RequestInit) => {
          const signal = (init as RequestInit | undefined)?.signal;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
            );
          });
        },
        previousResults: new Map(),
      };
      const result = await checkNetHealth.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(
        result.message.toLowerCase().includes("timeout") ||
          result.message.toLowerCase().includes("abort"),
        true,
      );
    });
  });
});
