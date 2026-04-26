import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkAuthProbe } from "../../../../../src/doctor/sections/ingest/check-auth-probe.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

async function setupConfigAndKey(): Promise<{ tmp: string; keyPath: string }> {
  const tmp = await Deno.makeTempDir();
  const keyPath = `${tmp}/k.ed25519`;
  // 32 non-zero bytes — valid format and accepted by ed25519 sign.
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = i + 1;
  await Deno.writeFile(keyPath, seed);
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: https://x.example\n  key_id: 7\n  key_path: ${keyPath}\n  machine_id: machine-A\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  return { tmp, keyPath };
}

describe("checkAuthProbe", () => {
  it("passes when server returns auth.ok=true and key_role=ingest and machine_id_match=true", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: true,
                machine_id_match: true,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "passed");
      assertEquals(result.message.includes("key_id=7"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails on 401 with auth-mismatch remediation hint", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(new Response("bad sig", { status: 401 }));
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, false);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when machine_id_match=false even though signature is valid", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: true,
                machine_id_match: false,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("machine_id"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key was revoked (auth.key_active=false)", async () => {
    const { tmp } = await setupConfigAndKey();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: false,
                machine_id_match: true,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        previousResults: new Map(),
      };
      const result = await checkAuthProbe.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.message.includes("revoked"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
