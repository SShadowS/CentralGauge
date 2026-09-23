import { assertEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import type { Catalog } from "../../../src/ingest/catalog/read.ts";
import {
  _resetEnsureTaskSetCache,
  ensureTaskSet,
} from "../../../src/ingest/register.ts";
import { computeTaskSetHash } from "../../../src/ingest/catalog/task-set-hash.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

async function withProject(fn: (root: string) => Promise<void>) {
  const root = await createTempDir("register-task-set");
  try {
    await Deno.mkdir(`${root}/tasks/easy`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/tasks/easy/CG-AL-E001.yml`,
      "id: CG-AL-E001\nmetadata:\n  category: data-modeling\n",
    );
    await fn(root);
  } finally {
    await cleanupTempDir(root);
  }
}

async function run(root: string, hash: string) {
  const calls: {
    url: string;
    body: { payload: { hash: string; tasks?: { task_id: string }[] } };
  }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    _resetEnsureTaskSetCache();
    await ensureTaskSet({} as Catalog, hash, 1, {
      catalogDir: `${root}/catalog`,
      config: {
        url: "https://example.test",
        keyPath: "",
        keyId: 1,
        machineId: "m",
        adminKeyPath: "x",
        adminKeyId: 4,
      },
      adminPrivateKey: ed.utils.randomSecretKey(),
      interactive: false,
    }, root);
  } finally {
    globalThis.fetch = orig;
  }
  return calls;
}

Deno.test("ensureTaskSet uploads task rows when the tree matches the hash", async () => {
  await withProject(async (root) => {
    const hash = await computeTaskSetHash(root);
    const calls = await run(root, hash);
    assertEquals(calls.map((c) => new URL(c.url).pathname), [
      "/api/v1/admin/catalog/task-sets",
      "/api/v1/task-sets",
    ]);
    const upload = calls[1]!.body.payload;
    assertEquals(upload.tasks?.map((t) => t.task_id), ["CG-AL-E001"]);
    assertEquals(upload.hash, hash);
  });
});

Deno.test("ensureTaskSet skips task rows when the tree hash differs", async () => {
  await withProject(async (root) => {
    const calls = await run(root, "f".repeat(64));
    assertEquals(calls.map((c) => new URL(c.url).pathname), [
      "/api/v1/admin/catalog/task-sets",
    ]);
  });
});
