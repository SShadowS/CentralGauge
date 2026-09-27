/**
 * H-01: the agent runs as the non-admin built-in ContainerUser. The run arg
 * (sandbox.ts) is the primary control; the images end as ContainerUser and
 * every agent entrypoint refuses to start as an administrator.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ADMIN_REFUSAL_EXIT,
  ADMIN_REFUSAL_MARKER,
} from "../../../src/harness/sandbox.ts";

const GUARD = "harness/images/base/cg-nonadmin.ps1";
const ENTRYPOINTS = {
  "claude-code": ["$env:USERPROFILE", "& claude @claudeArgs"],
  pi: ["$env:PI_CODING_AGENT_DIR =", "& pi --version"],
} as const;
const code = (text: string) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );

Deno.test("H-01 guard: one implementation, in the base image; exit 86 with the marker; only a refusal can be forced", async () => {
  const base = await Deno.readTextFile(
    "harness/images/base/Dockerfile.windows",
  );
  assert(/^COPY cg-nonadmin\.ps1 C:\/cg-nonadmin\.ps1\s*$/m.test(base), base);
  const g = await Deno.readTextFile(GUARD);
  assertStringIncludes(g, ADMIN_REFUSAL_MARKER);
  assertStringIncludes(g, `exit ${ADMIN_REFUSAL_EXIT}`);
  assertStringIncludes(
    g,
    "[Security.Principal.WindowsBuiltInRole]::Administrator",
  );
  assertStringIncludes(g, "ContainerAdministrator");
  assert(!/param\s*\(/i.test(g), "no parameters");
  assertEquals(
    [...new Set(g.match(/\$env:\w+/g))],
    ["$env:CG_NONADMIN_FORCE_ADMIN"],
    "the only input can force a refusal, never skip one",
  );
  for (const h of ["claude-code", "pi", "mock"]) {
    const df = await Deno.readTextFile(
      `harness/images/${h}/Dockerfile.windows`,
    );
    assert(!df.includes("cg-nonadmin"), `${h} copies no second guard`);
  }
});

Deno.test("H-01 entrypoints: the guard runs first, before config, secrets, ready and the agent; any non-zero exits 86", async () => {
  for (const [h, own] of Object.entries(ENTRYPOINTS)) {
    const run = await Deno.readTextFile(`harness/images/${h}/run.ps1`);
    const lines = code(run);
    assertEquals(lines.slice(0, 3), [
      "$ErrorActionPreference = 'Stop'",
      "& 'C:\\cg-nonadmin.ps1'",
      "if ($LASTEXITCODE -ne 0) { exit 86 }",
    ], h);
    const body = lines.join("\n"); // comments may name anything
    const guard = body.indexOf("& 'C:\\cg-nonadmin.ps1'");
    for (
      const later of ["C:\\config", "cg-secrets", "ready", ...own]
    ) {
      const at = body.indexOf(later);
      assert(at > guard, `${h}: ${later} after the guard`);
    }
  }
});

Deno.test("H-01 images: npm into a machine-wide prefix; the agent images end as ContainerUser", async () => {
  const pkgs = {
    "claude-code": "@anthropic-ai/claude-code@2.1.282",
    pi: "@earendil-works/pi-coding-agent@0.87.1",
  };
  for (const [h, pkg] of Object.entries(pkgs)) {
    const df = await Deno.readTextFile(
      `harness/images/${h}/Dockerfile.windows`,
    );
    assertStringIncludes(df, `npm install -g --prefix C:\\cg-npm ${pkg};`);
    assertStringIncludes(
      df,
      "[Environment]::SetEnvironmentVariable('PATH', 'C:\\cg-npm;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)",
    );
    assert(!df.includes("npm config get prefix"), h);
  }
  for (const h of ["claude-code", "pi", "mock"]) {
    const lines = code(
      await Deno.readTextFile(`harness/images/${h}/Dockerfile.windows`),
    );
    assertEquals(lines.at(-2), "USER ContainerUser", h);
    assert(lines.at(-1)!.startsWith("CMD "), h);
    // Exec form is JSON: the script path must parse to C:\<script> ("C:\r..." would be a carriage return).
    const cmd = JSON.parse(lines.at(-1)!.slice(4)) as string[];
    assertEquals(
      cmd.at(-1),
      h === "mock" ? "C:\\mock.ps1" : "C:\\run.ps1",
      h,
    );
    assertEquals(lines.filter((l) => /^USER\b/.test(l)).length, 1, h);
  }
});

Deno.test("H-01 pi: C:\\pi-agent exists at build time, Users may modify it (by SID); run.ps1 creates it only if missing", async () => {
  const df = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(
    df,
    "New-Item -ItemType Directory -Force -Path C:\\pi-agent",
  );
  assertStringIncludes(
    df,
    'icacls C:\\pi-agent /grant "*S-1-5-32-545:(OI)(CI)M"',
  );
  assert(
    df.indexOf("icacls C:\\pi-agent") < df.indexOf("USER ContainerUser"),
    "granted while still admin",
  );
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(df));
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  assertStringIncludes(
    run,
    "if (-not (Test-Path $env:PI_CODING_AGENT_DIR)) { New-Item -ItemType Directory -Path $env:PI_CODING_AGENT_DIR | Out-Null }",
  );
});

const guardRun = async (env: Record<string, string>) => {
  const out = await new Deno.Command("powershell", {
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", GUARD],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
};

Deno.test({
  name:
    "H-01 guard on the host (non-elevated): passes silently; CG_NONADMIN_FORCE_ADMIN=1 refuses with 86 and the marker",
  ignore: Deno.build.os !== "windows",
  async fn() {
    assertEquals(await guardRun({ CG_NONADMIN_FORCE_ADMIN: "" }), {
      code: 0,
      stderr: "",
    });
    assertEquals((await guardRun({ CG_NONADMIN_FORCE_ADMIN: "0" })).code, 0);
    const r = await guardRun({ CG_NONADMIN_FORCE_ADMIN: "1" });
    assertEquals(r.code, ADMIN_REFUSAL_EXIT);
    assert(r.stderr.startsWith(`${ADMIN_REFUSAL_MARKER} (`), r.stderr);
    assert(r.stderr.includes(Deno.env.get("USERNAME") ?? "?"), r.stderr);
  },
});
