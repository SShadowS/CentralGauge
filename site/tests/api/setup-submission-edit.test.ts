import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";

const BASE = "https://x/api/v1/setup-submissions";
const realFetch = globalThis.fetch;
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]);
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function stubTurnstile() {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = input instanceof Request ? input.url : String(input);
      if (u.includes("challenges.cloudflare.com")) {
        return Response.json({ success: true });
      }
      return realFetch(input, init);
    },
  );
}

let ipN = 0;
async function create(
  over: Record<string, string> = {},
): Promise<{ id: string; token: string }> {
  const fd = new FormData();
  const fields = {
    agent_tool: "claude-code",
    base_model: "claude-opus-5",
    description: "My setup",
    instructions_name: "CLAUDE.md",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set("instructions", new File(["# secret instructions"], "CLAUDE.md"));
  fd.set("zip", new File([ZIP], "s.zip", { type: "application/zip" }));
  const res = await SELF.fetch(BASE, {
    method: "POST",
    body: fd,
    headers: {
      origin: "https://x",
      "cf-connecting-ip": `10.7.0.${++ipN}`,
      "cf-turnstile-response": "ok",
    },
  });
  expect(res.status).toBe(201);
  const { id, edit_path } = (await res.json()) as {
    id: string;
    edit_path: string;
  };
  return { id, token: edit_path.split("#")[1] };
}

function call(
  id: string,
  op: "status" | "edit",
  body: unknown,
  ip = "10.8.0.1",
) {
  return SELF.fetch(`${BASE}/${id}/${op}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://x",
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
  });
}

async function row(id: string) {
  return env.DB.prepare("SELECT * FROM setup_submissions WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  stubTurnstile();
});

describe("POST status", () => {
  it("returns the view without instructions or key", async () => {
    const exp = day(1);
    const { id, token } = await create({
      key: "sk-plain-secret",
      key_expires_on: exp,
    });
    const res = await call(id, "status", { token });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("instructions_md");
    expect(text).not.toContain("secret instructions");
    expect(text).not.toContain("sk-plain-secret");
    expect(text).not.toContain("key_ciphertext");
    const b = JSON.parse(text);
    expect(b).toMatchObject({
      id,
      status: "new",
      agent_tool: "claude-code",
      base_model: "claude-opus-5",
      description: "My setup",
      visibility: "public",
      has_key: true,
      key_expires_on: exp,
      setup_id: null,
    });
    expect(typeof b.created_at).toBe("string");
  });

  it("404s on a wrong token and on another submission's token", async () => {
    const a = await create();
    const b = await create();
    const wrong = await call(a.id, "status", { token: "x".repeat(43) });
    expect(wrong.status).toBe(404);
    expect(((await wrong.json()) as { code: string }).code).toBe("not_found");
    expect((await call(b.id, "status", { token: a.token })).status).toBe(404);
  });

  it("404s on an unknown id and a malformed token", async () => {
    const a = await create();
    expect(
      (await call("f".repeat(32), "status", { token: a.token })).status,
    ).toBe(404);
    expect((await call(a.id, "status", { token: "short" })).status).toBe(404);
    expect((await call(a.id, "status", {})).status).toBe(404);
  });
});

describe("POST edit", () => {
  it("persists a visibility change", async () => {
    const { id, token } = await create();
    const res = await call(id, "edit", { token, visibility: "private" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { visibility: string }).visibility).toBe(
      "private",
    );
    expect((await row(id))!.visibility).toBe("private");
  });

  it("rejects an invalid visibility", async () => {
    const { id, token } = await create();
    expect((await call(id, "edit", { token, visibility: "x" })).status).toBe(
      400,
    );
  });

  it("replaces the key and clears key_deleted_at", async () => {
    const { id, token } = await create({
      key: "sk-one",
      key_expires_on: day(1),
    });
    const before = await row(id);
    await env.DB.prepare(
      "UPDATE setup_submissions SET key_deleted_at = ?, key_ciphertext = NULL, key_iv = NULL WHERE id = ?",
    )
      .bind("2026-01-01T00:00:00Z", id)
      .run();
    const exp = day(3);
    const res = await call(id, "edit", {
      token,
      key: "sk-two",
      key_expires_on: exp,
    });
    expect(res.status).toBe(200);
    const b = (await res.json()) as Record<string, unknown>;
    expect(b.has_key).toBe(true);
    expect(b.key_expires_on).toBe(exp);
    expect(JSON.stringify(b)).not.toContain("sk-two");
    const after = await row(id);
    expect(after!.key_deleted_at).toBeNull();
    expect(after!.key_ciphertext).not.toBeNull();
    expect(after!.key_ciphertext).not.toEqual(before!.key_ciphertext);
  });

  it("rejects a key expiring in 8 days and writes nothing", async () => {
    const { id, token } = await create();
    const res = await call(id, "edit", {
      token,
      key: "sk-late",
      key_expires_on: day(8),
    });
    expect(res.status).toBe(400);
    expect((await row(id))!.key_ciphertext).toBeNull();
  });

  it("rejects a key over 4096 characters and writes nothing", async () => {
    const { id, token } = await create();
    const res = await call(id, "edit", {
      token,
      key: "k".repeat(4097),
      key_expires_on: day(1),
    });
    expect(res.status).toBe(400);
    expect(
      ((await res.json()) as { details: Record<string, string> }).details.key,
    ).toBeTruthy();
    expect((await row(id))!.key_ciphertext).toBeNull();
  });

  it("413s on a body over 16 KiB and writes nothing", async () => {
    const { id, token } = await create();
    const res = await call(id, "edit", {
      token,
      visibility: "private",
      pad: "p".repeat(17 * 1024),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe(
      "payload_too_large",
    );
    expect((await row(id))!.visibility).toBe("public");
  });

  it("rejects a key without an expiry", async () => {
    const { id, token } = await create();
    expect((await call(id, "edit", { token, key: "sk-x" })).status).toBe(400);
  });

  it("404s on a wrong token without changing anything", async () => {
    const { id } = await create();
    const res = await call(id, "edit", {
      token: "y".repeat(43),
      visibility: "private",
    });
    expect(res.status).toBe(404);
    expect((await row(id))!.visibility).toBe("public");
  });

  it("updates a linked setups row too", async () => {
    const { id, token } = await create();
    await env.DB.prepare(
      "INSERT INTO setups (id, description, agent_tool, base_model, visibility, created_at) VALUES ('s-linked','d','claude-code','m','public','2026-01-01T00:00:00Z')",
    ).run();
    await env.DB.prepare(
      "UPDATE setup_submissions SET setup_id = 's-linked' WHERE id = ?",
    )
      .bind(id)
      .run();
    const pending = async () =>
      Number(
        (await env.DB.prepare(
          "SELECT pending_since FROM cache_epoch WHERE id = 1",
        ).first<{ pending_since: number }>())!.pending_since,
      );
    await env.DB.prepare(
      "UPDATE cache_epoch SET pending_since = 0 WHERE id = 1",
    ).run();
    // Same visibility: no epoch mark.
    expect((await call(id, "edit", { token, visibility: "public" })).status).toBe(
      200,
    );
    expect(await pending()).toBe(0);
    const res = await call(id, "edit", { token, visibility: "private" });
    expect(res.status).toBe(200);
    const s = await env.DB.prepare(
      "SELECT visibility FROM setups WHERE id = 's-linked'",
    ).first<{ visibility: string }>();
    expect(s!.visibility).toBe("private");
    expect(await pending()).toBeGreaterThan(0);
  });

  it("refuses a key on a rejected submission but allows visibility", async () => {
    const { id, token } = await create();
    await env.DB.prepare(
      "UPDATE setup_submissions SET status = 'rejected' WHERE id = ?",
    )
      .bind(id)
      .run();
    const res = await call(id, "edit", {
      token,
      key: "sk-late",
      key_expires_on: day(1),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "submission_closed",
    );
    expect((await row(id))!.key_ciphertext).toBeNull();
    expect(
      (await call(id, "edit", { token, visibility: "private" })).status,
    ).toBe(200);
  });

  it("reports a bad key under key, a bad visibility as 400, and sets no-store", async () => {
    const { id, token } = await create();
    const bad = await call(id, "edit", { token, key: 5, key_expires_on: day(1) });
    expect(bad.status).toBe(400);
    expect(
      ((await bad.json()) as { details: Record<string, string> }).details.key,
    ).toBeTruthy();
    const vis = await call(id, "edit", {
      token,
      visibility: "x",
      key: "sk-ok",
      key_expires_on: day(1),
    });
    expect(vis.status).toBe(400);
    const ok = await call(id, "status", { token });
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("sets updated_at on every edit", async () => {
    const { id, token } = await create();
    await env.DB.prepare(
      "UPDATE setup_submissions SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(id)
      .run();
    await call(id, "edit", { token });
    expect(((await row(id))!.updated_at as string) > "2025").toBe(true);
  });
});
