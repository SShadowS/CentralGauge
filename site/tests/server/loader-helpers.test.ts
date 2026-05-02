import { describe, expect, it, vi } from "vitest";
import { passthroughLoader } from "../../src/lib/server/loader-helpers";

function makeEvent(
  opts: {
    url?: string;
    params?: Record<string, string>;
    fetchImpl: typeof fetch;
  } & Record<string, unknown>,
) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const url = new URL(opts.url ?? "http://x/");
  return {
    event: {
      url,
      params: opts.params ?? {},
      fetch: opts.fetchImpl,
      setHeaders,
      depends,
    },
    setHeaders,
    depends,
  };
}

describe("passthroughLoader", () => {
  it("passes through query params and returns the parsed body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "cache-control": "public, s-maxage=60" },
      })
    );
    const loader = passthroughLoader<{ ok: boolean }>({
      depTag: "app:test",
      fetchPath: "/api/v1/test",
    });
    const { event, setHeaders, depends } = makeEvent({
      url: "http://x/?foo=1",
      fetchImpl,
    });
    // @ts-expect-error - test event is a partial mock of LoadEvent
    const out = await loader(event);
    expect(out.data).toEqual({ ok: true });
    expect(depends).toHaveBeenCalledWith("app:test");
    expect(setHeaders).toHaveBeenCalledWith({
      "cache-control": "public, s-maxage=60",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/test?foo=1");
  });

  it("forwards only whitelisted params when forwardParams is set", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
    const loader = passthroughLoader<unknown>({
      depTag: "app:filtered",
      fetchPath: "/api/v1/test",
      forwardParams: ["model", "tier"],
    });
    const { event } = makeEvent({
      url: "http://x/?model=a&tier=v&secret=zzz",
      fetchImpl,
    });
    // @ts-expect-error - partial mock
    await loader(event);
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/test?model=a&tier=v");
  });

  it("throws SvelteKit error on non-OK response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "nope" }), { status: 404 })
    );
    const loader = passthroughLoader<unknown>({
      depTag: "app:nope",
      fetchPath: "/api/v1/nope",
    });
    const { event } = makeEvent({ url: "http://x/", fetchImpl });
    // @ts-expect-error - partial mock
    await expect(loader(event)).rejects.toMatchObject({ status: 404 });
  });

  it("depTag can be a function of params", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );
    const loader = passthroughLoader<unknown>({
      depTag: (p) => `app:family:${p.slug}`,
      fetchPath: (_url, p) => `/api/v1/families/${p.slug}`,
    });
    const { event, depends } = makeEvent({
      url: "http://x/",
      params: { slug: "claude" },
      fetchImpl,
    });
    // @ts-expect-error - partial mock
    await loader(event);
    expect(depends).toHaveBeenCalledWith("app:family:claude");
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/families/claude");
  });

  it("resultKey renames the response key (default is `data`)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ rows: [1, 2] }), { status: 200 })
    );
    // Both generics must be specified explicitly: TS does not yet support
    // partial type-arg inference, so passing only <TVal> would default
    // TKey to the literal `'data'` and reject `resultKey: 'families'`.
    const loader = passthroughLoader<{ rows: number[] }, "families">({
      depTag: "app:families",
      fetchPath: "/api/v1/families",
      resultKey: "families",
    });
    const { event } = makeEvent({ url: "http://x/", fetchImpl });
    // @ts-expect-error - partial mock
    const out = await loader(event);
    expect(out).toEqual({ families: { rows: [1, 2] } });
    // After B1 the return type is precisely {families: ...} so out.data
    // would be a compile error — runtime cast keeps the original assertion.
    expect((out as Record<string, unknown>).data).toBeUndefined();
  });
});
