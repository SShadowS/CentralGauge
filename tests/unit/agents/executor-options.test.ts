import { assertEquals } from "@std/assert";
import type { QueryOptions } from "../../../src/agents/sdk-types.ts";

Deno.test("QueryOptions", async (t) => {
  await t.step("settingSources is included in type", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project"],
    };
    assertEquals(opts.settingSources, ["project"]);
  });

  await t.step("settingSources accepts user and project", () => {
    const opts: QueryOptions = {
      model: "test",
      cwd: "/tmp",
      maxTurns: 10,
      systemPrompt: "test",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project"],
    };
    assertEquals(opts.settingSources, ["user", "project"]);
  });
});
