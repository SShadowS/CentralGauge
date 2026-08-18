import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { resolveServeOptions } from "../../../cli/commands/workbench-command.ts";

describe("cli/workbench-command", () => {
  it("defaults to the repo's scratch directory", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(o.scratchDir.replaceAll("\\", "/"), "/repo/scratch");
  });

  it("honours an explicit port", () => {
    assertEquals(resolveServeOptions({ port: 4321 }, "/repo").port, 4321);
  });

  it("leaves the port unset when not given, so the server picks one", () => {
    assertEquals(resolveServeOptions({}, "/repo").port, undefined);
  });
});
