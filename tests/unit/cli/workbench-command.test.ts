import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { resolveServeOptions } from "../../../cli/commands/workbench-command.ts";

describe("cli/workbench-command", () => {
  it("defaults to the repo's scratch directory", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(o.scratchDir.replaceAll("\\", "/"), "/repo/scratch");
  });

  // It used to be the relative literal `"tests/al/dependencies"` inside
  // server.ts, resolved against `Deno.cwd()` at request time: started from
  // anywhere but the repo root, every chained prereq dependency silently
  // failed to resolve, which is indistinguishable from the legitimate
  // base-app case, so their fields vanished from the index and a model
  // referencing one was told it made the field up. Absolutised here,
  // against the same root as `scratchDir`.
  it("absolutises the chained-prereq dependencies root against the repo root", () => {
    const o = resolveServeOptions({}, "/repo");
    assertEquals(
      o.dependenciesRoot.replaceAll("\\", "/"),
      "/repo/tests/al/dependencies",
    );
  });

  it("honours an explicit port", () => {
    assertEquals(resolveServeOptions({ port: 4321 }, "/repo").port, 4321);
  });

  it("leaves the port unset when not given, so the server picks one", () => {
    assertEquals(resolveServeOptions({}, "/repo").port, undefined);
  });

  it("resolves default models from a named preset in config", () => {
    const o = resolveServeOptions(
      { preset: "flagship" },
      "/repo",
      { benchmarkPresets: { flagship: { llms: ["a/b", "c/d"] } } },
    );
    assertEquals(o.defaultModels, ["a/b", "c/d"]);
  });

  it("leaves defaultModels empty when no preset is given", () => {
    const o = resolveServeOptions(
      {},
      "/repo",
      { benchmarkPresets: { flagship: { llms: ["a/b"] } } },
    );
    assertEquals(o.defaultModels, []);
  });

  it("an unknown preset yields an empty list rather than throwing", () => {
    const o = resolveServeOptions({ preset: "nope" }, "/repo", {});
    assertEquals(o.defaultModels, []);
  });
});
