import { assertEquals } from "@std/assert";
import {
  __setContextListerForTests,
  decideDockerContext,
  DOCKER_CONTEXT_ENV,
  dockerContextEnv,
  parseContextList,
  resolveDockerContext,
  WINDOWS_DOCKER_CONTEXT,
} from "../../../src/container/docker-context.ts";
import { MockEnv } from "../../utils/test-helpers.ts";

Deno.test("decideDockerContext", async (t) => {
  await t.step("pins desktop-windows when it exists on Windows", () => {
    assertEquals(
      decideDockerContext({
        os: "windows",
        envOverride: undefined,
        availableContexts: ["default", "desktop-linux", "desktop-windows"],
      }),
      { context: WINDOWS_DOCKER_CONTEXT, reason: "context_available" },
    );
  });

  await t.step("pins nothing when the context is absent", () => {
    assertEquals(
      decideDockerContext({
        os: "windows",
        envOverride: undefined,
        availableContexts: ["default"],
      }),
      { context: undefined, reason: "context_missing" },
    );
  });

  await t.step("pins nothing when the context list is unreadable", () => {
    assertEquals(
      decideDockerContext({
        os: "windows",
        envOverride: undefined,
        availableContexts: undefined,
      }),
      { context: undefined, reason: "context_list_failed" },
    );
  });

  await t.step("pins nothing off Windows", () => {
    assertEquals(
      decideDockerContext({
        os: "linux",
        envOverride: undefined,
        availableContexts: ["desktop-windows"],
      }),
      { context: undefined, reason: "not_windows" },
    );
  });

  await t.step("operator override wins over os and availability", () => {
    assertEquals(
      decideDockerContext({
        os: "linux",
        envOverride: "  my-remote  ",
        availableContexts: undefined,
      }),
      { context: "my-remote", reason: "operator_override" },
    );
  });

  await t.step("empty override opts out of pinning", () => {
    assertEquals(
      decideDockerContext({
        os: "windows",
        envOverride: "",
        availableContexts: ["desktop-windows"],
      }),
      { context: undefined, reason: "operator_opt_out" },
    );
  });
});

Deno.test("parseContextList drops blank lines and trims", () => {
  assertEquals(
    parseContextList("default\n  desktop-windows  \n\ndesktop-linux\n"),
    ["default", "desktop-windows", "desktop-linux"],
  );
});

Deno.test("resolveDockerContext caches and dockerContextEnv reflects it", async (t) => {
  const env = new MockEnv();
  try {
    await t.step("env fragment carries the pinned context", () => {
      env.delete(DOCKER_CONTEXT_ENV);
      let calls = 0;
      __setContextListerForTests(() => {
        calls++;
        return ["default", WINDOWS_DOCKER_CONTEXT];
      });
      const expected = Deno.build.os === "windows"
        ? { DOCKER_CONTEXT: WINDOWS_DOCKER_CONTEXT }
        : {};
      assertEquals(dockerContextEnv(), expected);
      // Second call must not re-probe Docker.
      assertEquals(dockerContextEnv(), expected);
      assertEquals(calls, Deno.build.os === "windows" ? 1 : 0);
    });

    await t.step("operator opt-out yields an empty fragment", () => {
      env.set(DOCKER_CONTEXT_ENV, "");
      __setContextListerForTests(() => [WINDOWS_DOCKER_CONTEXT]);
      assertEquals(dockerContextEnv(), {});
      assertEquals(resolveDockerContext().reason, "operator_opt_out");
    });

    await t.step("operator override is pinned verbatim", () => {
      env.set(DOCKER_CONTEXT_ENV, "windows-ci");
      __setContextListerForTests(() => undefined);
      assertEquals(dockerContextEnv(), { DOCKER_CONTEXT: "windows-ci" });
    });
  } finally {
    __setContextListerForTests(undefined);
    env.restore();
  }
});
