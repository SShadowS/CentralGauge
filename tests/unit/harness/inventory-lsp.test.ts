import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { tempDir } from "./temp-dirs.ts";

const SCRIPT = fromFileUrl(
  new URL(
    "../../../harness/images/claude-code/cg-inventory.ps1",
    import.meta.url,
  ),
);
const FAKE_PROBE = fromFileUrl(
  new URL("../../fixtures/harness/lsp/fake-probe.mjs", import.meta.url),
);
const IGNORE = Deno.build.os !== "windows";

async function run(
  settings: Record<string, unknown> | null,
  opts: { plugin?: boolean; rc?: number; enableTool?: boolean } = {},
) {
  const root = await Deno.realPath(await tempDir({ prefix: "cg-inv-lsp-" }));
  for (const d of ["config", "home", "ws/Core", "plugin"]) {
    await Deno.mkdir(join(root, d), { recursive: true });
  }
  await Deno.writeTextFile(join(root, "ws", "Core", "app.json"), "{}");
  if (settings) {
    await Deno.writeTextFile(
      join(root, "config", "settings.json"),
      JSON.stringify({ settings }),
    );
  }
  if (opts.plugin !== false) {
    await Deno.writeTextFile(join(root, "plugin", ".lsp.json"), "{}");
  }
  const env: Record<string, string> = {
    CG_FAKE_PROBE_RC: String(opts.rc ?? 0),
  };
  const out = await new Deno.Command("powershell", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `${
        opts.enableTool
          ? "$env:ENABLE_LSP_TOOL = '1'"
          : "Remove-Item Env:\\ENABLE_LSP_TOOL -ErrorAction SilentlyContinue"
      }; ` +
      `& '${SCRIPT}' -ConfigDir '${join(root, "config")}' -HomeDir '${
        join(root, "home")
      }' -Workspace '${join(root, "ws")}' -Ancestors '${root}' -ManagedDir '${
        join(root, "managed")
      }' -LspPlugin '${
        join(root, "plugin")
      }' -LspProbe '${FAKE_PROBE}'; exit $LASTEXITCODE`,
    ],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).split(/\r?\n/).filter(
    Boolean,
  );
  assertEquals(lines.length, 1, `one JSON line: ${lines.join(" | ")}`);
  return { code: out.code, rec: JSON.parse(lines[0]!) };
}

Deno.test({
  name:
    "cg-inventory LSP: a declared LSP whose preflight passes is installed as lsp:al",
  ignore: IGNORE,
  async fn() {
    const r = await run({ lsp: ["al"] });
    assertEquals([r.code, r.rec.ok, r.rec.installed], [0, true, ["lsp:al"]]);
  },
});

Deno.test({
  name:
    "cg-inventory LSP: a failed preflight, a missing plugin or an unknown name is refused",
  ignore: IGNORE,
  async fn() {
    const failed = await run({ lsp: ["al"] }, { rc: 3 });
    assertEquals([failed.code, failed.rec.ok], [5, false]);
    assert(failed.rec.problems.includes("lsp:al: preflight failed (exit 3)"));
    const missing = await run({ lsp: ["al"] }, { plugin: false });
    assert(
      missing.rec.problems.some((p: string) =>
        p.startsWith("lsp:al: plugin missing at")
      ),
    );
    const unknown = await run({ lsp: ["pyright"] });
    assert(unknown.rec.problems.includes("unknown LSP component: pyright"));
  },
});

Deno.test({
  name:
    "cg-inventory LSP: ENABLE_LSP_TOOL in an arm without LSP is refused; no settings file means the check is off (host tests)",
  ignore: IGNORE,
  async fn() {
    const leaked = await run({}, { enableTool: true });
    assertEquals([leaked.code, leaked.rec.ok], [5, false]);
    assert(
      leaked.rec.problems.includes(
        "ENABLE_LSP_TOOL is set in an arm without LSP",
      ),
    );
    assertEquals((await run({})).rec.ok, true);
    assertEquals((await run(null, { enableTool: true })).rec.ok, true);
  },
});
