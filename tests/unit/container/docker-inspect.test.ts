import { assertEquals } from "@std/assert";
import {
  inspectContainer,
  parseInspectJson,
} from "../../../src/container/docker-inspect.ts";
import { createCommandMock } from "../../utils/command-mock.ts";

// Shape mirrors real `docker inspect <name>` output, trimmed to what we read.
function inspectPayload(env: string[], running: boolean): string {
  return JSON.stringify([{
    Config: { Env: env },
    State: { Running: running },
  }]);
}

Deno.test("parseInspectJson reads artifactUrl and running state", () => {
  const out = parseInspectJson(
    inspectPayload([
      "foo=bar",
      "artifactUrl=https://x/sandbox/28.3/dk",
      "platformArtifactUrl=",
    ], true),
  );
  assertEquals(out?.artifactUrl, "https://x/sandbox/28.3/dk");
  assertEquals(out?.running, true);
});

Deno.test("parseInspectJson reports a stopped container as not running", () => {
  // This is the Cronus284 case: Test-BcContainer reported it healthy while
  // Docker reported it not running, and the whole bench measured wrong.
  const out = parseInspectJson(
    inspectPayload(["artifactUrl=https://x/sandbox/28.3/dk"], false),
  );
  assertEquals(out?.running, false);
});

Deno.test("parseInspectJson returns undefined artifactUrl when absent", () => {
  const out = parseInspectJson(inspectPayload(["foo=bar"], true));
  assertEquals(out?.artifactUrl, undefined);
  assertEquals(out?.running, true);
});

Deno.test("parseInspectJson returns undefined on unusable output", () => {
  assertEquals(parseInspectJson(""), undefined);
  assertEquals(parseInspectJson("not json"), undefined);
  assertEquals(parseInspectJson("[]"), undefined);
});

Deno.test("parseInspectJson returns an empty string for a present but empty artifactUrl", () => {
  // Distinct from the "absent" case above: the entry exists but has
  // nothing after the `=`. Must not be conflated with `undefined`.
  const out = parseInspectJson(inspectPayload(["artifactUrl="], true));
  assertEquals(out?.artifactUrl, "");
  assertEquals(out?.running, true);
});

// =============================================================================
// inspectContainer - subprocess paths (must never throw; undefined on failure)
// =============================================================================

Deno.test("inspectContainer returns the parsed inspection on a successful exit", async () => {
  const mock = createCommandMock();
  try {
    mock.install();
    mock.mockDocker(
      ["inspect", "Cronus28"],
      inspectPayload(["artifactUrl=https://x/sandbox/28.3/dk"], true),
    );

    const out = await inspectContainer("Cronus28");

    assertEquals(out?.artifactUrl, "https://x/sandbox/28.3/dk");
    assertEquals(out?.running, true);
  } finally {
    mock.restore();
  }
});

Deno.test("inspectContainer returns undefined on a non-zero exit code", async () => {
  const mock = createCommandMock();
  try {
    mock.install();
    mock.mockDockerError(
      ["inspect", "NoSuchContainer"],
      "Error: No such object: NoSuchContainer",
      1,
    );

    const out = await inspectContainer("NoSuchContainer");

    assertEquals(out, undefined);
  } finally {
    mock.restore();
  }
});

Deno.test("inspectContainer returns undefined when Deno.Command throws (e.g. docker binary missing)", async () => {
  // CommandMock always resolves output() rather than throwing, so this path
  // needs a raw Deno.Command replacement that throws on construction -
  // simulating a missing `docker` binary. Deno 2.8 exposes Deno.Command as a
  // getter-only accessor, so restore via Object.defineProperty, not a plain
  // assignment.
  const original = Deno.Command;
  try {
    Object.defineProperty(Deno, "Command", {
      value: function () {
        throw new Error("docker: command not found");
      },
      configurable: true,
      writable: true,
    });

    const out = await inspectContainer("Cronus28");

    assertEquals(out, undefined);
  } finally {
    Object.defineProperty(Deno, "Command", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
});
