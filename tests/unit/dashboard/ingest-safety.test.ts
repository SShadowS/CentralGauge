import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

describe("dashboard/ingest-safety", () => {
  it("never imports bench, ingest, the ingest module tree, or the config loader", async () => {
    const cmd = new Deno.Command("deno", {
      args: ["info", "--json", "src/dashboard/server.ts"],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout } = await cmd.output();
    assertEquals(code, 0);

    const graph = JSON.parse(new TextDecoder().decode(stdout));
    const specifiers: string[] = (graph.modules ?? []).map(
      (m: { specifier: string }) => m.specifier.replaceAll("\\", "/"),
    );

    // Positive control. Without this the test passes vacuously if `deno info`
    // ever changes its JSON shape: `graph.modules ?? []` would yield an empty
    // array, nothing would match, and a safety guarantee would silently
    // report success. A trivial module already pulls in ~100 modules here, so
    // a handful means the shape assumption broke.
    assertEquals(
      specifiers.length > 20,
      true,
      `expected a populated module graph, got ${specifiers.length} — ` +
        `has 'deno info --json' changed shape?`,
    );
    assertEquals(
      specifiers.some((s) =>
        s.toLowerCase().includes("/src/dashboard/server.ts")
      ),
      true,
      "module graph does not contain the entry point it was asked about",
    );

    const forbidden = [
      "cli/commands/bench-command.ts",
      "cli/commands/ingest-command.ts",
      "cli/commands/bench/",
      "/src/ingest/",
      // The config loader. `server.ts` and `cli/commands/workbench-command.ts`
      // both assert in their doc comments that the dashboard stays clear of
      // it — `--preset` is resolved by the CLI and handed in as plain data —
      // but until now that was enforced only by hand on review. It nearly
      // slipped: resolving a model alias meant importing
      // `src/llm/model-presets.ts`, which type-imports the config loader, and
      // `deno info` counts type-only imports. This list would have stayed
      // green through it. A hand-enforced invariant that outlives the
      // reviewer's attention is what a test is for.
      "/src/config/config.ts",
    ];

    // Windows path case is not stable — `deno info` emits the drive root as
    // both `U:/git/...` and `U:/Git/...` within a single graph — so compare
    // case-insensitively rather than trusting the casing to match.
    const violations = specifiers.filter((s) =>
      forbidden.some((f) => s.toLowerCase().includes(f.toLowerCase()))
    );
    assertEquals(
      violations,
      [],
      `dashboard must not reach these modules: ${violations.join(", ")}`,
    );
  });
});
