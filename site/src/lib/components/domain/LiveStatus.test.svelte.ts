import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import LiveStatus from "./LiveStatus.svelte";

function makeHandle(
  status: "connecting" | "connected" | "reconnecting" | "disconnected",
) {
  return { status, on: () => () => {}, dispose: () => {} };
}

describe("LiveStatus", () => {
  it("renders connected state", () => {
    const { container } = render(LiveStatus, { sse: makeHandle("connected") });
    expect(container.querySelector(".status-connected")).not.toBeNull();
  });

  it("renders reconnecting state with spinner-equivalent class", () => {
    const { container } = render(LiveStatus, {
      sse: makeHandle("reconnecting"),
    });
    expect(container.querySelector(".status-reconnecting")).not.toBeNull();
  });

  it("renders disconnected state and exposes a Reconnect button", () => {
    const { container, getByRole } = render(LiveStatus, {
      sse: makeHandle("disconnected"),
    });
    expect(container.querySelector(".status-disconnected")).not.toBeNull();
    expect(getByRole("button", { name: /reconnect/i })).toBeDefined();
  });

  it("label override surfaces in the rendered text", () => {
    const { getByText } = render(LiveStatus, {
      sse: makeHandle("connected"),
      label: "streaming",
    });
    expect(getByText("streaming")).toBeDefined();
  });
});
