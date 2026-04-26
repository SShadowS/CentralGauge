import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkKeysFiles } from "../../../../../src/doctor/sections/ingest/check-keys-files.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

function ctx(cwd: string): DoctorContext {
  return { cwd, fetchFn: globalThis.fetch, previousResults: new Map() };
}

async function writeKey(path: string, bytes: number) {
  await Deno.writeFile(path, new Uint8Array(bytes));
}

describe("checkKeysFiles", () => {
  it("passes when ingest key file exists at exactly 32 bytes", async () => {
    const tmp = await Deno.makeTempDir();
    const keyPath = `${tmp}/key.ed25519`;
    await writeKey(keyPath, 32);
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${keyPath}\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key file does not exist", async () => {
    const tmp = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${tmp}/missing.ed25519\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const issues =
        (result.details?.["issues"] as Array<Record<string, unknown>>) ?? [];
      assertEquals(issues[0]?.["reason"], "not found");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when key file size is not 32 bytes", async () => {
    const tmp = await Deno.makeTempDir();
    const keyPath = `${tmp}/wrong.ed25519`;
    await writeKey(keyPath, 64); // wrong size
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${keyPath}\n  machine_id: m\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "failed");
      const issues =
        (result.details?.["issues"] as Array<Record<string, unknown>>) ?? [];
      assertEquals(issues[0]?.["reason"], "wrong size");
      assertEquals(issues[0]?.["bytes"], 64);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("checks admin key too when configured", async () => {
    const tmp = await Deno.makeTempDir();
    const ingestKey = `${tmp}/i.ed25519`;
    const adminKey = `${tmp}/a.ed25519`;
    await writeKey(ingestKey, 32);
    await writeKey(adminKey, 32);
    await Deno.writeTextFile(
      `${tmp}/.centralgauge.yml`,
      `ingest:\n  url: x\n  key_id: 1\n  key_path: ${ingestKey}\n  machine_id: m\n  admin_key_id: 2\n  admin_key_path: ${adminKey}\n`,
    );
    Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
    try {
      const result = await checkKeysFiles.run(ctx(tmp));
      assertEquals(result.status, "passed");
      assertEquals(result.message, "ingest + admin keys 32B each");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
