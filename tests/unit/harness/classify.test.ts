import { assertEquals } from "@std/assert";
import {
  CATEGORIES,
  classify,
  RULES_VERSION,
} from "../../../src/harness/classify.ts";

const c = (
  tool: string,
  command: string | null = null,
  target: string | null = null,
) => classify({ tool, command, target });

Deno.test("classify: the 45 blind-labelled M0-07 calls match their labels (training pin, not held-out accuracy)", async () => {
  const rows = (await Deno.readTextFile(
    "tests/fixtures/harness/classify/m0-07-labeled.jsonl",
  )).trim().split("\n").map((l) => JSON.parse(l));
  assertEquals(rows.length, 45);
  const wrong = rows.map((r) => ({ r, got: c(r.tool, r.command).category }))
    .filter(({ r, got }) => got !== r.label)
    .map(({ r, got }) =>
      `${r.i} ${r.tool} ${r.command ?? ""}: ${got}, label ${r.label}`
    );
  assertEquals(wrong, []);
});

Deno.test("classify: carryover rules from accept-M0-07", () => {
  const cases: [string, string | null, string][] = [
    ["Skill", null, "other"],
    ["Agent", null, "other"],
    ["Task", null, "other"],
    ["ToolSearch", null, "other"],
    ["Bash", "cg-al --version", "other"],
    ["Bash", "cg-al publish Core", "other"],
    ["PowerShell", "cg-al frobnicate", "other"],
    ["PowerShell", 'Set-Content -Path a.txt -Value "x"; Get-ChildItem', "edit"],
    [
      "PowerShell",
      '(Get-ChildItem -Path "C:\\workspace\\src" -Filter *.al -Recurse -File | Measure-Object).Count',
      "search",
    ],
    ["bash", "set | grep PI_", "other"],
    ["mcp__al-tools__al_compile", null, "compile"],
    ["mcp__al-tools__al_test", null, "test"],
    ["mcp__al-tools__al_symbols", null, "symbols"],
    ["mcp__al-tools__al_new_thing", null, "unclassified"],
    ["mcp__test-server__read_file", null, "unclassified"],
    ["mcp__other__build_app", null, "compile"],
    ["mcp__other__run-tests", null, "test"],
    ["mcp__other__publish_app", null, "publish"],
    ["mcp__other__attest", null, "unclassified"],
  ];
  for (const [tool, cmd, want] of cases) {
    assertEquals(c(tool, cmd).category, want, `${tool} ${cmd}`);
  }
});

Deno.test("classify: command shapes (cg-al, toolchain, wrappers, redirects)", () => {
  const cases: [string, string, string][] = [
    ["Bash", "cg-al compile Core Rental", "compile"],
    ["Bash", "cg-al test 80000", "test"],
    ["Bash", "cg-al symbols", "symbols"],
    ["PowerShell", "& 'C:\\cg-al.ps1' compile Core", "compile"],
    [
      "PowerShell",
      "powershell -NoProfile -File C:\\cg-al.ps1 test 80001",
      "test",
    ],
    ["PowerShell", "cg-al.cmd compile", "compile"],
    ["PowerShell", 'powershell -Command "cg-al compile Core"', "compile"],
    ["Bash", 'cmd /c "cg-al test"', "test"],
    ["Bash", "cd /c/workspace && cg-al compile Core", "compile"],
    [
      "Bash",
      "al compile /project:C:\\workspace\\Core /packagecachepath:C:\\workspace\\.alpackages",
      "compile",
    ],
    ["PowerShell", "al.exe compile /project:Core", "compile"],
    ["Bash", "dotnet C:\\tools\\altool.dll compile /project:Core", "compile"],
    [
      "PowerShell",
      "& 'C:\\bc\\alc.exe' /project:Core /packagecachepath:.alpackages",
      "compile",
    ],
    ["Bash", "git diff --stat", "vcs"],
    ["Bash", "echo hi > Core/src/A.al", "edit"],
    ["Bash", "cat a.al > b.al", "edit"],
    ["Bash", "ls 2>/dev/null", "search"],
    ["Bash", "cat a.al 2>&1 | head -5", "read"],
  ];
  for (const [tool, cmd, want] of cases) {
    assertEquals(c(tool, cmd).category, want, cmd);
  }
});

Deno.test("classify: never a guess (unknown segment, quoted '>', unknown command with a redirect, empty)", () => {
  for (
    const cmd of [
      "python make.py",
      "ls; python x.py",
      "echo hi",
      'echo "x > a.al"',
      "python make.py > out.txt",
      "",
      "al GetPackageManifest x.app",
    ]
  ) {
    assertEquals(c("Bash", cmd), {
      category: "unclassified",
      classifier: `none@${RULES_VERSION}`,
    }, cmd);
  }
  assertEquals(c("Bash").category, "unclassified");
  assertEquals(c("WebFetch").category, "unclassified");
});

Deno.test("classify: builtins, pi tools, skill reads, classifier ids", () => {
  assertEquals(c("Read"), { category: "read", classifier: "builtin.Read@1" });
  assertEquals(c("Write").category, "edit");
  assertEquals(
    c("read", null, ".pi/skills/fleet-notes/SKILL.md").category,
    "read",
  );
  assertEquals(
    c("Bash", "cg-al compile Core").classifier,
    "shell.cg-al.compile@1",
  );
  assertEquals(
    c("mcp__al-tools__al_compile").classifier,
    "mcp-exact.al-tools.al_compile@1",
  );
  assertEquals(c("mcp__x__build").classifier, "mcp-token.build@1");
  assertEquals(CATEGORIES.length, 10);
});
