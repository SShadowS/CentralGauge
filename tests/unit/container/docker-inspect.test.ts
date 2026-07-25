import { assertEquals } from "@std/assert";
import { parseInspectJson } from "../../../src/container/docker-inspect.ts";

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
