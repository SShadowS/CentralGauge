/**
 * handleFetch: SvelteKit's internal same-origin fetch forwards only cookie +
 * authorization, so admin loaders calling /api/v1/admin/* lose the Access JWT
 * header and get 401. handleFetch re-attaches it for same-origin admin API
 * calls only.
 */
import { describe, expect, it } from "vitest";
import { handleFetch } from "../../src/hooks.server";

const JWT_HEADER = "cf-access-jwt-assertion";

async function run(
  outgoingUrl: string,
  incomingJwt: string | null,
  outgoingJwt?: string,
): Promise<Request> {
  const incoming = new Headers();
  if (incomingJwt) incoming.set(JWT_HEADER, incomingJwt);
  const event = {
    url: new URL("https://ai.example.dev/admin/submissions"),
    request: new Request("https://ai.example.dev/admin/submissions", {
      headers: incoming,
    }),
  };
  const outHeaders = new Headers();
  if (outgoingJwt) outHeaders.set(JWT_HEADER, outgoingJwt);
  const request = new Request(outgoingUrl, { headers: outHeaders });
  let seen: Request | undefined;
  const fakeFetch = (r: Request) => {
    seen = r;
    return Promise.resolve(new Response("ok"));
  };
  // deno-lint-ignore no-explicit-any
  await handleFetch({ event, request, fetch: fakeFetch } as any);
  return seen!;
}

describe("handleFetch", () => {
  it("adds the JWT to same-origin admin API calls", async () => {
    const r = await run("https://ai.example.dev/api/v1/admin/x", "jwt-1");
    expect(r.headers.get(JWT_HEADER)).toBe("jwt-1");
  });

  it("does not forward cross-origin", async () => {
    const r = await run("https://evil.example/api/v1/admin/x", "jwt-1");
    expect(r.headers.get(JWT_HEADER)).toBeNull();
  });

  it("does not forward to non-admin paths", async () => {
    const r = await run("https://ai.example.dev/api/v1/models", "jwt-1");
    expect(r.headers.get(JWT_HEADER)).toBeNull();
  });

  it("adds nothing when the incoming request has no JWT", async () => {
    const r = await run("https://ai.example.dev/api/v1/admin/x", null);
    expect(r.headers.get(JWT_HEADER)).toBeNull();
  });

  it("keeps an existing outgoing JWT", async () => {
    const r = await run(
      "https://ai.example.dev/api/v1/admin/x",
      "jwt-1",
      "own",
    );
    expect(r.headers.get(JWT_HEADER)).toBe("own");
  });
});
