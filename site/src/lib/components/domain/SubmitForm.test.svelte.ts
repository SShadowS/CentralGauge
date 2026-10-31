import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import SubmitForm from "./SubmitForm.svelte";
import { AGENT_TOOLS } from "$shared/setups";

function stubFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  // The real widget needs the network; hand back a token at once.
  (window as unknown as { turnstile: unknown }).turnstile = {
    render: (_el: unknown, opts: { callback: (t: string) => void }) => {
      opts.callback("test-token");
      return "w1";
    },
    reset: () => {},
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

const submit = async (container: HTMLElement) => {
  await fireEvent.submit(container.querySelector("form")!);
};

describe("SubmitForm", () => {
  it("lists all six agent tools", () => {
    render(SubmitForm, { siteKey: "k", onsubmitted: () => {} });
    const select = screen.getByLabelText("Agent tool") as unknown as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([...AGENT_TOOLS]);
  });

  it("uses a password input for the key", () => {
    render(SubmitForm, { siteKey: "k", onsubmitted: () => {} });
    expect(screen.getByLabelText("Key (optional)").getAttribute("type")).toBe("password");
  });

  it("shows a 400 detail next to its field", async () => {
    stubFetch(400, { error: "bad", code: "invalid_submission", details: { description: "Description is required." } });
    const { container } = render(SubmitForm, { siteKey: "k", onsubmitted: () => {} });
    await submit(container);
    const msg = await screen.findByText("Description is required.");
    expect(msg.id).toBe("err-description");
    expect(screen.getByLabelText("Description").getAttribute("aria-describedby")).toBe("err-description");
  });

  it("shows a 429 as a banner", async () => {
    stubFetch(429, { error: "too many submissions today", code: "submission_limit" });
    const { container } = render(SubmitForm, { siteKey: "k", onsubmitted: () => {} });
    await submit(container);
    expect((await screen.findByRole("alert")).textContent).toContain("too many submissions today");
  });

  it("calls onsubmitted with id and edit path on 201", async () => {
    const f = stubFetch(201, { id: "abc", edit_path: "/submit/edit/abc#tok" });
    const onsubmitted = vi.fn();
    const { container } = render(SubmitForm, { siteKey: "k", onsubmitted });
    await submit(container);
    await waitFor(() => expect(onsubmitted).toHaveBeenCalledWith({ id: "abc", edit_path: "/submit/edit/abc#tok" }));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/setup-submissions");
    expect(new Headers(init.headers).get("cf-turnstile-response")).toBe("test-token");
    expect((init.body as FormData).has("cf-turnstile-response")).toBe(false);
  });
});
