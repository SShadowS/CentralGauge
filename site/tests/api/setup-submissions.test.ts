import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sealKey } from "../../src/lib/server/submission-crypto";

const URL_ = "https://x/api/v1/setup-submissions";
const realFetch = globalThis.fetch;
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]);

// Turnstile siteverify needs the network; answer it locally. A token of
// "bad" fails, anything else passes.
function stubTurnstile() {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = input instanceof Request ? input.url : String(input);
      if (u.includes("challenges.cloudflare.com")) {
        const body = String((init?.body as URLSearchParams) ?? "");
        return Response.json({ success: !body.includes("response=bad") });
      }
      return realFetch(input, init);
    },
  );
}

const FIELDS: Record<string, string> = {
  agent_tool: "claude-code",
  base_model: "claude-opus-5",
  description: "My setup",
  instructions_name: "CLAUDE.md",
};

function form(
  over: Record<string, string> = {},
  opts: {
    zip?: Uint8Array<ArrayBuffer>;
    zipName?: string;
    token?: string;
  } = {},
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...FIELDS, ...over })) fd.set(k, v);
  fd.set("cf-turnstile-response", opts.token ?? "ok");
  fd.set("instructions", new File(["# hi"], "CLAUDE.md"));
  fd.set(
    "zip",
    new File([opts.zip ?? ZIP], opts.zipName ?? "s.zip", {
      type: "application/zip",
    }),
  );
  return fd;
}

let ipN = 0;
function post(fd: FormData, ip = `10.0.0.${++ipN}`) {
  return SELF.fetch(URL_, {
    method: "POST",
    body: fd,
    headers: { origin: "https://x", "cf-connecting-ip": ip },
  });
}

async function countRows() {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM setup_submissions",
  ).first<{ n: number }>();
  return r!.n;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  stubTurnstile();
  // Warm the lazy route module (see the deadlock note in transcripts.test.ts).
  await post(form({}, { token: "bad" })).then((r) => r.body?.cancel());
});
afterEach(() => stubTurnstile());

describe("POST /api/v1/setup-submissions", () => {
  it("stores a valid submission", async () => {
    const before = await countRows();
    const res = await post(form());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; edit_path: string };
    const m = body.edit_path.match(/^\/submit\/edit\/([0-9a-f]{32})#(.{43})$/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(body.id);
    const row = await env.DB.prepare(
      "SELECT * FROM setup_submissions WHERE id = ?",
    )
      .bind(body.id)
      .first<Record<string, unknown>>();
    expect(row!.status).toBe("new");
    expect(row!.edit_token_hash).not.toBe(m![2]);
    expect(row!.key_ciphertext).toBeNull();
    expect(row!.zip_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await countRows()).toBe(before + 1);
    const obj = await env.BLOBS.get(`setup-submissions/${body.id}.zip`);
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(ZIP);
  });

  it("seals a key and never exposes the plaintext", async () => {
    const secretKey = "sk-super-secret-value";
    const exp = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await post(form({ key: secretKey, key_expires_on: exp }));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(secretKey);
    const id = (JSON.parse(text) as { id: string }).id;
    const row = await env.DB.prepare(
      "SELECT * FROM setup_submissions WHERE id = ?",
    )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row!.key_ciphertext).not.toBeNull();
    expect(row!.key_iv).not.toBeNull();
    expect(row!.key_expires_on).toBe(exp);
    expect(JSON.stringify(row)).not.toContain(secretKey);
  });

  it("rejects a failed captcha with nothing written", async () => {
    const before = await countRows();
    const listed = (await env.BLOBS.list({ prefix: "setup-submissions/" }))
      .objects.length;
    const res = await post(form({}, { token: "bad" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "captcha_failed",
    );
    expect(await countRows()).toBe(before);
    expect(
      (await env.BLOBS.list({ prefix: "setup-submissions/" })).objects.length,
    ).toBe(listed);
  });

  it("limits to 5 per IP per day", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 5; i++)
      expect((await post(form(), ip)).status).toBe(201);
    const res = await post(form(), ip);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe(
      "submission_limit",
    );
  });

  it("rejects a non-zip with details.zip", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 not a zip");
    const res = await post(form({}, { zip: pdf, zipName: "a.pdf" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Record<string, string> };
    expect(body.details.zip).toBeTruthy();
  });

  it("rejects an 11 MiB zip with 413", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(ZIP);
    const res = await post(form({}, { zip: big }));
    expect(res.status).toBe(413);
  });

  it("caps a body with no content-length", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 12) c.enqueue(chunk);
        else c.close();
      },
    });
    const res = await SELF.fetch(URL_, {
      method: "POST",
      body: stream,
      // @ts-expect-error required by undici for stream bodies
      duplex: "half",
      headers: {
        origin: "https://x",
        "content-type": "multipart/form-data; boundary=x",
        "cf-connecting-ip": "10.9.9.9",
      },
    });
    expect(res.status).toBe(413);
  });

  it("returns field errors under details", async () => {
    const res = await post(form({ description: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      details: Record<string, string>;
    };
    expect(body.code).toBe("invalid_submission");
    expect(body.details.description).toBeTruthy();
  });

  it("rejects non-UTF-8 instructions", async () => {
    const fd = form();
    fd.set("instructions", new File([new Uint8Array([0xff, 0xfe, 0xfd])], "x"));
    const res = await post(fd);
    expect(res.status).toBe(400);
    expect(
      ((await res.json()) as { details: Record<string, string> }).details
        .instructions,
    ).toBeTruthy();
  });
});

describe("secret handling", () => {
  it("a bad SUBMISSION_KEY_SECRET is submissions_unavailable", async () => {
    await expect(sealKey("k", "not-base64-32-bytes")).rejects.toMatchObject({
      status: 503,
      code: "submissions_unavailable",
    });
  });
});
